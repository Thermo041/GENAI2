import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, Radar, Route, Search, TestTube2, Boxes } from 'lucide-react';
import { aiApi, repoApi } from '../../services/endpoints.js';
import { useDebouncedValue } from '../../hooks/useAsync.js';
import { useRepository } from '../../context/RepositoryContext.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.jsx';
import { Badge, Input, Mono, Skeleton } from '../../components/ui/primitives.jsx';
import { Alert, EmptyState, StatTile } from '../../components/ui/feedback.jsx';
import { AiMarkdown } from '../../components/ai/AiMarkdown.jsx';
import { useEffect } from 'react';

const SEVERITY = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'muted' };

export default function ImpactTab() {
  const { owner, repo, indexed, startIndexing, isIndexing, setOpenFile } = useRepository();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [symbols, setSymbols] = useState([]);
  const [searching, setSearching] = useState(false);
  const [impact, setImpact] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [target, setTarget] = useState(null);
  const debounced = useDebouncedValue(query, 250);

  useEffect(() => {
    if (!indexed || debounced.trim().length < 2) {
      setSymbols([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    repoApi
      .symbols(owner, repo, debounced.trim())
      .then((data) => !cancelled && setSymbols(data.symbols || []))
      .catch(() => {})
      .finally(() => !cancelled && setSearching(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, owner, repo, indexed]);

  const analyze = async (symbol) => {
    setAnalyzing(true);
    setTarget(symbol);
    setImpact(null);
    try {
      const data = await aiApi.impact({ owner, repo, symbol: symbol.name, filePath: symbol.filePath });
      setImpact(data.impact);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const openFile = (path, startLine, endLine) => {
    setOpenFile({ path, startLine, endLine });
    navigate('../files', { relative: 'path' });
  };

  if (!indexed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={Radar}
          title="Impact analysis needs an index"
          description="CodeWeave walks the AST-derived graph of imports, calls, routes and tests — that graph is built during indexing."
          action={
            <Button size="sm" loading={isIndexing} onClick={() => startIndexing({})}>
              Index repository
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[20rem_1fr]">
      <aside className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle>Find a symbol</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="processPayment, UserService…"
                aria-label="Search symbols"
                className="pl-8 text-xs"
                spellCheck={false}
              />
            </div>
            {searching ? (
              <div className="space-y-1.5">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-8 w-full" />
                ))}
              </div>
            ) : symbols.length ? (
              <ul className="max-h-[26rem] space-y-1 overflow-y-auto scrollbar-thin">
                {symbols.map((symbol) => (
                  <li key={`${symbol.filePath}:${symbol.startLine}:${symbol.name}`}>
                    <button
                      type="button"
                      onClick={() => analyze(symbol)}
                      className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-left transition-colors hover:border-primary/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Mono className="truncate text-xs text-foreground">{symbol.name}</Mono>
                        <Badge variant="outline">{symbol.kind}</Badge>
                      </div>
                      <p className="truncate text-2xs text-muted-foreground">
                        {symbol.filePath}:{symbol.startLine}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            ) : query.trim().length >= 2 ? (
              <p className="text-2xs text-muted-foreground">No indexed symbol matches “{query}”.</p>
            ) : (
              <p className="text-2xs text-muted-foreground">
                Search the symbols extracted by the AST parser, then run impact analysis on one.
              </p>
            )}
          </CardContent>
        </Card>
      </aside>

      <section className="min-w-0 space-y-4">
        {analyzing ? (
          <Card>
            <CardContent className="space-y-3 pt-4">
              <p className="text-xs text-muted-foreground">Walking the dependency graph and retrieving related code…</p>
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ) : null}

        {!analyzing && !impact ? (
          <EmptyState
            icon={Radar}
            title="Pick a symbol to see its blast radius"
            description="You get direct callers, importing modules, exposed routes and test coverage — from the parsed graph, not a guess."
          />
        ) : null}

        {impact ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Mono className="text-base">{impact.symbol}</Mono>
                  <Badge variant={SEVERITY[impact.riskLevel]}>{impact.riskLevel} risk</Badge>
                </h2>
                {impact.definitions?.[0] ? (
                  <button
                    type="button"
                    onClick={() => openFile(impact.definitions[0].filePath, impact.definitions[0].startLine, impact.definitions[0].endLine)}
                    className="mt-1 font-mono text-2xs text-primary hover:underline"
                  >
                    {impact.definitions[0].filePath}:{impact.definitions[0].startLine}-{impact.definitions[0].endLine}
                  </button>
                ) : null}
              </div>
            </div>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Direct callers" value={impact.counts.directCallers} tone={impact.counts.directCallers ? 'danger' : 'default'} />
              <StatTile label="Importing modules" value={impact.counts.importers} />
              <StatTile label="Routes exposed" value={impact.counts.routes} icon={Route} tone={impact.counts.routes ? 'warning' : 'default'} />
              <StatTile label="Test files" value={impact.counts.tests} icon={TestTube2} tone={impact.counts.tests ? 'success' : 'warning'} />
            </section>

            {impact.counts.tests === 0 ? (
              <Alert variant="warning" title="No test file references this symbol" icon={AlertTriangle}>
                A change here is not covered by the indexed tests.
              </Alert>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Affected files</CardTitle>
              </CardHeader>
              <CardContent>
                {impact.impacts.length ? (
                  <ul className="divide-y divide-border">
                    {impact.impacts.map((item) => (
                      <li key={item.filePath} className="flex flex-wrap items-start gap-2 py-2">
                        <Badge variant={SEVERITY[item.severity]} className="mt-0.5 w-16 justify-center">
                          {item.severity}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => openFile(item.filePath)}
                            className="truncate font-mono text-xs text-foreground hover:text-primary hover:underline"
                          >
                            {item.filePath}
                          </button>
                          <p className="text-2xs text-muted-foreground">{item.reasons.join(' · ')}</p>
                          {item.details?.length ? (
                            <ul className="mt-0.5 space-y-0.5">
                              {item.details.slice(0, 3).map((detail, index) => (
                                <li key={index} className="font-mono text-2xs text-muted-foreground/80">
                                  {detail}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        {item.isTest ? <Badge variant="muted">test</Badge> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nothing in the indexed graph depends on this symbol. It may be an entry point or dead code.
                  </p>
                )}
              </CardContent>
            </Card>

            {impact.callPaths?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5">
                    <Boxes className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    Call paths from the AST graph
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {impact.callPaths.map((path) => (
                      <li key={path} className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">
                        <ArrowRight className="size-3 shrink-0 text-primary/70" aria-hidden="true" />
                        <span className="truncate">{path}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            {impact.explanation ? (
              <Card>
                <CardHeader>
                  <CardTitle>What could break</CardTitle>
                </CardHeader>
                <CardContent>
                  <AiMarkdown
                    text={impact.explanation}
                    onOpenFile={(target) => openFile(target.path, target.startLine, target.endLine)}
                  />
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
