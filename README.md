# 🛡️ SaveKidsFromBrainRot

AI-native YouTube parental controls. Instead of hand-curating whitelists, parents write
**criteria in plain language** — "educational and calm content for a 7-year-old; no brainrot,
no rage gaming, no prank channels" — and Claude judges every channel and every video your kid
encounters against those rules. Administration happens from a **web dashboard**, so you never
need to touch the kid's laptop after a one-time pairing.

Inspired by [yt-blocker-kids](https://github.com/Michailbul/yt-blocker-kids); see
[PLAN.md](./PLAN.md) for the design.

**Want this for your family?** Clone the repo and run `npm run setup` — it deploys
the whole thing (API + dashboard, one URL) to your own free Cloudflare account in
about ten minutes. Full walkthrough in [SETUP.md](./SETUP.md).

## How it works

- **Two-tier AI filtering.** Channel-level verdicts (batched, cached 30 days) filter feeds,
  search, and related videos wholesale. Video-level verdicts run at click time — playback is
  held behind a friendly "Checking…" overlay until the specific video passes. Borderline
  videos escalate to a deeper check that includes the thumbnail image and a transcript excerpt.
- **Fail-closed.** Unevaluated content is blurred/blocked until judged. Offline, the last
  synced policy plus local caches keep enforcing; unknown content stays blocked.
- **Parent overrides win.** Anything you pin (allow or block) is never re-judged. The AI's
  "unsure" verdicts, its blocks, and your kid's "ask my grown-up" requests all land in a
  one-click review queue.
- **Everything is remote.** Criteria, review queue, overrides, per-device time limits, and an
  activity feed live in the web dashboard. The Anthropic API key stays server-side.

## Repository layout

| Directory | What it is |
|---|---|
| `backend/` | Cloudflare Worker (Hono + D1): device/parent APIs, verdict engine, Claude calls |
| `extension/` | Chrome extension (MV3, TypeScript): enforcement on the kid's laptop |
| `dashboard/` | Parent web dashboard (React + Vite) |
| `shared/` | Types shared by all three |

## Setup

### 1. Deploy the backend (Cloudflare Workers, free tier is fine)

```bash
cd backend
npm install
npx wrangler d1 create skfbr          # paste the printed database_id into wrangler.toml
npm run db:apply                       # apply schema.sql to the remote D1
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy                         # note the workers.dev URL it prints
```

### 2. Host the dashboard

```bash
cd dashboard
npm install
npm run build
npx wrangler pages deploy dist        # or any static host
```

Open the dashboard, enter your backend URL, and create your family account. Write your
criteria (there's a "test a URL" box to try them out), set a time limit if you want one, and
generate a pairing code under **Devices**.

### 3. Install the extension on the kid's laptop (one time)

```bash
cd extension
npm install
npm run build
```

Load `extension/dist/` via `chrome://extensions` → Developer mode → **Load unpacked**. Open
the extension's options page, enter your backend URL + pairing code. Done — everything else
is administered from the dashboard.

## Notifications (optional)

- **Push to your phone (easiest):** install the free [ntfy](https://ntfy.sh) app, subscribe to
  a long random topic name, and enter the same topic under Criteria → Notifications in the
  dashboard. You'll get a push when your kid taps "ask my grown-up" (and, optionally, whenever
  the AI blocks or is unsure about something new). Treat the topic name like a password.
- **Email:** create a [Resend](https://resend.com) API key, run
  `npx wrangler secret put RESEND_API_KEY` in `backend/`, and set your email in the dashboard.

## Backup

Criteria → Backup exports your rules, settings, and pinned decisions to a JSON file; import
restores them (replacing what's there and re-judging all content).

## Notes for parents

- Set a **spend limit** on the Anthropic API key you use. Steady-state cost is low (verdicts
  are cached aggressively and kids rewatch a lot), but a cap is good hygiene.
- Editing your criteria clears all AI verdicts so content is re-judged against the new rules.
  Pinned overrides survive.
- The extension protects YouTube in Chrome. It does not stop a determined kid from disabling
  the extension — pair it with Chrome's own supervision (Family Link) or OS-level controls
  if that's a concern.

## Development

Each package is standalone: `npm run typecheck` everywhere; `npm run build` for extension and
dashboard; `npm run dev` in `backend/` runs the Worker locally (`npm run db:apply:local`
seeds a local D1 first) and in `dashboard/` starts Vite.
