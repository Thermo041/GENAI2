import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { repoApi } from '../services/endpoints.js';
import { invalidateCache, useAsync } from '../hooks/useAsync.js';
import { useIndexProgress } from '../hooks/useIndexProgress.js';

const RepositoryContext = createContext(null);

export function RepositoryProvider({ children }) {
  const { owner, repo } = useParams();
  const [openFile, setOpenFile] = useState(null); // { path, line }

  const details = useAsync(() => repoApi.details(owner, repo), [owner, repo], { cacheKey: `repo:${owner}/${repo}` });
  const repository = details.data?.repository || null;

  const progress = useIndexProgress(owner, repo, {
    onComplete: async (status) => {
      invalidateCache(`overview:${owner}/${repo}`);
      invalidateCache(`graph:${owner}/${repo}`);
      invalidateCache(`tree:${owner}/${repo}`);
      invalidateCache('repos:');
      await details.refresh();
      if (status?.job?.status === 'completed') {
        toast.success('Repository indexed', { description: status.job.message });
      } else if (status?.job?.status === 'failed') {
        toast.error('Indexing failed', { description: status.job.message });
      }
    },
  });

  const startIndexing = useCallback(
    async ({ force = false, branch } = {}) => {
      try {
        const result = await repoApi.startIndex(owner, repo, { force, ...(branch ? { branch } : {}) });
        if (result.upToDate) {
          toast.info(result.message);
          await details.refresh();
          return result;
        }
        toast.success(result.message);
        progress.watch();
        await details.refresh();
        return result;
      } catch (error) {
        toast.error(error.message);
        throw error;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [owner, repo],
  );

  const indexed = ['indexed', 'partial'].includes(repository?.index?.status);
  const canWrite = Boolean(repository?.access?.canWrite);

  const value = useMemo(
    () => ({
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      repository,
      loading: details.loading,
      error: details.error,
      refresh: details.refresh,
      indexed,
      canWrite,
      branch: repository?.index?.branch || repository?.defaultBranch || 'main',
      job: progress.job,
      indexStatus: progress.status,
      isIndexing: progress.isActive || ['queued', 'indexing'].includes(repository?.index?.status),
      startIndexing,
      openFile,
      setOpenFile,
    }),
    [owner, repo, repository, details.loading, details.error, details.refresh, indexed, canWrite, progress.job, progress.status, progress.isActive, startIndexing, openFile],
  );

  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}

export function useRepository() {
  const context = useContext(RepositoryContext);
  if (!context) throw new Error('useRepository must be used inside RepositoryProvider');
  return context;
}
