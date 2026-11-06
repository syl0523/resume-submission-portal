import { normalizeForCompare } from './text';

/**
 * US places in searches and postings (KAN-65): metro areas that a search can name as one place
 * ("San Francisco Bay Area" ↔ its cities), "anywhere in the US" aliases, US states, and how each
 * search provider wants a metro expressed. Pure data and string logic; no I/O.
 */

export interface MetroCity {
  name: string;
  /**
   * Also a well-known place elsewhere (Dublin, Ireland; Newark, NJ; Concord, NH): a posting only
   * counts as in the metro when it also names the metro's state.
   */
  needsState?: boolean;
}

export interface Metro {
  id: string;
  /** Canonical name, used in planned queries and labels. */
  name: string;
  /** Matches the metro's names in normalized text (lower case, no punctuation). */
  alias: RegExp;
  /** Two-letter state code, lower case. */
  state: string;
  cities: MetroCity[];
  /** How each provider wants this metro expressed. */
  providers: {
    /** JSearch query suffix ("<title> in <jsearch>"). */
    jsearch: string;
    /** Indeed `l=`. */
    indeed: string;
    /** Google Jobs query suffix ("<title> jobs in <google>"). */
    google: string;
    /** LinkedIn `location=` text, plus the region's `geoId` when known. */
    linkedin: { location: string; geoId?: string };
    /** Adzuna `where=` (a city) and `distance=` (kilometres from its centre). */
    adzuna: { where: string; distanceKm: number };
    /** USAJOBS `LocationName=` ("City, State") and `Radius=` (miles). */
    usajobs: { locationName: string; radiusMiles: number };
    /** Approximate location for location-aware web search. */
    userLocation: { city: string; region: string; country: 'US'; timezone: string };
  };
}

const city = (name: string, needsState = false): MetroCity =>
  needsState ? { name, needsState } : { name };

export const SF_BAY_AREA: Metro = {
  id: 'sf_bay_area',
  name: 'San Francisco Bay Area',
  alias: /\b((san francisco|sf) )?bay area\b|\bsilicon valley\b/,
  state: 'ca',
  cities: [
    city('San Francisco'),
    city('South San Francisco'),
    city('Daly City'),
    city('Brisbane', true),
    city('San Bruno'),
    city('Millbrae'),
    city('Burlingame'),
    city('San Mateo'),
    city('Foster City'),
    city('Belmont', true),
    city('San Carlos'),
    city('Redwood City'),
    city('Redwood Shores'),
    city('Menlo Park'),
    city('Palo Alto'),
    city('Stanford'),
    city('Mountain View'),
    city('Los Altos'),
    city('Sunnyvale'),
    city('Santa Clara'),
    city('Cupertino'),
    city('Campbell'),
    city('Los Gatos'),
    city('Saratoga', true),
    city('San Jose'),
    city('Milpitas'),
    city('Fremont'),
    city('Newark', true),
    city('Union City', true),
    city('Hayward'),
    city('San Leandro'),
    city('Alameda'),
    city('Oakland'),
    city('Emeryville'),
    city('Berkeley'),
    city('Richmond', true),
    city('Pleasanton'),
    city('Dublin', true),
    city('Livermore'),
    city('San Ramon'),
    city('Walnut Creek'),
    city('Concord', true),
    city('Pleasant Hill'),
    city('San Rafael'),
    city('Novato'),
    city('Mill Valley'),
    city('Sausalito'),
  ],
  providers: {
    jsearch: 'San Francisco Bay Area',
    indeed: 'San Francisco Bay Area, CA',
    google: 'San Francisco Bay Area',
    // LinkedIn's "San Francisco Bay Area" region (widely used geoId; the location text is sent too).
    linkedin: { location: 'San Francisco Bay Area', geoId: '90000084' },
    // ~50 miles from downtown San Francisco reaches San Jose, Livermore and Novato.
    adzuna: { where: 'San Francisco', distanceKm: 80 },
    usajobs: { locationName: 'San Francisco, California', radiusMiles: 50 },
    userLocation: {
      city: 'San Francisco',
      region: 'California',
      country: 'US',
      timezone: 'America/Los_Angeles',
    },
  },
};

const NEW_YORK_METRO: Metro = {
  id: 'nyc',
  name: 'New York City area',
  alias: /\bnew york city\b|\bnyc\b|\bnew york metro/,
  state: 'ny',
  cities: [
    city('New York'),
    city('NYC'),
    city('Manhattan'),
    city('Brooklyn'),
    city('Queens'),
    city('Bronx'),
    city('Long Island City'),
    city('Jersey City'),
    city('Hoboken'),
  ],
  providers: {
    jsearch: 'New York, NY',
    indeed: 'New York, NY',
    google: 'New York, NY',
    linkedin: { location: 'New York City Metropolitan Area' },
    adzuna: { where: 'New York', distanceKm: 40 },
    usajobs: { locationName: 'New York, New York', radiusMiles: 25 },
    userLocation: {
      city: 'New York',
      region: 'New York',
      country: 'US',
      timezone: 'America/New_York',
    },
  },
};

const SEATTLE_METRO: Metro = {
  id: 'seattle',
  name: 'Greater Seattle Area',
  alias: /\b(greater )?seattle area\b|\bpuget sound\b/,
  state: 'wa',
  cities: [city('Seattle'), city('Bellevue'), city('Redmond'), city('Kirkland'), city('Bothell')],
  providers: {
    jsearch: 'Seattle, WA',
    indeed: 'Seattle, WA',
    google: 'Seattle, WA',
    linkedin: { location: 'Greater Seattle Area' },
    adzuna: { where: 'Seattle', distanceKm: 40 },
    usajobs: { locationName: 'Seattle, Washington', radiusMiles: 25 },
    userLocation: {
      city: 'Seattle',
      region: 'Washington',
      country: 'US',
      timezone: 'America/Los_Angeles',
    },
  },
};

export const METROS: readonly Metro[] = [SF_BAY_AREA, NEW_YORK_METRO, SEATTLE_METRO];

/** The metro a place names ("SF Bay Area", "Bay Area, CA", "Silicon Valley"), if any. */
export function findMetro(place: string): Metro | null {
  const norm = normalizeForCompare(place);
  return METROS.find((m) => m.alias.test(norm)) ?? null;
}

const NATIONWIDE =
  /^(united states( of america)?|usa?|u s( a)?|anywhere( in the (us|usa|united states))?|nationwide|us wide)$/;

/** "United States", "USA", "Anywhere", "Nationwide": a search that covers the whole country. */
export function isNationwide(place: string): boolean {
  return NATIONWIDE.test(normalizeForCompare(place));
}

export function isRemotePlace(place: string): boolean {
  return /remote/i.test(place);
}

/**
 * A search place as queries use it: a metro's canonical name ("Bay Area" → "San Francisco Bay
 * Area"), null for the whole country, otherwise the place as typed.
 */
export function canonicalPlace(place: string): string | null {
  if (isNationwide(place)) return null;
  return findMetro(place)?.name ?? (place.trim() || null);
}

// ---------------------------------------------------------------------------------------------
// US states
// ---------------------------------------------------------------------------------------------

export const US_STATES: Readonly<Record<string, string>> = {
  al: 'alabama',
  ak: 'alaska',
  az: 'arizona',
  ar: 'arkansas',
  ca: 'california',
  co: 'colorado',
  ct: 'connecticut',
  de: 'delaware',
  dc: 'district of columbia',
  fl: 'florida',
  ga: 'georgia',
  hi: 'hawaii',
  id: 'idaho',
  il: 'illinois',
  in: 'indiana',
  ia: 'iowa',
  ks: 'kansas',
  ky: 'kentucky',
  la: 'louisiana',
  me: 'maine',
  md: 'maryland',
  ma: 'massachusetts',
  mi: 'michigan',
  mn: 'minnesota',
  ms: 'mississippi',
  mo: 'missouri',
  mt: 'montana',
  ne: 'nebraska',
  nv: 'nevada',
  nh: 'new hampshire',
  nj: 'new jersey',
  nm: 'new mexico',
  ny: 'new york',
  nc: 'north carolina',
  nd: 'north dakota',
  oh: 'ohio',
  ok: 'oklahoma',
  or: 'oregon',
  pa: 'pennsylvania',
  ri: 'rhode island',
  sc: 'south carolina',
  sd: 'south dakota',
  tn: 'tennessee',
  tx: 'texas',
  ut: 'utah',
  vt: 'vermont',
  va: 'virginia',
  wa: 'washington',
  wv: 'west virginia',
  wi: 'wisconsin',
  wy: 'wyoming',
};

const STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([code, name]) => [name, code]));
/** Longest first, so "west virginia" is consumed before "virginia". */
const STATE_NAMES = [...STATE_BY_NAME.keys()].sort((a, b) => b.length - a.length);

/** Countries that job postings commonly name; such a posting is not in a US metro. */
const FOREIGN =
  /\b(canada|mexico|costa rica|ireland|united kingdom|uk|england|scotland|germany|france|netherlands|spain|portugal|poland|india|philippines|singapore|australia|new zealand|japan|china|brazil|argentina|colombia|israel)\b/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "TX", "tx", "Texas", "Texas 78701" → "tx"; anything else → null. */
export function stateCode(token: string): string | null {
  const t = normalizeForCompare(token)
    .replace(/\b\d{5}(\s\d{4})?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^[a-z]{2}$/.test(t) && t in US_STATES) return t;
  return STATE_BY_NAME.get(t) ?? null;
}

/**
 * Where a posting's location says it is: the US states it names (codes after a comma or in
 * capitals, or full names) and whether it names a foreign country.
 */
export function describeLocation(location: string): { states: Set<string>; foreign: boolean } {
  const states = new Set<string>();
  for (const m of location.matchAll(/(?:^|,)\s*([A-Za-z]{2})(?=\s*(?:$|[,;/()\-\d]))/g)) {
    const code = (m[1] ?? '').toLowerCase();
    if (code in US_STATES) states.add(code);
  }
  for (const m of location.matchAll(/(?:^|[\s(/;-])([A-Z]{2})(?=$|[\s,;/()-])/g)) {
    const code = (m[1] ?? '').toLowerCase();
    if (code in US_STATES) states.add(code);
  }
  let rest = ` ${normalizeForCompare(location)} `;
  for (const name of STATE_NAMES) {
    const re = new RegExp(`\\b${escapeRe(name)}\\b`, 'g');
    if (re.test(rest)) {
      const code = STATE_BY_NAME.get(name);
      if (code) states.add(code);
      rest = rest.replace(re, ' ');
    }
  }
  return { states, foreign: FOREIGN.test(rest) };
}

// ---------------------------------------------------------------------------------------------
// Matching a posting's location against a search place
// ---------------------------------------------------------------------------------------------

/**
 * - `match`: the posting is in the place (a metro city, the city, or the state for a state search)
 * - `same_state`: elsewhere in the same state
 * - `elsewhere`: somewhere else
 * - `unknown`: the place gives nothing to compare (a ZIP code, free text)
 */
export type PlaceFit = 'match' | 'same_state' | 'elsewhere' | 'unknown';

interface PlaceSpec {
  metro: Metro | null;
  city: string | null;
  state: string | null;
}

function specOf(place: string): PlaceSpec {
  const metro = findMetro(place);
  if (metro) return { metro, city: null, state: metro.state };
  const [cityPart = '', ...rest] = place.split(',');
  const state = rest.map(stateCode).find((s) => s !== null) ?? null;
  if (rest.length === 0) {
    const lone = stateCode(cityPart);
    if (lone) return { metro: null, city: null, state: lone };
  }
  const cityName = normalizeForCompare(cityPart);
  if (!cityName || /^\d{5}$/.test(cityName)) return { metro: null, city: null, state };
  return { metro: null, city: cityName, state };
}

/** Whole place names, not single words: "New York" must not match "New Orleans". */
function mentions(where: string, name: string): boolean {
  return new RegExp(`\\b${escapeRe(normalizeForCompare(name))}\\b`).test(where);
}

/** Is the posting (by its location text) in this metro? */
export function inMetro(metro: Metro, location: string): boolean {
  const where = normalizeForCompare(location);
  const { states, foreign } = describeLocation(location);
  if (foreign && !states.has(metro.state)) return false;
  if (states.size > 0 && !states.has(metro.state)) return false;
  if (metro.alias.test(where)) return true;
  return metro.cities.some(
    (c) => mentions(where, c.name) && (!c.needsState || states.has(metro.state)),
  );
}

/** How well a posting's location fits one search place (see PlaceFit). */
export function matchPlace(place: string, location: string): PlaceFit {
  const spec = specOf(place);
  const { states } = describeLocation(location);
  if (spec.metro) {
    if (inMetro(spec.metro, location)) return 'match';
    return states.has(spec.metro.state) ? 'same_state' : 'elsewhere';
  }
  if (spec.city === null && spec.state === null) return 'unknown';
  if (spec.city === null) return spec.state && states.has(spec.state) ? 'match' : 'elsewhere';
  const conflict = spec.state !== null && states.size > 0 && !states.has(spec.state);
  if (!conflict) {
    const where = normalizeForCompare(location);
    if (mentions(where, spec.city)) return 'match';
    // The posting names a metro this city is in ("San Francisco Bay Area" for "San Jose, CA").
    const metro = findMetro(location);
    if (metro?.cities.some((c) => normalizeForCompare(c.name) === spec.city)) return 'match';
  }
  return spec.state && states.has(spec.state) ? 'same_state' : 'elsewhere';
}
