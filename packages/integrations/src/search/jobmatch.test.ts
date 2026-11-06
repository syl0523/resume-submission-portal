import { jobInputSchema, type SearchProfileParsed, searchProfileSchema } from '@jsp/core';
import { describe, expect, it } from 'vitest';
import { scoreJobFit, titleSimilarity } from '../fit';
import { dedupeJobs } from './dedupe';
import { buildDeepLinks } from './deeplinks';
import { planQueries } from './plan';

const NOW = new Date('2026-11-04T12:00:00Z');

const profile = (over: Partial<SearchProfileParsed> = {}): SearchProfileParsed =>
  searchProfileSchema.parse({
    titles: ['HR Generalist', 'HR Business Partner'],
    skills: ['HRIS', 'Workday', 'Employee relations', 'FMLA', 'Onboarding'],
    locations: ['Austin, TX'],
    keywords: [],
    excludeKeywords: ['commission only'],
    minSalary: 65000,
    ...over,
  });

const job = (over: Record<string, unknown> = {}) =>
  jobInputSchema.parse({
    title: 'Human Resources Generalist II',
    company: 'Northwind Freight',
    location: 'Austin, TX',
    remoteType: 'hybrid',
    description:
      'You will manage onboarding, employee relations and FMLA cases in Workday. HRIS experience a plus.',
    salaryMin: 68000,
    salaryMax: 80000,
    postedAt: '2026-11-02T12:00:00Z',
    ...over,
  });

describe('scoreJobFit', () => {
  it('scores a strong match high and explains why', () => {
    const fit = scoreJobFit(profile(), job(), NOW);
    expect(fit.score).toBeGreaterThanOrEqual(85);
    expect(fit.titleMatch).toBeGreaterThanOrEqual(0.9);
    expect(fit.matchedSkills).toEqual([
      'HRIS',
      'Workday',
      'Employee relations',
      'FMLA',
      'Onboarding',
    ]);
    expect(fit.reasons).toEqual(
      expect.arrayContaining([
        'Title matches “HR Generalist”',
        'In Austin, TX',
        'Posted 2 days ago',
        'Pay meets your minimum',
      ]),
    );
    expect(fit.excluded).toBe(false);
  });

  it('scores an unrelated job low', () => {
    const fit = scoreJobFit(
      profile(),
      job({
        title: 'Forklift Operator',
        description: 'Operate forklifts.',
        location: 'Denver, CO',
      }),
      NOW,
    );
    expect(fit.score).toBeLessThan(40);
  });

  it('flags work-authorization language and excludes it when sponsorship is needed', () => {
    const text =
      'Candidates must be authorized to work in the US without sponsorship. Active secret clearance required.';
    const flagged = scoreJobFit(profile(), job({ description: text }), NOW);
    expect(flagged.flags).toEqual(expect.arrayContaining(['no_sponsorship', 'clearance_required']));
    expect(flagged.excluded).toBe(false);
    expect(
      scoreJobFit(profile({ needsSponsorship: true }), job({ description: text }), NOW).excluded,
    ).toBe(true);
  });

  it('excludes on keywords and the salary floor, and notes contracts and stale postings', () => {
    expect(
      scoreJobFit(profile(), job({ description: 'Commission only role.' }), NOW),
    ).toMatchObject({
      excluded: true,
      flags: expect.arrayContaining(['excluded_keyword']),
    });
    expect(
      scoreJobFit(profile(), job({ salaryMin: 40000, salaryMax: 50000 }), NOW).flags,
    ).toContain('salary_below_min');
    const contract = scoreJobFit(
      profile(),
      job({ title: 'HR Generalist (Contract)', postedAt: '2026-08-01T00:00:00Z' }),
      NOW,
    );
    expect(contract.flags).toEqual(expect.arrayContaining(['contract_role', 'stale_posting']));
  });

  it('prefers remote postings for remote searches', () => {
    const remote = profile({ workMode: 'remote', locations: [] });
    const a = scoreJobFit(remote, job({ remoteType: 'remote', location: 'Remote (US)' }), NOW);
    const b = scoreJobFit(remote, job({ remoteType: 'onsite', location: 'Chicago, IL' }), NOW);
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.reasons).toContain('Remote, as preferred');
  });

  it('understands title abbreviations', () => {
    expect(
      titleSimilarity('HR Business Partner', 'Senior Human Resources Business Partner'),
    ).toBeGreaterThan(0.9);
    expect(titleSimilarity('TA Partner', 'Talent Acquisition Partner')).toBeGreaterThan(0.9);
    expect(titleSimilarity('HR Generalist', 'Software Engineer')).toBeLessThan(0.4);
  });
});

describe('location fit', () => {
  const reasonsFor = (locations: string[], location: string) =>
    scoreJobFit(profile({ locations }), job({ location, remoteType: 'onsite' }), NOW).reasons;

  it('treats the Bay Area as one place covering its cities', () => {
    for (const where of [
      'San Jose, CA',
      'Palo Alto, California',
      'South San Francisco, CA',
      'Oakland, CA',
    ]) {
      expect(reasonsFor(['San Francisco Bay Area'], where)).toContain(`In ${where}`);
    }
    expect(reasonsFor(['Bay Area'], 'San Diego, CA')).not.toContain('In San Diego, CA');
    expect(reasonsFor(['Silicon Valley'], 'Mountain View, CA')).toContain('In Mountain View, CA');
  });

  it('matches whole city names, not single words', () => {
    expect(reasonsFor(['New York, NY'], 'New Orleans, LA')).not.toContain('In New Orleans, LA');
    expect(reasonsFor(['San Francisco, CA'], 'San Diego, CA')).not.toContain('In San Diego, CA');
    expect(reasonsFor(['New York, NY'], 'New York, New York, United States')).toContain(
      'In New York, New York, United States',
    );
  });

  it('gives a same-state posting partial credit', () => {
    const score = (location: string) =>
      scoreJobFit(
        profile({ locations: ['San Francisco, CA'] }),
        job({ location, remoteType: 'onsite' }),
        NOW,
      ).score;
    expect(score('San Francisco, CA')).toBeGreaterThan(score('Los Angeles, CA'));
    expect(score('Los Angeles, CA')).toBeGreaterThan(score('Denver, CO'));
  });
});

describe('planQueries', () => {
  it('interleaves titles and places, adding a remote query, within the cap', () => {
    const queries = planQueries(profile({ locations: ['Austin, TX', 'Remote'] }), 4);
    expect(queries.map((q) => [q.title, q.location, q.remote])).toEqual([
      ['HR Generalist', 'Austin, TX', false],
      ['HR Generalist', null, true],
      ['HR Business Partner', 'Austin, TX', false],
      ['HR Business Partner', null, true],
    ]);
    expect(planQueries(profile({ locations: [] }), 8).map((q) => q.location)).toEqual([null, null]);
    expect(planQueries(profile(), 1)).toHaveLength(1);
  });

  it('names metros canonically, merges their aliases and reads "United States" as US-wide', () => {
    const queries = planQueries(
      profile({ titles: ['SRE Lead'], locations: ['Bay Area', 'SF Bay Area', 'United States'] }),
      8,
    );
    expect(queries.map((q) => [q.location, q.remote])).toEqual([
      ['San Francisco Bay Area', false],
      [null, false],
    ]);
  });
});

describe('Bay Area searches', () => {
  const bayArea = (over: Partial<SearchProfileParsed> = {}) =>
    profile({
      titles: ['Incident Manager'],
      skills: [],
      locations: ['San Francisco Bay Area'],
      minSalary: null,
      ...over,
    });

  it('scores postings across the Bay Area above ones elsewhere in California and beyond', () => {
    const score = (location: string) =>
      scoreJobFit(
        bayArea(),
        job({ title: 'Incident Manager', location, remoteType: 'onsite' }),
        NOW,
      );
    const oakland = score('Oakland, CA');
    expect(oakland.reasons).toContain('In Oakland, CA');
    expect(score('Dublin, CA').reasons).toContain('In Dublin, CA');
    expect(score('Dublin, Ireland').reasons).not.toContain('In Dublin, Ireland');
    expect(oakland.score).toBeGreaterThan(score('Los Angeles, CA').score);
    expect(score('Los Angeles, CA').score).toBeGreaterThan(score('Charlotte, NC').score);
    // "United States" next to the metro: postings elsewhere are acceptable, the metro still wins.
    const both = bayArea({ locations: ['San Francisco Bay Area', 'United States'] });
    const charlotte = job({ title: 'Incident Manager', location: 'Charlotte, NC' });
    expect(scoreJobFit(both, charlotte, NOW).score).toBeGreaterThan(
      scoreJobFit(bayArea(), charlotte, NOW).score,
    );
    expect(
      scoreJobFit(both, job({ title: 'Incident Manager', location: 'Oakland, CA' }), NOW).score,
    ).toBeGreaterThan(scoreJobFit(both, charlotte, NOW).score);
  });

  it('builds region-aware LinkedIn, Indeed and Google Jobs links', () => {
    const [linkedin, indeed, google] = buildDeepLinks(bayArea({ locations: ['Bay Area'] }));
    expect(linkedin?.links[0]?.label).toBe('Incident Manager · San Francisco Bay Area');
    const li = new URL(linkedin?.links[0]?.url ?? '');
    expect(li.searchParams.get('location')).toBe('San Francisco Bay Area');
    expect(li.searchParams.get('geoId')).toBe('90000084');
    expect(new URL(indeed?.links[0]?.url ?? '').searchParams.get('l')).toBe(
      'San Francisco Bay Area, CA',
    );
    expect(new URL(google?.links[0]?.url ?? '').searchParams.get('q')).toBe(
      'Incident Manager jobs in San Francisco Bay Area',
    );
    // Other places keep their own text and no geoId.
    const [austin] = buildDeepLinks(bayArea({ locations: ['Austin, TX'] }));
    expect(new URL(austin?.links[0]?.url ?? '').searchParams.get('geoId')).toBeNull();
  });
});

describe('dedupeJobs', () => {
  it('merges one job seen on LinkedIn, Indeed and the employer ATS, keeping the employer link', () => {
    const merged = dedupeJobs([
      {
        sourceLabel: 'LinkedIn',
        job: job({
          url: 'https://www.linkedin.com/jobs/view/4000000001/',
          source: 'linkedin',
          description: 'short',
        }),
      },
      {
        sourceLabel: 'Adzuna',
        job: job({
          title: 'Other role',
          company: 'Elsewhere',
          url: 'https://www.adzuna.com/details/123',
          source: 'adzuna',
        }),
      },
      {
        sourceLabel: 'Company site',
        job: job({
          url: 'https://job-boards.greenhouse.io/northwind/jobs/101',
          source: 'greenhouse',
          description: 'a much longer description of the role',
          salaryMin: null,
          salaryMax: null,
          postedAt: '2026-11-01T12:00:00Z',
        }),
      },
      {
        sourceLabel: 'Indeed',
        job: job({
          title: 'Human Resources Generalist II',
          url: 'https://www.indeed.com/viewjob?jk=0123456789abcdef',
          source: 'indeed',
          description: 'medium length text',
        }),
      },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.job).toMatchObject({
      url: 'https://job-boards.greenhouse.io/northwind/jobs/101',
      description: 'a much longer description of the role',
      salaryMin: 68000,
      postedAt: '2026-11-01T12:00:00Z',
    });
    expect(merged[0]?.sourceLabel).toBe('Company site');
    expect(merged[1]?.job.company).toBe('Elsewhere');
  });

  it('keeps similar titles at different companies or places apart', () => {
    const items = [
      { sourceLabel: 'A', job: job({ url: null }) },
      { sourceLabel: 'B', job: job({ url: null, location: 'Seattle, WA' }) },
      { sourceLabel: 'C', job: job({ url: null, company: 'Contoso' }) },
    ];
    expect(dedupeJobs(items)).toHaveLength(3);
  });
});

describe('buildDeepLinks', () => {
  it('builds LinkedIn, Indeed and Google Jobs searches with filters', () => {
    const groups = buildDeepLinks(
      profile({ locations: ['Austin, TX', 'Remote'], seniority: 'mid_senior' }),
    );
    expect(groups.map((g) => g.site)).toEqual(['linkedin', 'indeed', 'google']);
    const [linkedin, indeed, google] = groups;
    expect(linkedin?.links[0]?.label).toBe('HR Generalist · Austin, TX');
    const li = new URL(linkedin?.links[0]?.url ?? '');
    expect(li.searchParams.get('keywords')).toBe('HR Generalist');
    expect(li.searchParams.get('f_TPR')).toBe('r604800');
    expect(li.searchParams.get('f_E')).toBe('4');
    expect(new URL(linkedin?.links[1]?.url ?? '').searchParams.get('f_WT')).toBe('2');
    expect(new URL(indeed?.links[1]?.url ?? '').searchParams.get('remotejob')).toBeTruthy();
    expect(new URL(google?.links[0]?.url ?? '').searchParams.get('ibp')).toBe('htl;jobs');
    expect(linkedin?.links).toHaveLength(4);
  });
});
