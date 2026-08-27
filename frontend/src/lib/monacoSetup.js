import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';

/**
 * Self-hosted Monaco. By default @monaco-editor/react pulls the editor from a
 * CDN at runtime; bundling it keeps CodeWeave working on locked-down networks
 * and removes a third-party dependency from the critical path.
 *
 * Only the core editor worker is registered — CodeWeave views code read-only and
 * shows diffs, so the language service workers are not needed.
 */
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

loader.config({ monaco });

export { monaco };
