import { ArrowRight, FileCode2, Database, Cpu, GitBranch } from 'lucide-react';

/**
 * Schematic of the real pipeline — a diagram, not a fake product screenshot.
 * Mirrors exactly what the backend does for one question.
 */
export function PipelineDiagram() {
  const nodes = [
    { icon: FileCode2, title: 'Repository', lines: ['GitHub tree', 'filtered source files'] },
    { icon: Cpu, title: 'Analysis', lines: ['AST symbols + calls', 'symbol-aware chunks'] },
    { icon: Database, title: 'Storage', lines: ['Qdrant vectors', 'Mongo graph'] },
    { icon: GitBranch, title: 'Answer / patch', lines: ['cited files + lines', 'branch → commit → PR'] },
  ];

  return (
    <div className="rounded-xl border border-border bg-card/80 p-4 shadow-panel sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Request pipeline</p>
        <span className="font-mono text-2xs text-muted-foreground">index → retrieve → ground → apply</span>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {nodes.map(({ icon: Icon, title, lines }, index) => (
          <li key={title} className="relative rounded-lg border border-border bg-surface/70 p-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md border border-border bg-card">
                <Icon className="size-3.5 text-primary" aria-hidden="true" />
              </span>
              <p className="text-xs font-semibold">{title}</p>
            </div>
            <ul className="mt-2 space-y-0.5">
              {lines.map((line) => (
                <li key={line} className="font-mono text-2xs text-muted-foreground">
                  {line}
                </li>
              ))}
            </ul>
            {index < nodes.length - 1 ? (
              <ArrowRight
                className="absolute -right-[13px] top-1/2 hidden size-4 -translate-y-1/2 text-border lg:block"
                aria-hidden="true"
              />
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-4 rounded-lg border border-border bg-background/60 p-3">
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Answer shape</p>
        <pre className="mt-2 overflow-x-auto font-mono text-2xs leading-relaxed text-muted-foreground">
{`Authentication starts in src/middlewares/auth.js:6-21
  └─ verifyCallback  →  src/services/token.service.js:12-30
  └─ route guard     →  src/routes/v1/user.route.js:9-14

sources: 3 files · retrieval: 12 chunks · repository-scoped`}
        </pre>
      </div>
    </div>
  );
}
