import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` writes SQL migrations that wrangler applies with `d1 migrations apply`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/worker/db/schema.ts',
  out: './migrations',
});
