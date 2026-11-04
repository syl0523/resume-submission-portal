import { clsx } from 'clsx';
import {
  Briefcase,
  Building2,
  FileText,
  Inbox,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useMe, useStats } from '../lib/queries';

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: <LayoutDashboard className="size-4" aria-hidden />,
    end: true,
  },
  {
    to: '/applications',
    label: 'Applications',
    icon: <Briefcase className="size-4" aria-hidden />,
  },
  { to: '/match', label: 'Job Match', icon: <Sparkles className="size-4" aria-hidden /> },
  { to: '/discover', label: 'Discover', icon: <Search className="size-4" aria-hidden /> },
  { to: '/boards', label: 'Company boards', icon: <Building2 className="size-4" aria-hidden /> },
  { to: '/inbox', label: 'Inbox', icon: <Inbox className="size-4" aria-hidden /> },
  { to: '/resumes', label: 'Resumes', icon: <FileText className="size-4" aria-hidden /> },
  { to: '/imports', label: 'Import', icon: <Upload className="size-4" aria-hidden /> },
  { to: '/settings', label: 'Settings', icon: <Settings className="size-4" aria-hidden /> },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="font-semibold tracking-tight text-ink">
        <span className="hidden sm:inline lg:hidden xl:inline">Resume Submission Portal</span>
        <span className="sm:hidden lg:inline xl:hidden">Resume Portal</span>
      </span>
    </div>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { data: stats } = useStats();
  const badges: Record<string, number | undefined> = {
    '/match': stats?.newMatches,
  };
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-sheet text-ink shadow-[0_0_0_1px_var(--line)]'
                : 'text-ink-2 hover:bg-sheet/70 hover:text-ink',
            )
          }
        >
          {item.icon}
          <span className="flex-1">{item.label}</span>
          {badges[item.to] ? (
            <span className="tone-new rounded-full px-1.5 text-xs font-semibold">
              {badges[item.to]}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}

/** App frame: sidebar on wide screens, a top bar with a slide-in menu on phones. */
export function Shell() {
  const [open, setOpen] = useState(false);
  const { data: me } = useMe();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-line px-3 py-5 lg:flex lg:flex-col lg:gap-6">
        <div className="px-2">
          <Brand />
        </div>
        <NavItems />
        <div className="mt-auto truncate px-3 text-xs text-muted" title={me?.user.email}>
          {me?.user.email}
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-paper/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <Brand />
        <button
          type="button"
          className="rounded-md p-2 text-ink-2 hover:bg-sheet"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="size-5" aria-hidden />
        </button>
      </header>

      {open ? (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-5 bg-paper px-3 py-4 shadow-xl">
            <div className="flex items-center justify-between px-2">
              <Brand />
              <button
                type="button"
                className="rounded-md p-2 text-ink-2 hover:bg-sheet"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <NavItems onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
