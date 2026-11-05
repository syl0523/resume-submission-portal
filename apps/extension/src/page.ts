/** What the popup reads from the job page. Plain data, so it survives `executeScript`. */
export interface PageSnapshot {
  url: string;
  title: string;
  /** Parsed `<script type="application/ld+json">` blocks; malformed ones are skipped. */
  jsonLd: unknown[];
  /** og:title, og:site_name, og:description, description, twitter:title. */
  meta: Record<string, string>;
  h1: string | null;
  /** LinkedIn or Indeed job pane, read with the site's own markup. Null elsewhere. */
  board: BoardFields | null;
  /** Text the applicant selected, used as the description when it is substantial. */
  selection: string | null;
}

export interface BoardFields {
  title: string | null;
  company: string | null;
  location: string | null;
  description: string | null;
}

/**
 * Runs inside the job page through `chrome.scripting.executeScript({ func })`, which sends the
 * function's source text, so it must be self-contained: no imports and no helpers from this
 * module. It only reads the page the applicant clicked the extension on; it never changes it.
 */
export function collectPage(
  doc: Document = document,
  href: string = doc.location.href,
): PageSnapshot {
  const oneLine = (value: string | null | undefined, max: number): string | null => {
    const text = (value ?? '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, max) : null;
  };
  const block = (value: string | null | undefined, max: number): string | null => {
    const text = (value ?? '')
      .replace(/[ \t\f\v ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return text ? text.slice(0, max) : null;
  };
  const textOf = (selectors: string[]): string | null => {
    for (const selector of selectors) {
      const el = doc.querySelector(selector);
      // innerText keeps the visible line breaks; jsdom (tests) only has textContent.
      // biome-ignore lint/performance/useDomNodeTextContent: line breaks matter for descriptions
      const text = el ? ((el as HTMLElement).innerText ?? el.textContent) : null;
      if (text?.trim()) return text;
    }
    return null;
  };

  const jsonLd: unknown[] = [];
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts.slice(0, 20)) {
    const text = script.textContent ?? '';
    if (!text.trim() || text.length > 2_000_000) continue;
    try {
      jsonLd.push(JSON.parse(text));
    } catch {
      // Sites ship broken JSON-LD now and then; the other sources still work.
    }
  }

  const meta: Record<string, string> = {};
  for (const el of Array.from(doc.querySelectorAll('meta[property], meta[name]'))) {
    const key = (el.getAttribute('property') ?? el.getAttribute('name') ?? '').toLowerCase();
    const content = el.getAttribute('content');
    if (content && /^(og:(title|site_name|description)|description|twitter:title)$/.test(key)) {
      meta[key] = content.slice(0, 5000);
    }
  }

  let host = '';
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    host = '';
  }
  let board: BoardFields | null = null;
  if (/(^|\.)linkedin\.com$/.test(host)) {
    board = {
      title: oneLine(
        textOf([
          '.job-details-jobs-unified-top-card__job-title h1',
          '.job-details-jobs-unified-top-card__job-title',
          '.jobs-unified-top-card__job-title',
          'h1.top-card-layout__title',
          '.topcard__title',
        ]),
        300,
      ),
      company: oneLine(
        textOf([
          '.job-details-jobs-unified-top-card__company-name a',
          '.job-details-jobs-unified-top-card__company-name',
          '.jobs-unified-top-card__company-name',
          '.topcard__org-name-link',
        ]),
        200,
      ),
      location: oneLine(
        textOf([
          '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
          '.job-details-jobs-unified-top-card__bullet',
          '.jobs-unified-top-card__bullet',
          '.topcard__flavor--bullet',
        ]),
        200,
      ),
      description: block(
        textOf([
          '#job-details',
          '.jobs-description__content',
          '.jobs-box__html-content',
          '.show-more-less-html__markup',
          '.description__text',
        ]),
        100_000,
      ),
    };
  } else if (/(^|\.)indeed\.com$/.test(host)) {
    board = {
      title: oneLine(
        textOf([
          '[data-testid="jobsearch-JobInfoHeader-title"]',
          'h1.jobsearch-JobInfoHeader-title',
          '.jobsearch-JobInfoHeader-title',
        ])?.replace(/\s*-\s*job post\s*$/i, ''),
        300,
      ),
      company: oneLine(
        textOf([
          '[data-testid="inlineHeader-companyName"]',
          '[data-company-name="true"]',
          '.jobsearch-CompanyInfoContainer a',
        ]),
        200,
      ),
      location: oneLine(
        textOf(['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]']),
        200,
      ),
      description: block(textOf(['#jobDescriptionText']), 100_000),
    };
  }

  return {
    url: href,
    title: oneLine(doc.title, 500) ?? '',
    jsonLd,
    meta,
    h1: oneLine(textOf(['h1']), 300),
    board,
    selection: block(doc.getSelection?.()?.toString(), 50_000),
  };
}
