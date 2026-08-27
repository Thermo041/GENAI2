import { Fragment } from 'react';

const CITATION_RE = /((?:[\w.\-@]+\/)*[\w.\-]+\.[A-Za-z][\w]*):(\d+)(?:\s*[-–]\s*(\d+))?/g;

/** Turns `src/a.js:10-20` mentions inside AI text into clickable citations. */
function linkifyCitations(text, onOpenFile, keyPrefix) {
  if (!onOpenFile) return text;
  const parts = [];
  let lastIndex = 0;
  let match;
  CITATION_RE.lastIndex = 0;

  while ((match = CITATION_RE.exec(text)) !== null) {
    const [full, path, start, end] = match;
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <button
        key={`${keyPrefix}-cite-${match.index}`}
        type="button"
        onClick={() => onOpenFile({ path, startLine: Number(start), endLine: Number(end || start) })}
        className="rounded bg-primary/10 px-1 py-0.5 font-mono text-[0.75rem] text-primary underline-offset-2 transition-colors hover:bg-primary/20 hover:underline"
      >
        {full}
      </button>,
    );
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length ? parts : text;
}

function renderInline(text, onOpenFile, keyPrefix) {
  // Order matters: code spans first so their contents are not styled further.
  const segments = String(text).split(/(`[^`]+`)/g);
  return segments.map((segment, index) => {
    const key = `${keyPrefix}-i${index}`;
    if (segment.startsWith('`') && segment.endsWith('`') && segment.length > 2) {
      const inner = segment.slice(1, -1);
      const cited = linkifyCitations(inner, onOpenFile, key);
      return <code key={key}>{cited}</code>;
    }
    const bolded = segment.split(/(\*\*[^*]+\*\*)/g).map((piece, pieceIndex) => {
      const pieceKey = `${key}-b${pieceIndex}`;
      if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
        return <strong key={pieceKey}>{linkifyCitations(piece.slice(2, -2), onOpenFile, pieceKey)}</strong>;
      }
      return <Fragment key={pieceKey}>{linkifyCitations(piece, onOpenFile, pieceKey)}</Fragment>;
    });
    return <Fragment key={key}>{bolded}</Fragment>;
  });
}

/**
 * Deliberately small markdown renderer for AI answers: headings, paragraphs,
 * lists, fenced code and inline code. No HTML is ever injected, so model output
 * cannot inject markup into the page.
 */
export function AiMarkdown({ text, onOpenFile, className }) {
  const blocks = [];
  const lines = String(text || '').split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre key={`code-${blocks.length}`} data-language={language}>
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(3, heading[1].length);
      const Tag = `h${level}`;
      blocks.push(<Tag key={`h-${blocks.length}`}>{renderInline(heading[2], onOpenFile, `h${blocks.length}`)}</Tag>);
      index += 1;
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    const orderedMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bulletMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch);
      const items = [];
      while (index < lines.length) {
        const current = lines[index];
        const bullet = current.match(/^\s*[-*+]\s+(.*)$/);
        const numbered = current.match(/^\s*\d+[.)]\s+(.*)$/);
        if (ordered ? !numbered : !bullet) break;
        items.push((ordered ? numbered : bullet)[1]);
        index += 1;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={`list-${blocks.length}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, onOpenFile, `l${blocks.length}-${itemIndex}`)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[index]) && !lines[index].trim().startsWith('```') && !/^#{1,4}\s/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(paragraph.join(' '), onOpenFile, `p${blocks.length}`)}</p>);
  }

  return <div className={`ai-prose ${className || ''}`}>{blocks}</div>;
}
