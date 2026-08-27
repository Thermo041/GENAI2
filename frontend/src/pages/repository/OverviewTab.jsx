import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Boxes, Database, FileCode2, Layers, RefreshCw, Route, Sparkles, TestTube2 } from 'lucide-react';
import { repoApi } from '../../services/endpoints.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useRepository } from '../../context/RepositoryContext.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, SectionHeader } from '../../components/ui/card.jsx';
import { Badge, Mono } from '../../components/ui/primitives.jsx';
import { Alert, EmptyState, ErrorState, LoadingLines, StatTile } from '../../components/ui/feedback.jsx';
import { AiMarkdown } from '../../components/ai/AiMarkdown.jsx';
import { formatNumber } from '../../lib/utils.js';

export default function OverviewTab() {
  const { owner, repo, indexed, startIndexing, isIndexing, repository } = useRepository();
  const overview = useAsync(() => repoApi.overview(owner, repo), [owner, repo], { immediate: indexed, cacheKey: `overview:${owner}/${repo}` });

  // The narrative is a separate, slower call (Groq). Facts render immediately;
  // this only ever gates the summary card.
  const [narrative, setNarrative] = useState(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrativeError, setNarrativeError] = useState(null);
  const requestedFor = useRef('');

  const generate = async (refresh = false) => {
    setNarrativeLoading(true);
    setNarrativeError(null);
    try {
      const data = await repoApi.generateOverview(owner, repo, refresh);
      setNarrative(data.overview);
      if (refresh) toast.success('Overview regenerated');
    } catch (error) {
      setNarrativeError(error);
      if (refresh) toast.error(error.message);
    } finally {
      setNarrativeLoading(false);
    }
  };

  useEffect(() => {
    const data = overview.data;
    if (!data) return;
    if (data.overview) setNarrative(data.overview);
    // Generate once per repository when no summary is cached yet.
    const key = `${owner}/${repo}`;
    if (!data.overview && data.narrativeStatus === 'missing' && requestedFor.current !== key) {
      requestedFor.current = key;
      generate(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview.data, owner, repo]);

  if (!indexed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={Sparkles}
          title="Index this repository to see its overview"
          description="CodeWeave computes deterministic facts from the parsed code — languages, entry points, routes, frameworks — then narrates them."
          action={
            <Button size="sm" loading={isIndexing} onClick={() => startIndexing({})}>
              Index repository
            </Button>
          }
        />
      </div>
    );
  }

  const facts = overview.data?.facts;

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6">
      <SectionHeader
        title="Repository overview"
        description={
          narrativeLoading
            ? 'Facts are from the current index; generating the AI summary…'
            : overview.data?.cached
              ? 'Cached for the indexed commit'
              : 'Generated from the current index'
        }
        actions={
          <Button size="xs" variant="outline" loading={narrativeLoading} onClick={() => generate(true)}>
            <RefreshCw aria-hidden="true" />
            Regenerate
          </Button>
        }
      />

      {overview.error ? <ErrorState error={overview.error} onRetry={overview.refresh} /> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Indexed files" value={formatNumber(facts?.fileCount ?? repository?.index?.stats?.filesIndexed ?? 0)} icon={FileCode2} />
        <StatTile label="Lines of code" value={formatNumber(facts?.totalLines ?? 0)} icon={Layers} />
        <StatTile label="Symbols" value={formatNumber(facts?.symbolCount ?? 0)} icon={Boxes} tone="primary" />
        <StatTile label="Graph edges" value={formatNumber(facts?.edgeCount ?? 0)} icon={Database} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>What this project is</CardTitle>
          </CardHeader>
          <CardContent>
            {narrative?.summary ? (
              <>
                <AiMarkdown text={narrative.summary} />
                {narrative.architecture ? (
                  <>
                    <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Architecture</h3>
                    <AiMarkdown text={narrative.architecture} />
                  </>
                ) : null}
              </>
            ) : narrativeLoading ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Reading representative code and writing the summary…</p>
                <LoadingLines lines={5} />
              </div>
            ) : narrativeError ? (
              <ErrorState
                error={narrativeError}
                title="Could not generate the summary"
                onRetry={() => generate(false)}
              />
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">No AI summary yet. The facts below come straight from the index.</p>
                <Button size="xs" onClick={() => generate(false)}>
                  Generate summary
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Languages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {overview.loading && !facts ? (
                <LoadingLines lines={4} />
              ) : facts?.languages?.length ? (
                facts.languages.slice(0, 8).map((language) => (
                  <div key={language.language} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{language.language}</span>
                    <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                      {language.files} files · {formatNumber(language.lines)} lines
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No language data.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Detected stack</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Frameworks</p>
                <div className="flex flex-wrap gap-1.5">
                  {narrative?.frameworks?.length ? (
                    narrative.frameworks.map((framework) => (
                      <Badge key={framework} variant="primary">
                        {framework}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-2xs text-muted-foreground">None detected in manifests.</span>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Data stores</p>
                <div className="flex flex-wrap gap-1.5">
                  {narrative?.databases?.length ? (
                    narrative.databases.map((database) => (
                      <Badge key={database} variant="outline">
                        {database}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-2xs text-muted-foreground">None detected.</span>
                  )}
                </div>
              </div>
              {facts?.manifests?.length ? (
                <div>
                  <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Manifests</p>
                  <div className="flex flex-wrap gap-1.5">
                    {facts.manifests.map((manifest) => (
                      <Mono key={manifest} className="rounded border border-border bg-surface px-1.5 py-0.5 text-2xs">
                        {manifest}
                      </Mono>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Entry points &amp; key directories</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {narrative?.entryPoints?.length ? (
              <div className="space-y-1">
                {narrative.entryPoints.map((entry) => (
                  <Mono key={entry} className="block truncate rounded border border-border bg-surface px-2 py-1">
                    {entry}
                  </Mono>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No obvious entry point detected.</p>
            )}

            {narrative?.importantDirectories?.length ? (
              <ul className="space-y-1.5 border-t border-border pt-3">
                {narrative.importantDirectories.map((directory) => (
                  <li key={directory.path} className="text-xs">
                    <Mono className="text-primary">{directory.path}</Mono>
                    <span className="ml-1.5 text-muted-foreground">{directory.purpose}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Route className="size-3.5 text-muted-foreground" aria-hidden="true" />
              Detected HTTP routes
              {facts?.routeCount ? <Badge variant="muted">{facts.routeCount}</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {facts?.routes?.length ? (
              <ul className="max-h-64 space-y-1 overflow-y-auto scrollbar-thin">
                {facts.routes.slice(0, 40).map((route, index) => (
                  <li key={`${route.method}-${route.path}-${index}`} className="flex items-center gap-2 text-2xs">
                    <Badge variant={route.method === 'GET' ? 'outline' : 'primary'} className="w-14 justify-center">
                      {route.method}
                    </Badge>
                    <Mono className="truncate">{route.path}</Mono>
                    <span className="truncate text-muted-foreground">→ {route.handler || 'inline'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No HTTP routes were detected by the AST parser.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {facts?.testFileCount === 0 ? (
        <Alert variant="warning" title="No test files detected" icon={TestTube2}>
          CodeWeave found no test files in the indexed set. Impact analysis will flag missing coverage for changes here.
        </Alert>
      ) : null}
    </div>
  );
}
