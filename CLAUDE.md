# SaveKidsFromBrainRot — agent context

AI-native YouTube parental controls. Parents write **plain-language criteria**;
Claude judges every channel and video a kid encounters against them. Everything
is administered remotely from a web dashboard. Self-hosted per family on
Cloudflare's free tier; each family brings their own Anthropic API key.

Read this file before changing anything — it encodes decisions and gotchas that
are not visible in the code.

## Architecture (one paragraph)

A **Cloudflare Worker** (`backend/`, Hono v4 + D1/SQLite) is the single server:
device API, parent dashboard API, REST API, MCP server, and — via Workers
static assets — it also serves the built dashboard, so one `wrangler deploy`
ships everything. The **dashboard** (`dashboard/`, React 18 + Mantine 7 + Vite)
is the parent UI. The **extension** (`extension/`, TypeScript, WebExtensions
MV3, esbuild) runs on kids' machines: Chrome (store-distributed) and Safari on
iPadOS (converter-packaged; see `ios/README.md`). `shared/types.ts` is the
single source of truth for every wire type — backend, dashboard, and extension
all import it; change shapes there first.

## The filtering model

- **Two-tier AI judging** (`backend/src/claude.ts`): channel-level triage
  (batched, cheap, `effort: 'low'`, cached 30 days) filters feeds wholesale;
  video-level judging runs at click time (cached forever — videos are
  immutable), with an escalation pass (thumbnail via Claude vision + transcript
  excerpt) for borderline calls.
- **Verdicts**: `allow` | `block` | `unsure`. Unsure and AI-blocks land in the
  parent **review queue**; parent decisions become permanent **overrides**,
  which always beat the AI and are global across criteria modes.
- **Fail closed, always.** Unevaluated content is hidden; backend/AI
  unreachable → `unsure` (block) unless the family chose `failMode: 'open'`.
  Never weaken this in an edit.
- **Quiet filtering** (default on): pending tiles are `display:none`, not
  blurred — kids only ever see approved videos appear (no FOMO, no evidence of
  filtering). One root class (`html.skfbr-quiet`) + CSS; don't reintroduce
  visible placeholders.
- **Criteria modes**: `week` and optional `weekend` criteria, switched by a
  weekly schedule evaluated in the family's IANA timezone
  (`backend/src/mode.ts`). **Verdict caches are keyed by mode** (D1 PK
  `(family_id, mode, target)` and extension storage keys
  `channelVerdicts:<mode>`), so schedule flips never re-evaluate anything.
  Editing one mode's criteria clears only that mode's caches.
- **Cache-invalidation contract**: `policies.updated_at` bump ⇒ extensions drop
  local verdict caches on next sync. Bump it when verdict-relevant things
  change (criteria, overrides); do NOT bump for pause or mode flips.

## Extension internals (`extension/src/`)

- `ext.ts` — ALL WebExtension API access goes through `ext` (Safari's
  promise-based `browser`, else `chrome`). Never call `chrome.*` directly:
  Safari's `chrome` alias is callback-flavored and awaiting it hangs.
- `background.ts` — policy sync (5-min alarm, with timer fallback for Safari,
  + 60s refresh piggybacked on heartbeats), mode-scoped local verdict caches,
  override fast-paths, MDM managed-storage auto-pairing (Chrome-only;
  re-adopted every alarm cycle so cleared state self-heals), screen-time
  accounting. **401 from the backend = parent revoked the device → clear
  storage (self-unpair). Any other error → keep enforcing last-synced policy.**
- `content.ts` — feed filtering (MutationObserver + `ITEM_SELECTOR` covering
  desktop `ytd-*`/`yt-lockup-view-model` and mobile `ytm-*` markup), watch-page
  gate (hold playback + overlay until verdict), embed gate, **miniplayer
  guard** (corner popup can start unvetted playback — queue plays — so anything
  playing there needs an allow verdict), Shorts blocking, parent **pause**
  (full-page overlay, all states), distraction removal (Unhook-style CSS
  toggles via `html.skfbr-*` classes), heartbeat every 30s. A 500ms tick runs
  the cheap watchdogs (pause reconcile, miniplayer, autoplay-off).
- **No self-serve unpair exists — keep it that way.** Removal is
  parent-initiated (dashboard revoke → 401 → self-unpair). There is
  deliberately no UNPAIR message handler.
- Overlay screens share one `showOverlay()` (white card, brand footer, branded
  SVG state icons — no emoji). Styles in `static/content.css`.
- **YouTube DOM churn is the main maintenance burden.** When filtering misses
  content, suspect new markup; extend the selector lists and keep the
  fail-closed hiding of unattributed video cards.

## Identity & release invariants (do not break)

- **Extension ID `fkegepdokopkgklbpbkphdemnbinjhoc` is load-bearing**: managed
  storage domains (`com.google.Chrome.extensions.<id>`), force-install
  profiles, and the store listing all key on it. It derives from
  `extension/skfbr-signing-key.pem` — **never committed** (gitignored `*.pem`),
  never regenerate. The manifest `key` field pins the ID for load-unpacked.
- **Chrome release**: bump `static/manifest.json` version → `npm run
  pack:store` → upload `skfbr-store.zip` (human, via CWS dev console; zip
  contains `key.pem` on purpose — that's what preserves the ID). Do NOT add
  host permissions to the Chrome manifest casually — new ones can disable the
  extension for store users pending re-approval (that's why `m.youtube.com` is
  Safari-manifest-only, added by `build.mjs --safari`).
- **Legacy self-hosted feed** (`dashboard/public/plugin/` + crx3 packing) still
  serves the owner's MDM-managed Macs; keep it working until those move to the
  store build. The Worker rewrites `/plugin/updates.xml`'s codebase to the
  serving origin (`run_worker_first`).
- **Safari/iPadOS**: `npm run build:safari` → `dist-safari/` → Apple converter
  on a Mac (`ios/README.md`). No managed storage, alarms not guaranteed —
  both already handled; keep new code inside those guards.

## Backend specifics (`backend/src/`)

- `index.ts` — routes (device `/policy` `/evaluate/*` `/events` `/pair`;
  dashboard `/dashboard/*`; REST `/api/v1/*` via API keys; MCP at `/mcp`
  (Bearer) and `/mcp/:key` (claude.ai connectors)). `service.ts` is the shared
  family-ops layer for REST+MCP — add new programmatic features there, not
  inline. `mcp.ts` is a hand-rolled Streamable-HTTP JSON-RPC server (11 tools).
- **Signups auto-lock after the first family** (each account spends the
  operator's Anthropic key); multi-family is opt-in via `OPEN_SIGNUPS` secret.
- **Claude API model gates** (`claude.ts`): `output_config.effort` and
  `fallbacks` are only sent to models that accept them (`supportsEffort` /
  `supportsFallbacks`) — sending them to e.g. `claude-haiku-4-5` 400s every
  evaluation. `max_tokens: 16000` because thinking shares the budget.
  Evaluation failures embed the error text into the verdict reason —
  self-diagnosis via the review queue; preserve that.
- Settings live in `policies.settings_json` (schema-agnostic JSON; deep-merge
  nested objects with `DEFAULT_SETTINGS` at every read site — there are four).
  `paused_until` and `weekend_criteria` are separate columns so settings saves
  can't clobber them.
- Schema changes: `schema.sql` is idempotent for fresh deploys; existing
  deployments need explicit `ALTER`/migration via
  `npx wrangler d1 execute skfbr --remote --command "..."`. Verdict tables are
  pure caches — drop/recreate is a legal migration.
- Secrets: `ANTHROPIC_API_KEY` (required), `RESEND_API_KEY`/`NOTIFY_FROM`
  (email, optional), `OPEN_SIGNUPS` (optional). Notifications also go via
  ntfy.sh (topic stored in settings; topic = secret).

## Build / verify / deploy

```bash
# typecheck everything (backend, dashboard, extension each have `npm run typecheck`)
# extension:  cd extension  && npm run build        (Chrome dist/)
#             npm run build:safari                  (adds dist-safari/)
#             npm run pack:store                    (skfbr-store.zip; needs the pem)
# dashboard:  cd dashboard  && npm run build        (dist/ — REQUIRED before worker deploy: [assets] points at it)
# deploy:     cd backend    && npx wrangler deploy  (worker + dashboard assets)
#             cd dashboard  && npx wrangler pages deploy dist --project-name skfbr-dashboard --branch main --commit-dirty=true
# fresh stack (new family / friend): npm run setup   (root; interactive, idempotent)
```

- Cloudflare auth is a **mint-use-delete token** in `CLOUDFLARE_API_TOKEN` —
  the owner creates one per work session and deletes it after. It must be a
  **custom token** (Workers Scripts / Cloudflare Pages / D1, all Edit).
  Role-template tokens ("Super Administrator") verify fine but are rejected by
  exactly the upload endpoints wrangler needs — if deploys 401 while reads
  work, that's the cause; don't debug elsewhere.
- Production: `api.rosskids.com` (Worker + dashboard), `app.rosskids.com`
  (Pages mirror of the same dist; hosts the legacy plugin feed the kids'
  profiles point at). D1 database `skfbr`. Deploy both targets when the
  dashboard changed.
- **Verification pattern** (no staging env): `scratchpad`-style demo server
  serving `dashboard/dist` with mocked API + Playwright screenshots
  (Chromium at `/opt/pw-browsers/chromium`); D1 ground truth via
  `wrangler d1 execute --remote --json`; `wrangler tail` for live logs. Real
  YouTube behavior can only be tested on a real machine — say so rather than
  claiming it.

## Operational gotchas (each cost real debugging time)

- **Never `pkill -f`/`pgrep -f` a pattern contained in your own command line**
  — it kills the launching shell (exit 143/144). Kill by port:
  `ss -tlnp | grep :PORT`.
- macOS Chrome reads extension policy from the dedicated
  `com.google.Chrome.extensions.<id>` preference domain — **not** the
  `3rdparty` manifest key (Windows/ChromeOS only). The mobileconfig generator
  (`dashboard/src/mobileconfig.ts`) and `mosyle/` templates encode this.
- Manually-installed `.mobileconfig` profiles work without an MDM (System
  Settings → Profiles) — that's the "Mac setup profile" Devices-tab flow.
- Extension service-worker death mid-batch strands work: keep evaluation
  batches small (10), timeboxed (90s), and re-queued on failure.
- Dashboard `/plugin/*` must stay `Cache-Control: no-cache` (`_headers`) or
  Chrome serves stale update feeds from the edge.
- The repo is **public** (MIT). No secrets, tokens, kid names, or personal
  data in commits — history was scrubbed once already; don't make it need a
  second scrub. Commit messages must not name AI model identifiers.

## Current state / roadmap

Shipped: everything above, first-run onboarding wizard, install-confirmation
modal, one-command installer (`install.sh` / `npm run setup`), brand
(sprout-in-shield, `logo.svg` canonical), CWS listing (unlisted) at v0.2.10.
Open threads: real-iPad validation of the Safari build (mobile-markup selectors
and background lifecycle are the untested parts); moving the owner's Mosyle
Macs from the legacy feed to the store build, then retiring crx packing;
per-mode distraction toggles is a cheap natural extension.
