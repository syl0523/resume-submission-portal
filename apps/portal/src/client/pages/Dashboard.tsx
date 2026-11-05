import type { DashboardStats, WeeklyPoint } from '@jsp/core';
import { ArrowRight, CalendarClock, Plus, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
  StatusBadge,
} from '../components/ui';
import { formatDateTime, formatPercent, relativeDay, SOURCE_LABEL } from '../lib/format';
import { useStats } from '../lib/queries';

function Tile({
  label,
  value,
  hint,
  highlight = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-line p-4 ${highlight ? 'tone-new' : 'bg-sheet'}`}>
      <p className="text-xs font-medium tracking-wide uppercase opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs opacity-75">{hint}</p> : null}
    </div>
  );
}

/** Applications and employer responses per week, as paired bars. */
function WeeklyChart({ weeks }: { weeks: WeeklyPoint[] }) {
  const max = Math.max(1, ...weeks.flatMap((w) => [w.applied, w.responses]));
  const barW = 9;
  const gap = 26;
  const h = 120;
  return (
    <figure>
      <svg
        viewBox={`0 0 ${weeks.length * gap} ${h + 20}`}
        className="h-40 w-full"
        role="img"
        aria-label="Applications and responses per week"
      >
        {weeks.map((w, i) => {
          const x = i * gap + 4;
          const ah = (w.applied / max) * h;
          const rh = (w.responses / max) * h;
          return (
            <g key={w.weekStart}>
              <title>{`Week of ${w.weekStart}: ${w.applied} applied, ${w.responses} responses`}</title>
              <rect x={x} y={h - ah} width={barW} height={ah} rx="2" fill="var(--accent)" />
              <rect
                x={x + barW + 1}
                y={h - rh}
                width={barW}
                height={rh}
                rx="2"
                fill="var(--tone-success-ink)"
                opacity="0.8"
              />
              {i % 2 === 0 ? (
                <text x={x + barW} y={h + 14} textAnchor="middle" fontSize="8" fill="var(--muted)">
                  {w.weekStart.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-accent" /> Applied
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--tone-success-ink)]" /> Employer responses
        </span>
      </figcaption>
    </figure>
  );
}

function Body({ stats }: { stats: DashboardStats }) {
  const sent = stats.total - stats.counts.saved;
  if (stats.total === 0) {
    return (
      <EmptyState
        title="No applications yet"
        action={
          <Link to="/applications/new">
            <Button variant="primary">
              <Plus className="size-4" aria-hidden /> Add your first job
            </Button>
          </Link>
        }
      >
        Save a job from its link, import your LinkedIn history, or forward application emails to
        your portal address (Settings).
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="In progress"
          value={stats.active}
          hint={
            stats.counts.saved > 0
              ? `${stats.counts.saved} saved to apply · ${stats.total} total`
              : `${stats.total} total`
          }
        />
        <Tile
          label="Applied, 7 days"
          value={stats.appliedLast7Days}
          hint={`${stats.appliedLast30Days} in 30 days`}
        />
        {/* Rates mean nothing until something has been sent. */}
        <Tile label="Response rate" value={sent > 0 ? formatPercent(stats.responseRate) : '—'} />
        <Tile label="Interview rate" value={sent > 0 ? formatPercent(stats.interviewRate) : '—'} />
        <Tile
          label="Interviews"
          value={stats.counts.interview}
          hint={`${stats.counts.offer} offers`}
        />
        <Tile
          label="New matches"
          value={stats.newMatches}
          highlight={stats.newMatches > 0}
          hint="Job Match"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Follow-ups due"
          action={
            <Link
              to="/applications?status=applied,viewed,screening,interview&sort=activity"
              className="text-sm text-accent hover:underline"
            >
              All active
            </Link>
          }
        >
          {stats.followUpsDue.length === 0 ? (
            <p className="text-sm text-ink-2">
              Nothing due. Follow-up dates are set a week after you apply.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {stats.followUpsDue.map((a) => (
                <li key={a.id}>
                  <Link
                    to={`/applications/${a.id}`}
                    className="flex items-center gap-3 py-2.5 hover:bg-sheet-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{a.job.title}</p>
                      <p className="truncate text-sm text-ink-2">{a.job.company}</p>
                    </div>
                    <StatusBadge status={a.status} />
                    <span className="w-24 text-right text-xs text-muted">
                      {relativeDay(a.nextFollowUpAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Upcoming interviews">
          {stats.upcomingInterviews.length === 0 ? (
            <p className="text-sm text-ink-2">
              No interviews scheduled. Interview emails with a time land here automatically.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {stats.upcomingInterviews.map((i) => (
                <li key={i.eventId}>
                  <Link
                    to={`/applications/${i.applicationId}`}
                    className="flex items-start gap-3 py-2.5 hover:bg-sheet-2"
                  >
                    <CalendarClock className="mt-0.5 size-4 text-accent" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">{formatDateTime(i.scheduledAt)}</p>
                      <p className="truncate text-sm text-ink-2">
                        {i.title} · {i.company}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card title="Last 12 weeks">
          <WeeklyChart weeks={stats.weekly} />
        </Card>
        <Card title="By source">
          <ul className="flex flex-col gap-2">
            {stats.bySource.map((s) => (
              <li key={s.source} className="flex items-center gap-2 text-sm">
                <span className="w-28 truncate text-ink-2">{SOURCE_LABEL[s.source]}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-sheet-2">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${(s.count / Math.max(1, stats.total)) * 100}%` }}
                  />
                </span>
                <span className="w-8 text-right tabular-nums">{s.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Recent activity">
        <ul className="divide-y divide-line">
          {stats.recentEvents.map((e) => (
            <li key={e.id}>
              <Link
                to={`/applications/${e.applicationId}`}
                className="flex flex-col gap-0.5 py-2.5 hover:bg-sheet-2 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="w-28 shrink-0 text-xs text-muted">
                  {relativeDay(e.occurredAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.summary}</span>
                <span className="truncate text-sm text-ink-2 sm:max-w-[40%]">
                  {e.title} · {e.company}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {stats.newMatches > 0 ? (
        <Link
          to="/match"
          className="tone-new flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium"
        >
          <Sparkles className="size-4" aria-hidden /> {stats.newMatches} new job matches since your
          searches last ran
          <ArrowRight className="ml-auto size-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

export function Dashboard() {
  const { data, error, isLoading } = useStats();
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Where every application stands, and what needs you next."
        actions={
          <Link to="/applications/new">
            <Button variant="primary">
              <Plus className="size-4" aria-hidden /> Add job
            </Button>
          </Link>
        }
      />
      {isLoading ? <Spinner /> : null}
      <ErrorNote error={error} />
      {data ? <Body stats={data} /> : null}
      {data && data.counts.ghosted > 0 ? (
        <p className="mt-4 text-xs text-muted">
          <Badge tone="muted">No response</Badge> {data.counts.ghosted}{' '}
          {data.counts.ghosted === 1 ? 'application' : 'applications'} had no reply within the
          follow-up window.
        </p>
      ) : null}
    </>
  );
}
