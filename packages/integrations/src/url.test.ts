import { describe, expect, it } from 'vitest';
import { analyzeJobUrl, normalizeUrl, urlKey } from './url';

describe('analyzeJobUrl', () => {
  it('canonicalises LinkedIn job views and search panes', () => {
    const a = analyzeJobUrl(
      'https://ca.linkedin.com/jobs/view/senior-hr-manager-at-acme-4012345678?refId=abc&trackingId=xyz',
    );
    expect(a).toMatchObject({
      url: 'https://www.linkedin.com/jobs/view/4012345678/',
      source: 'linkedin',
      externalId: '4012345678',
    });
    const b = analyzeJobUrl(
      'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=hr',
    );
    expect(b?.key).toBe(a?.key);
    expect(analyzeJobUrl('https://www.linkedin.com/comm/jobs/view/4012345678/')?.externalId).toBe(
      '4012345678',
    );
  });

  it('canonicalises Indeed jk and vjk links', () => {
    expect(
      analyzeJobUrl('https://ca.indeed.com/viewjob?jk=0123456789ABCDEF&from=serp&vjs=3'),
    ).toMatchObject({
      url: 'https://ca.indeed.com/viewjob?jk=0123456789abcdef',
      source: 'indeed',
      externalId: '0123456789abcdef',
    });
    expect(
      analyzeJobUrl('https://ca.indeed.com/jobs?q=hr&l=Toronto&vjk=0123456789abcdef')?.url,
    ).toBe('https://ca.indeed.com/viewjob?jk=0123456789abcdef');
    expect(analyzeJobUrl('https://m.indeed.com/viewjob?jk=0123456789abcdef')?.url).toBe(
      'https://www.indeed.com/viewjob?jk=0123456789abcdef',
    );
  });

  it('recognises Greenhouse boards, embeds and gh_jid pages', () => {
    expect(analyzeJobUrl('https://boards.greenhouse.io/acme/jobs/4567890?gh_src=li')).toMatchObject(
      {
        url: 'https://job-boards.greenhouse.io/acme/jobs/4567890',
        source: 'greenhouse',
        externalId: '4567890',
      },
    );
    expect(
      analyzeJobUrl('https://boards.greenhouse.io/embed/job_app?for=acme&token=4567890')?.url,
    ).toBe('https://job-boards.greenhouse.io/acme/jobs/4567890');
    expect(
      analyzeJobUrl('https://www.acme.com/careers/open-roles/?gh_jid=4567890&utm_source=x'),
    ).toMatchObject({
      url: 'https://www.acme.com/careers/open-roles?gh_jid=4567890',
      source: 'greenhouse',
      externalId: '4567890',
    });
  });

  it('recognises Lever, Ashby, Workday and SmartRecruiters', () => {
    const uuid = '1f2e3d4c-5b6a-4987-8a1b-2c3d4e5f6a7b';
    expect(
      analyzeJobUrl(`https://jobs.lever.co/acme/${uuid}/apply?lever-source=LinkedIn`),
    ).toMatchObject({
      url: `https://jobs.lever.co/acme/${uuid}`,
      source: 'lever',
      externalId: uuid,
    });
    expect(analyzeJobUrl(`https://jobs.ashbyhq.com/acme/${uuid}/application`)?.source).toBe(
      'ashby',
    );
    expect(
      analyzeJobUrl(
        'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Toronto-ON/HR-Business-Partner_R12345/apply',
      ),
    ).toMatchObject({
      url: 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Toronto-ON/HR-Business-Partner_R12345',
      source: 'workday',
      externalId: 'R12345',
    });
    expect(
      analyzeJobUrl(
        'https://jobs.smartrecruiters.com/AcmeInc/744000012345678-hr-generalist?trid=1',
      ),
    ).toMatchObject({ source: 'smartrecruiters', externalId: '744000012345678' });
  });

  it('strips tracking parameters from company sites and sorts the rest', () => {
    expect(normalizeUrl('https://careers.example.com/jobs/123/?utm_source=x&b=2&a=1#apply')).toBe(
      'https://careers.example.com/jobs/123?a=1&b=2',
    );
    expect(analyzeJobUrl('https://www.glassdoor.ca/job-listing/x?jl=1')?.source).toBe('other');
  });

  it('rejects non-http input', () => {
    expect(analyzeJobUrl('not a url')).toBeNull();
    expect(analyzeJobUrl('mailto:jobs@example.com')).toBeNull();
    expect(urlKey('')).toBeNull();
  });

  it('builds case-insensitive keys without protocol or trailing slash', () => {
    expect(urlKey('https://www.linkedin.com/jobs/view/4012345678/')).toBe(
      'www.linkedin.com/jobs/view/4012345678',
    );
  });
});
