import type { ChannelMeta, DistractionSettings, Verdict } from '../../shared/types';
import type {
  BgRequest,
  ChannelVerdictsResponse,
  HeartbeatResponse,
  StateResponse,
  VideoVerdictResponse,
} from './messages';

function send<T>(message: BgRequest): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

// ---------- state ----------

let state: StateResponse | null = null;
const channelVerdicts = new Map<string, Verdict>();
const pendingChannels = new Map<string, ChannelMeta>(); // queued for evaluation
const elementsByChannel = new Map<string, Set<HTMLElement>>();
let evaluateTimer: number | null = null;
let currentVideoId: string | null = null;
let gateAllowed = false;
let timeUp = false;

// Session-level verdict memory keyed by videoId, shared by the watch gate and
// the miniplayer guard so a video blocked on the watch page stays blocked when
// YouTube shifts playback into the corner miniplayer.
const allowedVideos = new Set<string>();
const deniedVideos = new Set<string>();

// Parent-initiated pause: while active, ALL viewing is blocked page-wide.
let pausedUntil: number | null = null;
let pauseShown = false;

// Criteria mode currently filtering this page. When the weekly schedule flips
// it (week ↔ weekend), everything on screen was judged by the old rules — so
// filtering resets and re-runs against the mode-scoped caches.
let currentMode: 'week' | 'weekend' = 'week';

// Embedded player on a third-party site (or youtube-nocookie): minimal gate mode.
const IS_EMBED = location.pathname.startsWith('/embed/');

const ITEM_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  // Newer YouTube markup: small/compact cards on home, related, and shelves.
  'yt-lockup-view-model',
  'ytd-rich-grid-media',
].join(',');

// Shorts cards (individual small tiles, various generations of markup).
const SHORTS_ITEM_SELECTOR = [
  'ytm-shorts-lockup-view-model',
  'ytm-shorts-lockup-view-model-v2',
  'ytd-reel-item-renderer',
  'shorts-lockup-view-model',
].join(',');

// ---------- overlay ----------

let overlayEl: HTMLElement | null = null;

// Brand shield-and-sprout mark (inline so no web-accessible resources are needed).
const BRAND_SVG =
  '<svg width="15" height="15" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="4" y="4" width="120" height="120" rx="30" fill="#ea580c"/>' +
  '<path d="M64 15 L105 30 V62 C105 90 88 107 64 115 C40 107 23 90 23 62 V30 Z" fill="#fff"/>' +
  '<path d="M64 96 C64 96 64 78 64 70 M64 70 C64 52 52 42 34 42 C34 62 46 72 64 70 M64 62 C64 46 76 36 94 36 C94 56 82 66 64 62" fill="none" stroke="#ea580c" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M34 42 C34 62 46 72 62 70 C62 52 52 42 34 42 Z" fill="#ea580c"/>' +
  '<path d="M94 36 C94 56 82 66 66 62 C66 46 76 36 94 36 Z" fill="#f97316"/></svg>';

// State icons for the overlay — branded line icons instead of OS emoji.
type OverlayIcon = 'checking' | 'blocked' | 'time' | 'paused';
const ICON_SVG: Record<OverlayIcon, string> = {
  checking:
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.2 15.2 L20.5 20.5"/></svg>',
  blocked:
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2.2" stroke-linecap="round">' +
    '<circle cx="12" cy="12" r="9"/><path d="M5.8 5.8 L18.2 18.2"/></svg>',
  time:
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="#ea580c">' +
    '<path d="M12.5 3 A 9 9 0 1 0 21 11.5 A 7.2 7.2 0 0 1 12.5 3 Z"/></svg>',
  paused:
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="#ea580c">' +
    '<rect x="7" y="5" width="3.6" height="14" rx="1.6"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.6"/></svg>',
};

function showOverlay(opts: {
  icon: OverlayIcon;
  title: string;
  message: string;
  spinner?: boolean;
  requestAccess?: { targetKind: 'channel' | 'video'; targetId: string; title: string };
  onRecheck?: () => void;
}): void {
  removeOverlay();
  const el = document.createElement('div');
  el.className = 'skfbr-overlay';
  const card = document.createElement('div');
  card.className = 'skfbr-card';

  const emoji = document.createElement('div');
  emoji.className = 'skfbr-emoji';
  emoji.innerHTML = ICON_SVG[opts.icon];
  const h1 = document.createElement('h1');
  h1.textContent = opts.title;
  const p = document.createElement('p');
  p.textContent = opts.message;
  card.append(emoji, h1, p);

  if (opts.spinner) {
    const spin = document.createElement('div');
    spin.className = 'skfbr-spinner';
    card.append(spin);
  }
  if (opts.requestAccess || opts.onRecheck) {
    const actions = document.createElement('div');
    actions.className = 'skfbr-actions';
    if (opts.requestAccess) {
      const btn = document.createElement('button');
      btn.textContent = 'Ask my grown-up';
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = 'Asked! They’ll take a look 💌';
        void send(({ type: 'REQUEST_ACCESS', ...opts.requestAccess! }) as BgRequest);
      });
      actions.append(btn);
    }
    if (opts.onRecheck) {
      const recheckBtn = document.createElement('button');
      recheckBtn.className = 'skfbr-ghost';
      recheckBtn.textContent = 'Check again';
      recheckBtn.addEventListener('click', () => {
        recheckBtn.disabled = true;
        opts.onRecheck!();
      });
      actions.append(recheckBtn);
    }
    card.append(actions);
  }

  const brand = document.createElement('div');
  brand.className = 'skfbr-brand';
  brand.innerHTML = BRAND_SVG;
  brand.append(' Protected by SaveKidsFromBrainRot');
  card.append(brand);

  el.append(card);
  document.documentElement.append(el);
  overlayEl = el;
}

function removeOverlay(): void {
  overlayEl?.remove();
  overlayEl = null;
}

// ---------- video pausing (gate) ----------

let pauseInterval: number | null = null;

function holdPlayback(): void {
  if (pauseInterval !== null) return;
  pauseInterval = window.setInterval(() => {
    for (const v of document.querySelectorAll('video')) {
      if (!v.paused) v.pause();
      v.muted = true;
    }
  }, 250);
}

function releasePlayback(): void {
  if (pauseInterval !== null) {
    clearInterval(pauseInterval);
    pauseInterval = null;
  }
  const v = document.querySelector('video');
  if (v) {
    v.muted = false;
    void v.play().catch(() => undefined);
  }
}

// ---------- channel extraction from feed items ----------

function channelRefFromHref(href: string | null): string | null {
  if (!href) return null;
  const handle = href.match(/\/(@[\w.-]+)/);
  if (handle) return handle[1];
  const chan = href.match(/\/channel\/(UC[\w-]+)/);
  if (chan) return chan[1];
  return null;
}

function extractItem(el: HTMLElement): { channelRef: string; channelName: string; videoTitle: string } | null {
  let channelRef: string | null = null;
  let channelName = '';
  for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const ref = channelRefFromHref(a.getAttribute('href'));
    if (ref) {
      channelRef = ref;
      channelName = a.textContent?.trim() || channelName;
      break;
    }
  }
  if (!channelRef) {
    // Newest YouTube markup often shows the channel as plain text, not a link.
    // Fall back to the name itself as the channel identity — the AI judges from
    // the name + video titles anyway, and the verdict cache stays consistent.
    channelName = extractChannelNameText(el);
    if (channelName) channelRef = `name:${channelName.toLowerCase()}`;
  }
  if (!channelRef) return null;
  const videoTitle =
    el.querySelector('#video-title, .yt-lockup-metadata-view-model__title, h3')?.textContent?.trim() ?? '';
  return { channelRef, channelName: channelName || channelRef, videoTitle };
}

function extractChannelNameText(el: HTMLElement): string {
  const candidates = el.querySelectorAll(
    'ytd-channel-name #text, ytd-channel-name, yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row:first-child, [class*="metadata-view-model"] [class*="metadata-row"]:first-child',
  );
  for (const c of candidates) {
    const text = c.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    // Skip rows that are clearly view counts / timestamps ("1.2M views · 3 days ago").
    if (text && !/^\d|^[\d.,]+[KMB]? views/i.test(text)) {
      // A metadata row may join name and stats with a separator — keep the name part.
      return text.split('·')[0].trim().slice(0, 120);
    }
  }
  return '';
}

/** Does this element link to playable content (a watch page or a Short)? */
function hasVideoLink(el: HTMLElement): boolean {
  return !!el.querySelector('a[href*="watch?v="], a[href^="/shorts/"]');
}

function isShortsItem(el: HTMLElement): boolean {
  return el.matches(SHORTS_ITEM_SELECTOR) || !!el.querySelector('a[href^="/shorts/"]');
}

function applyVerdictToElement(el: HTMLElement, verdict: Verdict): void {
  el.classList.remove('skfbr-pending');
  if (verdict.decision === 'allow') {
    el.classList.remove('skfbr-blocked');
  } else {
    // block and unsure are both hidden from the feed; unsure lands in the
    // parent's review queue server-side.
    el.classList.add('skfbr-blocked');
  }
}

function processFeedItem(el: HTMLElement): void {
  if (el.dataset.skfbr) return;
  // Old and new markup nest (a lockup inside a rich-item renderer): the outer
  // element owns the decision; skip inner matches.
  if (el.parentElement?.closest('[data-skfbr]')) return;

  // Shorts tiles: no per-channel logic — policy decides wholesale.
  if (state?.policy?.settings.blockShorts && isShortsItem(el)) {
    el.dataset.skfbr = 'shorts';
    el.classList.add('skfbr-blocked');
    return;
  }

  const info = extractItem(el);
  if (!info) {
    // Video card whose channel we couldn't attribute (new/changed markup).
    // Fail closed: hide it unless the parent chose fail-open. Non-video UI
    // cards (chips, prompts) are left alone.
    if (hasVideoLink(el)) {
      el.dataset.skfbr = 'unattributed';
      if (state?.policy?.settings.failMode !== 'open') el.classList.add('skfbr-blocked');
    }
    return;
  }
  el.dataset.skfbr = info.channelRef;

  const known = channelVerdicts.get(info.channelRef);
  if (known) {
    applyVerdictToElement(el, known);
    return;
  }

  el.classList.add('skfbr-pending');
  let set = elementsByChannel.get(info.channelRef);
  if (!set) {
    set = new Set();
    elementsByChannel.set(info.channelRef, set);
  }
  set.add(el);

  const existing = pendingChannels.get(info.channelRef);
  if (existing) {
    if (info.videoTitle && !existing.videoTitles!.includes(info.videoTitle)) {
      existing.videoTitles!.push(info.videoTitle);
    }
  } else {
    pendingChannels.set(info.channelRef, {
      channelId: info.channelRef,
      title: info.channelName,
      handle: info.channelRef.startsWith('@') ? info.channelRef : undefined,
      videoTitles: info.videoTitle ? [info.videoTitle] : [],
    });
  }
  scheduleEvaluation();
}

function scheduleEvaluation(): void {
  if (evaluateTimer !== null) return;
  evaluateTimer = window.setTimeout(() => {
    evaluateTimer = null;
    void flushEvaluation();
  }, 800);
}

async function flushEvaluation(): Promise<void> {
  if (pendingChannels.size === 0) return;
  // Small batches keep each backend call fast enough that the service worker
  // never dies mid-await (which would strand tiles in the blurred state).
  const batch = Array.from(pendingChannels.values()).slice(0, 10);
  for (const ch of batch) pendingChannels.delete(ch.channelId);
  try {
    const resp = await Promise.race([
      send<ChannelVerdictsResponse>({ type: 'EVALUATE_CHANNELS', channels: batch }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 90_000)),
    ]);
    if (!resp) throw new Error('timeout');
    for (const [id, verdict] of Object.entries(resp.verdicts)) {
      channelVerdicts.set(id, verdict);
      const els = elementsByChannel.get(id);
      if (els) {
        for (const el of els) applyVerdictToElement(el, verdict);
        elementsByChannel.delete(id);
      }
    }
  } catch {
    // Response lost (worker restarted or call timed out) — re-queue this batch
    // so blurred tiles self-heal instead of sticking forever.
    for (const ch of batch) {
      if (!channelVerdicts.has(ch.channelId)) pendingChannels.set(ch.channelId, ch);
    }
  }
  if (pendingChannels.size > 0) scheduleEvaluation();
}

// ---------- Shorts ----------

function hideShortsShelves(): void {
  if (!state?.policy?.settings.blockShorts) return;
  const shelfSelectors = ['ytd-rich-shelf-renderer[is-shorts]', 'ytd-reel-shelf-renderer', 'grid-shelf-view-model'];
  for (const sel of shelfSelectors) {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      // grid-shelf-view-model is generic — only hide it when it holds Shorts.
      if (sel !== 'grid-shelf-view-model' || el.querySelector('a[href^="/shorts/"]')) {
        el.classList.add('skfbr-blocked');
      }
    }
  }
  // Individual Shorts tiles anywhere else on the page.
  for (const el of document.querySelectorAll<HTMLElement>(SHORTS_ITEM_SELECTOR)) {
    el.classList.add('skfbr-blocked');
  }
  // Shorts entry in the sidebar.
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[title="Shorts"], a[href^="/shorts"]')) {
    const entry = a.closest<HTMLElement>('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer');
    entry?.classList.add('skfbr-blocked');
  }
}

// ---------- watch page gate ----------

async function gateWatchPage(): Promise<void> {
  const url = new URL(location.href);
  const videoId = url.searchParams.get('v');
  if (!videoId || videoId === currentVideoId) return;
  currentVideoId = videoId;
  gateAllowed = false;

  holdPlayback();
  showOverlay({
    icon: 'checking',
    title: 'One second…',
    message: "Checking this video against your family's rules.",
    spinner: true,
  });

  // Give the page a moment to render the owner link so we can grab the handle.
  const channelRef = await waitForChannelRef(3000);
  const pageTitle = document.title.replace(/ - YouTube$/, '');

  const resp = await send<VideoVerdictResponse>({
    type: 'EVALUATE_VIDEO',
    videoId,
    channelRef: channelRef ?? undefined,
    pageTitle,
  });

  if (videoId !== currentVideoId) return; // user already navigated away
  if (pauseActive()) return; // pause landed mid-evaluation — its overlay stays

  if (resp.verdict.decision === 'allow') {
    gateAllowed = true;
    deniedVideos.delete(videoId);
    allowedVideos.add(videoId);
    removeOverlay();
    releasePlayback();
    void send({ type: 'REPORT_WATCHED', videoId, title: pageTitle });
  } else {
    allowedVideos.delete(videoId);
    deniedVideos.add(videoId);
    void send({ type: 'REPORT_BLOCKED', targetKind: 'video', targetId: videoId, title: pageTitle });
    showOverlay({
      icon: 'blocked',
      title: "This one isn't on your list",
      message:
        resp.verdict.decision === 'unsure'
          ? 'We asked your grown-up to take a look at this video first.'
          : 'This video doesn\'t match your family\'s rules. Let\'s find something else!',
      requestAccess: { targetKind: 'video', targetId: videoId, title: pageTitle },
      // "Check again": re-sync policy immediately so a parent approval takes
      // effect right away instead of waiting for the 5-minute poll.
      onRecheck: () => {
        void (async () => {
          showOverlay({ icon: 'checking', title: 'One second…', message: 'Checking with the latest rules.', spinner: true });
          await send({ type: 'SYNC_POLICY' });
          currentVideoId = null;
          void gateWatchPage();
        })();
      },
    });
  }
}

async function gateEmbed(): Promise<void> {
  holdPlayback();
  const m = location.pathname.match(/^\/embed\/([\w-]{6,})/);
  const videoId = m && m[1] !== 'videoseries' ? m[1] : null;

  if (!videoId) {
    // Playlist embeds and unrecognized paths can't be evaluated per-video.
    if (state?.policy?.settings.failMode === 'open') {
      releasePlayback();
      return;
    }
    showOverlay({
      icon: 'blocked',
      title: "Can't check this one",
      message: 'This embedded player could not be checked, so it stays off.',
    });
    return;
  }

  showOverlay({
    icon: 'checking',
    title: 'One second…',
    message: "Checking this video against your family's rules.",
    spinner: true,
  });
  const title = document.title || videoId;
  const resp = await send<VideoVerdictResponse>({ type: 'EVALUATE_VIDEO', videoId, pageTitle: title });
  if (pauseActive()) return; // pause landed mid-evaluation — its overlay stays

  if (resp.verdict.decision === 'allow') {
    gateAllowed = true;
    removeOverlay();
    releasePlayback();
    void send({ type: 'REPORT_WATCHED', videoId, title });
  } else {
    void send({ type: 'REPORT_BLOCKED', targetKind: 'video', targetId: videoId, title });
    showOverlay({
      icon: 'blocked',
      title: "This one isn't on your list",
      message:
        resp.verdict.decision === 'unsure'
          ? 'We asked your grown-up to take a look at this video first.'
          : "This video doesn't match your family's rules.",
      requestAccess: { targetKind: 'video', targetId: videoId, title },
      onRecheck: () => {
        void (async () => {
          showOverlay({ icon: 'checking', title: 'One second…', message: 'Checking with the latest rules.', spinner: true });
          await send({ type: 'SYNC_POLICY' });
          void gateEmbed();
        })();
      },
    });
  }
}

// ---------- distraction removal (Unhook-style, parent-controlled) ----------
// Pure UI hiding via classes on <html>; the CSS rules live in content.css.
// Settings arrive with the policy at init and refresh via the 30s heartbeat.

let distractions: DistractionSettings | null = null;

const DISTRACTION_CLASSES: Array<[keyof DistractionSettings, string]> = [
  ['hideHomeFeed', 'skfbr-hide-home'],
  ['hideRelated', 'skfbr-hide-related'],
  ['hideComments', 'skfbr-hide-comments'],
  ['hideEndScreens', 'skfbr-hide-endscreens'],
  ['hideNotifications', 'skfbr-hide-bell'],
  ['hideExplore', 'skfbr-hide-explore'],
  ['hideLiveChat', 'skfbr-hide-chat'],
  ['hideChips', 'skfbr-hide-chips'],
];

function applyDistractions(d: DistractionSettings | null | undefined): void {
  if (!d) return;
  distractions = d;
  for (const [key, cls] of DISTRACTION_CLASSES) {
    document.documentElement.classList.toggle(cls, !!d[key]);
  }
  maybeRedirectHome();
}

function maybeRedirectHome(): void {
  if (!IS_EMBED && distractions?.redirectHomeToSubs && location.pathname === '/') {
    location.replace('/feed/subscriptions');
  }
}

/** Keep the player's autoplay toggle off — YouTube re-enables it quietly. */
function guardAutoplay(): void {
  if (!distractions?.disableAutoplay) return;
  const toggle = document.querySelector<HTMLElement>('.ytp-autonav-toggle-button[aria-checked="true"]');
  toggle?.click();
}

// ---------- mode flips ----------

/** Wipe all filtering state and re-judge the page under the new mode. */
function resetFiltering(): void {
  channelVerdicts.clear();
  pendingChannels.clear();
  elementsByChannel.clear();
  if (evaluateTimer !== null) {
    clearTimeout(evaluateTimer);
    evaluateTimer = null;
  }
  allowedVideos.clear();
  deniedVideos.clear();
  for (const el of document.querySelectorAll<HTMLElement>('[data-skfbr]')) {
    delete el.dataset.skfbr;
    el.classList.remove('skfbr-blocked', 'skfbr-pending');
  }
  currentVideoId = null;
  if (IS_EMBED) {
    void gateEmbed();
    return;
  }
  onNavigate(); // re-gate the watch page if we're on one
  for (const el of document.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) processFeedItem(el);
  hideShortsShelves();
}

// ---------- parent pause ----------

function pauseActive(): boolean {
  return pausedUntil !== null && Date.now() < pausedUntil;
}

function showPauseOverlay(): void {
  holdPlayback();
  const until = new Date(pausedUntil!);
  showOverlay({
    icon: 'paused',
    title: 'YouTube is on a break',
    message: `A grown-up pressed pause. Back at ${until.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`,
  });
}

/** Idempotent: called on every heartbeat and every 500ms tick. */
function reconcilePause(): void {
  const active = pauseActive();
  if (active) {
    // Show (or re-show, if another flow replaced our overlay) the pause screen.
    if (!pauseShown || !overlayEl) {
      pauseShown = true;
      showPauseOverlay();
    }
  } else if (pauseShown) {
    // Pause expired or a parent resumed — return to normal gating.
    pauseShown = false;
    removeOverlay();
    if (IS_EMBED) {
      void gateEmbed();
    } else {
      currentVideoId = null;
      onNavigate();
    }
  }
}

// ---------- miniplayer guard ----------
// YouTube's corner miniplayer can play a video that never passed the watch
// gate: navigating away from a blocked watch page shifts playback into it, and
// "Add to queue" starts it without visiting /watch at all. Anything playing
// there must hold an allow verdict; otherwise pause it and close the player.

let miniplayerChecking: string | null = null;

function activeMiniplayer(): HTMLElement | null {
  const mp = document.querySelector<HTMLElement>('ytd-miniplayer');
  if (!mp) return null;
  return mp.hasAttribute('active') || mp.querySelector('video') ? mp : null;
}

function miniplayerVideoId(mp: HTMLElement): string | null {
  const links = [
    ...mp.querySelectorAll<HTMLAnchorElement>('a[href*="watch"]'),
    ...mp.querySelectorAll<HTMLAnchorElement>('.ytp-title-link[href*="watch"]'),
  ];
  for (const a of links) {
    try {
      const v = new URL(a.href, location.origin).searchParams.get('v');
      if (v) return v;
    } catch {
      /* malformed href — keep looking */
    }
  }
  return null;
}

function silenceMiniplayer(mp: HTMLElement): void {
  for (const v of mp.querySelectorAll('video')) {
    if (!v.paused) v.pause();
    v.muted = true;
  }
}

function closeMiniplayer(mp: HTMLElement): void {
  silenceMiniplayer(mp); // display:none alone would keep the audio going
  mp.querySelector<HTMLElement>(
    '.ytp-miniplayer-close-button, #close-button button, button[aria-label*="close" i]',
  )?.click();
  mp.classList.add('skfbr-blocked');
}

function guardMiniplayer(): void {
  if (location.pathname === '/watch') return; // the watch gate owns playback here
  const mp = activeMiniplayer();
  if (!mp) return;
  if (timeUp || pauseActive()) {
    closeMiniplayer(mp);
    return;
  }
  const videoId = miniplayerVideoId(mp);
  if (!videoId) {
    // Can't tell what it's playing — fail closed unless the parent chose open.
    if (state?.policy?.settings.failMode !== 'open') closeMiniplayer(mp);
    return;
  }
  if (allowedVideos.has(videoId)) {
    mp.classList.remove('skfbr-blocked');
    return;
  }
  if (deniedVideos.has(videoId)) {
    closeMiniplayer(mp);
    return;
  }
  // Unvetted video (queue play): hold it silent while we check.
  silenceMiniplayer(mp);
  if (miniplayerChecking === videoId) return;
  miniplayerChecking = videoId;
  const title =
    mp.querySelector('#info-bar, .miniplayer-title, [class*="title"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  void (async () => {
    try {
      const resp = await send<VideoVerdictResponse>({ type: 'EVALUATE_VIDEO', videoId, pageTitle: title });
      if (resp.verdict.decision === 'allow') {
        allowedVideos.add(videoId);
        const cur = activeMiniplayer();
        if (cur && miniplayerVideoId(cur) === videoId) {
          cur.classList.remove('skfbr-blocked');
          for (const v of cur.querySelectorAll('video')) {
            v.muted = false;
            void v.play().catch(() => undefined);
          }
        }
        void send({ type: 'REPORT_WATCHED', videoId, title });
      } else {
        deniedVideos.add(videoId);
        void send({ type: 'REPORT_BLOCKED', targetKind: 'video', targetId: videoId, title });
        const cur = activeMiniplayer();
        if (cur) closeMiniplayer(cur);
      }
    } catch {
      // Verdict lost (worker restart) — leave it silenced; next tick retries.
    } finally {
      if (miniplayerChecking === videoId) miniplayerChecking = null;
    }
  })();
}

function waitForChannelRef(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const link = document.querySelector<HTMLAnchorElement>(
        'ytd-watch-metadata ytd-channel-name a[href], ytd-video-owner-renderer a[href]',
      );
      const ref = channelRefFromHref(link?.getAttribute('href') ?? null);
      if (ref) return resolve(ref);
      if (Date.now() - started > timeoutMs) return resolve(null);
      setTimeout(tick, 200);
    };
    tick();
  });
}

// ---------- timer ----------

function startHeartbeat(): void {
  window.setInterval(() => {
    void (async () => {
      const video = document.querySelector('video');
      const inWatchContext = location.pathname === '/watch' || IS_EMBED;
      const mp = IS_EMBED ? null : activeMiniplayer();
      const mpId = mp ? miniplayerVideoId(mp) : null;
      const mpPlaying =
        !!mp && !!mpId && allowedVideos.has(mpId) && [...mp.querySelectorAll('video')].some((v) => !v.paused);
      const playing = (!!video && !video.paused && gateAllowed && inWatchContext) || mpPlaying;
      const resp = await send<HeartbeatResponse>({ type: 'HEARTBEAT', playing });
      pausedUntil = resp.pausedUntil;
      reconcilePause();
      applyDistractions(resp.distractions);
      if (resp.activeMode && resp.activeMode !== currentMode) {
        currentMode = resp.activeMode;
        resetFiltering();
      }
      if (resp.remainingSeconds !== null && resp.remainingSeconds <= 0 && !timeUp) {
        timeUp = true;
        holdPlayback();
        showOverlay({
          icon: 'time',
          title: "That's all for today!",
          message: 'Your YouTube time is used up. It resets tomorrow — go build something cool!',
        });
      }
    })();
  }, 30_000);
}

// ---------- routing ----------

function onNavigate(): void {
  if (pauseActive()) {
    // The pause screen owns the page regardless of where they navigate.
    pauseShown = true;
    showPauseOverlay();
    return;
  }
  maybeRedirectHome();
  removeOverlay();
  if (timeUp) {
    holdPlayback();
    showOverlay({
      icon: 'time',
      title: "That's all for today!",
      message: 'Your YouTube time is used up. It resets tomorrow — go build something cool!',
    });
    return;
  }
  if (location.pathname.startsWith('/shorts')) {
    if (state?.policy?.settings.blockShorts) {
      holdPlayback();
      showOverlay({
        icon: 'blocked',
        title: 'No Shorts here',
        message: 'Shorts are turned off for this computer. How about a real video instead?',
      });
    }
    return;
  }
  if (location.pathname === '/watch') {
    void gateWatchPage();
    return;
  }
  currentVideoId = null;
  releasePlaybackIfIdle();
}

function releasePlaybackIfIdle(): void {
  // Leaving a gated page: stop the pause loop so browsing works normally.
  if (pauseInterval !== null && location.pathname !== '/watch' && !location.pathname.startsWith('/shorts')) {
    clearInterval(pauseInterval);
    pauseInterval = null;
  }
}

async function init(): Promise<void> {
  try {
    state = await send<StateResponse>({ type: 'GET_STATE' });
  } catch {
    state = null;
  }
  // Not paired yet → do nothing (setup mode). Once paired, enforcement is on.
  if (!state?.paired) return;

  if (state.remainingSeconds !== null && state.remainingSeconds <= 0) timeUp = true;
  pausedUntil = state.policy?.pausedUntil ?? null;
  currentMode =
    state.policy?.weekendCriteria?.trim() && state.policy.activeMode === 'weekend' ? 'weekend' : 'week';
  if (!IS_EMBED) applyDistractions(state.policy?.settings.distractions);

  if (IS_EMBED) {
    if (state.policy?.settings.filterEmbeds === false) return;
    if (timeUp) {
      holdPlayback();
      showOverlay({
        icon: 'time',
        title: "That's all for today!",
        message: 'Your YouTube time is used up. It resets tomorrow.',
      });
      return;
    }
    startHeartbeat();
    window.setInterval(reconcilePause, 500);
    if (pauseActive()) {
      reconcilePause();
      return; // gateEmbed runs when the pause lifts
    }
    void gateEmbed();
    return; // no feed observers or SPA navigation inside an embed
  }

  const observer = new MutationObserver(() => {
    for (const el of document.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) processFeedItem(el);
    hideShortsShelves();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // YouTube is a SPA — watch for soft navigations.
  window.addEventListener('yt-navigate-finish', onNavigate);
  let lastHref = location.href;
  window.setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onNavigate();
    }
  }, 500);

  // Twice a second: keep the pause state honest (expiry, overlay stomps),
  // watch the miniplayer, and hold autoplay off — all cheap, all independent
  // of navigation.
  window.setInterval(() => {
    reconcilePause();
    guardMiniplayer();
    guardAutoplay();
  }, 500);

  startHeartbeat();
  onNavigate();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}
