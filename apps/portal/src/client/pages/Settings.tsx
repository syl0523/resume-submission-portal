import type { CreatedApiToken, EducationEntry, ExperienceEntry, Profile } from '@jsp/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  CopyButton,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '../components/ui';
import { del, post, put } from '../lib/api';
import { formatDate, relativeDay, splitList } from '../lib/format';
import { keys, useMe, useProfile, useResumes, useTokens } from '../lib/queries';

const blankExperience = (): ExperienceEntry => ({
  title: '',
  company: '',
  location: null,
  start: null,
  end: null,
  current: false,
  highlights: [],
});
const blankEducation = (): EducationEntry => ({
  school: '',
  degree: null,
  field: null,
  start: null,
  end: null,
});
const orNull = (s: string) => (s.trim() ? s.trim() : null);

function ProfileForm({ initial }: { initial: Profile }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: resumes } = useResumes();
  const [p, setP] = useState<Profile>(initial);
  const [draftResume, setDraftResume] = useState('');
  useEffect(() => setP(initial), [initial]);

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) =>
    setP((prev) => ({ ...prev, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      put<Profile>('/api/profile', {
        ...p,
        experience: p.experience.filter((e) => e.title.trim() && e.company.trim()),
        education: p.education.filter((e) => e.school.trim()),
        customAnswers: p.customAnswers.filter((a) => a.question.trim()),
        updatedAt: undefined,
      }),
    onSuccess: (saved) => qc.setQueryData(keys.profile, saved),
  });
  const draft = useMutation({
    mutationFn: (resumeId: string) => post<Profile>('/api/profile/draft-from-resume', { resumeId }),
    onSuccess: (d) => setP(d),
  });

  const text =
    (
      k:
        | 'fullName'
        | 'headline'
        | 'email'
        | 'phone'
        | 'location'
        | 'linkedinUrl'
        | 'websiteUrl'
        | 'githubUrl',
    ) =>
    (id: string) => (
      <Input
        id={id}
        value={p[k] ?? ''}
        onChange={(e) => set(k, orNull(e.target.value))}
        type={k.endsWith('Url') ? 'url' : k === 'email' ? 'email' : 'text'}
      />
    );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {me?.features.ai && resumes && resumes.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-sheet-2 p-3 sm:flex-row sm:items-center">
          <Sparkles className="size-4 text-accent" aria-hidden />
          <span className="text-sm text-ink-2">
            Fill this in from a resume (you review before saving):
          </span>
          <Select
            aria-label="Resume"
            value={draftResume}
            onChange={(e) => setDraftResume(e.target.value)}
            className="sm:w-56"
          >
            <option value="">Choose a resume</option>
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={!draftResume}
            busy={draft.isPending}
            onClick={() => draft.mutate(draftResume)}
          >
            Draft
          </Button>
        </div>
      ) : null}
      <ErrorNote error={draft.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name">{text('fullName')}</Field>
        <Field label="Headline" hint="One line, e.g. “HR Generalist | HRIS | Logistics”">
          {text('headline')}
        </Field>
        <Field label="Email for applications">{text('email')}</Field>
        <Field label="Phone">{text('phone')}</Field>
        <Field label="Location">{text('location')}</Field>
        <Field label="LinkedIn">{text('linkedinUrl')}</Field>
        <Field label="Website / portfolio">{text('websiteUrl')}</Field>
        <Field label="GitHub">{text('githubUrl')}</Field>
        <Field
          label="Work authorization"
          className="sm:col-span-2"
          hint="Used to answer authorization questions; you always review before submitting."
        >
          {(id) => (
            <Input
              id={id}
              value={p.workAuthorization ?? ''}
              onChange={(e) => set('workAuthorization', orNull(e.target.value))}
            />
          )}
        </Field>
        <Field label="Summary" className="sm:col-span-2">
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              value={p.summary ?? ''}
              onChange={(e) => set('summary', orNull(e.target.value))}
            />
          )}
        </Field>
        <Field label="Skills" hint="Comma-separated" className="sm:col-span-2">
          {(id) => (
            <Input
              id={id}
              value={p.skills.join(', ')}
              onChange={(e) => set('skills', splitList(e.target.value))}
            />
          )}
        </Field>
        <Field
          label="Languages"
          hint="e.g. English (native), Mandarin (fluent)"
          className="sm:col-span-2"
        >
          {(id) => (
            <Input
              id={id}
              value={p.languages.join(', ')}
              onChange={(e) => set('languages', splitList(e.target.value))}
            />
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-ink">Experience</legend>
        {p.experience.map((x, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id; inputs are controlled, so position is the identity
            key={`exp-${i}`}
            className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-6"
          >
            <Input
              aria-label="Title"
              placeholder="Title"
              className="sm:col-span-2"
              value={x.title}
              onChange={(e) =>
                set(
                  'experience',
                  p.experience.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)),
                )
              }
            />
            <Input
              aria-label="Company"
              placeholder="Company"
              className="sm:col-span-2"
              value={x.company}
              onChange={(e) =>
                set(
                  'experience',
                  p.experience.map((y, j) => (j === i ? { ...y, company: e.target.value } : y)),
                )
              }
            />
            <Input
              aria-label="Start"
              placeholder="YYYY-MM"
              value={x.start ?? ''}
              onChange={(e) =>
                set(
                  'experience',
                  p.experience.map((y, j) =>
                    j === i ? { ...y, start: orNull(e.target.value) } : y,
                  ),
                )
              }
            />
            <Input
              aria-label="End"
              placeholder={x.current ? 'Present' : 'YYYY-MM'}
              disabled={x.current}
              value={x.end ?? ''}
              onChange={(e) =>
                set(
                  'experience',
                  p.experience.map((y, j) => (j === i ? { ...y, end: orNull(e.target.value) } : y)),
                )
              }
            />
            <Textarea
              aria-label="Highlights"
              rows={2}
              placeholder="Highlights, one per line"
              className="sm:col-span-5"
              value={x.highlights.join('\n')}
              onChange={(e) =>
                set(
                  'experience',
                  p.experience.map((y, j) =>
                    j === i
                      ? {
                          ...y,
                          highlights: e.target.value
                            .split('\n')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }
                      : y,
                  ),
                )
              }
            />
            <div className="flex flex-col justify-between gap-2">
              <Checkbox
                label="Current"
                checked={x.current}
                onChange={(e) =>
                  set(
                    'experience',
                    p.experience.map((y, j) =>
                      j === i
                        ? { ...y, current: e.target.checked, end: e.target.checked ? null : y.end }
                        : y,
                    ),
                  )
                }
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  set(
                    'experience',
                    p.experience.filter((_, j) => j !== i),
                  )
                }
                aria-label="Remove role"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button size="sm" onClick={() => set('experience', [...p.experience, blankExperience()])}>
            <Plus className="size-4" aria-hidden /> Add role
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-ink">Education</legend>
        {p.education.map((x, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id; inputs are controlled, so position is the identity
            key={`edu-${i}`}
            className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[2fr_1fr_1fr_6rem_auto]"
          >
            <Input
              aria-label="School"
              placeholder="School"
              value={x.school}
              onChange={(e) =>
                set(
                  'education',
                  p.education.map((y, j) => (j === i ? { ...y, school: e.target.value } : y)),
                )
              }
            />
            <Input
              aria-label="Degree"
              placeholder="Degree"
              value={x.degree ?? ''}
              onChange={(e) =>
                set(
                  'education',
                  p.education.map((y, j) =>
                    j === i ? { ...y, degree: orNull(e.target.value) } : y,
                  ),
                )
              }
            />
            <Input
              aria-label="Field"
              placeholder="Field"
              value={x.field ?? ''}
              onChange={(e) =>
                set(
                  'education',
                  p.education.map((y, j) =>
                    j === i ? { ...y, field: orNull(e.target.value) } : y,
                  ),
                )
              }
            />
            <Input
              aria-label="Year finished"
              placeholder="YYYY"
              value={x.end ?? ''}
              onChange={(e) =>
                set(
                  'education',
                  p.education.map((y, j) => (j === i ? { ...y, end: orNull(e.target.value) } : y)),
                )
              }
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                set(
                  'education',
                  p.education.filter((_, j) => j !== i),
                )
              }
              aria-label="Remove school"
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button size="sm" onClick={() => set('education', [...p.education, blankEducation()])}>
            <Plus className="size-4" aria-hidden /> Add school
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-ink">Saved answers</legend>
        <p className="-mt-2 text-sm text-ink-2">
          Answers you reuse (“Why this company?”, notice period, salary expectations). The extension
          offers them while you fill forms.
        </p>
        {p.customAnswers.map((a, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id; inputs are controlled, so position is the identity
            key={`ans-${i}`}
            className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_2fr_auto]"
          >
            <Input
              aria-label="Question"
              placeholder="Question"
              value={a.question}
              onChange={(e) =>
                set(
                  'customAnswers',
                  p.customAnswers.map((y, j) => (j === i ? { ...y, question: e.target.value } : y)),
                )
              }
            />
            <Textarea
              aria-label="Answer"
              rows={2}
              placeholder="Answer"
              value={a.answer}
              onChange={(e) =>
                set(
                  'customAnswers',
                  p.customAnswers.map((y, j) => (j === i ? { ...y, answer: e.target.value } : y)),
                )
              }
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                set(
                  'customAnswers',
                  p.customAnswers.filter((_, j) => j !== i),
                )
              }
              aria-label="Remove answer"
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            onClick={() => set('customAnswers', [...p.customAnswers, { question: '', answer: '' }])}
          >
            <Plus className="size-4" aria-hidden /> Add answer
          </Button>
        </div>
      </fieldset>

      <ErrorNote error={save.error} />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" busy={save.isPending}>
          Save profile
        </Button>
        <span role="status" className="text-sm text-[var(--tone-success-ink)]">
          {save.isSuccess ? 'Saved.' : ''}
        </span>
        {initial.updatedAt ? (
          <span className="text-xs text-muted">Last saved {relativeDay(initial.updatedAt)}</span>
        ) : null}
      </div>
    </form>
  );
}

function Tokens() {
  const qc = useQueryClient();
  const { data } = useTokens();
  const [name, setName] = useState('Chrome extension');
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const create = useMutation({
    mutationFn: () => post<CreatedApiToken>('/api/tokens', { name: name.trim() }),
    onSuccess: (t) => {
      setCreated(t);
      void qc.invalidateQueries({ queryKey: keys.tokens });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/api/tokens/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.tokens }),
  });
  return (
    <Card title="Browser extension">
      <p className="mb-3 text-sm text-ink-2">
        Create a token, then paste it with this portal's address ({window.location.origin}) into the
        extension's options. Revoke a token to sign that browser out.
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Input aria-label="Token name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" busy={create.isPending} disabled={!name.trim()}>
          <KeyRound className="size-4" aria-hidden /> Create token
        </Button>
      </form>
      <ErrorNote error={create.error ?? revoke.error} className="mt-2" />
      {created ? (
        <div className="tone-new mt-3 flex flex-col gap-2 rounded-lg p-3 text-sm">
          <p className="font-medium">Copy this token now. It is shown only once.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-sheet px-2 py-1 text-xs break-all text-ink">
              {created.token}
            </code>
            <CopyButton value={created.token} />
          </div>
        </div>
      ) : null}
      <ul className="mt-3 divide-y divide-line">
        {data?.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="flex-1 font-medium text-ink">{t.name}</span>
            <span className="text-xs text-muted">
              created {formatDate(t.createdAt)} ·{' '}
              {t.lastUsedAt ? `used ${relativeDay(t.lastUsedAt)}` : 'never used'}
            </span>
            <Button
              size="sm"
              variant="danger"
              onClick={() => revoke.mutate(t.id)}
              busy={revoke.isPending && revoke.variables === t.id}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  const { data: profile, error, isLoading } = useProfile();
  const features = me
    ? ([
        ['AI assist', me.features.ai],
        ['Email forwarding', me.features.inboundEmail],
        ['JSearch (LinkedIn, Indeed, company sites)', me.features.jsearch],
        ['Adzuna', me.features.adzuna],
        ['USAJOBS', me.features.usajobs],
      ] as const)
    : [];
  return (
    <>
      <PageHeader title="Settings" subtitle={me ? `Signed in as ${me.user.email}` : undefined} />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card title="Autofill profile">
          {isLoading ? <Spinner /> : null}
          <ErrorNote error={error} />
          {profile ? <ProfileForm initial={profile} /> : null}
        </Card>
        <div className="flex flex-col gap-5">
          <Tokens />
          <Card title="Calendar feed">
            <p className="mb-2 text-sm text-ink-2">
              Subscribe in Outlook or Google Calendar to see interviews and follow-up reminders.
              Keep the link private.
            </p>
            {me ? (
              <div className="flex flex-col gap-2">
                <code className="rounded bg-sheet-2 px-2 py-1 text-xs break-all">
                  {me.calendarUrl}
                </code>
                <div>
                  <CopyButton value={me.calendarUrl} label="Copy link" />
                </div>
              </div>
            ) : null}
          </Card>
          <Card title="Connected services">
            <ul className="flex flex-col gap-2 text-sm">
              {features.map(([label, on]) => (
                <li key={label} className="flex items-center justify-between gap-2">
                  <span className="text-ink">{label}</span>
                  <Badge tone={on ? 'success' : 'muted'}>{on ? 'On' : 'Not set up'}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              Keys are set on the server (see the runbook). Pre-filled LinkedIn, Indeed and Google
              Jobs links work without any keys.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
