import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTheme } from "../../context/ThemeContext.jsx";
import { monacoLanguage } from "../../lib/utils.js";
import { Spinner } from "../ui/primitives.jsx";

const BASE_OPTIONS = {
  readOnly: true,
  domReadOnly: true,
  minimap: { enabled: false },
  fontSize: 12.5,
  lineHeight: 19,
  fontFamily:
    "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  fontLigatures: false,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  renderLineHighlight: "line",
  lineNumbersMinChars: 4,
  glyphMargin: false,
  folding: true,
  automaticLayout: true,
  padding: { top: 10, bottom: 24 },
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    useShadows: false,
  },
  contextmenu: false,
  wordWrap: "off",
  stickyScroll: { enabled: false },
};

/**
 * Monaco is self-hosted (no CDN) but heavy, so it is loaded the first time a
 * code view actually mounts instead of on app start.
 */
// React.lazy keeps @monaco-editor/react (and the 4 MB monaco chunk) out of the
// initial page graph entirely — the landing page never downloads the editor.
const Editor = lazy(() =>
  import("@monaco-editor/react").then((module) => ({
    default: module.default,
  })),
);
const DiffEditor = lazy(() =>
  import("@monaco-editor/react").then((module) => ({
    default: module.DiffEditor,
  })),
);

let monacoSetup = null;
function useMonacoReady() {
  const [ready, setReady] = useState(Boolean(monacoSetup?.done));
  useEffect(() => {
    if (ready) return;
    if (!monacoSetup)
      monacoSetup = {
        promise: import("../../lib/monacoSetup.js"),
        done: false,
      };
    let cancelled = false;
    monacoSetup.promise
      .then(() => {
        monacoSetup.done = true;
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true); // fall back to the packaged loader
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);
  return ready;
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center bg-card">
      <Spinner label="Loading editor" />
    </div>
  );
}

/** Read-only Monaco viewer that can scroll to (and highlight) a line range. */
export function CodeViewer({
  path,
  content,
  highlight,
  onMount,
  className,
  height = "100%",
}) {
  const { isDark } = useTheme();
  const monacoReady = useMonacoReady();
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsRef = useRef(null);

  const applyHighlight = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    if (!decorationsRef.current)
      decorationsRef.current = editor.createDecorationsCollection();

    if (!highlight?.startLine) {
      decorationsRef.current.clear();
      return;
    }
    const startLine = Math.max(1, highlight.startLine);
    const endLine = Math.max(
      startLine,
      highlight.endLine || highlight.startLine,
    );
    decorationsRef.current.set([
      {
        range: new monaco.Range(startLine, 1, endLine, 1),
        options: {
          isWholeLine: true,
          className: "cw-highlight-line",
          linesDecorationsClassName: "cw-highlight-gutter",
        },
      },
    ]);
    editor.revealLinesInCenter(startLine, endLine, 1);
    editor.setPosition({ lineNumber: startLine, column: 1 });
  };

  useEffect(applyHighlight, [
    highlight?.startLine,
    highlight?.endLine,
    path,
    content,
  ]);

  if (!monacoReady) {
    return (
      <div className={className} style={{ height }}>
        <Loading />
      </div>
    );
  }

  return (
    <div className={className} style={{ height }}>
      <Suspense fallback={<Loading />}>
        <Editor
          key={path}
          height="100%"
          theme={isDark ? "vs-dark" : "light"}
          language={monacoLanguage(path)}
          value={content}
          options={BASE_OPTIONS}
          loading={<Loading />}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;
            applyHighlight();
            onMount?.(editor, monaco);
          }}
        />
      </Suspense>
    </div>
  );
}

/** Side-by-side diff for AI-proposed changes. */
export function DiffViewer({
  path,
  original,
  modified,
  className,
  height = "100%",
  inline = false,
}) {
  const { isDark } = useTheme();
  const monacoReady = useMonacoReady();

  if (!monacoReady) {
    return (
      <div className={className} style={{ height }}>
        <Loading />
      </div>
    );
  }

  return (
    <div className={className} style={{ height }}>
      <Suspense fallback={<Loading />}>
        <DiffEditor
          key={`${path}-${inline ? "inline" : "split"}`}
          height="100%"
          theme={isDark ? "vs-dark" : "light"}
          language={monacoLanguage(path)}
          original={original}
          modified={modified}
          loading={<Loading />}
          options={{
            ...BASE_OPTIONS,
            renderSideBySide: !inline,
            renderOverviewRuler: false,
            diffWordWrap: "off",
            originalEditable: false,
            ignoreTrimWhitespace: false,
          }}
        />
      </Suspense>
    </div>
  );
}
