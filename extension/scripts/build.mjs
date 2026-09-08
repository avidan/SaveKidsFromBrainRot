import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SAFARI = process.argv.includes('--safari');

mkdirSync('dist', { recursive: true });

await esbuild.build({
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/popup.ts', 'src/options.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: false,
  minify: false,
});

cpSync('static', 'dist', { recursive: true });
console.log('Built extension → dist/ (load dist/ as an unpacked extension)');

if (SAFARI) {
  // Safari (macOS/iPadOS) variant: same bundles, adjusted manifest. Feed the
  // resulting dist-safari/ to Apple's converter on a Mac:
  //   xcrun safari-web-extension-converter dist-safari ...
  cpSync('dist', 'dist-safari', { recursive: true });
  const manifest = JSON.parse(readFileSync('dist-safari/manifest.json', 'utf8'));

  // Chrome-only concepts.
  delete manifest.key; // pins the Chrome extension id; meaningless to Safari
  delete manifest.storage; // managed-storage schema (no managed storage on iOS)

  // Safari runs our background as a (non-persistent) page, which is the most
  // compatible choice across Safari/iPadOS versions.
  manifest.background = { scripts: ['background.js'] };

  // iPad Safari may serve the mobile site; cover it. (Deliberately NOT added
  // to the Chrome manifest — new host permissions there can disable the
  // extension for store users until re-approved.)
  const mobile = 'https://m.youtube.com/*';
  manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), mobile])];
  for (const cs of manifest.content_scripts ?? []) {
    if (cs.matches?.includes('https://www.youtube.com/*')) cs.matches.push(mobile);
  }

  writeFileSync('dist-safari/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log('Built Safari variant → dist-safari/ (see ios/README.md for the Xcode steps)');
}
