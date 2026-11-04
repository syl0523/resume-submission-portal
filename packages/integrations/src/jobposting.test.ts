import { describe, expect, it } from 'vitest';
import { jobFromJsonLd } from './jobposting';

// Synthetic JSON-LD shaped like what ATS and job sites embed for Google for Jobs.

describe('jobFromJsonLd', () => {
  it('reads a Greenhouse-style posting with salary and HTML description', () => {
    const job = jobFromJsonLd(
      [
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [] },
        {
          '@context': 'https://schema.org',
          '@type': 'JobPosting',
          title: 'HR Generalist',
          hiringOrganization: { '@type': 'Organization', name: 'Northwind Freight' },
          jobLocation: {
            '@type': 'Place',
            address: { addressLocality: 'Austin', addressRegion: 'TX', addressCountry: 'US' },
          },
          employmentType: 'FULL_TIME',
          datePosted: '2026-10-28',
          baseSalary: {
            '@type': 'MonetaryAmount',
            currency: 'usd',
            value: { minValue: 70000, maxValue: 82000, unitText: 'YEAR' },
          },
          description: '&lt;p&gt;Own onboarding &amp;amp; employee relations.&lt;/p&gt;',
          identifier: { '@type': 'PropertyValue', value: 'REQ-1234' },
        },
      ],
      'https://job-boards.greenhouse.io/northwind/jobs/4433221?gh_src=abc',
    );
    expect(job).toMatchObject({
      title: 'HR Generalist',
      company: 'Northwind Freight',
      url: 'https://job-boards.greenhouse.io/northwind/jobs/4433221',
      source: 'greenhouse',
      externalId: '4433221',
      location: 'Austin, TX, US',
      employmentType: 'Full-time',
      salaryMin: 70000,
      salaryMax: 82000,
      salaryCurrency: 'USD',
      description: 'Own onboarding & employee relations.',
      postedAt: '2026-10-28T00:00:00.000Z',
    });
  });

  it('finds the posting inside @graph and handles remote, hourly pay and identifiers', () => {
    const job = jobFromJsonLd(
      [
        {
          '@graph': [
            { '@type': 'WebPage', name: 'Careers' },
            {
              '@type': ['JobPosting'],
              name: 'Recruiting Coordinator',
              hiringOrganization: 'Contoso',
              jobLocationType: 'TELECOMMUTE',
              applicantLocationRequirements: { '@type': 'Country', name: 'USA' },
              baseSalary: { currency: 'USD', value: { value: 30, unitText: 'HOUR' } },
              employmentType: ['CONTRACTOR', 'PART_TIME'],
              identifier: 'abc-77',
            },
          ],
        },
      ],
      'https://careers.contoso.example/jobs/77',
    );
    expect(job).toMatchObject({
      title: 'Recruiting Coordinator',
      company: 'Contoso',
      remoteType: 'remote',
      location: 'USA',
      salaryMin: 62400,
      salaryMax: 62400,
      employmentType: 'Contractor, Part-time',
      externalId: 'abc-77',
      source: 'company_site',
    });
  });

  it('returns null without a JobPosting', () => {
    expect(
      jobFromJsonLd(
        [{ '@type': 'Organization', name: 'Acme' }, 'junk', null],
        'https://acme.example',
      ),
    ).toBeNull();
    expect(jobFromJsonLd([], 'https://acme.example')).toBeNull();
  });
});
