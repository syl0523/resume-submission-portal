import type {
  ApiErrorBody,
  ApiTokenInfo,
  CreatedApiToken,
  Profile,
  ProfileRequest,
} from '@jsp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, jsonBody, type TestContext } from '../test/harness';

const profile: ProfileRequest = {
  fullName: 'Jane Doe',
  headline: 'HR Generalist | HRIS | Logistics',
  email: 'jane.doe@example.com',
  phone: '+1 512 555 0100',
  location: 'Austin, TX',
  address: { city: 'Austin', region: 'TX', country: 'US' },
  linkedinUrl: 'https://www.linkedin.com/in/jane-doe-example',
  workAuthorization: 'Authorized to work in the US; no sponsorship needed',
  summary: 'HR generalist with six years in logistics.',
  skills: ['HRIS', 'Workday', 'Employee relations'],
  languages: ['English (native)', 'Mandarin (fluent)'],
  experience: [
    {
      title: 'HR Generalist',
      company: 'Example Freight',
      start: '2021-03',
      current: true,
      highlights: ['Rolled out Workday to 900 employees'],
    },
  ],
  education: [{ school: 'Example State University', degree: 'BA', field: 'Psychology' }],
  customAnswers: [{ question: 'Why this company?', answer: 'I like logistics.' }],
};

describe('profile API', () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext();
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('returns an empty profile with the account email', async () => {
    const { status, body } = await t.json<Profile>('/api/profile');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      fullName: null,
      email: 'test@example.com',
      skills: [],
      updatedAt: null,
    });
  });

  it('replaces the whole profile on PUT', async () => {
    const saved = await t.json<Profile>('/api/profile', jsonBody('PUT', profile));
    expect(saved.status).toBe(200);
    expect(saved.body.fullName).toBe('Jane Doe');
    expect(saved.body.experience[0]).toMatchObject({ company: 'Example Freight', current: true });
    expect(saved.body.updatedAt).not.toBeNull();

    const read = await t.json<Profile>('/api/profile');
    expect(read.body).toEqual(saved.body);

    const replaced = await t.json<Profile>(
      '/api/profile',
      jsonBody('PUT', { fullName: 'Jane D.' }),
    );
    expect(replaced.body).toMatchObject({
      fullName: 'Jane D.',
      headline: null,
      email: 'test@example.com',
      skills: [],
    });

    const other = await t.json<Profile>('/api/profile', {
      headers: { 'x-dev-user': 'other@example.com' },
    });
    expect(other.body.fullName).toBeNull();
  });

  it('validates the profile', async () => {
    const { status, body } = await t.json<ApiErrorBody>(
      '/api/profile',
      jsonBody('PUT', { ...profile, linkedinUrl: 'javascript:alert(1)' }),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe('invalid_request');
  });

  it('needs AI to draft a profile from a resume', async () => {
    const { status, body } = await t.json<ApiErrorBody>(
      '/api/profile/draft-from-resume',
      jsonBody('POST', { resumeId: 'any' }),
    );
    expect(status).toBe(501);
    expect(body.error.code).toBe('feature_disabled');
  });
});

describe('API tokens', () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext();
  });

  afterAll(async () => {
    await t.dispose();
  });

  it('creates a token once, lists it without the secret, and revokes it', async () => {
    const created = await t.json<CreatedApiToken>(
      '/api/tokens',
      jsonBody('POST', { name: 'Chrome on laptop' }),
    );
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^jsp_[a-z2-9]{40}$/);
    expect(created.body).toMatchObject({ name: 'Chrome on laptop', lastUsedAt: null });

    const listed = await t.json<ApiTokenInfo[]>('/api/tokens');
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).not.toHaveProperty('token');
    expect(JSON.stringify(listed.body)).not.toContain(created.body.token);

    const auth = { authorization: `Bearer ${created.body.token}` };
    expect((await t.fetch('/api/ext/ping', { headers: auth })).status).toBe(200);
    await t.settle();
    const used = await t.json<ApiTokenInfo[]>('/api/tokens');
    expect(used.body[0]?.lastUsedAt).not.toBeNull();

    const foreign = await t.fetch(`/api/tokens/${created.body.id}`, {
      method: 'DELETE',
      headers: { 'x-dev-user': 'other@example.com' },
    });
    expect(foreign.status).toBe(404);

    expect((await t.fetch(`/api/tokens/${created.body.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await t.fetch('/api/ext/ping', { headers: auth })).status).toBe(401);
    expect((await t.json<ApiTokenInfo[]>('/api/tokens')).body).toEqual([]);
  });

  it('validates the token name', async () => {
    const { status } = await t.json<ApiErrorBody>('/api/tokens', jsonBody('POST', { name: '' }));
    expect(status).toBe(400);
  });
});
