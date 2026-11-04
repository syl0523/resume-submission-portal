// Bundles the extension into dist/ (load it via chrome://extensions > Load unpacked).
// Usage: node build.mjs [--watch]
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, 'dist');
const watch = process.argv.includes('--watch');

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
cpSync(join(root, 'static'), outdir, { recursive: true });

const options = {
  entryPoints: {
    background: join(root, 'src/background.ts'),
    popup: join(root, 'src/popup.ts'),
    options: join(root, 'src/options.ts'),
    'content-autofill': join(root, 'src/content/autofill.ts'),
  },
  outdir,
  bundle: true,
  // Content scripts cannot be ES modules; IIFE works for every entry.
  format: 'iife',
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
