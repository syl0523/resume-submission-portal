import { JOB_SOURCES, type JobSource, REMOTE_TYPES, type RemoteType } from '@jsp/core';
import { REMOTE_LABEL, SOURCE_LABEL } from '../lib/format';
import { Field, Input, Select, Textarea } from './ui';

/** Editable job fields shared by "Add job" and the application's edit dialog. */
export interface JobDraftState {
  title: string;
  company: string;
  url: string;
  source: JobSource;
  location: string;
  remoteType: RemoteType;
  employmentType: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  description: string;
}

export const emptyJob: JobDraftState = {
  title: '',
  company: '',
  url: '',
  source: 'manual',
  location: '',
  remoteType: 'unknown',
  employmentType: '',
  salaryMin: '',
  salaryMax: '',
  salaryCurrency: 'USD',
  description: '',
};

const nul = (s: string) => (s.trim() ? s.trim() : null);
const num = (s: string) => {
  const n = Number(s.replace(/[^\d.]/g, ''));
  return s.trim() && Number.isFinite(n) ? Math.round(n) : null;
};

/** State → API job input (null, not "", for empty fields). */
export function jobPayload(j: JobDraftState) {
  return {
    title: j.title.trim(),
    company: j.company.trim(),
    url: nul(j.url),
    source: j.source,
    location: nul(j.location),
    remoteType: j.remoteType,
    employmentType: nul(j.employmentType),
    salaryMin: num(j.salaryMin),
    salaryMax: num(j.salaryMax),
    salaryCurrency:
      j.salaryMin || j.salaryMax ? (nul(j.salaryCurrency)?.toUpperCase() ?? 'USD') : null,
    description: nul(j.description),
  };
}

export function JobFields({
  value,
  onChange,
}: {
  value: JobDraftState;
  onChange: (next: JobDraftState) => void;
}) {
  const set = <K extends keyof JobDraftState>(k: K, v: JobDraftState[K]) =>
    onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Job title">
        {(id) => (
          <Input
            id={id}
            required
            value={value.title}
            onChange={(e) => set('title', e.target.value)}
          />
        )}
      </Field>
      <Field label="Company">
        {(id) => (
          <Input
            id={id}
            required
            value={value.company}
            onChange={(e) => set('company', e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Posting link"
        className="sm:col-span-2"
        hint="The posting's URL. Duplicates are detected from it."
      >
        {(id) => (
          <Input
            id={id}
            type="url"
            placeholder="https://"
            value={value.url}
            onChange={(e) => set('url', e.target.value)}
          />
        )}
      </Field>
      <Field label="Location">
        {(id) => (
          <Input
            id={id}
            placeholder="Austin, TX"
            value={value.location}
            onChange={(e) => set('location', e.target.value)}
          />
        )}
      </Field>
      <Field label="Work arrangement">
        {(id) => (
          <Select
            id={id}
            value={value.remoteType}
            onChange={(e) => set('remoteType', e.target.value as RemoteType)}
          >
            {REMOTE_TYPES.map((r) => (
              <option key={r} value={r}>
                {REMOTE_LABEL[r]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Where it is posted">
        {(id) => (
          <Select
            id={id}
            value={value.source}
            onChange={(e) => set('source', e.target.value as JobSource)}
          >
            {JOB_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Employment type">
        {(id) => (
          <Input
            id={id}
            placeholder="Full-time"
            value={value.employmentType}
            onChange={(e) => set('employmentType', e.target.value)}
          />
        )}
      </Field>
      <div className="grid grid-cols-[1fr_1fr_5rem] gap-2 sm:col-span-2">
        <Field label="Salary from">
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              value={value.salaryMin}
              onChange={(e) => set('salaryMin', e.target.value)}
            />
          )}
        </Field>
        <Field label="to">
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              value={value.salaryMax}
              onChange={(e) => set('salaryMax', e.target.value)}
            />
          )}
        </Field>
        <Field label="Currency">
          {(id) => (
            <Input
              id={id}
              maxLength={3}
              value={value.salaryCurrency}
              onChange={(e) => set('salaryCurrency', e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field
        label="Job description"
        className="sm:col-span-2"
        hint="Paste it: fit reports and AI answers use it."
      >
        {(id) => (
          <Textarea
            id={id}
            rows={8}
            value={value.description}
            onChange={(e) => set('description', e.target.value)}
          />
        )}
      </Field>
    </div>
  );
}
