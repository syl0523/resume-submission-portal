import {
  type ApplicationDetail,
  type DeepLinkGroup,
  type FitFlag,
  type RunSearchResponse,
  type SavedSearch,
  type SavedSearchDraft,
  type SavedSearchRequest,
  SENIORITY_LEVELS,
  type SearchHit,
  type SearchProvider,
  type SeniorityLevel,
  WORK_MODES,
  type WorkMode,
} from '@jsp/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ExternalLink, Pencil, Play, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
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
  NewBadge,
  PageHeader,
  ScoreRing,
  Select,
  Spinner,
} from '../components/ui';
import { api, del, post, put } from '../lib/api';
import { formatSalary, relativeDay, splitList, splitLocations } from '../lib/format';
import {
  invalidateApplications,
  keys,
  useHits,
  useMe,
  useResumes,
  useSearch,
  useSearches,
} from '../lib/queries';

const SENIORITY_LABEL: Record<SeniorityLevel, string> = {
  internship: 'Internship',
  entry: 'Entry level',
  associate: 'Associate',
  mid_senior: 'Mid-senior',
  director: 'Director',
  executive: 'Executive',
};

const WORK_MODE_LABEL: Record<WorkMode, string> = {
  any: 'Any',
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

const FLAG_LABEL: Record<FitFlag, string> = {
  no_sponsorship: 'No visa sponsorship',
  citizenship_required: 'US citizens only',
  clearance_required: 'Clearance required',
  relocation_required: 'Relocation required',
  contract_role: 'Contract',
  salary_below_min: 'Below your salary floor',
  stale_posting: 'Posted 30+ days ago',
  excluded_keyword: 'Has an excluded word',
};

interface FormState {
  name: string;
  resumeId: string;
  titles: string;
  skills: string;
  locations: string;
  workMode: WorkMode;
  seniority: SeniorityLevel | '';
  keywords: string;
  excludeKeywords: string;
  minSalary: string;
  postedWithinDays: 1 | 3 | 7 | 14 | 30;
  needsSponsorship: boolean;
  summary: string;
  alertsEnabled: boolean;
}

function toForm(s: SavedSearch | SavedSearchDraft | null): FormState {
  return {
    name: s?.name ?? '',
    resumeId: s?.resumeId ?? '',
    titles: s?.titles.join(', ') ?? '',
    skills: s?.skills.join(', ') ?? '',
    locations: s?.locations.join('; ') ?? '',
    workMode: s?.workMode ?? 'any',
    seniority: s?.seniority ?? '',
    keywords: s?.keywords.join(', ') ?? '',
    excludeKeywords: s?.excludeKeywords.join(', ') ?? '',
    minSalary: s?.minSalary ? String(s.minSalary) : '',
    postedWithinDays: s?.postedWithinDays ?? 7,
    needsSponsorship: s?.needsSponsorship ?? false,
    summary: s?.summary ?? '',
    alertsEnabled: s?.alertsEnabled ?? true,
  };
}

const PROVIDER_LABEL: Record<SearchProvider, string> = {
  jsearch: 'LinkedIn · Indeed · company sites',
  adzuna: 'Adzuna',
  usajobs: 'USAJOBS',
  boards: 'Company boards',
};

function toRequest(f: FormState): SavedSearchRequest {
  return {
    name: f.name.trim(),
    resumeId: f.resumeId || null,
    titles: splitList(f.titles),
    skills: splitList(f.skills),
    locations: splitLocations(f.locations),
    workMode: f.workMode,
    seniority: f.seniority || null,
    keywords: splitList(f.keywords),
    excludeKeywords: splitList(f.excludeKeywords),
    minSalary: f.minSalary ? Math.round(Number(f.minSalary.replace(/[^\d]/g, ''))) || null : null,
    postedWithinDays: f.postedWithinDays,
    needsSponsorship: f.needsSponsorship,
    summary: f.summary.trim() || null,
    alertsEnabled: f.alertsEnabled,
  };
}

function SearchForm({
  initial,
  onDone,
}: {
  initial: SavedSearch | null;
  onDone: (s: SavedSearch) => void;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: resumes } = useResumes();
  const [f, setF] = useState<FormState>(toForm(initial));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));
  const draft = useMutation({
    mutationFn: (resumeId: string) =>
      post<SavedSearchDraft>('/api/searches/draft-from-resume', { resumeId }),
    onSuccess: (d) => setF(toForm(d)),
  });
  const save = useMutation({
    mutationFn: () =>
      initial
        ? put<SavedSearch>(`/api/searches/${initial.id}`, toRequest(f))
        : post<SavedSearch>('/api/searches', toRequest(f)),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: keys.searches });
      void qc.invalidateQueries({ queryKey: keys.search(s.id) });
      onDone(s);
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
      {me?.features.ai && !initial ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-sheet-2 p-3 sm:flex-row sm:items-center">
          <Sparkles className="size-4 text-accent" aria-hidden />
          <span className="text-sm text-ink-2">Draft from a resume:</span>
          <Select
            aria-label="Resume"
            value={f.resumeId}
            onChange={(e) => set('resumeId', e.target.value)}
            className="sm:w-56"
          >
            <option value="">Choose a resume</option>
            {resumes?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={!f.resumeId}
            busy={draft.isPending}
            onClick={() => draft.mutate(f.resumeId)}
          >
            Draft
          </Button>
        </div>
      ) : null}
      <ErrorNote error={draft.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="e.g. “HR Manager, remote US”">
          {(id) => (
            <Input id={id} required value={f.name} onChange={(e) => set('name', e.target.value)} />
          )}
        </Field>
        <Field label="Resume">
          {(id) => (
            <Select id={id} value={f.resumeId} onChange={(e) => set('resumeId', e.target.value)}>
              <option value="">None</option>
              {resumes?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Target titles"
          hint="Comma-separated, most important first"
          className="sm:col-span-2"
        >
          {(id) => (
            <Input
              id={id}
              required
              value={f.titles}
              onChange={(e) => set('titles', e.target.value)}
            />
          )}
        </Field>
        <Field label="Skills" hint="Used for the fit score" className="sm:col-span-2">
          {(id) => (
            <Input id={id} value={f.skills} onChange={(e) => set('skills', e.target.value)} />
          )}
        </Field>
        <Field
          label="Locations"
          hint="e.g. “New York, NY; Remote”. ZIP codes work too. Empty = anywhere in the US."
        >
          {(id) => (
            <Input id={id} value={f.locations} onChange={(e) => set('locations', e.target.value)} />
          )}
        </Field>
        <Field label="Work arrangement">
          {(id) => (
            <Select
              id={id}
              value={f.workMode}
              onChange={(e) => set('workMode', e.target.value as WorkMode)}
            >
              {WORK_MODES.map((m) => (
                <option key={m} value={m}>
                  {WORK_MODE_LABEL[m]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Seniority">
          {(id) => (
            <Select
              id={id}
              value={f.seniority}
              onChange={(e) => set('seniority', e.target.value as SeniorityLevel | '')}
            >
              <option value="">Any</option>
              {SENIORITY_LEVELS.map((s) => (
                <option key={s} value={s}>
                  {SENIORITY_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Posted within">
          {(id) => (
            <Select
              id={id}
              value={f.postedWithinDays}
              onChange={(e) =>
                set('postedWithinDays', Number(e.target.value) as FormState['postedWithinDays'])
              }
            >
              {[1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? '24 hours' : `${d} days`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Extra keywords">
          {(id) => (
            <Input id={id} value={f.keywords} onChange={(e) => set('keywords', e.target.value)} />
          )}
        </Field>
        <Field label="Exclude words" hint="e.g. commission only, clearance">
          {(id) => (
            <Input
              id={id}
              value={f.excludeKeywords}
              onChange={(e) => set('excludeKeywords', e.target.value)}
            />
          )}
        </Field>
        <Field label="Minimum salary (USD / year)">
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              value={f.minSalary}
              onChange={(e) => set('minSalary', e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-col justify-end gap-2">
          <Checkbox
            label="I need visa sponsorship (hide postings that rule it out)"
            checked={f.needsSponsorship}
            onChange={(e) => set('needsSponsorship', e.target.checked)}
          />
          <Checkbox
            label="Refresh daily and flag new matches"
            checked={f.alertsEnabled}
            onChange={(e) => set('alertsEnabled', e.target.checked)}
          />
        </div>
      </div>
      <ErrorNote error={save.error} />
      <div>
        <Button
          type="submit"
          variant="primary"
          busy={save.isPending}
          disabled={!f.name.trim() || splitList(f.titles).length === 0}
        >
          {initial ? 'Save changes' : 'Create search'}
        </Button>
      </div>
    </form>
  );
}

export function JobMatch() {
  const navigate = useNavigate();
  const { data, error, isLoading } = useSearches();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Job Match"
        subtitle="Saved searches built from your resume, run across LinkedIn, Indeed and company sites, ranked by fit."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> New search
          </Button>
        }
      />
      {isLoading ? <Spinner /> : null}
      <ErrorNote error={error} />
      {data && data.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-6" aria-hidden />}
          title="No saved searches yet"
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create your first search
            </Button>
          }
        >
          A search is a track like “HR Generalist, Austin”: target titles, skills and places. Each
          run keeps what it found, so new postings stand out.
        </EmptyState>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {data?.map((s) => (
          <Link
            key={s.id}
            to={`/match/${s.id}`}
            className="rounded-xl border border-line bg-sheet p-4 hover:border-line-2 hover:bg-sheet-2"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-ink">{s.name}</p>
              {s.newHits > 0 ? <Badge tone="new">{s.newHits} new</Badge> : null}
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-ink-2">{s.titles.join(' · ')}</p>
            <p className="mt-2 text-xs text-muted">
              {s.locations.length ? s.locations.join(', ') : 'Anywhere in the US'} ·{' '}
              {WORK_MODE_LABEL[s.workMode]} · {s.totalHits} results ·{' '}
              {s.lastRunAt ? `ran ${relativeDay(s.lastRunAt)}` : 'not run yet'}
            </p>
          </Link>
        ))}
      </div>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New saved search" wide>
        <SearchForm
          initial={null}
          onDone={(s) => {
            setCreating(false);
            navigate(`/match/${s.id}`);
          }}
        />
      </Dialog>
    </>
  );
}

function HitRow({ hit, onChanged }: { hit: SearchHit; onChanged: () => void }) {
  const qc = useQueryClient();
  const [appId, setAppId] = useState(hit.applicationId);
  const save = useMutation({
    mutationFn: () =>
      post<ApplicationDetail>(`/api/searches/hits/${hit.id}/save`, { status: 'saved' }),
    onSuccess: (d) => {
      setAppId(d.application.id);
      invalidateApplications(qc);
      onChanged();
    },
  });
  const dismiss = useMutation({
    mutationFn: () => post(`/api/searches/hits/${hit.id}/dismiss`),
    onSuccess: onChanged,
  });
  const j = hit.job;
  const score = hit.aiFit?.score ?? hit.fit.score;
  const salary = formatSalary(j.salaryMin, j.salaryMax, j.salaryCurrency);
  return (
    <li
      className={clsx(
        'flex gap-3 px-4 py-3',
        hit.fit.excluded && 'opacity-60',
        hit.isNew && 'border-l-4 border-l-[var(--highlight)]',
      )}
    >
      <ScoreRing
        score={score}
        label={hit.aiFit ? `AI fit ${hit.aiFit.score}, rules ${hit.fit.score}` : undefined}
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
          {j.title} {hit.isNew ? <NewBadge /> : null}
        </p>
        <p className="text-sm text-ink-2">
          {j.company}
          {j.location ? ` · ${j.location}` : ''}
          {salary ? ` · ${salary}` : ''}
          {j.postedAt ? ` · posted ${relativeDay(j.postedAt)}` : ''}
        </p>
        {hit.aiFit ? <p className="mt-1 text-sm text-ink">{hit.aiFit.reason}</p> : null}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Badge tone="neutral">{hit.sourceLabel}</Badge>
          {hit.fit.reasons.slice(0, 3).map((r) => (
            <Badge key={r} tone="success">
              {r}
            </Badge>
          ))}
          {hit.fit.flags.map((f) => (
            <Badge key={f} tone="danger">
              {FLAG_LABEL[f]}
            </Badge>
          ))}
          {hit.fit.missingSkills.length > 0 ? (
            <span className="text-xs text-muted">
              Missing: {hit.fit.missingSkills.slice(0, 4).join(', ')}
            </span>
          ) : null}
        </div>
        <ErrorNote error={save.error ?? dismiss.error} className="mt-2" />
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-start">
        {j.url ? (
          <a href={j.url} target="_blank" rel="noreferrer noopener">
            <Button size="sm" aria-label="Open posting">
              <ExternalLink className="size-4" aria-hidden />
            </Button>
          </a>
        ) : null}
        {appId ? (
          <Link to={`/applications/${appId}`}>
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
    </li>
  );
}

function DeepLinks({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ['links', id],
    queryFn: () => api<DeepLinkGroup[]>(`/api/searches/${id}/links`),
  });
  if (!data) return null;
  return (
    <Card title="Search these sites yourself">
      <p className="mb-3 text-sm text-ink-2">
        Pre-filled searches with your titles, places and filters. They open the sites directly;
        nothing is scraped.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {data.map((g) => (
          <div key={g.site}>
            <p className="mb-1 text-sm font-medium text-ink">{g.label}</p>
            <ul className="flex flex-col gap-1">
              {g.links.map((l) => (
                <li key={l.url}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sm text-accent hover:underline"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function SearchDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: search, error, isLoading } = useSearch(id);
  const [onlyNew, setOnlyNew] = useState(false);
  const [aiRerank, setAiRerank] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lastRun, setLastRun] = useState<RunSearchResponse | null>(null);
  const hits = useHits(id, { onlyNew, sort: 'fit' });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.hitsAll });
    void qc.invalidateQueries({ queryKey: keys.search(id) });
    void qc.invalidateQueries({ queryKey: keys.searches });
    void qc.invalidateQueries({ queryKey: keys.stats });
  };
  const run = useMutation({
    mutationFn: () => post<RunSearchResponse>(`/api/searches/${id}/run`, { aiRerank }),
    onSuccess: (r) => {
      setLastRun(r);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => del(`/api/searches/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.searches });
      navigate('/match');
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !search) return <ErrorNote error={error ?? new Error('Not found')} />;

  return (
    <>
      <Link to="/match" className="text-sm text-ink-2 hover:underline">
        ← Job Match
      </Link>
      <PageHeader
        title={search.name}
        subtitle={`${search.titles.join(' · ')} — ${search.locations.length ? search.locations.join(', ') : 'anywhere in the US'}`}
        actions={
          <>
            <Button onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden /> Edit
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(`Delete “${search.name}” and its results?`)) remove.mutate();
              }}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
            <Button variant="primary" onClick={() => run.mutate()} busy={run.isPending}>
              <Play className="size-4" aria-hidden /> Run now
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          {me?.features.ai ? (
            <Checkbox
              label="Re-rank the top 20 with AI"
              checked={aiRerank}
              onChange={(e) => setAiRerank(e.target.checked)}
            />
          ) : null}
          <Checkbox
            label="New only"
            checked={onlyNew}
            onChange={(e) => setOnlyNew(e.target.checked)}
          />
          <span className="text-xs text-muted">
            {search.lastRunAt ? `Last run ${relativeDay(search.lastRunAt)}` : 'Not run yet'}
          </span>
        </div>
        <ErrorNote error={run.error ?? remove.error} />
        {lastRun ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {lastRun.providers.map((p) => (
              <Badge
                key={p.provider}
                tone={p.error || p.total === 0 ? 'muted' : 'success'}
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
            <span className="text-ink-2">{lastRun.hits.length} matches this run</span>
          </div>
        ) : null}
        <Card title={`Results${hits.data ? ` (${hits.data.total})` : ''}`}>
          {hits.isLoading ? <Spinner /> : null}
          <ErrorNote error={hits.error} />
          {hits.data && hits.data.items.length === 0 ? (
            <p className="py-4 text-sm text-ink-2">
              {!search.lastRunAt ? (
                'Run the search to collect matches.'
              ) : me && !me.features.jsearch && !me.features.adzuna && !me.features.usajobs ? (
                <>
                  No job search service is connected yet, so only your{' '}
                  <Link to="/boards" className="text-accent hover:underline">
                    watched company boards
                  </Link>{' '}
                  are searched. A JSearch key adds LinkedIn, Indeed and company sites (see{' '}
                  <Link to="/settings" className="text-accent hover:underline">
                    Settings
                  </Link>
                  ). Meanwhile, use the links below.
                </>
              ) : (
                'No results to show. Try broader titles or places, or the links below.'
              )}
            </p>
          ) : null}
          <ul className="-mx-4 divide-y divide-line sm:-mx-5">
            {hits.data?.items.map((h) => (
              <HitRow key={h.id} hit={h} onChanged={refresh} />
            ))}
          </ul>
        </Card>
        <DeepLinks id={id} />
      </div>
      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit saved search" wide>
        <SearchForm initial={search} onDone={() => setEditing(false)} />
      </Dialog>
    </>
  );
}
