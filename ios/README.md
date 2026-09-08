# SaveKidsFromBrainRot on iPad (Safari Web Extension)

The extension codebase is cross-browser: `extension/src` talks to the
WebExtension APIs through `src/ext.ts` (Safari's promise-based `browser`
namespace, Chrome's `chrome`), guards the Chrome-only pieces (alarms, managed
storage), and covers both desktop and `m.youtube.com` markup. What remains is
Apple's packaging, which requires a Mac with Xcode — these are those steps.

**The iPad reality check first:** an extension can only filter Safari. A real
iPad deployment is the extension **plus** a lockdown that removes every other
path to YouTube (the YouTube app, other browsers). Section 4 covers that; skip
it and the filter is decorative.

## 1. Build the Safari package (any machine)

```bash
cd extension
npm install
npm run build:safari     # → extension/dist-safari/
```

## 2. Convert and run (Mac with Xcode 15+)

```bash
xcrun safari-web-extension-converter extension/dist-safari \
  --project-location ios/SaveKidsFromBrainRot \
  --app-name "SaveKidsFromBrainRot" \
  --bundle-identifier com.savekidsfrombrainrot.ios \
  --swift
```

Then in Xcode:

1. Open the generated project, select the iOS app target, and set your Team
   under Signing & Capabilities (requires an Apple Developer Program
   membership, $99/yr, for device installs and distribution).
2. Plug in an iPad, select it as the run destination, and Run. The wrapper app
   installs; open it once (it just explains how to enable the extension).
3. On the iPad: **Settings → Apps → Safari → Extensions** (older iPadOS:
   Settings → Safari → Extensions) → SaveKidsFromBrainRot → turn it **on**,
   and set permissions for `youtube.com` and `m.youtube.com` to **Allow**
   ("Always Allow" / "All Websites" is fine — the manifest only matches
   YouTube).

## 3. Pair and test

1. In Safari, tap the puzzle/extension button in the address bar →
   SaveKidsFromBrainRot → the options page opens.
2. Enter the family dashboard URL and a pairing code from **Devices →
   Generate pairing code**. The device appears in the dashboard within a
   minute.
3. Test both markups: browse youtube.com normally, then use the **ᴀA menu →
   Request Desktop/Mobile Website** to flip modes. Check: feed shows only
   approved videos (quiet filtering), tapping a video gates it, a blocked
   video shows the overlay, distraction toggles apply, screen time accrues in
   Activity.

Known platform differences (already handled in code, listed for awareness):

- **No managed storage on iOS** → no MDM auto-pairing; pairing codes only.
- **No `chrome.alarms` guarantee** → background sync falls back to a timer;
  the 60-second heartbeat refresh while YouTube is open is unaffected.
- **Parent-revoke unpairing** works the same as on desktop (401 → self-unpair).

## 4. Lock the iPad down (the part that makes it real)

Via Mosyle (supervised iPad) or, minimally, Screen Time with a parent passcode:

- **Remove/block the YouTube app** and block reinstalling (restrict App Store
  installs, or app blocklist in MDM).
- **Block other browsers** (Chrome, Firefox, Brave, Arc…) the same way.
- **Keep Safari** as the only browser; the extension filters it.
- **Prevent the kid from disabling the extension:** on recent iPadOS, MDM can
  manage Safari extensions (force-enabled state + website access) — check
  Mosyle's Safari extension management payload for your iPadOS version. If
  unavailable, a Screen Time passcode on Settings changes is the fallback
  (weaker: verify the kid can't reach Settings → Safari → Extensions).

## 5. Distribute (beyond your own cable)

- **TestFlight** — easiest for family + friends (up to 10k testers, 90-day
  builds, no review beyond a light beta check).
- **App Store, unlisted** — request unlisted distribution in App Store
  Connect: a permanent link-only listing, matching how the Chrome version
  ships. Parental-control apps get a closer review; the self-hosted design
  (app does nothing until paired with the family's own server) is the story
  to tell in review notes.
- **Custom app via Apple Business Manager + Mosyle** — private distribution
  to your own fleet, no public review.
