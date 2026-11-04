// Creates .dev.vars from the example on first run so `pnpm dev` works out of the box.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.dev.vars');
if (!existsSync(target)) {
  copyFileSync(join(root, '.dev.vars.example'), target);
  console.log('Created apps/portal/.dev.vars from .dev.vars.example (AUTH_MODE=dev).');
}
