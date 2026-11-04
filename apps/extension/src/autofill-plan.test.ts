import type { Profile } from '@jsp/core';
import { describe, expect, it } from 'vitest';
import { type FieldInfo, isSupportedApplicationPage, planAutofill } from './autofill-plan';

const profile: Profile = {
  fullName: 'Jane Q Doe',
  headline: null,
  email: 'jane.doe@example.com',
  phone: '+1 512 555 0100',
  location: 'Austin, TX',
  address: null,
  linkedinUrl: 'https://www.linkedin.com/in/jane-doe-example',
  websiteUrl: null,
  githubUrl: null,
  workAuthorization: 'Authorized to work in the US',
  summary: null,
  skills: [],
  languages: [],
  experience: [
    {
      title: 'HR Generalist',
      company: 'Example Freight',
      location: null,
      start: '2021-03',
      end: null,
      current: true,
      highlights: [],
    },
  ],
  education: [],
  customAnswers: [
    { question: 'Why do you want to work here?', answer: 'Logistics and people work.' },
  ],
  updatedAt: null,
};

let n = 0;
const field = (over: Partial<FieldInfo>): FieldInfo => ({
  index: n++,
  tag: 'input',
  type: 'text',
  name: '',
  id: '',
  label: '',
  placeholder: '',
  autocomplete: '',
  options: [],
  filled: false,
  ...over,
});

describe('planAutofill', () => {
  it('maps contact fields, links, current role, resume and saved answers', () => {
    const fields = [
      field({ name: 'first_name', label: 'First Name' }),
      field({ name: 'last_name', label: 'Last Name' }),
      field({ type: 'email', name: 'email', label: 'Email' }),
      field({ type: 'tel', name: 'phone', label: 'Phone' }),
      field({ name: 'urls[LinkedIn]', label: 'LinkedIn URL' }),
      field({ name: 'org', label: 'Current company' }),
      field({ tag: 'input', type: 'file', name: 'resume', label: 'Resume/CV' }),
      field({ tag: 'input', type: 'file', name: 'cover_letter', label: 'Cover Letter' }),
      field({ tag: 'textarea', name: 'q1', label: 'Why do you want to work here?' }),
      field({ name: 'location', label: 'Location (City)' }),
    ];
    const plan = planAutofill(fields, profile, { hasResume: true });
    const byIndex = new Map(plan.map((a) => [a.index, a]));
    const value = (i: number) => {
      const a = byIndex.get(fields[i]?.index ?? -1);
      return a?.kind === 'text' ? a.value : a?.kind;
    };
    expect(value(0)).toBe('Jane Q');
    expect(value(1)).toBe('Doe');
    expect(value(2)).toBe('jane.doe@example.com');
    expect(value(3)).toBe('+1 512 555 0100');
    expect(value(4)).toBe('https://www.linkedin.com/in/jane-doe-example');
    expect(value(5)).toBe('Example Freight');
    expect(value(6)).toBe('file');
    expect(value(7)).toBeUndefined();
    expect(value(8)).toBe('Logistics and people work.');
    expect(value(9)).toBe('Austin');
  });

  it('never answers demographic or authorization questions, nor overwrites what you typed', () => {
    const fields = [
      field({ tag: 'select', name: 'gender', label: 'Gender' }),
      field({ name: 'race', label: 'Race / Ethnicity (voluntary self-identification)' }),
      field({ name: 'veteran_status', label: 'Veteran Status' }),
      field({ name: 'disability', label: 'Disability status' }),
      field({ name: 'auth', label: 'Are you legally authorized to work in the United States?' }),
      field({ name: 'sponsor', label: 'Will you now or in the future require visa sponsorship?' }),
      field({ name: 'email', type: 'email', label: 'Email', filled: true }),
    ];
    expect(planAutofill(fields, profile, { hasResume: true })).toEqual([]);
  });

  it('skips empty profile values and resumes the user does not have', () => {
    const fields = [field({ label: 'GitHub' }), field({ type: 'file', label: 'Resume' })];
    expect(planAutofill(fields, profile, { hasResume: false })).toEqual([]);
  });
});

describe('isSupportedApplicationPage', () => {
  it('allows company ATS application pages only', () => {
    expect(
      isSupportedApplicationPage('https://job-boards.greenhouse.io/northwind/jobs/4433221'),
    ).toBe(true);
    expect(
      isSupportedApplicationPage(
        'https://jobs.lever.co/fabrikam/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab/apply',
      ),
    ).toBe(true);
    expect(
      isSupportedApplicationPage(
        'https://jobs.lever.co/fabrikam/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab',
      ),
    ).toBe(false);
    expect(
      isSupportedApplicationPage(
        'https://jobs.ashbyhq.com/litware/11111111-2222-3333-4444-555555555555/application',
      ),
    ).toBe(true);
    expect(isSupportedApplicationPage('https://www.linkedin.com/jobs/view/4012345678/')).toBe(
      false,
    );
    expect(isSupportedApplicationPage('https://www.indeed.com/viewjob?jk=0123456789abcdef')).toBe(
      false,
    );
    expect(isSupportedApplicationPage('not a url')).toBe(false);
  });
});
