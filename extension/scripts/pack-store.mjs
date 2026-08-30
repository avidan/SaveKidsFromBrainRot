// Builds the Chrome Web Store upload zip (skfbr-store.zip).
//
// Differences from the normal dist build:
// - manifest "key" is stripped: the store rejects manifests that carry it.
// - key.pem (our CRX signing key) is included in the zip root: on the FIRST
//   upload this is what makes the store keep our existing extension ID
//   (fkegepdokopkgklbpbkphdemnbinjhoc) — which every managed-storage payload
//   and force-install profile depends on. After the first upload the store
//   holds the key; later uploads don't need the pem (but including it is harmless).
//
// AFTER UPLOADING: verify the item ID shown in the developer dashboard is
// exactly fkegepdokopkgklbpbkphdemnbinjhoc before publishing. If it isn't,
// do not publish — the zip was built without key.pem.

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE_DIR = join(ROOT, 'dist-store');
const PEM = join(ROOT, 'skfbr-signing-key.pem');
const ZIP = join(ROOT, 'skfbr-store.zip');

if (!existsSync(PEM)) {
  console.error('skfbr-signing-key.pem not found — required to preserve the extension ID on the store.');
  process.exit(1);
}

execSync('node scripts/build.mjs', { cwd: ROOT, stdio: 'inherit' });

rmSync(STORE_DIR, { recursive: true, force: true });
cpSync(join(ROOT, 'dist'), STORE_DIR, { recursive: true });

const manifestPath = join(STORE_DIR, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
delete manifest.key;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

cpSync(PEM, join(STORE_DIR, 'key.pem'));

rmSync(ZIP, { force: true });
execSync(`cd "${STORE_DIR}" && zip -qr "${ZIP}" .`, { stdio: 'inherit' });
mkdirSync(STORE_DIR, { recursive: true }); // no-op, keeps dir for inspection

console.log(`\nStore upload zip: ${ZIP} (version ${manifest.version})`);
console.log('Upload at https://chrome.google.com/webstore/devconsole — see store/LISTING.md for the copy.');
