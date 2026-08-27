import { useNavigate } from 'react-router-dom';
import { ChatPanel } from '../../components/ai/ChatPanel.jsx';
import { useRepository } from '../../context/RepositoryContext.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.jsx';
import { Badge } from '../../components/ui/primitives.jsx';

const NOTES = [
  { label: 'Retrieval', detail: 'MiniLM embeddings in Qdrant, filtered to this repository only.' },
  { label: 'Structure', detail: 'Symbols matched from the AST index, plus one dependency-graph hop.' },
  { label: 'Grounding', detail: 'If retrieval finds nothing relevant, the assistant says so instead of guessing.' },
];

export default function AssistantTab() {
  const { setOpenFile, repository } = useRepository();
  const navigate = useNavigate();

  /** Citations jump to the Files tab and highlight the cited lines. */
  const openFile = (target) => {
    setOpenFile(target);
    navigate('../files', { relative: 'path' });
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[1fr_18rem]">
      <Card className="flex h-[calc(100vh-16rem)] min-h-[30rem] flex-col overflow-hidden">
        <ChatPanel className="flex-1" onOpenFile={openFile} />
      </Card>

      <aside className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle>How answers are built</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {NOTES.map((note) => (
              <div key={note.label}>
                <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{note.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{note.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Index snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs text-muted-foreground">
            <p className="flex items-center justify-between">
              <span>Files</span>
              <Badge variant="muted">{repository?.index?.stats?.filesIndexed ?? 0}</Badge>
            </p>
            <p className="flex items-center justify-between">
              <span>Chunks</span>
              <Badge variant="muted">{repository?.index?.stats?.chunks ?? 0}</Badge>
            </p>
            <p className="flex items-center justify-between">
              <span>Symbols</span>
              <Badge variant="muted">{repository?.index?.stats?.symbols ?? 0}</Badge>
            </p>
            <p className="flex items-center justify-between">
              <span>Graph edges</span>
              <Badge variant="muted">{repository?.index?.stats?.edges ?? 0}</Badge>
            </p>
            {typeof repository?.index?.vectors === 'number' ? (
              <p className="flex items-center justify-between">
                <span>Qdrant vectors</span>
                <Badge variant="muted">{repository.index.vectors}</Badge>
              </p>
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
