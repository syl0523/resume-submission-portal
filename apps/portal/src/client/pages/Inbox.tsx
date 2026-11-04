import { type EmailKind, INBOX_STATUSES, type InboxItem, type IngestResult } from '@jsp/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Link2, Mail, Plus, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  Card,
  CopyButton,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Spinner,
  StatusBadge,
  Textarea,
  type Tone,
} from '../components/ui';
import { post } from '../lib/api';
import { relativeDay } from '../lib/format';
import { invalidateApplications, keys, useApplications, useInbox, useMe } from '../lib/queries';

const KIND: Record<EmailKind, { label: string; tone: Tone }> = {
  application_received: { label: 'Application received', tone: 'info' },
  application_viewed: { label: 'Viewed', tone: 'info' },
  screening: { label: 'Screening', tone: 'progress' },
  assessment: { label: 'Assessment', tone: 'progress' },
  interview: { label: 'Interview', tone: 'progress' },
  offer: { label: 'Offer', tone: 'success' },
  rejection: { label: 'Rejection', tone: 'danger' },
  other: { label: 'Other', tone: 'muted' },
};

const STATUS_LABEL: Record<string, string> = {
  all: 'All',
  unmatched: 'Needs review',
  matched: 'Matched',
  created: 'Created',
  ignored: 'Ignored',
  error: 'Errors',
};

function useRefreshInbox() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.inboxAll });
    invalidateApplications(qc);
  };
}

function LinkDialog({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  const refresh = useRefreshInbox();
  const [q, setQ] = useState(item.company ?? '');
  const { data } = useApplications({ q: q.trim() || undefined, limit: 20 });
  const link = useMutation({
    mutationFn: (applicationId: string) =>
      post<InboxItem>(`/api/inbox/${item.id}/link`, { applicationId }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your applications"
        aria-label="Search applications"
      />
      <ErrorNote error={link.error} />
      <ul className="divide-y divide-line rounded-lg border border-line">
        {data?.items.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{a.job.title}</p>
              <p className="truncate text-sm text-ink-2">{a.job.company}</p>
            </div>
            <StatusBadge status={a.status} />
            <Button
              size="sm"
              onClick={() => link.mutate(a.id)}
              busy={link.isPending && link.variables === a.id}
            >
              Link
            </Button>
          </li>
        ))}
        {data?.items.length === 0 ? (
          <li className="px-3 py-4 text-sm text-ink-2">No applications match.</li>
        ) : null}
      </ul>
    </div>
  );
}

function Item({ item, onLink }: { item: InboxItem; onLink: () => void }) {
  const refresh = useRefreshInbox();
  const create = useMutation({
    mutationFn: () => post<IngestResult>(`/api/inbox/${item.id}/create`),
    onSuccess: refresh,
  });
  const ignore = useMutation({
    mutationFn: () => post<InboxItem>(`/api/inbox/${item.id}/ignore`),
    onSuccess: refresh,
  });
  const kind = KIND[item.kind];
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={kind.tone}>{kind.label}</Badge>
        <span className="text-xs text-muted">
          {Math.round(item.confidence * 100)}% sure · {item.classifier === 'ai' ? 'AI' : 'rules'} ·{' '}
          {relativeDay(item.receivedAt)}
        </span>
        {item.status === 'unmatched' ? <Badge tone="new">Needs review</Badge> : null}
        {item.status === 'error' ? <Badge tone="danger">Error</Badge> : null}
      </div>
      <p className="font-medium text-ink">{item.subject}</p>
      <p className="truncate text-sm text-ink-2">
        {item.fromAddress}
        {item.company ? ` · ${item.company}` : ''}
        {item.jobTitle ? ` · ${item.jobTitle}` : ''}
      </p>
      {item.snippet ? <p className="line-clamp-2 text-sm text-muted">{item.snippet}</p> : null}
      {item.error ? <p className="text-sm text-[var(--tone-danger-ink)]">{item.error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {item.application ? (
          <Link
            to={`/applications/${item.application.id}`}
            className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
          >
            {item.application.title} · {item.application.company}{' '}
            <StatusBadge status={item.application.status} />
          </Link>
        ) : null}
        {item.status === 'unmatched' || item.status === 'error' || item.status === 'ignored' ? (
          <>
            <Button size="sm" onClick={onLink}>
              <Link2 className="size-4" aria-hidden /> Link to application
            </Button>
            {item.company && item.jobTitle ? (
              <Button size="sm" onClick={() => create.mutate()} busy={create.isPending}>
                <Plus className="size-4" aria-hidden /> Create application
              </Button>
            ) : null}
            {item.status !== 'ignored' ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => ignore.mutate()}
                busy={ignore.isPending}
              >
                <XCircle className="size-4" aria-hidden /> Ignore
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      <ErrorNote error={create.error ?? ignore.error} />
    </li>
  );
}

function PasteCard() {
  const refresh = useRefreshInbox();
  const [mode, setMode] = useState<'fields' | 'raw'>('fields');
  const [form, setForm] = useState({ from: '', subject: '', text: '', raw: '' });
  const [result, setResult] = useState<IngestResult | null>(null);
  const paste = useMutation({
    mutationFn: () =>
      post<IngestResult>(
        '/api/inbox/paste',
        mode === 'raw'
          ? { raw: form.raw }
          : { from: form.from || undefined, subject: form.subject, text: form.text },
      ),
    onSuccess: (r) => {
      setResult(r);
      setForm({ from: '', subject: '', text: '', raw: '' });
      refresh();
    },
  });
  return (
    <Card
      title="Paste an email"
      action={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setMode(mode === 'raw' ? 'fields' : 'raw')}
        >
          {mode === 'raw' ? 'Paste text instead' : 'Paste a .eml file instead'}
        </Button>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          paste.mutate();
        }}
      >
        {mode === 'raw' ? (
          <Field
            label="Raw email (.eml)"
            hint="In Outlook: File → Save As; in Gmail: ⋮ → Show original."
          >
            {(id) => (
              <Textarea
                id={id}
                rows={6}
                required
                value={form.raw}
                onChange={(e) => setForm({ ...form, raw: e.target.value })}
                className="font-mono text-xs"
              />
            )}
          </Field>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From">
                {(id) => (
                  <Input
                    id={id}
                    placeholder="LinkedIn <jobs-noreply@linkedin.com>"
                    value={form.from}
                    onChange={(e) => setForm({ ...form, from: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Subject">
                {(id) => (
                  <Input
                    id={id}
                    required
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <Field label="Body">
              {(id) => (
                <Textarea
                  id={id}
                  rows={5}
                  required
                  value={form.text}
                  onChange={(e) => setForm({ ...form, text: e.target.value })}
                />
              )}
            </Field>
          </>
        )}
        <ErrorNote error={paste.error} />
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" busy={paste.isPending}>
            <Mail className="size-4" aria-hidden /> Process email
          </Button>
          {result ? (
            <span className="text-sm text-ink-2">
              {result.created
                ? 'Created a new application.'
                : result.applicationId
                  ? result.statusChanged
                    ? 'Matched and updated the status.'
                    : 'Matched; added to the timeline.'
                  : result.item.status === 'ignored'
                    ? 'Not about an application: ignored.'
                    : 'Needs review below.'}
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

export function InboxPage() {
  const { data: me } = useMe();
  const [status, setStatus] = useState<string>('all');
  const { data, error, isLoading } = useInbox(status);
  const [linking, setLinking] = useState<InboxItem | null>(null);
  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Application emails you forward update your applications automatically."
      />
      <div className="flex flex-col gap-5">
        <Card title="Your forwarding address">
          {me?.inboundAddress ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-sheet-2 px-2.5 py-1.5 text-sm">
                  {me.inboundAddress}
                </code>
                <CopyButton value={me.inboundAddress} />
              </div>
              <p className="text-sm text-ink-2">
                Forward confirmations, “viewed” notices, interview invites and rejections here, or
                set a rule in Outlook or Gmail to forward mail from LinkedIn, Indeed and
                applicant-tracking systems automatically.
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-2">
              Email forwarding is not set up on this portal yet (see the runbook). You can still
              paste emails below.
            </p>
          )}
        </Card>
        <PasteCard />
        <Card title="Processed emails">
          <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter">
            {['all', ...INBOX_STATUSES].map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={status === s}
                onClick={() => setStatus(s)}
                className={clsx(
                  'rounded-full px-3 py-1 text-sm',
                  status === s
                    ? 'bg-accent text-accent-ink'
                    : 'bg-sheet-2 text-ink-2 hover:text-ink',
                )}
              >
                {STATUS_LABEL[s] ?? s}
              </button>
            ))}
          </div>
          {isLoading ? <Spinner /> : null}
          <ErrorNote error={error} />
          {data && data.items.length === 0 ? (
            <EmptyState title="No emails here">
              Forwarded and pasted emails show up here with what they changed.
            </EmptyState>
          ) : null}
          {data && data.items.length > 0 ? (
            <ul className="-mx-4 divide-y divide-line sm:-mx-5">
              {data.items.map((item) => (
                <Item key={item.id} item={item} onLink={() => setLinking(item)} />
              ))}
            </ul>
          ) : null}
        </Card>
      </div>
      <Dialog
        open={linking !== null}
        onClose={() => setLinking(null)}
        title="Link email to an application"
      >
        {linking ? <LinkDialog item={linking} onClose={() => setLinking(null)} /> : null}
      </Dialog>
    </>
  );
}
