# Deploying SaveKidsFromBrainRot via MDM (Mosyle etc.)

> No MDM? You don't need this folder — the dashboard's **Devices → Download Mac
> setup profile** button generates a ready-to-install profile per device.

The extension is force-installed through Chrome enterprise policy from the
**Chrome Web Store** (unlisted listing):

- **Extension ID:** `fkegepdokopkgklbpbkphdemnbinjhoc`
- **Update URL:** `https://clients2.google.com/service/update2/crx` (Google's
  standard store feed — updates arrive automatically when a new version passes
  store review).
- **Managed config:** on macOS, Chrome reads extension managed storage from the
  dedicated preference domain `com.google.Chrome.extensions.<id>` (NOT the
  `3rdparty` key — that's Windows/ChromeOS). That payload feeds
  `chrome.storage.managed`; the extension auto-pairs from it at install with
  keys `backendUrl`, `deviceToken`, `deviceName`.

Use `skfbr.kid1.mobileconfig` as the template.

## Per-device provisioning

Each kid device gets its own `deviceToken`:

1. Dashboard → **Devices** → **Mint MDM device token** (name it after the device).
2. Copy the token into the device's mobileconfig (`REPLACE_WITH_DEVICE_TOKEN`),
   set `deviceName` and `REPLACE_WITH_BACKEND_URL` (your dashboard URL).
3. For each additional device: duplicate the mobileconfig, mint a new token, and
   regenerate the `PayloadUUID`s/identifiers so the profiles don't collide.

## Pushing via Mosyle

Management → **Custom Profiles** → upload the `.mobileconfig` → target the kid's Mac.
Keep exactly one `com.google.Chrome` payload per device: **remove any older Chrome
policy profiles** when deploying this one — duplicate Chrome payloads have undefined
precedence. The template blocks all other extensions and force-installs only
SaveKidsFromBrainRot (plus Unhook, if you keep that entry).

## Verify on the device

1. `chrome://extensions` → SaveKidsFromBrainRot shows "Installed by your administrator".
2. `chrome://policy` → the extension IDs appear under `ExtensionInstallForcelist`.
3. The extension popup shows "Protecting …" without anyone typing anything.
4. The device appears in the dashboard's Devices tab with a recent "last seen".

## Legacy: self-hosted CRX feed

Before the store listing existed, devices were provisioned against a signed CRX
served from the dashboard's `/plugin/` path (packed with `skfbr-signing-key.pem`
— same extension ID, since the store item was created from the same key).
Profiles pointing at `<dashboard>/plugin/updates.xml` keep working, but new
profiles should use the store feed above, and old profiles can be switched over
whenever convenient. Once no devices use the legacy feed, the `/plugin/` hosting
and CRX packing (`npx crx3 …`) can be retired entirely.
