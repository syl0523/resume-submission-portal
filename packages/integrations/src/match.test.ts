import { describe, expect, it } from 'vitest';
import { type MatchCandidate, matchApplication } from './match';

const NOW = new Date('2026-11-10T12:00:00Z');

const c = (
  id: string,
  company: string,
  title: string,
  over: Partial<MatchCandidate> = {},
): MatchCandidate => ({
  id,
  company,
  title,
  status: 'applied',
  appliedAt: '2026-10-20T12:00:00Z',
  lastActivityAt: '2026-10-25T12:00:00Z',
  ...over,
});

const email = (over: Partial<Parameters<typeof matchApplication>[0]> = {}) => ({
  provider: 'generic' as const,
  company: null,
  jobTitle: null,
  jobUrl: null,
  externalJobId: null,
  ...over,
});

describe('matchApplication', () => {
  const candidates = [
    c('nw', 'Northwind Freight, Inc.', 'HR Generalist'),
    c('ct-pay', 'Contoso', 'Payroll Specialist'),
    c('ct-rec', 'Contoso', 'Recruiter'),
    c('li', 'Litware', 'Talent Partner', {
      source: 'linkedin',
      externalId: '4012345678',
      url: 'https://www.linkedin.com/jobs/view/4012345678/',
    }),
    c('ww', 'Wide World Importers', 'TA Partner', {
      url: 'https://job-boards.greenhouse.io/wideworld/jobs/4433221',
    }),
  ];

  it('matches the same job id outright', () => {
    expect(
      matchApplication(
        email({
          externalJobId: '4012345678',
          jobUrl: 'https://www.linkedin.com/jobs/view/4012345678/',
        }),
        candidates,
        NOW,
      ),
    ).toEqual({ applicationId: 'li', score: 1, reason: 'Same job id' });
  });

  it('matches the same canonical job link', () => {
    const r = matchApplication(
      email({
        jobUrl: 'https://boards.greenhouse.io/wideworld/jobs/4433221?gh_src=mail',
        externalJobId: '4433221',
      }),
      candidates,
      NOW,
    );
    expect(r).toMatchObject({ applicationId: 'ww', score: 1, reason: 'Same job link' });
  });

  it('matches by company and title despite legal suffixes', () => {
    const r = matchApplication(
      email({ company: 'Northwind Freight', jobTitle: 'HR Generalist (Req 12345)' }),
      candidates,
      NOW,
    );
    expect(r?.applicationId).toBe('nw');
    expect(r?.reason).toBe('Company and job title match');
  });

  it('uses the title to choose between two jobs at one company', () => {
    expect(
      matchApplication(
        email({ company: 'Contoso Ltd.', jobTitle: 'Payroll Specialist' }),
        candidates,
        NOW,
      )?.applicationId,
    ).toBe('ct-pay');
  });

  it('refuses to guess between two jobs at one company without a title', () => {
    expect(matchApplication(email({ company: 'Contoso' }), candidates, NOW)).toBeNull();
  });

  it('matches on company alone when there is only one application there', () => {
    expect(
      matchApplication(email({ company: 'Northwind Freight' }), candidates, NOW),
    ).toMatchObject({
      applicationId: 'nw',
      reason: 'Company matches',
    });
  });

  it('returns null for an unknown company or no candidates', () => {
    expect(
      matchApplication(email({ company: 'Fabrikam', jobTitle: 'Recruiter' }), candidates, NOW),
    ).toBeNull();
    expect(matchApplication(email({ company: 'Contoso' }), [], NOW)).toBeNull();
    expect(matchApplication(email({ jobTitle: 'Recruiter' }), candidates, NOW)).toBeNull();
  });

  it('prefers the live application over an old closed one', () => {
    const r = matchApplication(
      email({ company: 'Proseware' }),
      [
        c('old', 'Proseware', 'HR Coordinator', {
          status: 'rejected',
          lastActivityAt: '2025-01-10T12:00:00Z',
        }),
        c('new', 'Proseware', 'HR Business Partner'),
      ],
      NOW,
    );
    expect(r?.applicationId).toBe('new');
  });
});
