import { Link } from 'react-router-dom';
import { GitCompare, RefreshCw } from 'lucide-react';
import { changeApi } from '../services/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader } from '../components/ui/card.jsx';
import { EmptyState, ErrorState, LoadingRows } from '../components/ui/feedback.jsx';
import { ActivityFeed } from '../components/activity/ActivityFeed.jsx';

export default function Changes() {
  const { data, error, loading, refresh } = useAsync(() => changeApi.list(), [], { cacheKey: 'changes:all' });
  const changes = (data?.changes || []).map((change) => ({ ...change, files: change.files?.length ?? 0 }));

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <SectionHeader
        title="AI changes"
        description="Every patch CodeWeave proposed for you, and what happened to it"
        icon={GitCompare}
        actions={
          <Button size="xs" variant="ghost" onClick={refresh} disabled={loading}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {loading ? (
        <LoadingRows rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : changes.length === 0 ? (
        <EmptyState
          icon={GitCompare}
          title="No AI changes yet"
          description="Open a repository, describe the change you want, and review the diff before anything reaches GitHub."
          action={
            <Button size="sm" variant="outline" asChild>
              <Link to="/repositories">Pick a repository</Link>
            </Button>
          }
        />
      ) : (
        <ActivityFeed items={changes} kind="changes" />
      )}
    </div>
  );
}
