import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type {
  ActivityEvent,
  ChannelMeta,
  DeviceInfo,
  ExportBundle,
  EvaluateChannelsRequest,
  EvaluateChannelsResponse,
  EvaluateVideoRequest,
  EvaluateVideoResponse,
  EventInput,
  Override,
  PairRequest,
  PairResponse,
  Policy,
  ReviewItem,
  Settings,
  TestRequest,
  TestResponse,
  Verdict,
  VideoMeta,
} from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import {
  PAIRING_CODE_TTL_MS,
  SESSION_TTL_MS,
  hashPassword,
  newSalt,
  pairingCode,
  randomId,
  randomToken,
} from './auth';
import { evaluateChannels, evaluateVideo } from './claude';
import type { AppContext } from './env';
import { handleMcpRequest } from './mcp';
import { activeMode, criteriaFor, effectiveMode } from './mode';
import { notifyParent, sendDirect, shouldNotify } from './notify';
import * as service from './service';
import { fetchChannelMetaServer, fetchVideoMetaServer, parseYouTubeUrl } from './yt';

const app = new Hono<AppContext>();

app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'] }));

app.onError((err, c) => {
  console.error(`unhandled error on ${c.req.method} ${c.req.path}: ${err.stack ?? err.message}`);
  return c.json({ error: 'Internal error' }, 500);
});

// ---------- helpers ----------

function now(): number {
  return Date.now();
}

function bearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

async function loadPolicy(db: D1Database, familyId: string): Promise<Policy> {
  const row = await db
    .prepare('SELECT criteria, weekend_criteria, settings_json, paused_until, updated_at FROM policies WHERE family_id = ?')
    .bind(familyId)
    .first<{ criteria: string; weekend_criteria: string; settings_json: string; paused_until: number | null; updated_at: number }>();
  const overrides = await db
    .prepare('SELECT kind, target_id, decision, note, created_at FROM overrides WHERE family_id = ?')
    .bind(familyId)
    .all<{ kind: string; target_id: string; decision: string; note: string | null; created_at: number }>();
  const parsed = row ? JSON.parse(row.settings_json) : {};
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...parsed,
    schedule: { ...DEFAULT_SETTINGS.schedule, ...(parsed.schedule ?? {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(parsed.notifications ?? {}) },
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
    pausedUntil: row?.paused_until && row.paused_until > Date.now() ? row.paused_until : null,
    updatedAt: row?.updated_at ?? 0,
  };
}

async function addReviewItem(
  db: D1Database,
  familyId: string,
  kind: 'channel' | 'video',
  targetId: string,
  title: string,
  reason: string,
  source: ReviewItem['source'],
): Promise<boolean> {
  const existing = await db
    .prepare(
      "SELECT id FROM review_items WHERE family_id = ? AND kind = ? AND target_id = ? AND status = 'pending'",
    )
    .bind(familyId, kind, targetId)
    .first();
  if (existing) return false;
  await db
    .prepare(
      'INSERT INTO review_items (family_id, kind, target_id, title, reason, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(familyId, kind, targetId, title, reason, source, now())
    .run();
  return true;
}

// ---------- parent auth ----------

app.post('/auth/signup', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  if (!email?.includes('@') || !password || password.length < 8) {
    return c.json({ error: 'Valid email and a password of 8+ characters required' }, 400);
  }
  const db = c.env.DB;
  // Self-hosted single-family default: the first signup claims this server and
  // closes registration (every account shares the operator's Anthropic bill).
  // Hosting several families on one instance is an explicit opt-in:
  //   npx wrangler secret put OPEN_SIGNUPS   (value: true)
  if (c.env.OPEN_SIGNUPS !== 'true') {
    const anyFamily = await db.prepare('SELECT id FROM families LIMIT 1').first();
    if (anyFamily) {
      return c.json(
        { error: 'Signups are closed on this server. Deploy your own instance (see SETUP.md) — it takes about ten minutes.' },
        403,
      );
    }
  }
  const existing = await db.prepare('SELECT id FROM families WHERE email = ?').bind(email.toLowerCase()).first();
  if (existing) return c.json({ error: 'An account with this email already exists' }, 409);

  const familyId = randomId('fam');
  const salt = newSalt();
  const hash = await hashPassword(password, salt);
  await db
    .prepare('INSERT INTO families (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(familyId, email.toLowerCase(), hash, salt, now())
    .run();
  await db
    .prepare('INSERT INTO policies (family_id, criteria, settings_json, updated_at) VALUES (?, ?, ?, ?)')
    .bind(familyId, '', JSON.stringify(DEFAULT_SETTINGS), now())
    .run();

  const token = randomToken();
  await db
    .prepare('INSERT INTO sessions (token, family_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, familyId, now() + SESSION_TTL_MS)
    .run();
  return c.json({ sessionToken: token });
});

app.post('/auth/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const db = c.env.DB;
  const fam = await db
    .prepare('SELECT id, password_hash, password_salt FROM families WHERE email = ?')
    .bind((email ?? '').toLowerCase())
    .first<{ id: string; password_hash: string; password_salt: string }>();
  if (!fam) return c.json({ error: 'Invalid email or password' }, 401);
  const hash = await hashPassword(password ?? '', fam.password_salt);
  if (hash !== fam.password_hash) return c.json({ error: 'Invalid email or password' }, 401);

  const token = randomToken();
  await db
    .prepare('INSERT INTO sessions (token, family_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, fam.id, now() + SESSION_TTL_MS)
    .run();
  return c.json({ sessionToken: token });
});

app.post('/auth/logout', async (c) => {
  const token = bearer(c.req.header('Authorization'));
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return c.json({ ok: true });
});

// Password reset: a 6-digit code delivered to the account email (Resend, if
// configured) and/or the family's ntfy topic. Valid 30 minutes, single-use.
app.post('/auth/request-reset', async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  const db = c.env.DB;
  const fam = await db
    .prepare('SELECT id, email FROM families WHERE email = ?')
    .bind((email ?? '').toLowerCase())
    .first<{ id: string; email: string }>();
  if (!fam) return c.json({ ok: true }); // don't reveal whether the account exists

  const policy = await loadPolicy(db, fam.id);
  const ntfyTopic = policy.settings.notifications?.ntfyTopic ?? null;
  const canEmail = !!c.env.RESEND_API_KEY;
  if (!ntfyTopic && !canEmail) {
    return c.json(
      { error: 'No delivery channel available. Set an ntfy topic in Notifications (or configure email on the backend) first.' },
      400,
    );
  }

  const code = pairingCode();
  await db
    .prepare('INSERT OR REPLACE INTO password_resets (family_id, code, expires_at, used) VALUES (?, ?, ?, 0)')
    .bind(fam.id, code, now() + 30 * 60 * 1000)
    .run();
  await sendDirect(
    c.env,
    { ntfyTopic, email: canEmail ? fam.email : null },
    'Password reset code',
    `Your SaveKidsFromBrainRot password reset code is: ${code}\nIt expires in 30 minutes. If you didn't request this, ignore it.`,
  );
  return c.json({ ok: true });
});

app.post('/auth/reset', async (c) => {
  const { email, code, newPassword } = await c.req.json<{ email: string; code: string; newPassword: string }>();
  if (!newPassword || newPassword.length < 8) {
    return c.json({ error: 'New password must be 8+ characters' }, 400);
  }
  const db = c.env.DB;
  const fam = await db
    .prepare('SELECT id FROM families WHERE email = ?')
    .bind((email ?? '').toLowerCase())
    .first<{ id: string }>();
  if (!fam) return c.json({ error: 'Invalid code' }, 400);
  const row = await db
    .prepare('SELECT code, expires_at, used FROM password_resets WHERE family_id = ?')
    .bind(fam.id)
    .first<{ code: string; expires_at: number; used: number }>();
  if (!row || row.used || row.code !== (code ?? '').trim() || row.expires_at < now()) {
    return c.json({ error: 'Invalid or expired code' }, 400);
  }
  const salt = newSalt();
  const hash = await hashPassword(newPassword, salt);
  await db.batch([
    db.prepare('UPDATE families SET password_hash = ?, password_salt = ? WHERE id = ?').bind(hash, salt, fam.id),
    db.prepare('UPDATE password_resets SET used = 1 WHERE family_id = ?').bind(fam.id),
    db.prepare('DELETE FROM sessions WHERE family_id = ?').bind(fam.id), // sign out everywhere
  ]);
  return c.json({ ok: true });
});

app.use('/dashboard/*', async (c, next) => {
  const token = bearer(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Missing session token' }, 401);
  const session = await c.env.DB.prepare('SELECT family_id, expires_at FROM sessions WHERE token = ?')
    .bind(token)
    .first<{ family_id: string; expires_at: number }>();
  if (!session || session.expires_at < now()) return c.json({ error: 'Session expired' }, 401);
  c.set('familyId', session.family_id);
  await next();
});

// ---------- device auth + pairing ----------

app.post('/pair', async (c) => {
  const { code, deviceName } = await c.req.json<PairRequest>();
  const db = c.env.DB;
  const row = await db
    .prepare('SELECT code, family_id, device_name, expires_at, used FROM pairing_codes WHERE code = ?')
    .bind(code)
    .first<{ code: string; family_id: string; device_name: string; expires_at: number; used: number }>();
  if (!row || row.used || row.expires_at < now()) {
    return c.json({ error: 'Invalid or expired pairing code' }, 400);
  }
  const deviceId = randomId('dev');
  const token = randomToken();
  await db.batch([
    db.prepare('UPDATE pairing_codes SET used = 1 WHERE code = ?').bind(code),
    db
      .prepare('INSERT INTO devices (id, family_id, name, token, paired_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(deviceId, row.family_id, deviceName || row.device_name, token, now(), now()),
  ]);
  const resp: PairResponse = { deviceToken: token, deviceId };
  return c.json(resp);
});

const deviceRoutes = ['/policy', '/evaluate/*', '/events'];
for (const route of deviceRoutes) {
  app.use(route, async (c, next) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'Missing device token' }, 401);
    const device = await c.env.DB.prepare(
      'SELECT id, family_id FROM devices WHERE token = ? AND revoked = 0',
    )
      .bind(token)
      .first<{ id: string; family_id: string }>();
    if (!device) return c.json({ error: 'Unknown or revoked device' }, 401);
    c.set('familyId', device.family_id);
    c.set('deviceId', device.id);
    await c.env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(now(), device.id).run();
    await next();
  });
}

// ---------- device: policy sync ----------

app.get('/policy', async (c) => {
  const policy = await loadPolicy(c.env.DB, c.get('familyId'));
  return c.json(policy);
});

// ---------- device: channel evaluation ----------

app.post('/evaluate/channels', async (c) => {
  const familyId = c.get('familyId');
  const db = c.env.DB;
  const body = await c.req.json<EvaluateChannelsRequest>();
  const channels = (body.channels ?? []).slice(0, 25);
  if (channels.length === 0) return c.json({ verdicts: {} } satisfies EvaluateChannelsResponse);

  const policy = await loadPolicy(db, familyId);
  const mode = effectiveMode(policy); // verdicts are cached per criteria mode
  const ttlMs = policy.settings.channelTtlDays * 24 * 60 * 60 * 1000;
  const verdicts: Record<string, Verdict> = {};
  const misses: ChannelMeta[] = [];

  for (const ch of channels) {
    const override = policy.overrides.find((o) => o.kind === 'channel' && o.targetId === ch.channelId);
    if (override) {
      verdicts[ch.channelId] = {
        decision: override.decision,
        confidence: 1,
        reason: override.note || 'Set by parent',
        evaluatedAt: override.createdAt,
        source: 'override',
      };
      continue;
    }
    const cached = await db
      .prepare('SELECT decision, confidence, reason, evaluated_at FROM channel_verdicts WHERE family_id = ? AND mode = ? AND channel_id = ?')
      .bind(familyId, mode, ch.channelId)
      .first<{ decision: Verdict['decision']; confidence: number; reason: string; evaluated_at: number }>();
    if (cached && now() - cached.evaluated_at < ttlMs) {
      verdicts[ch.channelId] = {
        decision: cached.decision,
        confidence: cached.confidence,
        reason: cached.reason,
        evaluatedAt: cached.evaluated_at,
        source: 'ai',
      };
      continue;
    }
    misses.push(ch);
  }

  if (misses.length > 0) {
    const fresh = await evaluateChannels(c.env, policy.settings.model, criteriaFor(policy, mode), misses);
    for (const ch of misses) {
      const v = fresh[ch.channelId];
      verdicts[ch.channelId] = v;
      await db
        .prepare(
          `INSERT INTO channel_verdicts (family_id, mode, channel_id, decision, confidence, reason, evaluated_at, meta_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (family_id, mode, channel_id) DO UPDATE SET
             decision = excluded.decision, confidence = excluded.confidence,
             reason = excluded.reason, evaluated_at = excluded.evaluated_at, meta_json = excluded.meta_json`,
        )
        .bind(familyId, mode, ch.channelId, v.decision, v.confidence, v.reason, v.evaluatedAt, JSON.stringify(ch))
        .run();
      if (v.decision === 'unsure') {
        const inserted = await addReviewItem(db, familyId, 'channel', ch.channelId, ch.title, v.reason, 'ai_unsure');
        if (inserted && shouldNotify(policy.settings, 'ai_flag')) {
          c.executionCtx.waitUntil(
            notifyParent(c.env, policy.settings, 'AI needs your review', `Channel "${ch.title}": ${v.reason}`),
          );
        }
      }
    }
  }

  return c.json({ verdicts } satisfies EvaluateChannelsResponse);
});

// ---------- device: video evaluation ----------

app.post('/evaluate/video', async (c) => {
  const familyId = c.get('familyId');
  const db = c.env.DB;
  const { video, transcriptExcerpt } = await c.req.json<EvaluateVideoRequest>();
  if (!video?.videoId) return c.json({ error: 'video.videoId required' }, 400);

  const policy = await loadPolicy(db, familyId);
  const mode = effectiveMode(policy); // verdicts are cached per criteria mode

  // 1. Overrides win, video-level then channel-level.
  const videoOverride = policy.overrides.find((o) => o.kind === 'video' && o.targetId === video.videoId);
  if (videoOverride) {
    return c.json({
      verdict: {
        decision: videoOverride.decision,
        confidence: 1,
        reason: videoOverride.note || 'Set by parent',
        evaluatedAt: videoOverride.createdAt,
        source: 'override',
      },
    } satisfies EvaluateVideoResponse);
  }
  const channelOverride = video.channelId
    ? policy.overrides.find((o) => o.kind === 'channel' && o.targetId === video.channelId)
    : undefined;
  if (channelOverride?.decision === 'block') {
    return c.json({
      verdict: {
        decision: 'block',
        confidence: 1,
        reason: channelOverride.note || 'Channel blocked by parent',
        evaluatedAt: channelOverride.createdAt,
        source: 'override',
      },
    } satisfies EvaluateVideoResponse);
  }
  if (channelOverride?.decision === 'allow' && !policy.settings.checkAllowedChannels) {
    return c.json({
      verdict: {
        decision: 'allow',
        confidence: 1,
        reason: 'Channel allowed by parent',
        evaluatedAt: channelOverride.createdAt,
        source: 'override',
      },
    } satisfies EvaluateVideoResponse);
  }

  // 2. Cache — videos are immutable, verdicts never expire.
  const cached = await db
    .prepare('SELECT decision, confidence, reason, evaluated_at FROM video_verdicts WHERE family_id = ? AND mode = ? AND video_id = ?')
    .bind(familyId, mode, video.videoId)
    .first<{ decision: Verdict['decision']; confidence: number; reason: string; evaluated_at: number }>();
  if (cached) {
    return c.json({
      verdict: {
        decision: cached.decision,
        confidence: cached.confidence,
        reason: cached.reason,
        evaluatedAt: cached.evaluated_at,
        source: 'ai',
      },
    } satisfies EvaluateVideoResponse);
  }

  // 3. Channel verdict as prior.
  let channelPrior: Verdict | null = null;
  if (video.channelId) {
    const prior = await db
      .prepare('SELECT decision, confidence, reason, evaluated_at FROM channel_verdicts WHERE family_id = ? AND mode = ? AND channel_id = ?')
      .bind(familyId, mode, video.channelId)
      .first<{ decision: Verdict['decision']; confidence: number; reason: string; evaluated_at: number }>();
    if (prior) {
      channelPrior = {
        decision: prior.decision,
        confidence: prior.confidence,
        reason: prior.reason,
        evaluatedAt: prior.evaluated_at,
        source: 'ai',
      };
    }
  }

  // 4. Evaluate (lightweight → escalate with thumbnail/transcript if needed).
  const verdict = await evaluateVideo(
    c.env,
    policy.settings.model,
    criteriaFor(policy, mode),
    video,
    channelPrior,
    transcriptExcerpt,
  );

  await db
    .prepare(
      'INSERT OR REPLACE INTO video_verdicts (family_id, mode, video_id, decision, confidence, reason, evaluated_at, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(familyId, mode, video.videoId, verdict.decision, verdict.confidence, verdict.reason, verdict.evaluatedAt, JSON.stringify(video))
    .run();

  if (verdict.decision === 'unsure' || verdict.decision === 'block') {
    const inserted = await addReviewItem(
      db,
      familyId,
      'video',
      video.videoId,
      video.title,
      verdict.reason,
      verdict.decision === 'unsure' ? 'ai_unsure' : 'ai_block',
    );
    if (inserted && shouldNotify(policy.settings, 'ai_flag')) {
      c.executionCtx.waitUntil(
        notifyParent(
          c.env,
          policy.settings,
          verdict.decision === 'unsure' ? 'AI needs your review' : 'AI blocked a video',
          `Video "${video.title}": ${verdict.reason}`,
        ),
      );
    }
  }

  return c.json({ verdict } satisfies EvaluateVideoResponse);
});

// ---------- device: events ----------

app.post('/events', async (c) => {
  const familyId = c.get('familyId');
  const deviceId = c.get('deviceId');
  const body = await c.req.json<{ events: EventInput[] }>();
  const events = (body.events ?? []).slice(0, 100);
  for (const e of events) {
    await c.env.DB.prepare(
      'INSERT INTO events (family_id, device_id, type, target_kind, target_id, title, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(familyId, deviceId, e.type, e.targetKind ?? null, e.targetId ?? null, e.title ?? null, JSON.stringify(e.detail ?? {}), now())
      .run();
    if (e.type === 'request_access' && e.targetKind && e.targetId) {
      const inserted = await addReviewItem(
        c.env.DB,
        familyId,
        e.targetKind,
        e.targetId,
        e.title ?? e.targetId,
        'Your kid asked to watch this',
        'kid_request',
      );
      if (inserted) {
        const policy = await loadPolicy(c.env.DB, familyId);
        if (shouldNotify(policy.settings, 'kid_request')) {
          c.executionCtx.waitUntil(
            notifyParent(
              c.env,
              policy.settings,
              '🙋 Your kid wants to watch something',
              `"${e.title ?? e.targetId}" — open the dashboard to allow or block it.`,
            ),
          );
        }
      }
    }
  }
  return c.json({ ok: true });
});

// ---------- dashboard: policy ----------

app.get('/dashboard/policy', async (c) => {
  return c.json(await loadPolicy(c.env.DB, c.get('familyId')));
});

app.put('/dashboard/policy', async (c) => {
  const familyId = c.get('familyId');
  const { criteria, weekendCriteria, settings } = await c.req.json<{
    criteria: string;
    weekendCriteria?: string;
    settings: Settings;
  }>();
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    schedule: { ...DEFAULT_SETTINGS.schedule, ...(settings?.schedule ?? {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(settings?.notifications ?? {}) },
  };
  const before = await loadPolicy(c.env.DB, familyId);
  await c.env.DB.prepare(
    `INSERT INTO policies (family_id, criteria, weekend_criteria, settings_json, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (family_id) DO UPDATE SET criteria = excluded.criteria, weekend_criteria = excluded.weekend_criteria, settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
  )
    .bind(familyId, criteria ?? '', weekendCriteria ?? '', JSON.stringify(merged), now())
    .run();
  // Clear cached verdicts only for the mode(s) whose criteria actually changed
  // (overrides survive; settings-only saves clear nothing).
  const stale: string[] = [];
  if ((criteria ?? '') !== before.criteria) stale.push('week');
  if ((weekendCriteria ?? '') !== before.weekendCriteria) stale.push('weekend');
  for (const mode of stale) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM channel_verdicts WHERE family_id = ? AND mode = ?').bind(familyId, mode),
      c.env.DB.prepare('DELETE FROM video_verdicts WHERE family_id = ? AND mode = ?').bind(familyId, mode),
    ]);
  }
  return c.json(await loadPolicy(c.env.DB, familyId));
});

// ---------- dashboard: pause ----------

app.post('/dashboard/pause', async (c) => {
  const { minutes } = await c.req.json<{ minutes: number }>();
  if (!minutes || minutes <= 0) return c.json({ error: 'minutes (> 0) required' }, 400);
  const pausedUntil = await service.setPause(c.env, c.get('familyId'), minutes);
  return c.json({ pausedUntil });
});

app.delete('/dashboard/pause', async (c) => {
  await service.setPause(c.env, c.get('familyId'), null);
  return c.json({ pausedUntil: null });
});

// ---------- dashboard: overrides ----------

app.get('/dashboard/overrides', async (c) => {
  const policy = await loadPolicy(c.env.DB, c.get('familyId'));
  return c.json({ overrides: policy.overrides });
});

app.post('/dashboard/overrides', async (c) => {
  const familyId = c.get('familyId');
  const o = await c.req.json<{ kind: 'channel' | 'video'; targetId: string; decision: 'allow' | 'block'; note?: string }>();
  if (!o.targetId || !['channel', 'video'].includes(o.kind) || !['allow', 'block'].includes(o.decision)) {
    return c.json({ error: 'kind, targetId, decision required' }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO overrides (family_id, kind, target_id, decision, note, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (family_id, kind, target_id) DO UPDATE SET decision = excluded.decision, note = excluded.note, created_at = excluded.created_at`,
  )
    .bind(familyId, o.kind, o.targetId, o.decision, o.note ?? null, now())
    .run();
  await c.env.DB.prepare('UPDATE policies SET updated_at = ? WHERE family_id = ?').bind(now(), familyId).run();
  return c.json({ ok: true });
});

app.delete('/dashboard/overrides/:kind/:targetId', async (c) => {
  const familyId = c.get('familyId');
  await c.env.DB.prepare('DELETE FROM overrides WHERE family_id = ? AND kind = ? AND target_id = ?')
    .bind(familyId, c.req.param('kind'), decodeURIComponent(c.req.param('targetId')))
    .run();
  await c.env.DB.prepare('UPDATE policies SET updated_at = ? WHERE family_id = ?').bind(now(), familyId).run();
  return c.json({ ok: true });
});

// ---------- dashboard: devices ----------

app.get('/dashboard/devices', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, name, paired_at, last_seen_at FROM devices WHERE family_id = ? AND revoked = 0 ORDER BY paired_at DESC',
  )
    .bind(c.get('familyId'))
    .all<{ id: string; name: string; paired_at: number | null; last_seen_at: number | null }>();
  const devices: DeviceInfo[] = rows.results.map((d) => ({
    id: d.id,
    name: d.name,
    pairedAt: d.paired_at,
    lastSeenAt: d.last_seen_at,
  }));
  return c.json({ devices });
});

app.post('/dashboard/devices/pair-code', async (c) => {
  const familyId = c.get('familyId');
  const { deviceName } = await c.req.json<{ deviceName: string }>();
  const code = pairingCode();
  const expiresAt = now() + PAIRING_CODE_TTL_MS;
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO pairing_codes (code, family_id, device_name, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(code, familyId, deviceName || 'Kid laptop', expiresAt)
    .run();
  return c.json({ code, expiresAt });
});

app.delete('/dashboard/devices/:id', async (c) => {
  await c.env.DB.prepare('UPDATE devices SET revoked = 1 WHERE family_id = ? AND id = ?')
    .bind(c.get('familyId'), c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

// ---------- dashboard: review queue ----------

app.get('/dashboard/review', async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, kind, target_id, title, reason, source, status, created_at FROM review_items WHERE family_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 200",
  )
    .bind(c.get('familyId'))
    .all<{ id: number; kind: string; target_id: string; title: string; reason: string; source: string; status: string; created_at: number }>();
  const items: ReviewItem[] = rows.results.map((r) => ({
    id: r.id,
    kind: r.kind as ReviewItem['kind'],
    targetId: r.target_id,
    title: r.title,
    reason: r.reason,
    source: r.source as ReviewItem['source'],
    status: r.status as ReviewItem['status'],
    createdAt: r.created_at,
  }));
  return c.json({ items });
});

app.post('/dashboard/review/:id', async (c) => {
  const familyId = c.get('familyId');
  const id = Number(c.req.param('id'));
  const { action } = await c.req.json<{ action: 'allow' | 'block' | 'dismiss' }>();
  const item = await c.env.DB.prepare('SELECT id, kind, target_id FROM review_items WHERE family_id = ? AND id = ?')
    .bind(familyId, id)
    .first<{ id: number; kind: string; target_id: string }>();
  if (!item) return c.json({ error: 'Not found' }, 404);

  if (action === 'allow' || action === 'block') {
    await c.env.DB.prepare(
      `INSERT INTO overrides (family_id, kind, target_id, decision, note, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (family_id, kind, target_id) DO UPDATE SET decision = excluded.decision, note = excluded.note, created_at = excluded.created_at`,
    )
      .bind(familyId, item.kind, item.target_id, action, 'Decided from review queue', now())
      .run();
    await c.env.DB.prepare('UPDATE policies SET updated_at = ? WHERE family_id = ?').bind(now(), familyId).run();
  }
  await c.env.DB.prepare("UPDATE review_items SET status = 'resolved' WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ---------- dashboard: activity ----------

app.get('/dashboard/activity', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const rows = await c.env.DB.prepare(
    `SELECT e.id, d.name AS device_name, e.type, e.target_kind, e.target_id, e.title, e.detail_json, e.created_at
     FROM events e JOIN devices d ON d.id = e.device_id
     WHERE e.family_id = ? ORDER BY e.created_at DESC LIMIT ?`,
  )
    .bind(c.get('familyId'), limit)
    .all<{ id: number; device_name: string; type: string; target_kind: string | null; target_id: string | null; title: string | null; detail_json: string | null; created_at: number }>();
  const events: ActivityEvent[] = rows.results.map((r) => {
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
  return c.json({ events });
});

// ---------- dashboard: export / import ----------

app.get('/dashboard/export', async (c) => {
  const policy = await loadPolicy(c.env.DB, c.get('familyId'));
  const bundle: ExportBundle = {
    version: 1,
    exportedAt: now(),
    criteria: policy.criteria,
    weekendCriteria: policy.weekendCriteria,
    settings: policy.settings,
    overrides: policy.overrides,
  };
  return c.json(bundle);
});

app.post('/dashboard/import', async (c) => {
  const familyId = c.get('familyId');
  const bundle = await c.req.json<ExportBundle>();
  if (bundle.version !== 1 || typeof bundle.criteria !== 'string' || !Array.isArray(bundle.overrides)) {
    return c.json({ error: 'Not a valid SaveKidsFromBrainRot export file' }, 400);
  }
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...bundle.settings,
    schedule: { ...DEFAULT_SETTINGS.schedule, ...(bundle.settings?.schedule ?? {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(bundle.settings?.notifications ?? {}) },
  };
  const db = c.env.DB;
  await db
    .prepare(
      `INSERT INTO policies (family_id, criteria, weekend_criteria, settings_json, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (family_id) DO UPDATE SET criteria = excluded.criteria, weekend_criteria = excluded.weekend_criteria, settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
    )
    .bind(familyId, bundle.criteria, bundle.weekendCriteria ?? '', JSON.stringify(merged), now())
    .run();
  await db.batch([
    db.prepare('DELETE FROM overrides WHERE family_id = ?').bind(familyId),
    // Imported criteria may differ from the old ones — reset AI verdicts.
    db.prepare('DELETE FROM channel_verdicts WHERE family_id = ?').bind(familyId),
    db.prepare('DELETE FROM video_verdicts WHERE family_id = ?').bind(familyId),
  ]);
  for (const o of bundle.overrides) {
    if (!o.targetId || !['channel', 'video'].includes(o.kind) || !['allow', 'block'].includes(o.decision)) continue;
    await db
      .prepare('INSERT OR REPLACE INTO overrides (family_id, kind, target_id, decision, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(familyId, o.kind, o.targetId, o.decision, o.note ?? null, o.createdAt ?? now())
      .run();
  }
  return c.json(await loadPolicy(db, familyId));
});

// ---------- dashboard: test a URL against current criteria ----------

app.post('/dashboard/test', async (c) => {
  const familyId = c.get('familyId');
  const { url } = await c.req.json<TestRequest>();
  const parsed = parseYouTubeUrl(url ?? '');
  if (!parsed) return c.json({ error: 'Not a recognizable YouTube video or channel URL' }, 400);

  const policy = await loadPolicy(c.env.DB, familyId);
  const mode = effectiveMode(policy);
  const criteria = criteriaFor(policy, mode);

  if (parsed.kind === 'video') {
    const meta = await fetchVideoMetaServer(parsed.videoId);
    if (!meta) return c.json({ error: 'Could not fetch video metadata (private or removed?)' }, 404);
    const verdict = await evaluateVideo(c.env, policy.settings.model, criteria, meta as VideoMeta, null);
    return c.json({ kind: 'video', extracted: meta, verdict, mode } satisfies TestResponse);
  }

  const meta = await fetchChannelMetaServer(parsed.ref);
  if (!meta) return c.json({ error: 'Could not fetch channel metadata' }, 404);
  const verdicts = await evaluateChannels(c.env, policy.settings.model, criteria, [meta]);
  return c.json({ kind: 'channel', extracted: meta, verdict: verdicts[meta.channelId], mode } satisfies TestResponse);
});

// ---------- dashboard: API keys ----------

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

app.get('/dashboard/api-keys', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, name, created_at, last_used_at FROM api_keys WHERE family_id = ? AND revoked = 0 ORDER BY created_at DESC',
  )
    .bind(c.get('familyId'))
    .all<{ id: string; name: string; created_at: number; last_used_at: number | null }>();
  return c.json({
    keys: rows.results.map((k) => ({ id: k.id, name: k.name, createdAt: k.created_at, lastUsedAt: k.last_used_at })),
  });
});

app.post('/dashboard/api-keys', async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  const rawKey = `skfbr_${randomToken(24)}`;
  const id = randomId('key');
  await c.env.DB.prepare('INSERT INTO api_keys (id, family_id, name, key_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, c.get('familyId'), name || 'API key', await sha256Hex(rawKey), now())
    .run();
  return c.json({ id, key: rawKey }); // raw key is shown exactly once
});

app.delete('/dashboard/api-keys/:id', async (c) => {
  await c.env.DB.prepare('UPDATE api_keys SET revoked = 1 WHERE family_id = ? AND id = ?')
    .bind(c.get('familyId'), c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

// ---------- public API + MCP (parent API-key auth) ----------

async function familyFromApiKey(c: { env: { DB: D1Database } }, rawKey: string | null): Promise<string | null> {
  if (!rawKey?.startsWith('skfbr_')) return null;
  const hash = await sha256Hex(rawKey);
  const row = await c.env.DB.prepare('SELECT id, family_id FROM api_keys WHERE key_hash = ? AND revoked = 0')
    .bind(hash)
    .first<{ id: string; family_id: string }>();
  if (!row) return null;
  await c.env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(now(), row.id).run();
  return row.family_id;
}

app.use('/api/v1/*', async (c, next) => {
  const familyId = await familyFromApiKey(c, bearer(c.req.header('Authorization')));
  if (!familyId) return c.json({ error: 'Invalid or missing API key' }, 401);
  c.set('familyId', familyId);
  await next();
});

app.get('/api/v1/policy', async (c) => c.json(await service.getPolicy(c.env, c.get('familyId'))));
app.put('/api/v1/criteria', async (c) => {
  const { criteria, mode } = await c.req.json<{ criteria: string; mode?: string }>();
  if (typeof criteria !== 'string') return c.json({ error: 'criteria (string) required' }, 400);
  return c.json(
    await service.updateCriteria(c.env, c.get('familyId'), criteria, mode === 'weekend' ? 'weekend' : 'week'),
  );
});
app.post('/api/v1/pause', async (c) => {
  const { minutes } = await c.req.json<{ minutes: number }>();
  if (!minutes || minutes <= 0) return c.json({ error: 'minutes (> 0) required' }, 400);
  return c.json({ pausedUntil: await service.setPause(c.env, c.get('familyId'), minutes) });
});
app.delete('/api/v1/pause', async (c) =>
  c.json({ pausedUntil: await service.setPause(c.env, c.get('familyId'), null) }),
);
app.get('/api/v1/review', async (c) => c.json({ items: await service.listReview(c.env, c.get('familyId')) }));
app.post('/api/v1/review/:id', async (c) => {
  const { action } = await c.req.json<{ action: 'allow' | 'block' | 'dismiss' }>();
  const ok = await service.resolveReview(c.env, c.get('familyId'), Number(c.req.param('id')), action);
  return ok ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
});
app.post('/api/v1/overrides', async (c) => {
  const o = await c.req.json<{ kind: 'channel' | 'video'; targetId: string; decision: 'allow' | 'block'; note?: string }>();
  if (!o.targetId || !['channel', 'video'].includes(o.kind) || !['allow', 'block'].includes(o.decision)) {
    return c.json({ error: 'kind, targetId, decision required' }, 400);
  }
  await service.addOverride(c.env, c.get('familyId'), o.kind, o.targetId, o.decision, o.note);
  return c.json({ ok: true });
});
app.get('/api/v1/activity', async (c) =>
  c.json({ events: await service.listActivity(c.env, c.get('familyId'), Number(c.req.query('limit') ?? 100)) }),
);
app.get('/api/v1/screen-time', async (c) => c.json({ screenTime: await service.screenTimeToday(c.env, c.get('familyId')) }));
app.get('/api/v1/devices', async (c) => c.json({ devices: await service.listDevices(c.env, c.get('familyId')) }));
app.post('/api/v1/test', async (c) => {
  const { url } = await c.req.json<{ url: string }>();
  const result = await service.testUrl(c.env, c.get('familyId'), url);
  return 'error' in result ? c.json(result, 400) : c.json(result);
});

// MCP endpoint. Auth: Authorization: Bearer <key> (Claude Code, API clients),
// or the key embedded in the path (claude.ai custom connectors, which take a
// bare URL): https://api.rosskids.com/mcp/<key>
app.all('/mcp', async (c) => {
  const familyId = await familyFromApiKey(c, bearer(c.req.header('Authorization')));
  if (!familyId) return c.json({ error: 'Invalid or missing API key' }, 401);
  return handleMcpRequest(c.env, familyId, c.req.raw);
});
app.all('/mcp/:key', async (c) => {
  const familyId = await familyFromApiKey(c, c.req.param('key'));
  if (!familyId) return c.json({ error: 'Invalid API key' }, 401);
  return handleMcpRequest(c.env, familyId, c.req.raw);
});

// With [assets] configured, / is served by the dashboard's index.html and this
// route only answers on asset-less deploys. /health always reaches the Worker
// (no such file exists) — the dashboard probes it to detect same-origin setups.
app.get('/', (c) => c.json({ ok: true, service: 'skfbr-backend' }));
app.get('/health', (c) => c.json({ ok: true, service: 'skfbr-backend' }));

// Chrome's extension update feed, rewritten so the CRX downloads from THIS
// deployment's origin — self-hosted families force-install without depending
// on anyone else's domain. run_worker_first routes this path here; the static
// updates.xml (with its build-time codebase URL) is fetched as the template.
app.get('/plugin/updates.xml', async (c) => {
  if (!c.env.ASSETS) return c.notFound();
  const asset = await c.env.ASSETS.fetch(new URL('/plugin/updates.xml', c.req.url));
  if (!asset.ok) return c.notFound();
  const origin = new URL(c.req.url).origin;
  const xml = (await asset.text()).replace(/codebase="[^"]*"/, `codebase="${origin}/plugin/skfbr.crx"`);
  return c.body(xml, 200, {
    'content-type': 'application/xml',
    'cache-control': 'no-cache',
  });
});

export default app;
