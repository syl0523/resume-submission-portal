import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../errors';
import { roleFamily, titleSimilarity } from '../fit';
import { museCategoriesFor, museLocationsFor, searchMuse } from './muse';

// Synthetic postings in the shape of GET https://www.themuse.com/api/public/jobs.
const posting = (id: number, name: string, locations: string[], extra = {}) => ({
  id,
  name,
  type: 'external',
  publication_date: '2026-11-02T12:00:00Z',
  short_name: `job-${id}`,
  model_type: 'jobs',
  contents: '<p>Own <b>incident response</b> &amp; on-call.<br>Kubernetes, PagerDuty.</p>',
  locations: locations.map((name) => ({ name })),
  categories: [{ name: 'Software Engineering' }],
  levels: [{ name: 'Senior Level', short_name: 'senior' }],
  tags: [],
  refs: { landing_page: `https://www.themuse.com/jobs/examplebank/job-${id}` },
  company: { id: 1, short_name: 'examplebank', name: 'Example Bank' },
  ...extra,
});

function fakeMuse(pages: Record<string, unknown[][]>, seen: URL[], status = 200) {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url);
    if (status !== 200) return new Response('{}', { status });
    const category = url.searchParams.get('category') ?? '';
    const page = Number(url.searchParams.get('page'));
    const all = pages[category] ?? [];
    return new Response(
      JSON.stringify({
        page,
        page_count: all.length,
        items_per_page: 20,
        total: all.flat().length,
        results: all[page] ?? [],
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

const fullPage = (from: number, name: string) =>
  Array.from({ length: 20 }, (_, i) => posting(from + i, name, ['Austin, TX']));

describe('title families', () => {
  it('treats SRE, production / application support and incident roles as close variants', () => {
    const family = [
      'Site Reliability Engineer',
      'SRE',
      'Senior SRE Lead',
      'Production Support Engineer',
      'Application Support Analyst',
      'Incident Manager',
      'Major Incident Manager',
      'Reliability Engineer',
    ];
    for (const a of family) {
      expect(roleFamily(a), a).toBe('reliability');
      for (const b of family)
        expect(titleSimilarity(a, b), `${a} ~ ${b}`).toBeGreaterThanOrEqual(0.8);
    }
    expect(titleSimilarity('SRE Lead', 'Senior Site Reliability Engineer')).toBe(1);
    expect(titleSimilarity('Incident Manager', 'HR Generalist')).toBeLessThan(0.55);
    expect(roleFamily('Software Engineer')).toBeNull();
  });
});

describe('The Muse', () => {
  it('maps titles to current categories and places to Muse locations', () => {
    expect(
      museCategoriesFor(['Incident Management / SRE Lead', 'Production Support Manager']),
    ).toEqual(['Software Engineering', 'Computer and IT']);
    expect(museCategoriesFor(['HR Business Partner', 'Operations Manager'])).toEqual([
      'Human Resources and Recruitment',
      'Business Operations',
    ]);
    expect(museCategoriesFor(['Warehouse Supervisor', 'Recruiter', 'Payroll Specialist'])).toEqual([
      'Transportation and Logistics',
      'Manufacturing and Warehouse',
      'Human Resources and Recruitment',
    ]);
    const bay = museLocationsFor(['San Francisco Bay Area'], true);
    expect(bay[0]).toBe('San Francisco, CA');
    expect(bay).toEqual(expect.arrayContaining(['Oakland, CA', 'San Jose, CA', 'Dublin, CA']));
    expect(bay.at(-1)).toBe('Flexible / Remote');
    expect(museLocationsFor(['Austin, TX', null], false)).toEqual([]);
    expect(museLocationsFor([], true)).toEqual(['Flexible / Remote']);
  });

  it('queries per category with 0-based pages, keeps similar titles and maps postings', async () => {
    const seen: URL[] = [];
    const fetch = fakeMuse(
      {
        'Software Engineering': [
          [
            posting(1, 'Senior Site Reliability Engineer', ['Charlotte, NC', 'San Jose, CA']),
            posting(2, 'Frontend Engineer', ['San Francisco, CA']),
            posting(3, 'Production Support Lead', ['Flexible / Remote', 'Oakland, CA']),
          ],
        ],
        'Computer and IT': [[posting(1, 'Senior Site Reliability Engineer', ['San Jose, CA'])]],
      },
      seen,
    );
    const r = await searchMuse(
      {
        titles: ['SRE Lead', 'Incident Manager'],
        places: ['San Francisco Bay Area'],
        remote: true,
        seniority: 'mid_senior',
      },
      { fetch },
    );
    expect(seen).toHaveLength(2);
    const first = seen[0];
    expect(first?.origin + (first?.pathname ?? '')).toBe('https://www.themuse.com/api/public/jobs');
    expect(first?.searchParams.get('page')).toBe('0');
    expect(seen.map((u) => u.searchParams.get('category'))).toEqual([
      'Software Engineering',
      'Computer and IT',
    ]);
    expect(first?.searchParams.getAll('level')).toEqual(['Senior Level', 'Mid Level']);
    expect(first?.searchParams.getAll('location')).toContain('Sunnyvale, CA');
    expect(first?.searchParams.getAll('location')).toContain('Flexible / Remote');

    // The frontend role is dropped; the SRE posting seen in two categories is kept once.
    expect(r.items.map((i) => i.job.title)).toEqual([
      'Senior Site Reliability Engineer',
      'Production Support Lead',
    ]);
    expect(r.items[0]).toMatchObject({
      sourceLabel: 'The Muse',
      job: {
        company: 'Example Bank',
        url: 'https://www.themuse.com/jobs/examplebank/job-1',
        source: 'other',
        externalId: '1',
        // Bay Area places first, so the location shows (and scores) them.
        location: 'San Jose, CA; Charlotte, NC',
        remoteType: 'unknown',
        postedAt: '2026-11-02T12:00:00Z',
      },
    });
    expect(r.items[0]?.job.description).toBe(
      'Own incident response & on-call.\nKubernetes, PagerDuty.',
    );
    expect(r.items[1]?.job.remoteType).toBe('remote');
  });

  it('fetches a bounded number of pages and stops at the last one', async () => {
    const seen: URL[] = [];
    const fetch = fakeMuse(
      {
        'Human Resources and Recruitment': [
          fullPage(100, 'HR Generalist'),
          fullPage(200, 'HR Generalist II'),
          fullPage(300, 'Senior HR Generalist'),
        ],
      },
      seen,
    );
    const r = await searchMuse({ titles: ['HR Generalist'], maxPages: 2 }, { fetch });
    expect(seen.map((u) => u.searchParams.get('page'))).toEqual(['0', '1']);
    expect(r.items).toHaveLength(40);

    seen.length = 0;
    await searchMuse({ titles: ['HR Generalist'], page: 2, maxPages: 5 }, { fetch });
    expect(seen.map((u) => u.searchParams.get('page'))).toEqual(['2']);
  });

  it('matches descriptions for keyword searches and reports rate limits', async () => {
    const seen: URL[] = [];
    const fetch = fakeMuse({ '': [[posting(9, 'Platform Engineer', ['Austin, TX'])]] }, seen);
    const plain = await searchMuse({ titles: ['PagerDuty'] }, { fetch });
    expect(plain.items).toHaveLength(0);
    const keyword = await searchMuse({ titles: ['PagerDuty'], matchDescription: true }, { fetch });
    expect(keyword.items.map((i) => i.job.title)).toEqual(['Platform Engineer']);
    expect(seen[0]?.searchParams.has('category')).toBe(false);

    const limited = searchMuse({ titles: ['SRE'] }, { fetch: fakeMuse({}, [], 403) });
    await expect(limited).rejects.toBeInstanceOf(UpstreamError);
    await expect(limited).rejects.toThrow(/rate limit/);
  });
});
