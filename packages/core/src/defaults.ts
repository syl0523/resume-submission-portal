/**
 * Defaults shared by the Worker and the web portal (KAN-65).
 */

/**
 * Where searches look when no place is given: new saved searches and AI drafts get it as their
 * location, and Discover uses it for an empty `where` (unless the search is remote-only).
 * "United States" (or "USA", "Anywhere") searches the whole country instead.
 */
export const DEFAULT_SEARCH_LOCATION = 'San Francisco Bay Area';

/** A saved search's locations, with the default place when none is given. */
export function withDefaultLocation(locations: readonly string[]): string[] {
  const kept = locations.map((l) => l.trim()).filter(Boolean);
  return kept.length > 0 ? kept : [DEFAULT_SEARCH_LOCATION];
}
