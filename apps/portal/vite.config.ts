import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `pnpm dev` runs fully local, with no Cloudflare sign-in: the Workers AI binding is then not
// connected, so without ANTHROPIC_API_KEY in .dev.vars the AI features answer 502.
// `pnpm dev:remote` (mode "remote") connects remote bindings such as Workers AI; it needs
// `wrangler login` or CLOUDFLARE_API_TOKEN, and Workers AI usage counts against your account.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), cloudflare({ remoteBindings: mode === 'remote' })],
}));
