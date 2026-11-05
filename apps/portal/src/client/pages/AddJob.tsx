import {
  APPLY_CHANNELS,
  type ApplicationDetail,
  type ApplyChannel,
  type ResolveUrlResponse,
} from '@jsp/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { emptyJob, type JobDraftState, JobFields, jobPayload } from '../components/JobFields';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '../components/ui';
import { ApiError, post } from '../lib/api';
import { CHANNEL_LABEL, fromDateInput, toDateInput } from '../lib/format';
import { invalidateApplications, useResumes } from '../lib/queries';

/** Add a job: paste the link (prefilled from official board APIs where possible), check, save. */
export function AddJob() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: resumes } = useResumes();
  const [link, setLink] = useState('');
  const [job, setJob] = useState<JobDraftState>(emptyJob);
  const [status, setStatus] = useState<'saved' | 'applied'>('saved');
  const [appliedOn, setAppliedOn] = useState(toDateInput(new Date().toISOString()));
  const [appliedVia, setAppliedVia] = useState<ApplyChannel | ''>('');
  const [resumeId, setResumeId] = useState('');
  const [notes, setNotes] = useState('');
  const [resolved, setResolved] = useState<ResolveUrlResponse | null>(null);

  const resolve = useMutation({
    mutationFn: (url: string) => post<ResolveUrlResponse>('/api/applications/resolve-url', { url }),
    onSuccess: (r) => {
      setResolved(r);
      const d = r.job;
      setJob((prev) => ({
        ...prev,
        url: d.url ?? link,
        title: d.title ?? prev.title,
        company: d.company ?? prev.company,
        source: d.source ?? prev.source,
        location: d.location ?? prev.location,
        remoteType: d.remoteType ?? prev.remoteType,
        employmentType: d.employmentType ?? prev.employmentType,
        salaryMin: d.salaryMin != null ? String(d.salaryMin) : prev.salaryMin,
        salaryMax: d.salaryMax != null ? String(d.salaryMax) : prev.salaryMax,
        salaryCurrency: d.salaryCurrency ?? prev.salaryCurrency,
        description: d.description ?? prev.description,
      }));
    },
  });

  const save = useMutation({
    mutationFn: () =>
      post<ApplicationDetail>('/api/applications', {
        job: jobPayload(job),
        status,
        appliedAt: status === 'applied' ? fromDateInput(appliedOn) : null,
        appliedVia: status === 'applied' && appliedVia ? appliedVia : null,
        resumeId: resumeId || null,
        notes: notes.trim() || null,
        capturedVia: 'manual',
      }),
    onSuccess: (detail) => {
      invalidateApplications(qc);
      navigate(`/applications/${detail.application.id}`);
    },
  });

  const duplicateId =
    save.error instanceof ApiError && save.error.code === 'duplicate'
      ? (save.error.details as { applicationId?: string } | undefined)?.applicationId
      : resolved?.existingApplicationId;

  return (
    <>
      <PageHeader
        title="Add a job"
        subtitle="Paste the posting link to prefill what we can, then review and save."
      />
      <div className="flex flex-col gap-5">
        <Card>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) resolve.mutate(link.trim());
            }}
          >
            <Input
              type="url"
              placeholder="https://jobs.lever.co/… or a LinkedIn / Indeed posting"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              aria-label="Posting link"
            />
            <Button type="submit" busy={resolve.isPending} disabled={!link.trim()}>
              <Link2 className="size-4" aria-hidden /> Fill in from link
            </Button>
          </form>
          <ErrorNote error={resolve.error} className="mt-3" />
          {/* Live region: screen readers hear what the lookup found without moving focus. */}
          <div role="status">
            {resolved?.message ? (
              <p className="mt-3 text-sm text-ink-2">{resolved.message}</p>
            ) : null}
            {resolved?.fetched ? (
              <p className="mt-3 text-sm text-[var(--tone-success-ink)]">
                Details filled in from the employer's job board. Check them below.
              </p>
            ) : null}
          </div>
        </Card>

        <div role="status">
          {duplicateId ? (
            <div className="tone-info rounded-md px-4 py-3 text-sm">
              You already saved this job.{' '}
              <Link to={`/applications/${duplicateId}`} className="font-medium underline">
                Open it
              </Link>
            </div>
          ) : null}
        </div>

        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Card title="Job">
            <JobFields value={job} onChange={setJob} />
          </Card>
          <Card title="Your application">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                {(id) => (
                  <Select
                    id={id}
                    value={status}
                    onChange={(e) => setStatus(e.target.value === 'applied' ? 'applied' : 'saved')}
                  >
                    <option value="saved">Saved (not applied yet)</option>
                    <option value="applied">Applied</option>
                  </Select>
                )}
              </Field>
              <Field label="Resume">
                {(id) => (
                  <Select id={id} value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                    <option value="">None yet</option>
                    {resumes?.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                        {r.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {status === 'applied' ? (
                <>
                  <Field label="Applied on">
                    {(id) => (
                      <Input
                        id={id}
                        type="date"
                        value={appliedOn}
                        onChange={(e) => setAppliedOn(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Applied through">
                    {(id) => (
                      <Select
                        id={id}
                        value={appliedVia}
                        onChange={(e) => setAppliedVia(e.target.value as ApplyChannel | '')}
                      >
                        <option value="">—</option>
                        {APPLY_CHANNELS.map((c) => (
                          <option key={c} value={c}>
                            {CHANNEL_LABEL[c]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </>
              ) : null}
              <Field label="Notes" className="sm:col-span-2">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                )}
              </Field>
            </div>
          </Card>
          <ErrorNote
            error={
              save.error instanceof ApiError && save.error.code === 'duplicate' ? null : save.error
            }
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              busy={save.isPending}
              disabled={!job.title.trim() || !job.company.trim()}
            >
              Save application
            </Button>
            <Button
              onClick={() =>
                // Opened directly (bookmark, extension, new tab): there is no earlier page in this
                // app to go back to, so go to the list instead of leaving the portal.
                (window.history.state as { idx?: number } | null)?.idx
                  ? navigate(-1)
                  : navigate('/applications')
              }
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
