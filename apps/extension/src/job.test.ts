import type { SavedSearch } from '@jsp/core';
import { describe, expect, it } from 'vitest';
import { bestFit, jobFromSnapshot, toBase64 } from './job';
import type { PageSnapshot } from './page';

// Synthetic pages; no real postings.
const snapshot = (over: Partial<PageSnapshot>): PageSnapshot => ({
  url: 'https://example.com/',
  title: '',
  jsonLd: [],
  meta: {},
  h1: null,
  board: null,
  selection: null,
  ...over,
});

describe('jobFromSnapshot', () => {
  it('prefers the JSON-LD job on company ATS pages', () => {
    const { job, origin } = jobFromSnapshot(
      snapshot({
        url: 'https://job-boards.greenhouse.io/northwind/jobs/4433221?gh_src=abc',
        title: 'Job Application for HR Generalist at Northwind Freight',
        meta: { 'og:title': 'Something else' },
        jsonLd: [
          {
            '@context': 'https://schema.org',
            '@type': 'JobPosting',
            title: 'HR Generalist',
            hiringOrganization: { name: 'Northwind Freight' },
            jobLocation: { address: { addressLocality: 'Austin', addressRegion: 'TX' } },
            description: '<p>Own onboarding.</p>',
          },
        ],
      }),
    );
    expect(origin).toBe('json-ld');
    expect(job).toMatchObject({
      title: 'HR Generalist',
      company: 'Northwind Freight',
      location: 'Austin, TX',
      url: 'https://job-boards.greenhouse.io/northwind/jobs/4433221',
      source: 'greenhouse',
      externalId: '4433221',
      description: 'Own onboarding.',
    });
  });

  it('reads the LinkedIn pane and ignores JSON-LD for a different job', () => {
    const { job, origin } = jobFromSnapshot(
      snapshot({
        url: 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=hr',
        jsonLd: [
          { '@type': 'JobPosting', title: 'Senior Data Engineer', hiringOrganization: 'Elsewhere' },
        ],
        board: {
          title: 'Recruiting Coordinator',
          company: 'Contoso',
          location: 'Remote · United States',
          description: 'Coordinate interviews.',
        },
      }),
    );
    expect(origin).toBe('linkedin');
    expect(job).toMatchObject({
      title: 'Recruiting Coordinator',
      company: 'Contoso',
      location: 'Remote · United States',
      remoteType: 'remote',
      source: 'linkedin',
      externalId: '4012345678',
      url: 'https://www.linkedin.com/jobs/view/4012345678/',
      description: 'Coordinate interviews.',
    });
  });

  it('falls back to page metadata, a long selection and the company in an ATS URL', () => {
    const selection = 'Responsibilities: partner with managers on hiring. '.repeat(6);
    const { job, origin } = jobFromSnapshot(
      snapshot({
        url: 'https://jobs.lever.co/acme-robotics/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab',
        title: 'Acme Robotics - People Partner',
        meta: { 'og:title': 'People Partner', description: 'Short blurb' },
        selection,
      }),
    );
    expect(origin).toBe('page');
    expect(job).toMatchObject({
      title: 'People Partner',
      company: 'Acme Robotics',
      source: 'lever',
      description: selection,
    });
    // A stray word or two selected is not a description.
    expect(
      jobFromSnapshot(snapshot({ meta: { description: 'Blurb' }, selection: 'HR' })).job
        .description,
    ).toBe('Blurb');
  });
});

describe('bestFit', () => {
  const search = (name: string, titles: string[]): SavedSearch => ({
    id: name,
    name,
    resumeId: null,
    titles,
    skills: [],
    locations: [],
    workMode: 'any',
    seniority: null,
    keywords: [],
    excludeKeywords: [],
    minSalary: null,
    postedWithinDays: 7,
    needsSponsorship: false,
    summary: null,
    alertsEnabled: true,
    lastRunAt: null,
    totalHits: 0,
    newHits: 0,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  });

  it('scores the job against every saved search and keeps the best', () => {
    const best = bestFit([search('Data', ['Data Engineer']), search('HR', ['HR Generalist'])], {
      title: 'HR Generalist',
      company: 'Northwind Freight',
    });
    expect(best?.search.name).toBe('HR');
    expect(best?.fit.titleMatch).toBeGreaterThan(0.9);
  });

  it('needs a job title and at least one search', () => {
    expect(bestFit([], { title: 'HR Generalist' })).toBeNull();
    expect(bestFit([search('HR', ['HR Generalist'])], {})).toBeNull();
  });
});

describe('toBase64', () => {
  it('matches standard base64, also above the chunk size', () => {
    expect(toBase64(new TextEncoder().encode('Jane Doe, HR'))).toBe(btoa('Jane Doe, HR'));
    const big = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);
    expect(toBase64(big)).toBe(Buffer.from(big).toString('base64'));
  });
});
