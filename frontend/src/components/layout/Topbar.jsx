import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, LogOut, Moon, Plus, Sun, User as UserIcon, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import { repoApi } from '../../services/endpoints.js';
import { Button } from '../ui/button.jsx';
import { Input } from '../ui/primitives.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '../ui/overlays.jsx';

export function Topbar({ menuButton }) {
  const { user, logout, reconnectNeeded, login, installUrl, hasInstallation } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);

  const analyze = async (event) => {
    event.preventDefault();
    const value = url.trim();
    if (!value) return;
    setAnalyzing(true);
    try {
      const data = await repoApi.analyze(value);
      const repository = data.repository;
      toast.success(`Opened ${repository.fullName}`, {
        description: repository.access.canWrite ? 'Read & write access' : 'Read-only — fork flow available',
      });
      setUrl('');
      navigate(`/r/${repository.owner}/${repository.name}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-3 backdrop-blur sm:px-4">
      {menuButton}

      <form onSubmit={analyze} className="flex min-w-0 flex-1 items-center gap-2">
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Analyze any GitHub repository — owner/repo or https://github.com/owner/repo"
          aria-label="Analyze a GitHub repository"
          className="h-8 max-w-xl text-xs"
          spellCheck={false}
        />
        <Button type="submit" size="sm" loading={analyzing} disabled={!url.trim()}>
          <Plus aria-hidden="true" />
          <span className="hidden sm:inline">Analyze</span>
        </Button>
      </form>

      {reconnectNeeded ? (
        <Button size="sm" variant="destructive" onClick={() => login(window.location.pathname)}>
          <ShieldAlert aria-hidden="true" />
          Reconnect GitHub
        </Button>
      ) : null}

      {!hasInstallation && installUrl ? (
        <Tooltip content="Install the CodeWeave GitHub App to index private repositories and open pull requests">
          <Button size="sm" variant="outline" asChild>
            <a href={installUrl} target="_blank" rel="noreferrer noopener">
              Install app
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        </Tooltip>
      ) : null}

      <Tooltip content={isDark ? 'Switch to light theme' : 'Switch to dark theme'}>
        <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label="Toggle theme">
          {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-md border border-border bg-card px-1.5 py-1 text-xs transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Account menu"
          >
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="size-5 rounded-full" />
            ) : (
              <UserIcon className="size-4" aria-hidden="true" />
            )}
            <span className="hidden max-w-24 truncate sm:inline">{user?.login}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>{user?.name || user?.login}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href={user?.profileUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink aria-hidden="true" />
              GitHub profile
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings">
              <UserIcon aria-hidden="true" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={logout} className="text-destructive focus:text-destructive">
            <LogOut aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
