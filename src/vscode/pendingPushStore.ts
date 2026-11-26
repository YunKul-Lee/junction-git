import * as vscode from 'vscode';
import { PendingPush, PendingPushStore } from '../flows/pendingPush';

/** Keeps a repository's pending push in workspace state, so it survives a reload of VS Code. */
export function workspacePendingStore(state: vscode.Memento, root: vscode.Uri): PendingPushStore {
  const key = `junction.pendingPush.${root.fsPath}`;
  return {
    get: () => {
      const p = state.get<PendingPush>(key);
      return p && typeof p.branch === 'string' && typeof p.tip === 'string' ? p : undefined;
    },
    // Memento updates its in-memory value at once; only the write to disk is asynchronous.
    set: (p) => void state.update(key, { branch: p.branch, tip: p.tip }),
    clear: () => void state.update(key, undefined),
  };
}
