// Family-scoped operations shared by the public REST API (/api/v1/*) and the
// MCP server (/mcp). The dashboard's own routes predate this module; new
// programmatic surfaces should always go through here.

import type {
  ActivityEvent,
  CriteriaMode,
  Override,
  Policy,
  ReviewItem,
  ScreenTimeEntry,
  Settings,
  TestResponse,
  Verdict,
} from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { evaluateChannels, evaluateVideo } from './claude';
import type { Env } from './env';
import { activeMode, criteriaFor, effectiveMode } from './mode';
import { fetchChannelMetaServer, fetchVideoMetaServer, parseYouTubeUrl } from './yt';

function now(): number {
  return Date.now();
}

export async function getPolicy(env: Env, familyId: string): Promise<Policy> {
  const row = await env.DB.prepare(
    'SELECT criteria, weekend_criteria, settings_json, paused_until, updated_at FROM policies WHERE family_id = ?',
  )
    .bind(familyId)
    .first<{ criteria: string; weekend_criteria: string; settings_json: string; paused_until: number | null; updated_at: number }>();
  const overrides = await env.DB.prepare(
    'SELECT kind, target_id, decision, note, created_at FROM overrides WHERE family_id = ?',
  )
    .bind(familyId)
    .all<{ kind: string; target_id: string; decision: string; note: string | null; created_at: number }>();
  const parsed = row ? JSON.parse(row.settings_json) : {};
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...parsed,
    schedule: { ...DEFAULT_SETTINGS.schedule, ...(parsed.schedule ?? {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(parsed.notifications ?? {}) },
    distractions: { ...DEFAULT_SETTINGS.distractions, ...(parsed.distractions ?? {}) },
  };
  return {
    criteria: row?.criteria ?? '',
    weekendCriteria: row?.weekend_criteria ?? '',
    activeMode: activeMode(settings),
    settings,
    overrides: overrides.results.map((o) => ({
      kind: o.kind as Override['kind'],
      targetId: o.target_id,
      decision: o.decision as Override['decision'],
      note: o.note ?? undefined,
      createdAt: o.created_at,
    })),
    pausedUntil: row?.paused_until && row.paused_until > now() ? row.paused_until : null,
    updatedAt: row?.updated_at ?? 0,
  };
}

/**
 * Pause (or resume) ALL YouTube viewing for the family. Pass minutes to pause,
 * null to resume. Stored as its own column so criteria/settings saves can
 * never clobber an active pause. Does not bump updated_at (no cache flush
 * needed — devices pick the flag up on their next policy refresh).
 */
export async function setPause(env: Env, familyId: string, minutes: number | null): Promise<number | null> {
  const capped = minutes && minutes > 0 ? Math.min(Math.round(minutes), 7 * 24 * 60) : null;
  const pausedUntil = capped ? now() + capped * 60_000 : null;
  await env.DB.prepare('UPDATE policies SET paused_until = ? WHERE family_id = ?')
    .bind(pausedUntil, familyId)
    .run();
  return pausedUntil;
}

/**
 * Update one mode's criteria (settings untouched); clears only that mode's
 * cached AI verdicts so its content re-judges — the other mode stays warm.
 */
export async function updateCriteria(
  env: Env,
  familyId: string,
  criteria: string,
  mode: CriteriaMode = 'week',
): Promise<Policy> {
  const column = mode === 'weekend' ? 'weekend_criteria' : 'criteria';
  await env.DB.prepare(`UPDATE policies SET ${column} = ?, updated_at = ? WHERE family_id = ?`)
    .bind(criteria, now(), familyId)
    .run();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM channel_verdicts WHERE family_id = ? AND mode = ?').bind(familyId, mode),
    env.DB.prepare('DELETE FROM video_verdicts WHERE family_id = ? AND mode = ?').bind(familyId, mode),
  ]);
  return getPolicy(env, familyId);
}

export async function listReview(env: Env, familyId: string): Promise<ReviewItem[]> {
  const rows = await env.DB.prepare(
    "SELECT id, kind, target_id, title, reason, source, status, created_at FROM review_items WHERE family_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 200",
  )
    .bind(familyId)
    .all<{ id: number; kind: string; target_id: string; title: string; reason: string; source: string; status: string; created_at: number }>();
  return rows.results.map((r) => ({
    id: r.id,
    kind: r.kind as ReviewItem['kind'],
    targetId: r.target_id,
    title: r.title,
    reason: r.reason,
    source: r.source as ReviewItem['source'],
    status: r.status as ReviewItem['status'],
    createdAt: r.created_at,
  }));
}

export async function resolveReview(
  env: Env,
  familyId: string,
  id: number,
  action: 'allow' | 'block' | 'dismiss',
): Promise<boolean> {
  const item = await env.DB.prepare('SELECT id, kind, target_id FROM review_items WHERE family_id = ? AND id = ?')
    .bind(familyId, id)
    .first<{ id: number; kind: string; target_id: string }>();
  if (!item) return false;
  if (action === 'allow' || action === 'block') {
    await addOverride(env, familyId, item.kind as 'channel' | 'video', item.target_id, action, 'Decided from review');
  }
  await env.DB.prepare("UPDATE review_items SET status = 'resolved' WHERE id = ?").bind(id).run();
  return true;
}

export async function addOverride(
  env: Env,
  familyId: string,
  kind: 'channel' | 'video',
  targetId: string,
  decision: 'allow' | 'block',
  note?: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO overrides (family_id, kind, target_id, decision, note, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (family_id, kind, target_id) DO UPDATE SET decision = excluded.decision, note = excluded.note, created_at = excluded.created_at`,
  )
    .bind(familyId, kind, targetId, decision, note ?? null, now())
    .run();
  await env.DB.prepare('UPDATE policies SET updated_at = ? WHERE family_id = ?').bind(now(), familyId).run();
}

export async function listActivity(env: Env, familyId: string, limit = 100): Promise<ActivityEvent[]> {
  const rows = await env.DB.prepare(
    `SELECT e.id, d.name AS device_name, e.type, e.target_kind, e.target_id, e.title, e.detail_json, e.created_at
     FROM events e JOIN devices d ON d.id = e.device_id
     WHERE e.family_id = ? ORDER BY e.created_at DESC LIMIT ?`,
  )
    .bind(familyId, Math.min(limit, 500))
    .all<{ id: number; device_name: string; type: string; target_kind: string | null; target_id: string | null; title: string | null; detail_json: string | null; created_at: number }>();
  return rows.results.map((r) => {
    let detail: Record<string, unknown> | undefined;
    try {
      detail = r.detail_json ? (JSON.parse(r.detail_json) as Record<string, unknown>) : undefined;
    } catch {
      detail = undefined;
    }
    return {
      id: r.id,
      deviceName: r.device_name,
      type: r.type as ActivityEvent['type'],
      targetKind: (r.target_kind ?? undefined) as ActivityEvent['targetKind'],
      targetId: r.target_id ?? undefined,
      title: r.title ?? undefined,
      detail,
      createdAt: r.created_at,
    };
  });
}

/** Screen time today per device (UTC day; the counter events are cumulative, so take the max). */
export async function screenTimeToday(env: Env, familyId: string): Promise<ScreenTimeEntry[]> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const rows = await env.DB.prepare(
    `SELECT d.name AS device_name, e.detail_json FROM events e JOIN devices d ON d.id = e.device_id
     WHERE e.family_id = ? AND e.type = 'time_used' AND e.created_at >= ?`,
  )
    .bind(familyId, dayStart.getTime())
    .all<{ device_name: string; detail_json: string | null }>();
  const byDevice: Record<string, number> = {};
  for (const r of rows.results) {
    try {
      const seconds = Number((JSON.parse(r.detail_json ?? '{}') as { secondsToday?: number }).secondsToday ?? 0);
      byDevice[r.device_name] = Math.max(byDevice[r.device_name] ?? 0, seconds);
    } catch {
      /* skip malformed */
    }
  }
  return Object.entries(byDevice).map(([deviceName, secondsToday]) => ({ deviceName, secondsToday }));
}

export async function listDevices(env: Env, familyId: string) {
  const rows = await env.DB.prepare(
    'SELECT id, name, paired_at, last_seen_at FROM devices WHERE family_id = ? AND revoked = 0 ORDER BY paired_at DESC',
  )
    .bind(familyId)
    .all<{ id: string; name: string; paired_at: number | null; last_seen_at: number | null }>();
  return rows.results.map((d) => ({ id: d.id, name: d.name, pairedAt: d.paired_at, lastSeenAt: d.last_seen_at }));
}

export async function testUrl(env: Env, familyId: string, url: string): Promise<TestResponse | { error: string }> {
  const parsed = parseYouTubeUrl(url ?? '');
  if (!parsed) return { error: 'Not a recognizable YouTube video or channel URL' };
  const policy = await getPolicy(env, familyId);
  const mode = effectiveMode(policy);
  const criteria = criteriaFor(policy, mode);
  if (parsed.kind === 'video') {
    const meta = await fetchVideoMetaServer(parsed.videoId);
    if (!meta) return { error: 'Could not fetch video metadata' };
    const verdict = await evaluateVideo(env, policy.settings.model, criteria, meta, null);
    return { kind: 'video', extracted: meta, verdict, mode };
  }
  const meta = await fetchChannelMetaServer(parsed.ref);
  if (!meta) return { error: 'Could not fetch channel metadata' };
  const verdicts: Record<string, Verdict> = await evaluateChannels(env, policy.settings.model, criteria, [meta]);
  return { kind: 'channel', extracted: meta, verdict: verdicts[meta.channelId], mode };
}
