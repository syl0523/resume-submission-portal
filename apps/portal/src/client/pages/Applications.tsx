import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  APPLICATION_STATUSES,
  type ApplicationDetail,
  type ApplicationListItem,
  type ApplicationStatus,
  type ListResponse,
  STATUS_META,
} from '@jsp/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Download, Kanban, List, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
} from '../components/ui';
import { post, qs } from '../lib/api';
import { formatSalary, relativeDay, SOURCE_LABEL } from '../lib/format';
import {
  type ApplicationParams,
  invalidateApplications,
  keys,
  useApplications,
} from '../lib/queries';

const SORTS = [
  ['activity', 'Recent activity'],
  ['created', 'Recently added'],
  ['applied', 'Applied date'],
  ['company', 'Company A–Z'],
  ['fit', 'Fit score'],
] as const;

function useStatusMove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ApplicationStatus }) =>
      post<ApplicationDetail>(`/api/applications/${id}/status`, { status }),
    onMutate: async ({ id, status }) => {
      // Optimistic move on every cached list.
      await qc.cancelQueries({ queryKey: keys.applicationsAll });
      const snapshots = qc.getQueriesData<ListResponse<ApplicationListItem>>({
        queryKey: keys.applicationsAll,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData(key, {
          ...data,
          items: data.items.map((a) => (a.id === id ? { ...a, status } : a)),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: (_data, _err, vars) => invalidateApplications(qc, vars.id),
  });
}

function Row({ a }: { a: ApplicationListItem }) {
  const salary = formatSalary(a.job.salaryMin, a.job.salaryMax, a.job.salaryCurrency);
  return (
    <li>
      <Link
        to={`/applications/${a.id}`}
        className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-sheet-2 md:grid-cols-[2fr_1.2fr_7rem_7rem_6rem]"
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{a.job.title}</p>
          <p className="truncate text-sm text-ink-2">
            {a.job.company}
            {a.job.location ? ` · ${a.job.location}` : ''}
          </p>
        </div>
        <div className="justify-self-end md:justify-self-start">
          <StatusBadge status={a.status} />
        </div>
        <p className="hidden truncate text-sm text-ink-2 md:block">
          {SOURCE_LABEL[a.job.source]}
          {salary ? ` · ${salary}` : ''}
        </p>
        <p className="hidden text-sm text-ink-2 md:block">
          {a.appliedAt ? relativeDay(a.appliedAt) : '—'}
        </p>
        <p className="col-span-2 text-xs text-muted md:col-span-1 md:text-right md:text-sm">
          {a.fitScore != null ? (
            <Badge tone="info">Fit {a.fitScore}</Badge>
          ) : (
            relativeDay(a.lastActivityAt)
          )}
        </p>
      </Link>
    </li>
  );
}

function Card({ a }: { a: ApplicationListItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: a.id,
    data: { status: a.status },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={
        transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
      }
      className={clsx(
        'cursor-grab touch-none rounded-lg border border-line bg-sheet p-3 shadow-sm active:cursor-grabbing',
        isDragging && 'z-10 opacity-80 shadow-lg ring-2 ring-focus',
      )}
    >
      <Link
        to={`/applications/${a.id}`}
        className="block font-medium text-ink hover:underline"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {a.job.title}
      </Link>
      <p className="truncate text-sm text-ink-2">{a.job.company}</p>
      <p className="mt-1 text-xs text-muted">{relativeDay(a.lastActivityAt)}</p>
    </div>
  );
}

function Column({ status, items }: { status: ApplicationStatus; items: ApplicationListItem[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={STATUS_META[status].label}
      className={clsx(
        'flex w-64 shrink-0 flex-col gap-2 rounded-xl border border-line bg-sheet-2/60 p-2',
        isOver && 'ring-2 ring-focus',
      )}
    >
      <header className="flex items-center justify-between px-1 py-1">
        <StatusBadge status={status} />
        <span className="text-xs text-muted tabular-nums">{items.length}</span>
      </header>
      <div className="flex min-h-24 flex-col gap-2">
        {items.map((a) => (
          <Card key={a.id} a={a} />
        ))}
      </div>
    </section>
  );
}

function Board({ items }: { items: ApplicationListItem[] }) {
  const move = useStatusMove();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const to = e.over?.id;
    const from = e.active.data.current?.status;
    if (
      typeof to === 'string' &&
      to !== from &&
      (APPLICATION_STATUSES as readonly string[]).includes(to)
    ) {
      move.mutate({ id: String(e.active.id), status: to as ApplicationStatus });
    }
  };
  return (
    <>
      <ErrorNote error={move.error} className="mb-3" />
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
          {APPLICATION_STATUSES.map((s) => (
            <Column key={s} status={s} items={items.filter((a) => a.status === s)} />
          ))}
        </div>
      </DndContext>
      <p className="text-xs text-muted">
        Drag a card to change its status. Moves you make here always win over automatic updates.
      </p>
    </>
  );
}

export function Applications() {
  const [search, setSearch] = useSearchParams();
  const view = search.get('view') === 'board' ? 'board' : 'list';
  const [q, setQ] = useState(search.get('q') ?? '');
  const params: ApplicationParams = {
    q: search.get('q') ?? undefined,
    status: search.get('status') ?? undefined,
    sort: search.get('sort') ?? 'activity',
    limit: view === 'board' ? 500 : 200,
  };
  const { data, error, isLoading, isFetching } = useApplications(params);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSearch(next, { replace: true });
  };

  const exportHref = `/api/applications/export.csv${qs({ q: params.q, status: params.status, sort: params.sort })}`;

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle={
          data
            ? `${data.total} ${data.total === 1 ? 'application' : 'applications'}`
            : 'Every job you saved or applied to'
        }
        actions={
          <>
            <a href={exportHref}>
              <Button>
                <Download className="size-4" aria-hidden /> CSV
              </Button>
            </a>
            <Link to="/applications/new">
              <Button variant="primary">
                <Plus className="size-4" aria-hidden /> Add job
              </Button>
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: q.trim() || null });
          }}
        >
          <Input
            type="search"
            placeholder="Search title, company, location, notes"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search applications"
          />
        </form>
        <Select
          aria-label="Status"
          value={params.status ?? ''}
          onChange={(e) => update({ status: e.target.value || null })}
          className="sm:w-44"
        >
          <option value="">All statuses</option>
          <option value="applied,viewed,screening,interview">Active</option>
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Sort"
          value={params.sort}
          onChange={(e) => update({ sort: e.target.value })}
          className="sm:w-44"
        >
          {SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <fieldset className="flex rounded-md border border-line-2 bg-sheet p-0.5" aria-label="View">
          <Button
            size="sm"
            variant={view === 'list' ? 'primary' : 'ghost'}
            onClick={() => update({ view: null })}
            aria-pressed={view === 'list'}
          >
            <List className="size-4" aria-hidden /> List
          </Button>
          <Button
            size="sm"
            variant={view === 'board' ? 'primary' : 'ghost'}
            onClick={() => update({ view: 'board' })}
            aria-pressed={view === 'board'}
          >
            <Kanban className="size-4" aria-hidden /> Board
          </Button>
        </fieldset>
      </div>

      <ErrorNote error={error} className="mb-3" />
      {isLoading ? <Spinner /> : null}
      {data && data.items.length === 0 ? (
        <EmptyState
          title={
            params.q || params.status ? 'Nothing matches these filters' : 'No applications yet'
          }
        >
          {params.q || params.status
            ? 'Try another search or status.'
            : 'Add a job from its link, or import your LinkedIn applications.'}
        </EmptyState>
      ) : null}
      {data && data.items.length > 0 && view === 'board' ? <Board items={data.items} /> : null}
      {data && data.items.length > 0 && view === 'list' ? (
        <div
          className={clsx(
            'overflow-hidden rounded-xl border border-line bg-sheet',
            isFetching && 'opacity-70',
          )}
        >
          <div className="hidden grid-cols-[2fr_1.2fr_7rem_7rem_6rem] gap-3 border-b border-line px-4 py-2 text-xs font-medium tracking-wide text-muted uppercase md:grid">
            <span>Job</span>
            <span>Status</span>
            <span>Source</span>
            <span>Applied</span>
            <span className="text-right">Fit / activity</span>
          </div>
          <ul className="divide-y divide-line">
            {data.items.map((a) => (
              <Row key={a.id} a={a} />
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
