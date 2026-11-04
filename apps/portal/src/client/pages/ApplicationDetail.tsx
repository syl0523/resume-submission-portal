import {
  APPLICATION_STATUSES,
  APPLY_CHANNELS,
  type ApplicationDetail,
  type ApplicationEvent,
  type ApplicationStatus,
  type ApplyChannel,
  type FitReport,
  STATUS_META,
} from '@jsp/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus,
  ExternalLink,
  Mail,
  MessageSquare,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { emptyJob, type JobDraftState, JobFields, jobPayload } from '../components/JobFields';
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  ScoreRing,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
} from '../components/ui';
import { del, patch, post } from '../lib/api';
import {
  CHANNEL_LABEL,
  formatDate,
  formatDateTime,
  formatSalary,
  fromDateInput,
  fromDateTimeInput,
  REMOTE_LABEL,
  relativeDay,
  SOURCE_LABEL,
  toDateInput,
} from '../lib/format';
import { invalidateApplications, keys, useApplication, useMe, useResumes } from '../lib/queries';

const EVENT_ICON: Record<ApplicationEvent['type'], ReactNode> = {
  created: <Sparkles className="size-4" aria-hidden />,
  status_change: <RefreshCw className="size-4" aria-hidden />,
  note: <MessageSquare className="size-4" aria-hidden />,
  email: <Mail className="size-4" aria-hidden />,
  import: <RefreshCw className="size-4" aria-hidden />,
  interview: <CalendarPlus className="size-4" aria-hidden />,
};

function StatusControl({ detail }: { detail: ApplicationDetail }) {
  const qc = useQueryClient();
  const id = detail.application.id;
  const [status, setStatus] = useState<ApplicationStatus>(detail.application.status);
  const [note, setNote] = useState('');
  const [interviewAt, setInterviewAt] = useState('');
  const change = useMutation({
    mutationFn: () =>
      post<ApplicationDetail>(`/api/applications/${id}/status`, {
        status,
        note: note.trim() || undefined,
        interviewAt:
          status === 'interview' && interviewAt
            ? (fromDateTimeInput(interviewAt) ?? undefined)
            : undefined,
      }),
    onSuccess: (d) => {
      qc.setQueryData(keys.application(id), d);
      setNote('');
      setInterviewAt('');
      invalidateApplications(qc);
    },
  });
  const dirty = status !== detail.application.status;
  return (
    <Card title="Status">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
        >
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label} — {STATUS_META[s].description}
            </option>
          ))}
        </Select>
        {dirty && status === 'interview' ? (
          <Field label="Interview time (optional)" hint="Adds it to your calendar feed.">
            {(fid) => (
              <Input
                id={fid}
                type="datetime-local"
                value={interviewAt}
                onChange={(e) => setInterviewAt(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        {dirty ? (
          <Input
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Note"
          />
        ) : null}
        <ErrorNote error={change.error} />
        <Button type="submit" variant="primary" disabled={!dirty} busy={change.isPending}>
          Update status
        </Button>
      </form>
    </Card>
  );
}

function DetailsCard({ detail }: { detail: ApplicationDetail }) {
  const qc = useQueryClient();
  const { data: resumes } = useResumes(true);
  const a = detail.application;
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      patch<ApplicationDetail>(`/api/applications/${a.id}`, body),
    onSuccess: (d) => {
      qc.setQueryData(keys.application(a.id), d);
      invalidateApplications(qc);
    },
  });
  return (
    <Card title="Details">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-3 text-sm">
        <dt className="text-ink-2">Applied</dt>
        <dd>
          <Input
            type="date"
            aria-label="Applied on"
            value={toDateInput(a.appliedAt)}
            onChange={(e) => save.mutate({ appliedAt: fromDateInput(e.target.value) })}
          />
        </dd>
        <dt className="text-ink-2">Through</dt>
        <dd>
          <Select
            aria-label="Applied through"
            value={a.appliedVia ?? ''}
            onChange={(e) =>
              save.mutate({ appliedVia: (e.target.value || null) as ApplyChannel | null })
            }
          >
            <option value="">—</option>
            {APPLY_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </Select>
        </dd>
        <dt className="text-ink-2">Resume sent</dt>
        <dd className="flex items-center gap-2">
          <Select
            aria-label="Resume"
            value={a.resumeId ?? ''}
            onChange={(e) => save.mutate({ resumeId: e.target.value || null })}
          >
            <option value="">None</option>
            {resumes?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
                {r.archived ? ' (archived)' : ''}
              </option>
            ))}
          </Select>
          {a.resumeId ? (
            <a href={`/api/resumes/${a.resumeId}/file`} className="text-accent hover:underline">
              File
            </a>
          ) : null}
        </dd>
        <dt className="text-ink-2">Follow up</dt>
        <dd>
          <Input
            type="date"
            aria-label="Follow-up date"
            value={toDateInput(a.nextFollowUpAt)}
            onChange={(e) => save.mutate({ nextFollowUpAt: fromDateInput(e.target.value) })}
          />
        </dd>
        <dt className="text-ink-2">Last activity</dt>
        <dd className="text-ink">{relativeDay(a.lastActivityAt)}</dd>
        {a.fitScore != null ? (
          <>
            <dt className="text-ink-2">Fit score</dt>
            <dd>
              <Badge tone="info">{a.fitScore} / 100</Badge>
            </dd>
          </>
        ) : null}
      </dl>
      <ErrorNote error={save.error} className="mt-3" />
    </Card>
  );
}

function NotesCard({ detail }: { detail: ApplicationDetail }) {
  const qc = useQueryClient();
  const id = detail.application.id;
  const [notes, setNotes] = useState(detail.application.notes ?? '');
  const save = useMutation({
    mutationFn: () =>
      patch<ApplicationDetail>(`/api/applications/${id}`, { notes: notes.trim() || null }),
    onSuccess: (d) => qc.setQueryData(keys.application(id), d),
  });
  return (
    <Card title="Notes">
      <Textarea
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        aria-label="Notes"
        placeholder="Contacts, salary range discussed, questions to ask…"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => save.mutate()}
          busy={save.isPending}
          disabled={notes === (detail.application.notes ?? '')}
        >
          Save notes
        </Button>
        <ErrorNote error={save.error} />
      </div>
    </Card>
  );
}

function Timeline({ detail }: { detail: ApplicationDetail }) {
  const qc = useQueryClient();
  const id = detail.application.id;
  const [text, setText] = useState('');
  const [interview, setInterview] = useState({ at: '', title: 'Interview', location: '' });
  const [showInterview, setShowInterview] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.application(id) });
    void qc.invalidateQueries({ queryKey: keys.stats });
  };
  const addNote = useMutation({
    mutationFn: () => post(`/api/applications/${id}/notes`, { text }),
    onSuccess: () => {
      setText('');
      refresh();
    },
  });
  const addInterview = useMutation({
    mutationFn: () =>
      post(`/api/applications/${id}/interviews`, {
        scheduledAt: fromDateTimeInput(interview.at),
        title: interview.title.trim() || 'Interview',
        location: interview.location.trim() || null,
      }),
    onSuccess: () => {
      setInterview({ at: '', title: 'Interview', location: '' });
      setShowInterview(false);
      refresh();
    },
  });
  return (
    <Card
      title="Timeline"
      action={
        <Button size="sm" onClick={() => setShowInterview((v) => !v)}>
          <CalendarPlus className="size-4" aria-hidden /> Interview
        </Button>
      }
    >
      {showInterview ? (
        <form
          className="mb-4 grid gap-2 rounded-lg border border-line bg-sheet-2 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            addInterview.mutate();
          }}
        >
          <Input
            type="datetime-local"
            required
            aria-label="Interview time"
            value={interview.at}
            onChange={(e) => setInterview({ ...interview, at: e.target.value })}
          />
          <Input
            aria-label="Interview title"
            value={interview.title}
            onChange={(e) => setInterview({ ...interview, title: e.target.value })}
          />
          <Input
            aria-label="Where"
            placeholder="Zoom link or address"
            value={interview.location}
            onChange={(e) => setInterview({ ...interview, location: e.target.value })}
          />
          <Button type="submit" variant="primary" busy={addInterview.isPending}>
            Add
          </Button>
          <ErrorNote error={addInterview.error} className="sm:col-span-4" />
        </form>
      ) : null}
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) addNote.mutate();
        }}
      >
        <Input
          placeholder="Add a note to the timeline"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Timeline note"
        />
        <Button type="submit" busy={addNote.isPending} disabled={!text.trim()}>
          Add
        </Button>
      </form>
      <ErrorNote error={addNote.error} className="mb-3" />
      <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
        {detail.events.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute top-0.5 -left-[1.95rem] flex size-6 items-center justify-center rounded-full border border-line bg-sheet text-ink-2">
              {EVENT_ICON[e.type]}
            </span>
            <p className="text-sm text-ink">{e.summary}</p>
            <p className="text-xs text-muted">
              {formatDate(e.occurredAt)} · {e.source}
              {e.scheduledAt ? ` · scheduled ${formatDateTime(e.scheduledAt)}` : ''}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function FitCard({ detail }: { detail: ApplicationDetail }) {
  const [report, setReport] = useState<FitReport | null>(null);
  const run = useMutation({
    mutationFn: (opts: { coverLetter?: boolean; refresh?: boolean }) =>
      post<FitReport>('/api/ai/fit', { applicationId: detail.application.id, ...opts }),
    onSuccess: setReport,
  });
  return (
    <Card
      title="Fit report"
      action={
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => run.mutate({ refresh: Boolean(report) })}
            busy={run.isPending && !run.variables?.coverLetter}
          >
            <Sparkles className="size-4" aria-hidden /> {report ? 'Re-analyze' : 'Analyze fit'}
          </Button>
          <Button
            size="sm"
            onClick={() => run.mutate({ coverLetter: true })}
            busy={run.isPending && Boolean(run.variables?.coverLetter)}
          >
            Cover letter
          </Button>
        </div>
      }
    >
      <ErrorNote error={run.error} />
      {!report && !run.isPending ? (
        <p className="text-sm text-ink-2">
          Compare the resume you sent (or your default resume) with this job description.
        </p>
      ) : null}
      {run.isPending ? <Spinner label="Reading the resume and the job…" /> : null}
      {report ? (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-3">
            <ScoreRing score={report.score} />
            <p className="text-ink">{report.summary}</p>
          </div>
          {[
            ['Strengths', report.strengths],
            ['Gaps', report.gaps],
            ['Suggestions', report.suggestions],
          ].map(([label, items]) =>
            (items as string[]).length > 0 ? (
              <div key={label as string}>
                <p className="font-medium text-ink">{label as string}</p>
                <ul className="mt-1 list-disc pl-5 text-ink-2">
                  {(items as string[]).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          {report.missingKeywords.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {report.missingKeywords.map((k) => (
                <Badge key={k} tone="muted">
                  {k}
                </Badge>
              ))}
            </div>
          ) : null}
          {report.coverLetter ? (
            <div>
              <p className="font-medium text-ink">Cover letter draft</p>
              <p className="prose-plain mt-1 rounded-lg border border-line bg-sheet-2 p-3 text-ink">
                {report.coverLetter}
              </p>
            </div>
          ) : null}
          <p className="text-xs text-muted">
            Generated by {report.model}. Check every claim before you use it.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function EditJob({ detail, onClose }: { detail: ApplicationDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const j = detail.job;
  const [job, setJob] = useState<JobDraftState>({
    ...emptyJob,
    title: j.title,
    company: j.company,
    url: j.url ?? '',
    source: j.source,
    location: j.location ?? '',
    remoteType: j.remoteType,
    employmentType: j.employmentType ?? '',
    salaryMin: j.salaryMin != null ? String(j.salaryMin) : '',
    salaryMax: j.salaryMax != null ? String(j.salaryMax) : '',
    salaryCurrency: j.salaryCurrency ?? 'USD',
    description: j.description ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      patch<ApplicationDetail>(`/api/applications/${detail.application.id}`, {
        job: jobPayload(job),
      }),
    onSuccess: (d) => {
      qc.setQueryData(keys.application(d.application.id), d);
      invalidateApplications(qc);
      onClose();
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <JobFields value={job} onChange={setJob} />
      <ErrorNote error={save.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={save.isPending}>
          Save
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

export function ApplicationDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: detail, error, isLoading } = useApplication(id);
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => del(`/api/applications/${id}`),
    onSuccess: () => {
      invalidateApplications(qc);
      navigate('/applications');
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !detail) return <ErrorNote error={error ?? new Error('Not found')} />;
  const { job, application } = detail;
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);

  return (
    <>
      <Link to="/applications" className="text-sm text-ink-2 hover:underline">
        ← Applications
      </Link>
      <PageHeader
        title={job.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-ink">{job.company}</span>
            {job.location ? <span>· {job.location}</span> : null}
            <span>· {REMOTE_LABEL[job.remoteType]}</span>
            {salary ? <span>· {salary}</span> : null}
            <span>· {SOURCE_LABEL[job.source]}</span>
            <StatusBadge status={application.status} />
          </span>
        }
        actions={
          <>
            {job.url ? (
              <a href={job.url} target="_blank" rel="noreferrer noopener">
                <Button>
                  <ExternalLink className="size-4" aria-hidden /> Posting
                </Button>
              </a>
            ) : null}
            <Button onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden /> Edit job
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Timeline detail={detail} />
          {me?.features.ai ? <FitCard detail={detail} /> : null}
          {job.description ? (
            <Card title="Job description">
              <details>
                <summary className="cursor-pointer text-sm text-accent">
                  Show the full description
                </summary>
                <p className="prose-plain mt-3 text-sm text-ink">{job.description}</p>
              </details>
            </Card>
          ) : null}
        </div>
        <div className="flex flex-col gap-5">
          <StatusControl key={application.status} detail={detail} />
          <DetailsCard detail={detail} />
          <NotesCard detail={detail} />
          <Card title="Danger zone">
            <p className="mb-3 text-sm text-ink-2">
              Deleting removes the job, its timeline and any AI reports.
            </p>
            <ErrorNote error={remove.error} className="mb-2" />
            <Button
              variant="danger"
              busy={remove.isPending}
              onClick={() => {
                if (window.confirm(`Delete ${job.title} at ${job.company}?`)) remove.mutate();
              }}
            >
              <Trash2 className="size-4" aria-hidden /> Delete application
            </Button>
          </Card>
        </div>
      </div>
      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit job" wide>
        <EditJob detail={detail} onClose={() => setEditing(false)} />
      </Dialog>
    </>
  );
}
