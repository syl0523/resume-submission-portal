import { describe, expect, it } from 'vitest';
import {
  isAllowedJobUrl,
  WEB_SEARCH_ALLOWED_DOMAINS,
  type WebSearchPosting,
  webSearchItems,
  webSearchPrompt,
} from './websearch';

const posting = (url: string, over: Partial<WebSearchPosting> = {}): WebSearchPosting => ({
  title: 'Site Reliability Engineer',
  company: 'Example Payments',
  location: 'San Francisco, CA',
  url,
  postedAt: '2026-11-01',
  snippet: 'Keep payments up.',
  ...over,
});

describe('web search domains', () => {
  it('allows big-tech careers sites and ATS boards, never LinkedIn or Indeed', () => {
    for (const url of [
      'https://www.google.com/about/careers/applications/jobs/results/123-site-reliability-engineer',
      'https://www.amazon.jobs/en/jobs/2900001/production-support-engineer',
      'https://jobs.careers.microsoft.com/global/en/job/1700001',
      'https://apply.careers.microsoft.com/careers/job/1970001',
      'https://jobs.apple.com/en-us/details/200500001/sre',
      'https://www.metacareers.com/jobs/1000000001/',
      'https://explore.jobs.netflix.net/careers/job/790300001',
      'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/SRE_JR1990001',
      'https://www.uber.com/global/en/careers/list/150001/',
      'https://job-boards.greenhouse.io/examplepay/jobs/4000001',
      'https://jobs.lever.co/example/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab',
      'https://jobs.ashbyhq.com/example/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab',
    ]) {
      expect(isAllowedJobUrl(url), url).toBe(true);
    }
    for (const url of [
      'https://www.linkedin.com/jobs/view/4000000001/',
      'https://www.indeed.com/viewjob?jk=0123456789abcdef',
      'https://www.google.com/search?q=sre+jobs',
      'https://www.uber.com/us/en/ride/',
      'https://www.greenhouse.io/blog',
      'not a url',
    ]) {
      expect(isAllowedJobUrl(url), url).toBe(false);
    }
    expect(WEB_SEARCH_ALLOWED_DOMAINS.some((d) => /linkedin|indeed|\*/.test(d))).toBe(false);
  });
});

describe('webSearchItems', () => {
  it('keeps allowed postings that were search results, mapped to jobs', () => {
    const results = [
      'https://boards.greenhouse.io/examplepay/jobs/4000001?gh_src=abc',
      'https://www.amazon.jobs/en/jobs/2900001/production-support-engineer',
      'https://www.linkedin.com/jobs/view/4000000002/',
    ];
    const items = webSearchItems(
      [
        posting('https://job-boards.greenhouse.io/examplepay/jobs/4000001'),
        posting('https://www.amazon.jobs/en/jobs/2900001/production-support-engineer/', {
          title: 'Production Support Engineer',
          company: 'Amazon',
          location: 'Remote, US',
          postedAt: 'recently',
          snippet: null,
        }),
        // Not a search result: a guessed link.
        posting('https://jobs.apple.com/en-us/details/200500999/sre'),
        // Never LinkedIn, even when it was a result.
        posting('https://www.linkedin.com/jobs/view/4000000002/'),
        // The same Greenhouse job again.
        posting('https://boards.greenhouse.io/examplepay/jobs/4000001'),
      ],
      results,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceLabel: 'Web search',
      job: {
        title: 'Site Reliability Engineer',
        company: 'Example Payments',
        url: 'https://job-boards.greenhouse.io/examplepay/jobs/4000001',
        source: 'greenhouse',
        externalId: '4000001',
        description: 'Keep payments up.',
        postedAt: '2026-11-01',
      },
    });
    expect(items[1]?.job).toMatchObject({
      source: 'company_site',
      remoteType: 'remote',
      postedAt: null,
      description: null,
    });
  });

  it('writes a prompt with the place, window and close title variants', () => {
    const q = {
      title: 'SRE Lead',
      location: 'San Francisco Bay Area',
      remote: false,
      postedWithinDays: 7,
      seniority: 'mid_senior' as const,
    };
    const prompt = webSearchPrompt(q, 3);
    expect(prompt).toContain('"SRE Lead" in or near San Francisco Bay Area');
    expect(prompt).toContain('last 7 days');
    expect(prompt).toContain('Production Support');
    expect(prompt).toContain('at most 3 searches');
    expect(webSearchPrompt({ ...q, title: 'HR Generalist', remote: true }, 2)).not.toContain(
      'Production Support',
    );
  });
});
