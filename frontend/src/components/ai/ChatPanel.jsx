import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CornerDownLeft, Loader2, Quote, Sparkles, User } from 'lucide-react';
import { aiApi } from '../../services/endpoints.js';
import { useRepository } from '../../context/RepositoryContext.jsx';
import { Button } from '../ui/button.jsx';
import { Badge, Textarea } from '../ui/primitives.jsx';
import { Alert, EmptyState } from '../ui/feedback.jsx';
import { AiMarkdown } from './AiMarkdown.jsx';
import { cn } from '../../lib/utils.js';

const SUGGESTIONS = [
  'How does authentication work in this codebase?',
  'Where is the database connection configured?',
  'Which files handle incoming HTTP routes?',
  'What does the main entry point do on startup?',
];

function CitationChip({ citation, onOpenFile }) {
  return (
    <button
      type="button"
      onClick={() => onOpenFile?.({ path: citation.filePath, startLine: citation.startLine, endLine: citation.endLine })}
      className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-surface/70 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      title={`Open ${citation.filePath} at line ${citation.startLine}`}
    >
      <Quote className="size-2.5 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {citation.filePath}:{citation.startLine}-{citation.endLine}
      </span>
      {citation.symbolName ? <span className="shrink-0 text-primary/80">{citation.symbolName}</span> : null}
    </button>
  );
}

function Message({ message, onOpenFile }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border',
          isUser ? 'border-border bg-secondary' : 'border-primary/30 bg-primary/15',
        )}
      >
        {isUser ? <User className="size-3" aria-hidden="true" /> : <Sparkles className="size-3 text-primary" aria-hidden="true" />}
      </div>
      <div className={cn('min-w-0 max-w-[92%] space-y-2', isUser && 'text-right')}>
        {isUser ? (
          <p className="inline-block rounded-lg rounded-tr-sm border border-border bg-secondary/60 px-3 py-2 text-left text-xs">
            {message.content}
          </p>
        ) : (
          <div className="rounded-lg rounded-tl-sm border border-border bg-card px-3 py-2.5">
            <AiMarkdown text={message.content} onOpenFile={onOpenFile} />
            {message.citations?.length ? (
              <div className="mt-3 space-y-1.5 border-t border-border pt-2.5">
                <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Sources</p>
                <div className="flex flex-wrap gap-1.5">
                  {message.citations.map((citation) => (
                    <CitationChip key={`${citation.filePath}:${citation.startLine}`} citation={citation} onOpenFile={onOpenFile} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The repository AI assistant. Answers come from the backend RAG pipeline, so
 * every citation resolves to a real indexed file and can be opened in the editor.
 */
export function ChatPanel({ onOpenFile, className, compact = false }) {
  const { owner, repo, indexed, startIndexing } = useRepository();
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState('');
  const [freshness, setFreshness] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    aiApi
      .conversation(owner, repo)
      .then((data) => {
        if (cancelled) return;
        setConversationId(data.conversation?.id || null);
        setMessages(data.conversation?.messages || []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingHistory(false));
    return () => {
      cancelled = true;
    };
  }, [owner, repo]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const ask = async (question) => {
    const text = (question ?? input).trim();
    if (!text || sending) return;
    setInput('');
    setMessages((current) => [...current, { role: 'user', content: text, id: `local-${Date.now()}` }]);
    setSending(true);
    setStage('Searching the indexed codebase…');

    const stageTimer = setTimeout(() => setStage('Generating a grounded answer…'), 1200);
    try {
      const data = await aiApi.chat({ owner, repo, question: text, ...(conversationId ? { conversationId } : {}) });
      setConversationId(data.conversationId);
      setFreshness(data.freshness);
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: data.answer, citations: data.citations, id: `a-${Date.now()}`, stats: data.stats },
      ]);
    } catch (error) {
      toast.error(error.message);
      setMessages((current) => current.slice(0, -1));
      setInput(text);
    } finally {
      clearTimeout(stageTimer);
      setSending(false);
      setStage('');
    }
  };

  if (!indexed) {
    return (
      <div className={cn('flex items-center justify-center p-6', className)}>
        <EmptyState
          icon={Sparkles}
          title="Index this repository first"
          description="The assistant only answers from indexed code, so answers stay grounded and citable."
          action={
            <Button size="sm" onClick={() => startIndexing({})}>
              Index repository
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 scrollbar-thin">
        {freshness?.stale ? (
          <Alert variant="warning" title="Answers may be stale">
            The branch moved since indexing. Re-index for answers that match the current code.
          </Alert>
        ) : null}

        {loadingHistory ? (
          <p className="p-2 text-2xs text-muted-foreground">Loading conversation…</p>
        ) : messages.length === 0 ? (
          <div className="space-y-3 p-1">
            <EmptyState
              compact
              icon={Sparkles}
              title="Ask about this repository"
              description="Answers are built from retrieved code and always cite the files they came from."
            />
            <div className="space-y-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => ask(suggestion)}
                  className="block w-full rounded-md border border-border bg-card px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <Message key={message.id || index} message={message} onOpenFile={onOpenFile} />
          ))
        )}

        {sending ? (
          <div className="flex items-center gap-2 px-1 text-2xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            {stage}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
        className="border-t border-border p-2.5"
      >
        <div className="relative">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                ask();
              }
            }}
            placeholder="Ask anything about this repository…"
            aria-label="Ask the CodeWeave assistant"
            rows={compact ? 2 : 3}
            className="resize-none pr-20 text-xs"
            disabled={sending}
          />
          <Button type="submit" size="xs" className="absolute bottom-2 right-2" loading={sending} disabled={!input.trim()}>
            Ask
            <CornerDownLeft aria-hidden="true" />
          </Button>
        </div>
        <p className="mt-1.5 flex items-center justify-between text-2xs text-muted-foreground">
          <span>Enter to send · Shift + Enter for a new line</span>
          {messages.at(-1)?.stats ? (
            <Badge variant="muted">{messages.at(-1).stats.returned} chunks retrieved</Badge>
          ) : null}
        </p>
      </form>
    </div>
  );
}
