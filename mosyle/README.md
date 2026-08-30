# Deploying SaveKidsFromBrainRot via Mosyle

The extension is force-installed through Chrome enterprise policy using the private-host
method: a signed `.crx` and `updates.xml` served from the family dashboard's static
hosting at `https://app.rosskids.com/plugin/`.

- **Extension ID:** `fkegepdokopkgklbpbkphdemnbinjhoc` (derived from the signing key —
  keep `skfbr-signing-key.pem` safe and out of git; every future release must be packed
  with the same key or the ID changes and force-install breaks).
- **Managed config:** the profile's `3rdparty.extensions.<id>` block feeds
  `chrome.storage.managed`. The extension auto-pairs from it at install — no on-device
  setup. Keys: `backendUrl`, `deviceToken`, `deviceName`.

## Per-device provisioning

Each kid device gets its own `deviceToken`:

1. Dashboard → **Devices** → generate a pairing code (name it after the device).
2. Redeem the code yourself (within 15 minutes):
   ```bash
   curl -sX POST https://api.rosskids.com/pair \
     -H 'content-type: application/json' \
     -d '{"code":"123456","deviceName":"Kid 1 MacBook"}'
   ```
3. Copy `deviceToken` from the response into the device's mobileconfig
   (`REPLACE_WITH_DEVICE_TOKEN`), and set `deviceName`.
4. For a second kid: duplicate the mobileconfig, mint a new token, regenerate the
   `PayloadUUID`s/identifiers so the profiles don't collide.

## Pushing via Mosyle

Management → **Custom Profiles** → upload the `.mobileconfig` → target the kid's Mac.
Keep exactly one `com.google.Chrome` payload per device: **remove any older Chrome
policy profiles** (e.g. the deprecated "YouTube Watch Monitor" profile) when deploying
this one — duplicate Chrome payloads have undefined precedence. This profile blocks all
other extensions and force-installs only SaveKidsFromBrainRot.

## Verify on the device

1. `chrome://extensions` → SaveKidsFromBrainRot shows "Installed by your administrator".
2. `chrome://policy` → the extension IDs appear under `ExtensionInstallForcelist`.
3. The extension popup shows "Protecting …" without anyone typing anything.
4. The device appears in the dashboard's Devices tab with a recent "last seen".

## Releasing extension updates

1. Bump `version` in `extension/static/manifest.json`.
2. `npm run build`, then repack with the SAME key:
   ```bash
   npx crx3 dist -p skfbr-signing-key.pem -o skfbr.crx -x updates.xml \
     --crxURL https://app.rosskids.com/plugin/skfbr.crx
   ```
3. Copy `skfbr.crx` + `updates.xml` into `dashboard/public/plugin/` and redeploy the
   dashboard (Cloudflare Pages). Chrome picks up the new version within a few hours,
   or immediately via `chrome://extensions` → Update.
