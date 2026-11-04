import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import type { AuthUser } from '../env';
import { newId, randomSlug } from '../lib/crypto';
import { nowIso } from '../lib/time';

/** Find the user for a verified email, creating it (with a random inbound alias) on first sign-in. */
export async function ensureUser(
  db: Db,
  email: string,
  name: string | null = null,
): Promise<AuthUser> {
  const normalized = email.trim().toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, normalized)).get();
  if (existing) return existing;

  await db
    .insert(users)
    .values({
      id: newId(),
      email: normalized,
      name,
      inboundAlias: `jobs-${randomSlug(8)}`,
      calendarToken: randomSlug(32),
      createdAt: nowIso(),
    })
    .onConflictDoNothing({ target: users.email });

  const created = await db.select().from(users).where(eq(users.email, normalized)).get();
  if (!created) throw new Error(`Could not provision user ${normalized}`);
  return created;
}

/** Resolve the owner of an inbound address local part (e.g. "jobs-k3x9q2ab"). */
export async function findUserByInboundAlias(db: Db, alias: string): Promise<AuthUser | null> {
  const row = await db
    .select()
    .from(users)
    .where(eq(users.inboundAlias, alias.trim().toLowerCase()))
    .get();
  return row ?? null;
}

export function inboundAddressFor(user: AuthUser, domain: string | undefined): string | null {
  const d = domain?.trim();
  return d ? `${user.inboundAlias}@${d}` : null;
}
