import type {
  ChannelMeta,
  EvaluateChannelsResponse,
  EvaluateVideoResponse,
  EventInput,
  Policy,
  Verdict,
} from '../../shared/types';
import type {
  BgRequest,
  ChannelVerdictsResponse,
  HeartbeatResponse,
  PairResult,
  StateResponse,
  VideoVerdictResponse,
} from './messages';
import { fetchVideoData } from './metadata';

interface Config {
  backendUrl: string;
  deviceToken: string;
  deviceId: string;
  deviceName: string;
}

interface Usage {
  date: string; // YYYY-MM-DD local
  seconds: number;
}

const HEARTBEAT_SECONDS = 30;
const POLICY_ALARM = 'skfbr-policy-sync';

// ---------- storage helpers ----------

async function get<T>(key: string): Promise<T | null> {
  const obj = await chrome.storage.local.get(key);
  return (obj[key] as T) ?? null;
}
async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

// Bound local verdict caches: keep the freshest N entries.
const MAX_CACHE_ENTRIES = 3000;
function pruneCache(cache: Record<string, Verdict>): Record<string, Verdict> {
  const entries = Object.entries(cache);
  if (entries.length <= MAX_CACHE_ENTRIES) return cache;
  entries.sort((a, b) => b[1].evaluatedAt - a[1].evaluatedAt);
  return Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES));
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- backend client ----------

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const config = await get<Config>('config');
  if (!config) throw new Error('not-paired');
  const res = await fetch(`${config.backendUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.deviceToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`backend ${res.status}`);
  return (await res.json()) as T;
}

async function postEvents(events: EventInput[]): Promise<void> {
  try {
    await api('/events', { method: 'POST', body: JSON.stringify({ events }) });
  } catch {
    // Activity logging is best-effort; never break enforcement over it.
  }
}

// ---------- policy sync ----------

async function syncPolicy(): Promise<Policy | null> {
  try {
    const policy = await api<Policy>('/policy');
    const previous = await get<Policy>('policy');
    if (previous && previous.updatedAt !== policy.updatedAt) {
      // Policy changed (criteria edits clear server caches too) — drop local caches.
      await chrome.storage.local.remove(['channelVerdicts', 'videoVerdicts']);
    }
    await set('policy', policy);
    return policy;
  } catch {
    return get<Policy>('policy'); // offline: keep enforcing the last-synced policy
  }
}

// MDM/enterprise deployments (Mosyle etc.) push backendUrl + a pre-minted
// deviceToken via Chrome managed storage — adopt it so devices self-pair
// with zero on-device setup.
async function adoptManagedConfig(): Promise<void> {
  try {
    const managed = await chrome.storage.managed.get(['backendUrl', 'deviceToken', 'deviceName']);
    const backendUrl = typeof managed.backendUrl === 'string' ? managed.backendUrl.trim() : '';
    const deviceToken = typeof managed.deviceToken === 'string' ? managed.deviceToken.trim() : '';
    if (!backendUrl || !deviceToken) return;
    const existing = await get<Config>('config');
    if (existing?.deviceToken === deviceToken && existing?.backendUrl === backendUrl.replace(/\/$/, '')) return;
    const config: Config = {
      backendUrl: backendUrl.replace(/\/$/, ''),
      deviceToken,
      deviceId: 'managed',
      deviceName: typeof managed.deviceName === 'string' ? managed.deviceName : 'Managed device',
    };
    await set('config', config);
    await syncPolicy();
  } catch {
    // storage.managed unavailable (no policy pushed) — manual pairing still works.
  }
}

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'managed') void adoptManagedConfig();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLICY_ALARM, { periodInMinutes: 5 });
  void adoptManagedConfig().then(() => syncPolicy());
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLICY_ALARM, { periodInMinutes: 5 });
  void adoptManagedConfig().then(() => syncPolicy());
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLICY_ALARM) void syncPolicy();
});

// ---------- verdict logic ----------

function failVerdict(policy: Policy | null, reason: string): Verdict {
  const failOpen = policy?.settings.failMode === 'open';
  return {
    decision: failOpen ? 'allow' : 'unsure',
    confidence: 0,
    reason,
    evaluatedAt: Date.now(),
    source: 'default',
  };
}

function overrideVerdict(policy: Policy | null, kind: 'channel' | 'video', targetId: string): Verdict | null {
  const o = policy?.overrides.find((x) => x.kind === kind && x.targetId === targetId);
  if (!o) return null;
  return {
    decision: o.decision,
    confidence: 1,
    reason: o.note || 'Set by parent',
    evaluatedAt: o.createdAt,
    source: 'override',
  };
}

async function evaluateChannelsHandler(channels: ChannelMeta[]): Promise<ChannelVerdictsResponse> {
  const policy = await get<Policy>('policy');
  const cache = (await get<Record<string, Verdict>>('channelVerdicts')) ?? {};
  const ttlMs = (policy?.settings.channelTtlDays ?? 30) * 24 * 60 * 60 * 1000;

  const out: Record<string, Verdict> = {};
  const misses: ChannelMeta[] = [];
  for (const ch of channels) {
    const override = overrideVerdict(policy, 'channel', ch.channelId);
    if (override) {
      out[ch.channelId] = override;
      continue;
    }
    const cached = cache[ch.channelId];
    if (cached && Date.now() - cached.evaluatedAt < ttlMs) {
      out[ch.channelId] = cached;
      continue;
    }
    misses.push(ch);
  }

  if (misses.length > 0) {
    try {
      const resp = await api<EvaluateChannelsResponse>('/evaluate/channels', {
        method: 'POST',
        body: JSON.stringify({ channels: misses }),
      });
      for (const [id, verdict] of Object.entries(resp.verdicts)) {
        out[id] = verdict;
        cache[id] = verdict;
      }
      await set('channelVerdicts', pruneCache(cache));
    } catch {
      const fallback = failVerdict(policy, 'Could not reach the family server');
      for (const ch of misses) out[ch.channelId] = fallback;
    }
  }
  return { verdicts: out };
}

async function evaluateVideoHandler(
  videoId: string,
  channelRef?: string,
  pageTitle?: string,
): Promise<VideoVerdictResponse> {
  const policy = await get<Policy>('policy');

  // Local override fast paths (server enforces the same rules).
  const videoOverride = overrideVerdict(policy, 'video', videoId);
  if (videoOverride) return { verdict: videoOverride };
  if (channelRef) {
    const chOverride = overrideVerdict(policy, 'channel', channelRef);
    if (chOverride?.decision === 'block') return { verdict: chOverride };
  }

  const cache = (await get<Record<string, Verdict>>('videoVerdicts')) ?? {};
  if (cache[videoId]) return { verdict: cache[videoId] };

  const fetched = await fetchVideoData(videoId);
  const meta = fetched?.meta ?? {
    videoId,
    title: pageTitle ?? '(title unavailable)',
    channelId: channelRef,
  };
  // Prefer the handle observed in the page DOM so the channel-verdict cache
  // (keyed by handle on feed pages) is consulted as the prior.
  if (channelRef) meta.channelId = channelRef;

  try {
    const resp = await api<EvaluateVideoResponse>('/evaluate/video', {
      method: 'POST',
      body: JSON.stringify({ video: meta, transcriptExcerpt: fetched?.transcriptExcerpt }),
    });
    cache[videoId] = resp.verdict;
    await set('videoVerdicts', pruneCache(cache));
    return { verdict: resp.verdict };
  } catch {
    return { verdict: failVerdict(policy, 'Could not reach the family server') };
  }
}

// ---------- timer ----------

// Parents expect a pause to land fast, so while any YouTube tab is heartbeating
// we refresh the policy every minute instead of waiting for the 5-minute alarm.
// In-memory is fine: a service-worker restart just means one extra refresh.
const POLICY_REFRESH_MS = 60_000;
let lastPolicyRefresh = 0;

async function heartbeat(playing: boolean): Promise<HeartbeatResponse> {
  if (Date.now() - lastPolicyRefresh > POLICY_REFRESH_MS) {
    lastPolicyRefresh = Date.now();
    await syncPolicy();
  }
  const policy = await get<Policy>('policy');
  const pausedUntil = policy?.pausedUntil && policy.pausedUntil > Date.now() ? policy.pausedUntil : null;
  const limitMinutes = policy?.settings.dailyLimitMinutes ?? null;

  let usage = (await get<Usage>('usage')) ?? { date: today(), seconds: 0 };
  if (usage.date !== today()) usage = { date: today(), seconds: 0 }; // midnight reset

  if (playing) {
    usage.seconds += HEARTBEAT_SECONDS;
    await set('usage', usage);
    // Report time to the activity feed every 5 minutes of watching.
    if (usage.seconds % 300 < HEARTBEAT_SECONDS) {
      void postEvents([{ type: 'time_used', detail: { secondsToday: usage.seconds } }]);
    }
  }

  if (limitMinutes === null) return { remainingSeconds: null, pausedUntil };
  return { remainingSeconds: Math.max(0, limitMinutes * 60 - usage.seconds), pausedUntil };
}

// ---------- pairing ----------

async function pair(backendUrl: string, code: string, deviceName: string): Promise<PairResult> {
  try {
    const url = backendUrl.replace(/\/$/, '');
    const res = await fetch(`${url}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceName }),
    });
    const data = (await res.json()) as { deviceToken?: string; deviceId?: string; error?: string };
    if (!res.ok || !data.deviceToken) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    const config: Config = { backendUrl: url, deviceToken: data.deviceToken, deviceId: data.deviceId!, deviceName };
    await set('config', config);
    await syncPolicy();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

// ---------- message router ----------

chrome.runtime.onMessage.addListener((message: BgRequest, _sender, sendResponse) => {
  void (async () => {
    switch (message.type) {
      case 'GET_STATE': {
        const config = await get<Config>('config');
        const hb = await heartbeat(false); // may refresh the policy — read it after
        const policy = await get<Policy>('policy');
        const state: StateResponse = {
          paired: !!config,
          backendUrl: config?.backendUrl ?? null,
          deviceName: config?.deviceName ?? null,
          policy,
          remainingSeconds: hb.remainingSeconds,
        };
        sendResponse(state);
        break;
      }
      case 'EVALUATE_CHANNELS':
        sendResponse(await evaluateChannelsHandler(message.channels));
        break;
      case 'EVALUATE_VIDEO':
        sendResponse(await evaluateVideoHandler(message.videoId, message.channelRef, message.pageTitle));
        break;
      case 'HEARTBEAT':
        sendResponse(await heartbeat(message.playing));
        break;
      case 'REQUEST_ACCESS':
        await postEvents([
          { type: 'request_access', targetKind: message.targetKind, targetId: message.targetId, title: message.title },
        ]);
        sendResponse({ ok: true });
        break;
      case 'REPORT_BLOCKED':
        await postEvents([
          { type: 'blocked', targetKind: message.targetKind, targetId: message.targetId, title: message.title },
        ]);
        sendResponse({ ok: true });
        break;
      case 'REPORT_WATCHED':
        await postEvents([
          { type: 'watched', targetKind: 'video', targetId: message.videoId, title: message.title },
        ]);
        sendResponse({ ok: true });
        break;
      case 'SYNC_POLICY':
        await syncPolicy();
        sendResponse({ ok: true });
        break;
      case 'PAIR':
        sendResponse(await pair(message.backendUrl, message.code, message.deviceName));
        break;
      case 'UNPAIR':
        await chrome.storage.local.clear();
        sendResponse({ ok: true });
        break;
    }
  })();
  return true; // async sendResponse
});
