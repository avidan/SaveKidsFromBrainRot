# Chrome Web Store — publishing guide

Everything you need to publish the extension. The store listing itself must be
created by hand in the [developer console](https://chrome.google.com/webstore/devconsole)
(one-time $5 registration fee); this file has all the copy ready to paste.

## 1. Build the upload zip

```bash
cd extension && npm run pack:store   # → extension/skfbr-store.zip
```

The zip includes `key.pem`, which makes the store keep our existing extension ID.

## 2. Upload and VERIFY THE ID

Developer console → **New item** → upload `skfbr-store.zip`.

> ⚠️ **Before doing anything else**, check the item's ID shown in the console.
> It must be exactly `fkegepdokopkgklbpbkphdemnbinjhoc`. Every managed-storage
> payload, Mosyle profile, and Mac setup profile is keyed to that ID — if the
> console shows anything else, do not continue; the zip was built without key.pem.

## 3. Store listing tab

- **Name:** `SaveKidsFromBrainRot — AI YouTube Filter for Kids`
- **Summary** (short description):
  > Parents write rules in plain language; AI checks every YouTube channel and video your kid opens against them.
- **Category:** Privacy & Security (alternative: Lifestyle)
- **Language:** English
- **Detailed description:**

```
YouTube parental controls that don't need a whitelist.

Instead of hand-approving channels one by one, you write your family's rules in
plain language — "educational and calm content for a 7-year-old; no brainrot,
no rage gaming, no prank channels" — and AI judges every channel and every
video your kid encounters against them, in real time.

HOW IT WORKS
• Feeds, search, and recommendations are filtered wholesale by channel.
• Clicking a video holds playback behind a friendly "checking…" screen until
  that specific video passes your rules. Borderline videos get a deeper check
  (thumbnail + transcript).
• Blocked content is hidden or replaced with a kid-friendly screen and an
  "Ask my grown-up" button that sends the request to your dashboard.
• Shorts can be blocked entirely. Daily time limits, remote pause
  ("YouTube is on a break"), embedded players on other sites, and the
  mini-player are all covered. Fails closed: unvetted content stays hidden.

EVERYTHING IS REMOTE
Criteria, review queue, allow/block overrides, time limits, pause, and the
activity feed live in a web dashboard you host yourself — you never need the
kid's laptop after a one-time pairing.

YOU RUN THE SERVER
This extension is the client for a self-hosted, open-source backend
(github.com/avidan/SaveKidsFromBrainRot). Your family's data lives on YOUR
server, judged with YOUR AI key. Setup takes about ten minutes on Cloudflare's
free tier. The extension does nothing until you pair it with your own server.
```

- **Graphics:**
  - Icon: taken from the manifest automatically (128px included).
  - Screenshots (at least 1, up to 5, **1280×800** PNG): take them from your
    real dashboard — suggested set: ① Criteria tab with your rules, ② Activity
    tab with the screen-time pills, ③ a blocked-video overlay on youtube.com,
    ④ the Devices tab. Crop/resize to exactly 1280×800.

## 4. Privacy tab

- **Single purpose:** Filters YouTube content for children according to
  parent-defined criteria, enforced via the family's own self-hosted server.
- **Permission justifications:**
  - `storage` — caches the family policy and content verdicts locally; reads
    managed storage so schools/parents can pre-configure devices.
  - `alarms` — periodic policy re-sync with the family's server.
  - `host permission https://www.youtube.com/*` — the extension's core
    function: reading video/channel info on YouTube pages and hiding content
    that fails the family's rules.
  - `host permission https://i.ytimg.com/*` — fetches video thumbnails/
    metadata used when evaluating a video.
- **Remote code:** No.
- **Data usage disclosures:** check **Web history** (videos watched/blocked)
  and **User activity** (YouTube interactions) and **Website content** (video
  titles/channels). All are transmitted only to the family's own
  parent-operated server. Certify: data is not sold, not used for purposes
  unrelated to the single purpose, not used for creditworthiness.
- **Privacy policy URL:** `https://app.rosskids.com/privacy.html`
  (served from this repo at dashboard/public/privacy.html)

## 5. Distribution tab

- **Visibility: Unlisted** — installable by anyone with the link, invisible in
  search. Right for the friends-and-family stage; flip to Public later if
  desired (Public gets a stricter review).
- Free, all regions (or trim as you like).

## 6. After it's published

1. Grab the install link: `https://chromewebstore.google.com/detail/fkegepdokopkgklbpbkphdemnbinjhoc`
2. Update SETUP.md: replace the load-unpacked instructions with the store link.
3. Switch force-install profiles to the store's update feed: in
   `dashboard/src/mobileconfig.ts` and the Mosyle profiles, change the update
   URL to `https://clients2.google.com/service/update2/crx`. Existing installs
   keep working during the transition because the ID is identical.
4. Retire self-hosted CRX packing (`/plugin/*`, crx3, updates.xml) once all
   devices show the store version.
5. Keep `extension/skfbr-signing-key.pem` out of the repository — it is
   gitignored (`*.pem`) and has never been committed; verify with
   `git ls-files | grep pem` before sharing. Back it up somewhere private.
   After the first store upload, Google holds the publishing key; the pem's
   only remaining power is signing rogue CRXs for the trusted ID — treat it
   like a password.

## Review notes (if Google asks)

The extension requires pairing with a self-hosted backend and does nothing
before that. For review access, include a note like: "Parental-control client
for a self-hosted open-source server (github.com/avidan/SaveKidsFromBrainRot).
To test: deploy per SETUP.md or request a demo pairing code from the developer."
