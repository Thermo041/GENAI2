import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity as ActivityIcon,
  GitPullRequest,
  LayoutDashboard,
  Menu,
  FolderGit2,
  Settings as SettingsIcon,
  GitCompare,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Wordmark } from './Logo.jsx';
import { Topbar } from './Topbar.jsx';
import { Button } from '../ui/button.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/repositories', label: 'Repositories', icon: FolderGit2 },
  { to: '/changes', label: 'AI Changes', icon: GitCompare },
  { to: '/activity', label: 'Activity', icon: ActivityIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

function NavItems({ onNavigate }) {
  return (
    <nav className="space-y-0.5" aria-label="Main">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors',
              isActive
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
            )
          }
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface/60 lg:flex">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Wordmark to="/dashboard" />
        </div>
        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
          <NavItems />
        </div>
        <div className="border-t border-border p-3">
          <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <GitPullRequest className="size-3" aria-hidden="true" />
            AI changes always open a pull request
          </p>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-64 border-r border-border bg-card p-3 shadow-panel animate-fade-in">
            <div className="mb-3 flex items-center justify-between">
              <Wordmark to="/dashboard" />
              <Button variant="ghost" size="icon-sm" onClick={() => setDrawerOpen(false)} aria-label="Close navigation">
                <X aria-hidden="true" />
              </Button>
            </div>
            <NavItems onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onOpenNav={() => setDrawerOpen(true)}
          menuButton={
            <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
              <Menu aria-hidden="true" />
            </Button>
          }
        />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
