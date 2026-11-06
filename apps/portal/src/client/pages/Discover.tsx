import {
  type ApplicationDetail,
  DEFAULT_SEARCH_LOCATION,
  type DiscoverItem,
  type DiscoverResponse,
  type SearchProvider,
} from '@jsp/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Search } from 'lucide-react';
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
  PageHeader,
  Select,
  Spinner,
} from '../components/ui';
import { ApiError, api, post, qs } from '../lib/api';
import { formatSalary, relativeDay } from '../lib/format';
import { invalidateApplications } from '../lib/queries';

const PROVIDER_LABEL: Record<SearchProvider, string> = {
  jsearch: 'JSearch',
  adzuna: 'Adzuna',
  usajobs: 'USAJOBS',
  boards: 'Your company boards',
};

function Result({ item }: { item: DiscoverItem }) {
  const qc = useQueryClient();
  const [savedId, setSavedId] = useState<string | null>(item.existingApplicationId);
  const save = useMutation({
    mutationFn: () =>
      post<ApplicationDetail>('/api/applications', {
        job: item.job,
        status: 'saved',
        capturedVia: 'search',
      }),
    onSuccess: (d) => {
      setSavedId(d.application.id);
      invalidateApplications(qc);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'duplicate') {
        const id = (err.details as { applicationId?: string } | undefined)?.applicationId;
        if (id) setSavedId(id);
      }
    },
  });
  const j = item.job;
  const salary = formatSalary(j.salaryMin, j.salaryMax, j.salaryCurrency);
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{j.title}</p>
        <p className="text-sm text-ink-2">
          {j.company}
          {j.location ? ` · ${j.location}` : ''}
          {salary ? ` · ${salary}` : ''}
          {j.postedAt ? ` · posted ${relativeDay(j.postedAt)}` : ''}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge tone="neutral">{item.sourceLabel}</Badge>
          {j.remoteType === 'remote' ? <Badge tone="info">Remote</Badge> : null}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {j.url ? (
          <a href={j.url} target="_blank" rel="noreferrer noopener">
            <Button size="sm">
              <ExternalLink className="size-4" aria-hidden /> Open
            </Button>
          </a>
        ) : null}
        {savedId ? (
          <Link to={`/applications/${savedId}`}>
            <Button size="sm" variant="ghost">
              Saved ✓
            </Button>
          </Link>
        ) : (
          <Button size="sm" variant="primary" onClick={() => save.mutate()} busy={save.isPending}>
            Save
          </Button>
        )}
      </div>
    </li>
  );
}

export function Discover() {
  const [form, setForm] = useState({
    q: '',
    where: DEFAULT_SEARCH_LOCATION,
    remote: false,
    provider: 'all',
  });
  const [query, setQuery] = useState<typeof form | null>(null);
  const [page, setPage] = useState(1);
  const { data, error, isFetching } = useQuery({
    queryKey: ['discover', query, page],
    enabled: query !== null,
    queryFn: () =>
      api<DiscoverResponse>(
        `/api/discover${qs({ q: query?.q, where: query?.where, remote: query?.remote ? 'true' : null, provider: query?.provider, page })}`,
      ),
    staleTime: 5 * 60_000,
  });
  return (
    <>
      <PageHeader
        title="Discover"
        subtitle={`Keyword search across job sources, US-first. Default: ${DEFAULT_SEARCH_LOCATION}; “United States” searches the whole country. For searches built from your resume, use Job Match.`}
      />
      <Card>
        <form
          className="grid gap-2 sm:grid-cols-[2fr_1.4fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.q.trim()) return;
            setPage(1);
            setQuery({ ...form, q: form.q.trim(), where: form.where.trim() });
          }}
        >
          <Input
            placeholder="Job title or keywords"
            value={form.q}
            onChange={(e) => setForm({ ...form, q: e.target.value })}
            aria-label="Keywords"
            required
          />
          <Input
            placeholder={`City, state or ZIP (default: ${DEFAULT_SEARCH_LOCATION})`}
            value={form.where}
            onChange={(e) => setForm({ ...form, where: e.target.value })}
            aria-label="Where"
            title={`Default: ${DEFAULT_SEARCH_LOCATION}. “United States” searches the whole country.`}
          />
          <Select
            aria-label="Source"
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
          >
            <option value="all">All sources</option>
            {(Object.keys(PROVIDER_LABEL) as SearchProvider[]).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="primary" busy={isFetching}>
            <Search className="size-4" aria-hidden /> Search
          </Button>
          <Checkbox
            label="Remote only"
            checked={form.remote}
            onChange={(e) => setForm({ ...form, remote: e.target.checked })}
          />
        </form>
      </Card>

      <div className="mt-5 flex flex-col gap-3">
        <ErrorNote error={error} />
        {data ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {data.providers.map((p) => (
              <Badge
                key={p.provider}
                tone={p.error ? 'muted' : 'success'}
                title={p.error ?? undefined}
              >
                {PROVIDER_LABEL[p.provider]}:{' '}
                {p.error === 'not_configured'
                  ? 'not set up'
                  : p.error
                    ? 'failed'
                    : `${p.total} found`}
              </Badge>
            ))}
          </div>
        ) : null}
        {isFetching && !data ? <Spinner label="Searching…" /> : null}
        {data && data.items.length === 0 ? (
          <EmptyState title="No results">
            Try broader keywords, or set up JSearch, Adzuna or USAJOBS keys on the server (Settings
            shows what is on).
          </EmptyState>
        ) : null}
        {data && data.items.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-line bg-sheet">
            <ul className="divide-y divide-line">
              {data.items.map((item) => (
                <Result
                  key={`${item.provider}:${item.job.url ?? `${item.job.company}|${item.job.title}`}`}
                  item={item}
                />
              ))}
            </ul>
          </div>
        ) : null}
        {data && data.items.length > 0 ? (
          <div className="flex gap-2">
            <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button onClick={() => setPage(page + 1)}>Next page</Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
