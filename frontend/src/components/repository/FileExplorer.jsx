import { useMemo, useState } from 'react';
import { ChevronRight, File, FileCode2, Folder, FolderOpen, Search, X } from 'lucide-react';
import { cn, fileExtension } from '../../lib/utils.js';
import { Input } from '../ui/primitives.jsx';
import { Button } from '../ui/button.jsx';

/** Builds a nested tree from the flat path list the API returns. */
function buildTree(files) {
  const root = { name: '', path: '', type: 'dir', children: new Map() };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    parts.forEach((part, index) => {
      const isLeaf = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join('/');
      if (isLeaf) {
        node.children.set(part, { ...file, name: part, path, type: 'file' });
        return;
      }
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path, type: 'dir', children: new Map() });
      }
      node = node.children.get(part);
    });
  }
  return root;
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const INDEXED_DOT = 'after:absolute after:right-1.5 after:top-1/2 after:size-1 after:-translate-y-1/2 after:rounded-full after:bg-primary/70';

function TreeNode({ node, depth, activePath, onSelect, expanded, toggle }) {
  const entries = useMemo(() => sortEntries([...node.children.values()]), [node]);

  return (
    <ul className={depth === 0 ? 'space-y-px' : 'space-y-px'}>
      {entries.map((entry) => {
        if (entry.type === 'dir') {
          const isOpen = expanded.has(entry.path);
          return (
            <li key={entry.path}>
              <button
                type="button"
                onClick={() => toggle(entry.path)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ paddingLeft: `${depth * 10 + 6}px` }}
              >
                <ChevronRight className={cn('size-3 shrink-0 transition-transform', isOpen && 'rotate-90')} aria-hidden="true" />
                {isOpen ? <FolderOpen className="size-3.5 shrink-0" aria-hidden="true" /> : <Folder className="size-3.5 shrink-0" aria-hidden="true" />}
                <span className="truncate">{entry.name}</span>
              </button>
              {isOpen ? (
                <TreeNode node={entry} depth={depth + 1} activePath={activePath} onSelect={onSelect} expanded={expanded} toggle={toggle} />
              ) : null}
            </li>
          );
        }

        const isActive = activePath === entry.path;
        return (
          <li key={entry.path}>
            <button
              type="button"
              onClick={() => onSelect(entry)}
              aria-current={isActive ? 'true' : undefined}
              title={entry.indexed ? `${entry.path} · ${entry.symbols} symbols indexed` : entry.path}
              className={cn(
                'relative flex w-full items-center gap-1.5 rounded px-1.5 py-1 pr-4 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                entry.indexed && INDEXED_DOT,
              )}
              style={{ paddingLeft: `${depth * 10 + 22}px` }}
            >
              {fileExtension(entry.path) ? <FileCode2 className="size-3.5 shrink-0" aria-hidden="true" /> : <File className="size-3.5 shrink-0" aria-hidden="true" />}
              <span className="truncate">{entry.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function FileExplorer({ files = [], activePath, onSelect, className, truncated }) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => new Set(['src', 'src/controllers', 'src/services', 'app', 'lib', 'backend', 'frontend']));

  const filtered = useMemo(() => {
    if (!query.trim()) return files;
    const needle = query.trim().toLowerCase();
    return files.filter((file) => file.path.toLowerCase().includes(needle));
  }, [files, query]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);

  const toggle = (path) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // While searching, show a flat result list — faster to scan than a deep tree.
  const searching = query.trim().length > 0;

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="relative border-b border-border p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a file…"
          aria-label="Find a file"
          className="h-7 pl-7 pr-7 text-xs"
          spellCheck={false}
        />
        {query ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-2.5 top-1/2 -translate-y-1/2"
            onClick={() => setQuery('')}
            aria-label="Clear file filter"
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 scrollbar-thin">
        {filtered.length === 0 ? (
          <p className="p-3 text-2xs text-muted-foreground">No files match “{query}”.</p>
        ) : searching ? (
          <ul className="space-y-px">
            {filtered.slice(0, 200).map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => onSelect(file)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors',
                    activePath === file.path ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                  )}
                >
                  <FileCode2 className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{file.path}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <TreeNode node={tree} depth={0} activePath={activePath} onSelect={onSelect} expanded={expanded} toggle={toggle} />
        )}
      </div>

      <div className="border-t border-border px-2.5 py-1.5 text-2xs text-muted-foreground">
        {files.length} files{truncated ? ' · tree truncated by GitHub' : ''}
        <span className="ml-1.5 inline-flex items-center gap-1">
          <span className="size-1 rounded-full bg-primary/70" aria-hidden="true" /> indexed
        </span>
      </div>
    </div>
  );
}
