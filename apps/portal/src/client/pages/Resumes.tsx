import type { Resume } from '@jsp/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, FileText, Pencil, Star, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Spinner,
  Textarea,
} from '../components/ui';
import { del, patch, upload } from '../lib/api';
import { formatDate } from '../lib/format';
import { keys, useResumes } from '../lib/queries';

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function UploadCard() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set('file', file);
      if (label.trim()) form.set('label', label.trim());
      if (makeDefault) form.set('isDefault', 'true');
      if (text.trim()) form.set('text', text);
      return upload<Resume>('/api/resumes', form);
    },
    onSuccess: () => {
      setLabel('');
      setText('');
      setMakeDefault(false);
      if (fileRef.current) fileRef.current.value = '';
      void qc.invalidateQueries({ queryKey: keys.resumesAll });
    },
  });
  return (
    <Card title="Upload a version">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const file = fileRef.current?.files?.[0];
          if (file) send.mutate(file);
        }}
      >
        <Field
          label="File"
          hint="PDF works best (AI reads it directly). Also DOC, DOCX, ODT, RTF, TXT, up to 5 MB."
        >
          {(id) => (
            <input
              id={id}
              ref={fileRef}
              type="file"
              required
              accept=".pdf,.doc,.docx,.odt,.rtf,.txt"
              className="text-sm"
            />
          )}
        </Field>
        <Field label="Label" hint="e.g. “HR Generalist, logistics”">
          {(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <Field
          label="Plain text (optional)"
          hint="For Word files: paste the text so AI features can read it."
          className="sm:col-span-2"
        >
          {(id) => (
            <Textarea id={id} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          )}
        </Field>
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
          <Checkbox
            label="Make this my default resume"
            checked={makeDefault}
            onChange={(e) => setMakeDefault(e.target.checked)}
          />
          <Button type="submit" variant="primary" busy={send.isPending}>
            <Upload className="size-4" aria-hidden /> Upload
          </Button>
        </div>
        <ErrorNote error={send.error} className="sm:col-span-2" />
      </form>
    </Card>
  );
}

function EditResume({ resume, onClose }: { resume: Resume; onClose: () => void }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(resume.label);
  const [text, setText] = useState('');
  const save = useMutation({
    mutationFn: () =>
      patch<Resume>(`/api/resumes/${resume.id}`, {
        label: label.trim(),
        ...(text.trim() ? { textContent: text } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.resumesAll });
      onClose();
    },
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Label">
        {(id) => (
          <Input id={id} required value={label} onChange={(e) => setLabel(e.target.value)} />
        )}
      </Field>
      <Field
        label="Replace the plain text"
        hint={
          resume.hasText ? 'A text version is stored. Paste to replace it.' : 'No text version yet.'
        }
      >
        {(id) => (
          <Textarea id={id} rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        )}
      </Field>
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

function ResumeRow({ r, onEdit }: { r: Resume; onEdit: () => void }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.resumesAll });
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch<Resume>(`/api/resumes/${r.id}`, body),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => del(`/api/resumes/${r.id}`), onSuccess: refresh });
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <FileText className="hidden size-5 text-muted sm:block" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
          {r.label}
          {r.isDefault ? <Badge tone="info">Default</Badge> : null}
          {r.archived ? <Badge tone="muted">Archived</Badge> : null}
          {r.hasText ? <Badge tone="neutral">Text</Badge> : null}
        </p>
        <p className="truncate text-sm text-ink-2">
          {r.fileName} · {sizeLabel(r.sizeBytes)} · {formatDate(r.createdAt)}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <a href={`/api/resumes/${r.id}/file`}>
          <Button size="sm" aria-label="Download">
            <Download className="size-4" aria-hidden />
          </Button>
        </a>
        {!r.isDefault && !r.archived ? (
          <Button size="sm" onClick={() => act.mutate({ isDefault: true })} busy={act.isPending}>
            <Star className="size-4" aria-hidden /> Default
          </Button>
        ) : null}
        <Button size="sm" onClick={onEdit} aria-label="Edit">
          <Pencil className="size-4" aria-hidden />
        </Button>
        <Button
          size="sm"
          onClick={() => act.mutate({ archived: !r.archived })}
          aria-label={r.archived ? 'Restore' : 'Archive'}
        >
          <Archive className="size-4" aria-hidden /> {r.archived ? 'Restore' : ''}
        </Button>
        <Button
          size="sm"
          variant="danger"
          aria-label="Delete"
          busy={remove.isPending}
          onClick={() => {
            if (
              window.confirm(
                'Delete this resume? Versions an application used are archived instead, so the application keeps what was sent.',
              )
            )
              remove.mutate();
          }}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
      <ErrorNote error={act.error ?? remove.error} />
    </li>
  );
}

export function Resumes() {
  const [showArchived, setShowArchived] = useState(false);
  const { data, error, isLoading } = useResumes(showArchived);
  const [editing, setEditing] = useState<Resume | null>(null);
  return (
    <>
      <PageHeader
        title="Resumes"
        subtitle="Every version you send. Applications keep pointing at the exact file they used."
      />
      <div className="flex flex-col gap-5">
        <UploadCard />
        <Card
          title="Versions"
          action={
            <Checkbox
              label="Show archived"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
          }
        >
          {isLoading ? <Spinner /> : null}
          <ErrorNote error={error} />
          {data && data.length === 0 ? (
            <EmptyState title="No resumes yet">
              Upload your resume to attach it to applications and use AI features.
            </EmptyState>
          ) : null}
          {data && data.length > 0 ? (
            <ul className="-mx-4 divide-y divide-line sm:-mx-5">
              {data.map((r) => (
                <ResumeRow key={r.id} r={r} onEdit={() => setEditing(r)} />
              ))}
            </ul>
          ) : null}
        </Card>
      </div>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title="Edit resume">
        {editing ? <EditResume resume={editing} onClose={() => setEditing(null)} /> : null}
      </Dialog>
    </>
  );
}
