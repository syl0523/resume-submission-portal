import type { ApplicationDetail, BoardPosting, WatchedBoard } from '@jsp/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Building2, ExternalLink, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorNote,
  Input,
  NewBadge,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui';
import { del, post } from '../lib/api';
import { relativeDay } from '../lib/format';
import { invalidateApplications, keys, useBoards, usePostings } from '../lib/queries';

const PROVIDER: Record<WatchedBoard['provider'], string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
};

function useRefreshBoards() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.boards });
    void qc.invalidateQueries({ queryKey: keys.postingsAll });
  };
}

function AddBoard() {
  const refresh = useRefreshBoards();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () =>
      post<WatchedBoard>('/api/boards', { url: url.trim(), companyName: name.trim() || undefined }),
    onSuccess: () => {
      setUrl('');
      setName('');
      refresh();
    },
  });
  return (
    <Card title="Watch a company">
      <form
        className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Input
          type="url"
          required
          placeholder="Careers page on Greenhouse, Lever, Ashby or SmartRecruiters"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Careers page URL"
        />
        <Input
          placeholder="Company name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Company name"
        />
        <Button type="submit" variant="primary" busy={add.isPending}>
          <Plus className="size-4" aria-hidden /> Watch
        </Button>
      </form>
      <ErrorNote error={add.error} className="mt-2" />
      <p className="mt-2 text-xs text-muted">
        e.g. https://job-boards.greenhouse.io/acme or https://jobs.lever.co/acme. Boards sync every
        morning; new postings are highlighted.
      </p>
    </Card>
  );
}

function BoardRow({
  b,
  active,
  onSelect,
}: {
  b: WatchedBoard;
  active: boolean;
  onSelect: () => void;
}) {
  const refresh = useRefreshBoards();
  const sync = useMutation({
    mutationFn: () => post<WatchedBoard>(`/api/boards/${b.id}/sync`),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => del(`/api/boards/${b.id}`), onSuccess: refresh });
  return (
    <li className={clsx('flex items-center gap-3 px-4 py-3', active && 'bg-sheet-2')}>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <p className="flex items-center gap-2 font-medium text-ink">
          {b.companyName} {b.newPostings > 0 ? <Badge tone="new">{b.newPostings} new</Badge> : null}
        </p>
        <p className="truncate text-xs text-muted">
          {PROVIDER[b.provider]} · {b.openPostings} open · synced {relativeDay(b.lastSyncedAt)}
        </p>
        {b.lastError ? (
          <p className="text-xs text-[var(--tone-danger-ink)]">{b.lastError}</p>
        ) : null}
      </button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => sync.mutate()}
        busy={sync.isPending}
        aria-label="Sync now"
      >
        <RefreshCw className="size-4" aria-hidden />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (window.confirm(`Stop watching ${b.companyName}?`)) remove.mutate();
        }}
        aria-label="Stop watching"
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

function Posting({ p }: { p: BoardPosting }) {
  const qc = useQueryClient();
  const refresh = useRefreshBoards();
  const save = useMutation({
    mutationFn: () =>
      post<ApplicationDetail>(`/api/boards/postings/${p.id}/save`, { status: 'saved' }),
    onSuccess: () => {
      refresh();
      invalidateApplications(qc);
    },
  });
  const dismiss = useMutation({
    mutationFn: () => post(`/api/boards/postings/${p.id}/dismiss`),
    onSuccess: refresh,
  });
  return (
    <li
      className={clsx(
        'flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center',
        p.isNew && 'border-l-4 border-l-[var(--highlight)]',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-medium text-ink">
          {p.title} {p.isNew ? <NewBadge /> : null}
        </p>
        <p className="truncate text-sm text-ink-2">
          {p.companyName}
          {p.location ? ` · ${p.location}` : ''} · first seen {relativeDay(p.firstSeenAt)}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <a href={p.url} target="_blank" rel="noreferrer noopener">
          <Button size="sm">
            <ExternalLink className="size-4" aria-hidden /> Open
          </Button>
        </a>
        {p.savedApplicationId ? (
          <Link to={`/applications/${p.savedApplicationId}`}>
            <Button size="sm" variant="ghost">
              Saved ✓
            </Button>
          </Link>
        ) : (
          <Button size="sm" variant="primary" onClick={() => save.mutate()} busy={save.isPending}>
            Save
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => dismiss.mutate()}
          busy={dismiss.isPending}
          aria-label="Dismiss"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <ErrorNote error={save.error ?? dismiss.error} />
    </li>
  );
}

export function Boards() {
  const { data: boards, error, isLoading } = useBoards();
  const [boardId, setBoardId] = useState<string>('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [q, setQ] = useState('');
  const postings = usePostings({
    boardId: boardId || undefined,
    onlyNew,
    q: q.trim() || undefined,
  });
  return (
    <>
      <PageHeader
        title="Company boards"
        subtitle="Watch the careers pages of companies you like; new openings are flagged every morning."
      />
      <div className="flex flex-col gap-5">
        <AddBoard />
        {isLoading ? <Spinner /> : null}
        <ErrorNote error={error} />
        {boards && boards.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" aria-hidden />}
            title="No companies watched yet"
          >
            Add a careers page above. Only official public job-board APIs are used.
          </EmptyState>
        ) : null}
        {boards && boards.length > 0 ? (
          <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
            <Card title="Watching">
              <ul className="-mx-4 divide-y divide-line sm:-mx-5">
                {boards.map((b) => (
                  <BoardRow
                    key={b.id}
                    b={b}
                    active={b.id === boardId}
                    onSelect={() => setBoardId(b.id === boardId ? '' : b.id)}
                  />
                ))}
              </ul>
            </Card>
            <Card title="Open postings">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  type="search"
                  placeholder="Filter by title, location or company"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  aria-label="Filter postings"
                />
                <Select
                  aria-label="Company"
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                  className="sm:w-48"
                >
                  <option value="">All companies</option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.companyName}
                    </option>
                  ))}
                </Select>
                <Checkbox
                  label="New only"
                  checked={onlyNew}
                  onChange={(e) => setOnlyNew(e.target.checked)}
                />
              </div>
              <ErrorNote error={postings.error} />
              {postings.data && postings.data.items.length === 0 ? (
                <p className="py-4 text-sm text-ink-2">Nothing open matches.</p>
              ) : null}
              <ul className="-mx-4 divide-y divide-line sm:-mx-5">
                {postings.data?.items.map((p) => (
                  <Posting key={p.id} p={p} />
                ))}
              </ul>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
