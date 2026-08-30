# SaveKidsFromBrainRot — Plan (v2)

> **Status: all four phases built and deployed.** Backend (Worker + D1) and dashboard
> (Pages) run on Cloudflare behind custom domains; the extension is at v0.1.2.
> Post-launch additions beyond this plan: parent notifications (ntfy push + optional
> Resend email), settings export/import, password reset, instant approval recheck on
> the block overlay, watched-event logging, and review-queue thumbnails. Remaining
> backlog: local cache pruning, screen-time aggregation in the dashboard, and ongoing
> YouTube DOM-selector upkeep.

An AI-native reimagining of [yt-blocker-kids](https://github.com/Michailbul/yt-blocker-kids).
Parents write **criteria in plain language**; AI decides what's allowed — at the **channel
level** for cheap feed-wide filtering and at the **video level** for what actually gets
watched. Administration happens from a **web dashboard**, so parents never need to touch
the kid's laptop after initial setup.

---

## 1. System overview

Three components instead of the original's one:

```
┌─────────────────────────┐     ┌──────────────────────────────┐     ┌────────────────────┐
│ Chrome extension        │     │ Backend (Cloudflare Workers) │     │ Web dashboard      │
│ (kid's laptop)          │◄───►│  - Claude API calls          │◄───►│ (parent, anywhere) │
│  - DOM enforcement      │     │  - policy (criteria) store   │     │  - criteria editor │
│  - metadata extraction  │     │  - shared verdict cache      │     │  - review queue    │
│  - local verdict cache  │     │  - review queue + overrides  │     │  - overrides       │
│  - offline fail-closed  │     │  - activity log              │     │  - activity feed   │
└─────────────────────────┘     │  - device pairing/auth       │     │  - device settings │
                                └──────────────────────────────┘     └────────────────────┘
```

**Why a backend (vs. the original's fully-local design):**
- Remote administration — the explicit requirement.
- The Anthropic API key lives server-side, never on the kid's device.
- Verdict cache is shared across devices/siblings; one evaluation serves the family.
- Activity visibility: parent sees what was watched, blocked, and why.

**Stack:** Cloudflare Workers + Hono + D1 (SQLite) + KV for hot verdict cache; dashboard is
a static SPA (Vite + React) served from Cloudflare Pages. All TypeScript, shared types
package. (Swappable for Vercel/Supabase if preferred — the API surface is small.)

## 2. Two-tier AI filtering: channels AND videos

Per-video evaluation of an entire feed would be slow and expensive (a home page can show
50+ videos). The trick is **tiering**: cheap channel-level verdicts filter the feed;
video-level verdicts gate what actually plays.

### Tier 1 — Channel verdicts (feed-wide, batched, cached)

As in v1: channel metadata (title, description, ~15 recent video titles) → batched Claude
call → `allow | block | unsure`, cached with a 30-day TTL. Feed/search/related thumbnails
from blocked channels are hidden outright.

### Tier 2 — Video verdicts (at click time, before playback)

When the kid opens a watch page (or clicks a thumbnail), the extension holds playback
behind a "Checking…" overlay and asks the backend to evaluate **that specific video**:

- **Signals sent:** title, description, channel (+ its cached channel verdict as prior),
  duration, category, view count — and optionally the **thumbnail image** (Claude vision;
  thumbnails are one of the strongest brainrot signals) and a **transcript excerpt** (first
  ~2 min via YouTube's timedtext endpoint) for borderline cases.
- **Decision matrix:**

| Channel verdict | Video check? | Rationale |
|---|---|---|
| `block` / parent-blocked | No — video blocked | Channel block is absolute |
| Parent-allowed (pinned) | Configurable (default: no) | Parent trust wins |
| `allow` | **Yes, lightweight** (title/desc/duration) | Allowed channels still post junk; catches drift |
| `unsure` / unknown | **Yes, full** (incl. thumbnail + transcript excerpt) | The interesting case |

- Video verdicts cache **forever** (videos are immutable) in KV + locally.
- Median added latency at click time should be well under ~2s for the lightweight check
  (small input, structured output, prompt-cached criteria); the overlay makes the wait
  legible to a kid.
- **Escalation pattern:** the lightweight check returns `allow | block | escalate`;
  `escalate` triggers the full check with thumbnail + transcript. Keeps the common case
  cheap.

### The Claude calls (server-side)

- Model: `claude-opus-5` default, configurable per family in the dashboard.
- Structured outputs (`output_config.format` JSON schema): `{decision, confidence, reason}`
  per item — no parsing fragility.
- Prompt caching: system prompt = role + rubric rules + the family's criteria text (stable,
  `cache_control`); volatile channel/video metadata goes in the user turn.
- All calls originate from the Worker — no CORS gymnastics, no key on-device.

## 3. Backend API surface (small on purpose)

```
POST /pair                    # kid device redeems a pairing code → device token
GET  /policy                  # criteria, settings, overrides, timer config (ETag'd; extension polls every ~5 min + on startup)
POST /evaluate/channels       # batch channel metadata → verdicts
POST /evaluate/video          # single video metadata → verdict
POST /events                  # activity log: watched/blocked/time-used events
--- dashboard (parent session auth) ---
CRUD /criteria /overrides /devices /settings
GET  /review-queue            # unsure verdicts + fresh blocks, one-click approve/deny → pinned override
GET  /activity                # per-device feed
```

Parent auth: email + password with session cookies (simple, self-owned). Device auth:
opaque bearer token minted at pairing (parent generates a 6-digit code in the dashboard,
types it once into the extension on the kid's laptop — the only on-device setup step).

## 4. Chrome extension (thinner than v1)

```
src/
  background.ts      # sync loop (policy poll), verdict cache, backend client, timer
  content.ts         # DOM observers: channel/video extraction, hide/blur, overlays, Shorts blocking
  metadata.ts        # ytInitialData parsing for channel + video pages, timedtext fetch
  gate.ts            # watch-page playback gate (pause video until verdict)
  popup.ts           # kid-visible status: time left, "ask your grown-up" request button
  types.ts           # shared with backend via a common package
```

- **Fail-closed offline:** last-synced policy + local verdict cache keep enforcement
  working with no network; unknown content stays blocked.
- **"Request access" button:** kid can tap "ask my grown-up" on a blocked video/channel —
  lands in the parent's review queue (and optionally a push/email notification later).
- The extension retains a minimal local settings page for pairing only — everything else
  is administered from the web.

## 5. Web dashboard features

- **Criteria editor** with live "test a channel / video URL" preview showing Claude's
  verdict + reason before saving.
- **Review queue:** unsure/blocked items with AI reasons; one click → pinned override.
- **Overrides:** pinned allow/block lists (the old whitelist/blocklist, now exceptions).
- **Activity feed:** what each device watched, what was blocked and why, time used.
- **Devices:** pair/revoke, per-device timer limits, fail-open/closed, model choice.
- **Kid requests:** surfaced prominently, approve from your phone.

## 6. Build phases

1. **Phase 1 — Backend + verdict engine.** Workers scaffold, D1 schema (families, devices,
   policies, verdicts, overrides, events), pairing, `/evaluate/*` with Claude structured
   outputs, batching, KV cache. Testable with curl before any UI exists.
2. **Phase 2 — Extension enforcement.** Metadata extraction, channel-tier feed filtering,
   video-tier playback gate, Shorts blocking, offline fail-closed, pairing flow.
3. **Phase 3 — Web dashboard.** Auth, criteria editor + test preview, review queue,
   overrides, devices, activity feed.
4. **Phase 4 — Polish & parity.** Daily timer (config from dashboard, enforced in
   extension), kid "request access" flow, notifications, export/import, thumbnail-vision
   and transcript escalation tuning.

## 7. Risks & mitigations

- **Per-video cost/latency** → tiering (channel verdict filters the feed for free),
  click-time-only video checks, escalation pattern, immutable video cache, prompt caching.
  A kid's real viewing is repetitive; steady-state API volume is low.
- **YouTube DOM/`ytInitialData` churn** → all parsing isolated in `metadata.ts`;
  fail-closed means breakage never exposes kids to unfiltered content.
- **Backend availability** → extension degrades gracefully to cached policy + cache;
  Workers/KV are effectively always-up and free-tier friendly at this volume.
- **Kid circumvention** → extension-level protection with no local admin surface beyond
  pairing; policy tampering requires the parent's web credentials. (OS-level lockdown of
  "disable extension" remains out of scope, documented for parents.)
- **Privacy** → activity data is the family's own, in their own Cloudflare account;
  document what's stored and add a retention setting.
