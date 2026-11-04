const encoder = new TextEncoder();

export function newId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Random lower-case token without look-alike characters (for inbound aliases). */
export function randomSlug(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Extension API token: `jsp_` + 40 random base32-ish characters (~200 bits). */
export function newApiToken(): string {
  return `jsp_${randomSlug(40)}`;
}
