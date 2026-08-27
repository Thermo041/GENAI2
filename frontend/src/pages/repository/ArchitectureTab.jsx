import { useMemo } from 'react';
import { Boxes, GitBranch } from 'lucide-react';
import { useRepository } from '../../context/RepositoryContext.jsx';
import { repoApi } from '../../services/endpoints.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Button } from '../../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.jsx';
import { Badge, Mono } from '../../components/ui/primitives.jsx';
import { EmptyState, ErrorState, LoadingLines, StatTile } from '../../components/ui/feedback.jsx';
import { formatNumber } from '../../lib/utils.js';

const WIDTH = 900;
const NODE_WIDTH = 190;
const NODE_HEIGHT = 46;
const V_GAP = 16;

/**
 * Layered dependency view built from real import edges, aggregated to directory
 * level. Modules with no incoming edges sit on the left (entry points), modules
 * nothing imports sit on the right (leaves), everything else in the middle.
 */
function layout(nodes, links) {
  const inDegree = new Map();
  const outDegree = new Map();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    outDegree.set(node.id, 0);
  }
  for (const link of links) {
    if (!inDegree.has(link.target) || !outDegree.has(link.source)) continue;
    inDegree.set(link.target, inDegree.get(link.target) + link.weight);
    outDegree.set(link.source, outDegree.get(link.source) + link.weight);
  }

  const columns = [[], [], []];
  for (const node of nodes) {
    const incoming = inDegree.get(node.id) || 0;
    const outgoing = outDegree.get(node.id) || 0;
    const column = incoming === 0 && outgoing > 0 ? 0 : outgoing === 0 ? 2 : 1;
    columns[column].push({ ...node, incoming, outgoing });
  }

  const positioned = new Map();
  const columnX = [40, (WIDTH - NODE_WIDTH) / 2, WIDTH - NODE_WIDTH - 40];
  let maxHeight = 0;

  columns.forEach((column, columnIndex) => {
    const sorted = column.sort((a, b) => b.files - a.files).slice(0, 12);
    const height = sorted.length * (NODE_HEIGHT + V_GAP);
    maxHeight = Math.max(maxHeight, height);
    sorted.forEach((node, index) => {
      positioned.set(node.id, { ...node, x: columnX[columnIndex], y: 30 + index * (NODE_HEIGHT + V_GAP), column: columnIndex });
    });
  });

  const visibleLinks = links
    .filter((link) => positioned.has(link.source) && positioned.has(link.target))
    .slice(0, 80);

  return { positioned, visibleLinks, height: Math.max(260, maxHeight + 60) };
}

export default function ArchitectureTab() {
  const { owner, repo, indexed, startIndexing, isIndexing } = useRepository();
  const { data, error, loading, refresh } = useAsync(() => repoApi.graph(owner, repo), [owner, repo], { immediate: indexed, cacheKey: `graph:${owner}/${repo}` });

  const graph = useMemo(() => {
    if (!data?.nodes?.length) return null;
    return layout(data.nodes, data.links || []);
  }, [data]);

  if (!indexed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={Boxes}
          title="Index this repository to see its architecture"
          description="The graph is aggregated from the import edges the AST parser resolved — it is not a generic diagram."
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
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Modules" value={formatNumber(data?.nodes?.length ?? 0)} icon={Boxes} />
        <StatTile label="Indexed files" value={formatNumber(data?.fileCount ?? 0)} />
        <StatTile label="Import edges" value={formatNumber(data?.edgeCount ?? 0)} icon={GitBranch} tone="primary" />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Module dependency graph</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingLines lines={8} />
          ) : error ? (
            <ErrorState error={error} onRetry={refresh} />
          ) : !graph ? (
            <p className="text-xs text-muted-foreground">No internal import edges were resolved in this repository.</p>
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <svg
                viewBox={`0 0 ${WIDTH} ${graph.height}`}
                className="h-auto w-full min-w-[42rem]"
                role="img"
                aria-label="Directory-level dependency graph"
              >
                <defs>
                  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--muted-foreground))" opacity="0.55" />
                  </marker>
                </defs>

                {graph.visibleLinks.map((link) => {
                  const from = graph.positioned.get(link.source);
                  const to = graph.positioned.get(link.target);
                  const x1 = from.x + NODE_WIDTH;
                  const y1 = from.y + NODE_HEIGHT / 2;
                  const x2 = to.x;
                  const y2 = to.y + NODE_HEIGHT / 2;
                  const midX = (x1 + x2) / 2;
                  const sameColumn = from.column === to.column;
                  const path = sameColumn
                    ? `M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`
                    : `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
                  return (
                    <path
                      key={`${link.source}->${link.target}`}
                      d={path}
                      fill="none"
                      stroke="hsl(var(--muted-foreground))"
                      strokeOpacity={Math.min(0.5, 0.15 + link.weight * 0.05)}
                      strokeWidth={Math.min(3, 0.8 + link.weight * 0.25)}
                      markerEnd="url(#arrow)"
                    />
                  );
                })}

                {[...graph.positioned.values()].map((node) => (
                  <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                    <rect
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx="6"
                      fill="hsl(var(--card))"
                      stroke={node.routes > 0 ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
                      strokeWidth={node.routes > 0 ? 1.5 : 1}
                    />
                    <text x="10" y="19" fontSize="11" fontFamily="JetBrains Mono, monospace" fill="hsl(var(--foreground))">
                      {node.id.length > 24 ? `${node.id.slice(0, 23)}…` : node.id}
                    </text>
                    <text x="10" y="34" fontSize="9.5" fill="hsl(var(--muted-foreground))">
                      {node.files} files · {node.symbols} symbols
                      {node.routes ? ` · ${node.routes} routes` : ''}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-2xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-5 rounded border border-primary" aria-hidden="true" /> exposes HTTP routes
            </span>
            <span>left: nothing imports it (entry points) · right: imports nothing internal (leaves)</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Strongest dependencies</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.links?.length ? (
            <ul className="space-y-1">
              {data.links.slice(0, 15).map((link) => (
                <li key={`${link.source}=>${link.target}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Mono className="truncate">{link.source}</Mono>
                    <span className="text-muted-foreground">→</span>
                    <Mono className="truncate">{link.target}</Mono>
                  </span>
                  <Badge variant="muted">{link.weight} imports</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No import edges to rank.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
