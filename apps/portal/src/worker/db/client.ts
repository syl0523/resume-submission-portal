import type { BatchItem } from 'drizzle-orm/batch';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;

/** D1 allows at most 100 bound parameters per statement: chunk multi-row inserts with this. */
export function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export { schema };

/** Run statements atomically with D1 batch (D1 has no interactive transactions). No-op when empty. */
export async function runBatch(db: Db, statements: BatchItem<'sqlite'>[]): Promise<void> {
  const [first, ...rest] = statements;
  if (!first) return;
  await db.batch([first, ...rest]);
}
