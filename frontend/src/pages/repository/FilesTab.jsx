import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, FileCode2, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import { repoApi } from '../../services/endpoints.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useRepository } from '../../context/RepositoryContext.jsx';
import { FileExplorer } from '../../components/repository/FileExplorer.jsx';
import { CodeViewer } from '../../components/code/CodeViewer.jsx';
import { ChatPanel } from '../../components/ai/ChatPanel.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Badge, Mono, Skeleton } from '../../components/ui/primitives.jsx';
import { EmptyState, ErrorState } from '../../components/ui/feedback.jsx';
import { cn, formatNumber } from '../../lib/utils.js';

export default function FilesTab() {
  const { owner, repo, repository, branch, openFile, setOpenFile } = useRepository();
  const [selected, setSelected] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(true);

  const tree = useAsync(() => repoApi.tree(owner, repo, branch), [owner, repo, branch], { cacheKey: `tree:${owner}/${repo}@${branch}` });

  const load = useCallback(
    async (path, lines) => {
      setSelected(path);
      setLoadingFile(true);
      setFileError(null);
      try {
        const data = await repoApi.file(owner, repo, path, branch);
        setFile(data.file);
        setHighlight(lines || null);
        return data;
      } catch (error) {
        setFileError(error);
        setFile(null);
        return null;
      } finally {
        setLoadingFile(false);
      }
    },
    [owner, repo, branch],
  );

  // Citations from the assistant open the file here at the right line.
  useEffect(() => {
    if (!openFile?.path) return;
    if (openFile.path === selected) {
      setHighlight({ startLine: openFile.startLine, endLine: openFile.endLine });
    } else {
      load(openFile.path, { startLine: openFile.startLine, endLine: openFile.endLine });
    }
    setOpenFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFile]);

  const openFromChat = (target) => {
    setAssistantOpen(true);
    if (target.path === selected) setHighlight({ startLine: target.startLine, endLine: target.endLine });
    else load(target.path, { startLine: target.startLine, endLine: target.endLine });
  };

  const files = tree.data?.files || [];
  const symbols = file ? tree.data?.files?.find((f) => f.path === file.path) : null;

  return (
    <div className="flex h-[calc(100vh-3.5rem-9.5rem)] min-h-[32rem] border-t border-border">
      {/* Explorer */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface/40 md:flex">
        {tree.loading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 10 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : tree.error ? (
          <div className="p-3">
            <ErrorState error={tree.error} onRetry={tree.refresh} title="Cannot list files" />
          </div>
        ) : (
          <FileExplorer
            files={files}
            activePath={selected}
            truncated={tree.data?.truncated}
            onSelect={(entry) => load(entry.path)}
            className="flex-1"
          />
        )}
      </aside>

      {/* Editor */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 items-center justify-between gap-2 border-b border-border bg-card px-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Mono className="truncate">{selected || 'No file selected'}</Mono>
            {file ? <Badge variant="muted">{formatNumber(file.lines)} lines</Badge> : null}
            {symbols?.symbols ? <Badge variant="outline">{symbols.symbols} symbols indexed</Badge> : null}
          </div>
          <div className="flex items-center gap-1">
            {selected ? (
              <Button size="icon-sm" variant="ghost" asChild>
                <a
                  href={`${repository?.url}/blob/${branch}/${selected}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Open on GitHub"
                >
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            ) : null}
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setAssistantOpen((open) => !open)}
              aria-label={assistantOpen ? 'Hide AI assistant' : 'Show AI assistant'}
              className="hidden lg:inline-flex"
            >
              {assistantOpen ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 bg-card">
          {loadingFile ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 14 }).map((_, index) => (
                <Skeleton key={index} className={cn('h-3', index % 4 === 3 ? 'w-1/2' : 'w-full')} />
              ))}
            </div>
          ) : fileError ? (
            <div className="p-4">
              <ErrorState error={fileError} onRetry={() => load(selected)} title="Cannot open this file" />
            </div>
          ) : file?.binary ? (
            <EmptyState className="m-4" icon={FileCode2} title="Binary file" description="CodeWeave does not render binary content." />
          ) : file ? (
            <CodeViewer path={file.path} content={file.content} highlight={highlight} />
          ) : (
            <EmptyState
              className="m-4"
              icon={FileCode2}
              title="Pick a file to read it"
              description="Indexed files are marked with a dot. Citations from the assistant open here at the exact line."
            />
          )}
        </div>
      </section>

      {/* Assistant */}
      {assistantOpen ? (
        <aside className="hidden w-[24rem] shrink-0 flex-col border-l border-border bg-surface/30 lg:flex">
          <div className="flex h-9 items-center gap-2 border-b border-border px-3">
            <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
            <p className="text-xs font-medium">AI assistant</p>
          </div>
          <ChatPanel className="flex-1" compact onOpenFile={openFromChat} />
        </aside>
      ) : null}
    </div>
  );
}
