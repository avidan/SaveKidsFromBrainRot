// Generates a macOS configuration profile (.mobileconfig) that force-installs
// the extension on a kid's Mac and auto-pairs it — no MDM required, a parent
// double-clicks the file and approves it in System Settings → Profiles.
//
// Structure mirrors the proven MDM profile: Chrome on macOS reads extension
// managed storage ONLY from the dedicated com.google.Chrome.extensions.<id>
// preference domain (not the 3rdparty key — that's Windows/ChromeOS), so that
// payload carries the pairing config, and a com.google.Chrome payload carries
// the force-install plus kid-proofing policies.

export const EXTENSION_ID = 'fkegepdokopkgklbpbkphdemnbinjhoc';

/** The extension's Chrome Web Store page (unlisted listing — link-only). */
export const STORE_URL = `https://chromewebstore.google.com/detail/${EXTENSION_ID}`;

// The extension is published on the Chrome Web Store (same ID as the earlier
// self-hosted CRX), so force-installs pull from Google's update feed — no
// per-family CRX hosting involved.
const UPDATE_URL = 'https://clients2.google.com/service/update2/crx';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function uuid(): string {
  return crypto.randomUUID().toUpperCase();
}

export function buildMobileconfig(opts: {
  backendUrl: string;
  deviceName: string;
  deviceToken: string;
}): string {
  const backend = opts.backendUrl.replace(/\/$/, '');
  const updateUrl = UPDATE_URL;
  const name = esc(opts.deviceName);
  const storageUuid = uuid();
  const chromeUuid = uuid();
  const profileUuid = uuid();
  const org = esc(new URL(backend).hostname);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>backendUrl</key>
			<string>${esc(backend)}</string>
			<key>deviceToken</key>
			<string>${esc(opts.deviceToken)}</string>
			<key>deviceName</key>
			<string>${name}</string>
			<key>PayloadDescription</key>
			<string>Managed storage for the SaveKidsFromBrainRot extension (macOS reads extension policy from this dedicated preference domain).</string>
			<key>PayloadDisplayName</key>
			<string>SaveKidsFromBrainRot — extension managed storage</string>
			<key>PayloadEnabled</key>
			<true/>
			<key>PayloadIdentifier</key>
			<string>com.google.Chrome.extensions.${EXTENSION_ID}.${storageUuid}</string>
			<key>PayloadType</key>
			<string>com.google.Chrome.extensions.${EXTENSION_ID}</string>
			<key>PayloadUUID</key>
			<string>${storageUuid}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
		</dict>
		<dict>
			<key>ExtensionInstallForcelist</key>
			<array>
				<string>${EXTENSION_ID};${esc(updateUrl)}</string>
			</array>
			<key>ExtensionSettings</key>
			<dict>
				<key>${EXTENSION_ID}</key>
				<dict>
					<key>installation_mode</key>
					<string>force_installed</string>
					<key>update_url</key>
					<string>${esc(updateUrl)}</string>
				</dict>
			</dict>
			<key>IncognitoModeAvailability</key>
			<integer>1</integer>
			<key>BrowserGuestModeEnabled</key>
			<false/>
			<key>SyncDisabled</key>
			<true/>
			<key>PayloadDescription</key>
			<string>Force-installs SaveKidsFromBrainRot (AI filtering for YouTube). Incognito and guest mode disabled so filtering can't be bypassed.</string>
			<key>PayloadDisplayName</key>
			<string>SaveKidsFromBrainRot — Chrome policies</string>
			<key>PayloadEnabled</key>
			<true/>
			<key>PayloadIdentifier</key>
			<string>com.google.Chrome.${chromeUuid}</string>
			<key>PayloadType</key>
			<string>com.google.Chrome</string>
			<key>PayloadUUID</key>
			<string>${chromeUuid}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>PayloadDescription</key>
	<string>SaveKidsFromBrainRot for ${name}: force-installs the extension in Chrome and pairs it to your family dashboard. Install on the kid's Mac via System Settings → Privacy &amp; Security → Profiles.</string>
	<key>PayloadDisplayName</key>
	<string>SaveKidsFromBrainRot (${name})</string>
	<key>PayloadIdentifier</key>
	<string>com.savekidsfrombrainrot.${profileUuid}</string>
	<key>PayloadOrganization</key>
	<string>${org}</string>
	<key>PayloadScope</key>
	<string>System</string>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>${profileUuid}</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>
`;
}
