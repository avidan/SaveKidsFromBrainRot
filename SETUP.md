# Set up SaveKidsFromBrainRot for your family

You host this yourself — your data, your AI key, your rules. Everything runs on
Cloudflare's free tier; the only ongoing cost is Anthropic API usage (typically a
few dollars a month per family on the default model).

## What you need

- **Node.js 18+** on your computer ([nodejs.org](https://nodejs.org))
- A **free Cloudflare account** ([dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up))
- An **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com) → API keys)

## 1. Deploy your stack (~10 minutes)

```bash
git clone https://github.com/avidan/SaveKidsFromBrainRot.git
cd SaveKidsFromBrainRot
npm run setup
```

The script logs you into Cloudflare (browser window), creates your database,
deploys everything, and asks for your Anthropic key. At the end it prints your
family's URL, something like:

```
https://skfbr-backend.<your-subdomain>.workers.dev
```

That one URL is both the parent dashboard and the API. Open it, create your
parent account — **the first account claims the server**: registration closes
automatically after it, so strangers can't sign up and spend your API credits.
(To host several families on one instance anyway: `cd backend && npx wrangler
secret put OPEN_SIGNUPS` with value `true`.) Then write your criteria in plain
language on the first tab —
for example: *"Educational and calm content for a 7-year-old. No brainrot, no
rage gaming, no prank channels. Science, nature, LEGO, and slow crafts are
great."*

## 2. Install the extension on your kid's computer

> **Kid on a Mac?** Skip this section and step 3: in your dashboard's
> **Devices** tab, click **Download Mac setup profile**, install that file on
> the kid's Mac (System Settings → Privacy & Security → Profiles), and restart
> Chrome. That force-installs the extension from the Chrome Web Store, pairs
> it automatically, and disables incognito/guest mode so it can't be bypassed.
> No MDM needed.

On the kid's computer, install it from the Chrome Web Store:

**https://chromewebstore.google.com/detail/fkegepdokopkgklbpbkphdemnbinjhoc**

(The listing is unlisted — link-only, it won't show up in store search. If the
link ever 404s, a store review is in progress; as a stopgap you can
`cd extension && npm install && npm run build` and load `extension/dist/` via
chrome://extensions → Developer mode → Load unpacked.)

## 3. Pair the device

1. In your dashboard, go to **Devices** → create a pairing code (give the
   device a name like "Maya's laptop").
2. On the kid's computer, click the extension's icon → **Options**, enter your
   family URL and the 6-digit code.

Done. From here everything is remote: criteria, review queue, allow/block
overrides, daily time limits, the pause button, and the activity feed all live
in your dashboard. Your kid's YouTube starts filtering immediately.

## Optional extras

- **Push notifications** (kid asks to watch something → your phone): install
  the [ntfy](https://ntfy.sh) app, subscribe to a long random topic name, and
  paste that topic in the dashboard's Criteria tab → Notifications.
- **Email notifications**: create a [Resend](https://resend.com) account, then
  `cd backend && npx wrangler secret put RESEND_API_KEY` and set `NOTIFY_FROM`
  in `backend/wrangler.toml`.
- **Custom domain**: in the Cloudflare dashboard, add a custom domain to the
  `skfbr-backend` Worker (Workers & Pages → skfbr-backend → Settings → Domains).
- **Talk to it from Claude**: dashboard → **API** tab → create a key, then add
  it as a connector on claude.ai. "What did the kids watch today?", "pause
  YouTube for an hour", "approve that request" all work conversationally.
- **MDM fleets**: if you do run an MDM (Mosyle etc.), see `mosyle/README.md`
  for per-device profile templates; mint device tokens from the Devices tab.

## Updating later

```bash
git pull
npm run deploy
```

## Costs, honestly

- Cloudflare Workers/D1 free tier: fine for a family (100k requests/day).
- Anthropic API: channel verdicts are cached for 30 days and video verdicts
  forever, so costs settle down fast after the first week. Haiku (the default
  in the model dropdown) is the cheapest; expect single-digit dollars monthly.
