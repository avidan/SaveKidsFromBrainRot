# SaveKidsFromBrainRot on iPad & iPhone (Safari Web Extension)

The extension codebase is cross-browser: `extension/src` talks to the
WebExtension APIs through `src/ext.ts` (Safari's promise-based `browser`
namespace, Chrome's `chrome`), guards the Chrome-only pieces (alarms, managed
storage), and covers both desktop and `m.youtube.com` markup. What remains is
Apple's packaging, which requires a Mac with Xcode — these are those steps.
One build covers both devices: the app the converter produces runs on iPad
and iPhone alike (iPhone Safari always gets the mobile site, which the
selectors cover).

**The reality check first:** an extension can only filter Safari. A real
iPad/iPhone deployment is the extension **plus** a lockdown that removes every
other path to YouTube (the YouTube app, other browsers). Section 5 covers
that; skip it and the filter is decorative. On iPhone this matters doubly —
YouTube's mobile site pushes "Open in app" at every opportunity.

## 1. Build the Safari package (any machine)

```bash
cd extension
npm install
npm run build:safari     # → extension/dist-safari/
```

## 2. One-time Mac prep

1. Install **Xcode** from the Mac App Store (the full app — the converter and
   iOS builds need it, not just command-line tools). Open it once, accept the
   license, and install the **iOS platform** when prompted (Xcode → Settings →
   Components if it doesn't ask).
2. Xcode → **Settings → Accounts → + → Apple ID**. A free Apple ID suffices
   for cable-testing on your own iPad or iPhone (builds expire after 7 days);
   the $99/yr Developer Program is needed for TestFlight / App Store
   distribution.

## 3. Convert and run on an iPad or iPhone

```bash
cd ~/SaveKidsFromBrainRot
xcrun safari-web-extension-converter extension/dist-safari \
  --project-location ios/SaveKidsFromBrainRot \
  --app-name "SaveKidsFromBrainRot" \
  --bundle-identifier com.savekidsfrombrainrot.ios \
  --swift --ios-only
```

Warnings about unsupported manifest keys are normal. Xcode opens the project
automatically (or: `open ios/SaveKidsFromBrainRot/SaveKidsFromBrainRot.xcodeproj`).

**Signing** — click the blue project icon at the top of the sidebar, then for
BOTH targets (**SaveKidsFromBrainRot** and **SaveKidsFromBrainRot Extension**):
Signing & Capabilities → tick *Automatically manage signing* → pick your Team.

**Run** — plug the iPad/iPhone in via its cable, tap *Trust This Computer* on
it, set Xcode's run destination to the device, press ▶ (Cmd+R). Two normal
first-run speed bumps:

- The device asks for **Developer Mode**: Settings → Privacy & Security →
  Developer Mode → on → restart → confirm.
- "Untrusted Developer" at launch: Settings → General → **VPN & Device
  Management** → your Apple ID → Trust. Run again.

**Enable the extension** — on the device: Settings → **Apps → Safari →
Extensions** (older iOS/iPadOS: Settings → Safari → Extensions) →
SaveKidsFromBrainRot → on → set `youtube.com` and `m.youtube.com` to **Allow**.

## 4. Pair and test

1. In Safari, tap the puzzle/extension button in the address bar →
   SaveKidsFromBrainRot → the options page opens.
2. Enter the family dashboard URL and a pairing code from **Devices →
   Generate pairing code**. The device appears in the dashboard within a
   minute.
3. Test both markups: browse youtube.com normally, then use the **ᴀA menu →
   Request Desktop/Mobile Website** to flip modes (iPhone starts on the mobile
   site, iPad usually on desktop). Check: feed shows only approved videos
   (quiet filtering), tapping a video gates it, a blocked video shows the
   overlay, distraction toggles apply, screen time accrues in Activity.

Known platform differences (already handled in code, listed for awareness):

- **No managed storage on iOS** → no automatic pairing via remote device
  management; pairing codes only.
- **No `chrome.alarms` guarantee** → background sync falls back to a timer;
  the 60-second heartbeat refresh while YouTube is open is unaffected.
- **Parent-revoke unpairing** works the same as on desktop (401 → self-unpair).

## 5. Lock the device down (the part that makes it real)

Two ways to do this: an **MDM** — "mobile device management," a remote-management
service like Mosyle or Jamf that schools and companies use to control devices
(only relevant if you already run one, on a supervised device) — or, for
everyone else, Apple's built-in **Screen Time** with a parent passcode:

- **Remove/block the YouTube app** and block reinstalling (Screen Time →
  Content & Privacy Restrictions → don't allow installing apps; or the app
  blocklist in your MDM).
- **Block other browsers** (Chrome, Firefox, Brave, Arc…) the same way.
- **Keep Safari** as the only browser; the extension filters it.
- **Prevent the kid from disabling the extension:** without an MDM, a Screen
  Time passcode on Settings changes is the tool (verify the kid can't reach
  Settings → Safari → Extensions). With an MDM on recent iPadOS, Safari
  extensions can be managed directly (force-enabled state + website access) —
  check Mosyle's Safari extension management payload for your iPadOS version.

## 6. Distribute (beyond your own cable)

- **TestFlight** — easiest for family + friends (up to 10k testers, 90-day
  builds, no review beyond a light beta check).
- **App Store, unlisted** — request unlisted distribution in App Store
  Connect: a permanent link-only listing, matching how the Chrome version
  ships. Parental-control apps get a closer review; the self-hosted design
  (app does nothing until paired with the family's own server) is the story
  to tell in review notes.
- **Custom app via Apple Business Manager + an MDM** (e.g. Mosyle) — private
  distribution to your own managed devices, no public review. Only relevant
  if you run device-management software already.
