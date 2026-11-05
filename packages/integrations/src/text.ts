const LEGAL_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'plc',
  'gmbh',
  'ag',
  'sa',
  'bv',
  'nv',
  'pty',
  'ulc',
  'lp',
  'llp',
  'ltee',
]);

/** Lower-case, accent-free, punctuation-free text; keeps CJK characters. */
export function normalizeForCompare(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9㐀-鿿]+/g, ' ')
    .trim();
}

/**
 * Company name as a matching key: "Acme Logistics, Inc." -> "acme logistics".
 * Strips a leading "the" and trailing legal suffixes.
 */
export function normalizeCompany(name: string): string {
  const words = normalizeForCompare(name).split(' ').filter(Boolean);
  if (words[0] === 'the' && words.length > 1) words.shift();
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1] ?? '')) words.pop();
  return words.join(' ');
}

/** Job title as a matching key: drops requisition ids and bracketed qualifiers. */
export function normalizeTitle(title: string): string {
  return normalizeForCompare(
    title
      .replace(/\((?:[^)]*)\)|\[(?:[^\]]*)\]/g, ' ')
      .replace(/\b(req(uisition)?|job)\s*(id|#|no\.?)?\s*[:#]?\s*[A-Z0-9-]{3,}\b/gi, ' '),
  );
}

/** Sørensen-Dice similarity on character bigrams, 0..1. Robust to word order and small typos. */
export function similarity(a: string, b: string): number {
  const x = normalizeForCompare(a).replace(/ /g, '');
  const y = normalizeForCompare(b).replace(/ /g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      overlap++;
    }
  }
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Remove script, style, head and noscript elements in one pass. A tag with no closing tag after it
 * is left for the generic tag stripper, and is remembered, so later unclosed tags of the same kind
 * do not each search to the end of the document again.
 */
function dropHiddenElements(html: string): string {
  const open = /<(script|style|head|noscript)\b[^<>]*>/gi;
  const unclosed = new Set<string>();
  let out = '';
  let from = 0;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const tag = (m[1] ?? '').toLowerCase();
    if (unclosed.has(tag)) continue;
    const close = new RegExp(`</${tag}\\b[^<>]*>`, 'gi');
    close.lastIndex = open.lastIndex;
    const end = close.exec(html);
    if (!end) {
      unclosed.add(tag);
      continue;
    }
    out += `${html.slice(from, m.index)} `;
    from = end.index + end[0].length;
    open.lastIndex = from;
  }
  return out + html.slice(from);
}

/**
 * Readable plain text from an HTML fragment. For entity-encoded HTML (Greenhouse `content`),
 * call `htmlToText(decodeEntities(content))`.
 */
export function htmlToText(html: string): string {
  // Tag patterns stop at the next "<" as well as ">": with `[^>]*`, text full of "<" and no ">"
  // (broken or hostile email HTML) is rescanned from every "<", which is quadratic.
  const stripped = dropHiddenElements(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^<>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|tr|section|article|ul|ol|table|blockquote)>/gi, '\n')
    .replace(/<[^<>]+>/g, ' ');
  return decodeEntities(stripped)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
