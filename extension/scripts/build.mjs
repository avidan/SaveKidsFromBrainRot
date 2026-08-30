import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

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
