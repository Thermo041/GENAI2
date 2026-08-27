import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FolderGit2, RefreshCw, Search } from 'lucide-react';
import { repoApi } from '../services/endpoints.js';
import { useAsync, useDebouncedValue } from '../hooks/useAsync.js';
import { Button } from '../components/ui/button.jsx';
import { Card, SectionHeader } from '../components/ui/card.jsx';
import { Badge, Input, Mono } from '../components/ui/primitives.jsx';
import { EmptyState, ErrorState, LoadingRows } from '../components/ui/feedback.jsx';
import { AccessBadge, IndexBadge, VisibilityBadge } from '../components/repository/Badges.jsx';
import { formatNumber, timeAgo } from '../lib/utils.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'indexed', label: 'Indexed' },
  { id: 'write', label: 'Read & write' },
  { id: 'private', label: 'Private' },
];

export default function Repositories() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [opening, setOpening] = useState('');
  const search = useDebouncedValue(query, 200);
  const { data, error, loading, refresh } = useAsync(() => repoApi.listGithub(), [], { cacheKey: 'repos:github' });

  const repositories = useMemo(() => {
    const list = data?.repositories || [];
    return list.filter((repo) => {
      if (search && !repo.fullName.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === 'indexed') return ['indexed', 'partial'].includes(repo.index?.status);
      if (filter === 'write') return repo.access?.canWrite;
      if (filter === 'private') return repo.visibility === 'private';
      return true;
    });
  }, [data, search, filter]);

  const open = async (repo) => {
    setOpening(repo.fullName);
    try {
      await repoApi.analyze(repo.fullName);
      navigate(`/r/${repo.owner}/${repo.name}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setOpening('');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <SectionHeader
        title="GitHub repositories"
        description="Everything your GitHub account can reach through the CodeWeave app installation"
        icon={FolderGit2}
        actions={
          <Button size="xs" variant="ghost" onClick={refresh} disabled={loading}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name…"
            className="h-8 pl-8 text-xs"
            aria-label="Filter repositories"
          />
        </div>
        <div className="flex gap-1">
          {FILTERS.map((option) => (
            <Button
              key={option.id}
              size="xs"
              variant={filter === option.id ? 'secondary' : 'ghost'}
              onClick={() => setFilter(option.id)}
              aria-pressed={filter === option.id}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingRows rows={6} />
      ) : error ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : repositories.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No repositories match"
          description="Adjust the filter, or install the CodeWeave GitHub App on more accounts and repositories."
        />
      ) : (
        <Card className="divide-y divide-border">
          {repositories.map((repo) => (
            <div key={repo.fullName} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => open(repo)}
                    className="truncate text-xs font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {repo.fullName}
                  </button>
                  <VisibilityBadge visibility={repo.visibility} isFork={repo.isFork} />
                  <AccessBadge access={repo.access} />
                  <IndexBadge status={repo.index?.status} />
                </div>
                <p className="mt-1 line-clamp-1 text-2xs text-muted-foreground">
                  {repo.description || 'No description'}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-2xs text-muted-foreground">
                  {repo.primaryLanguage ? <span>{repo.primaryLanguage}</span> : null}
                  <span>
                    <Mono>{repo.defaultBranch}</Mono>
                  </span>
                  {repo.index?.files ? <span>{formatNumber(repo.index.files)} indexed files</span> : null}
                  {repo.pushedAt ? <span>pushed {timeAgo(repo.pushedAt)}</span> : null}
                  {repo.stars ? <Badge variant="muted">★ {formatNumber(repo.stars)}</Badge> : null}
                </div>
              </div>
              <Button size="xs" variant="secondary" loading={opening === repo.fullName} onClick={() => open(repo)}>
                Open
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
