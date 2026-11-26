import * as vscode from 'vscode';
import { Notice, nextNotice, PendingSeen, WatchState } from '../flows/conflictWatch';
import { conflictedFiles } from '../git/operations';
import { repoState } from '../git/queries';
import { GitConnection, RepoHandle } from './gitApi';

const DEBOUNCE_MS = 300;

interface Watched {
  repo: RepoHandle;
  sub: vscode.Disposable;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  again: boolean;
  closed: boolean;
  prev?: WatchState;
}

/**
 * Watches every repository's merge/rebase state and reports notices (conflicts left, all resolved,
 * merge ended). Each repository is evaluated once at start, then 300 ms after its last change,
 * never twice at once. Errors only go to `log`.
 */
export function watchConflicts(
  conn: GitConnection,
  onNotice: (repo: RepoHandle, n: Notice) => void,
  /** The branch a rejected push waits on in `repo`, if any. */
  pendingBranch: (repo: RepoHandle) => string | undefined,
  log: (line: string) => void,
): vscode.Disposable {
  const watched = new Map<string, Watched>();

  const evaluate = async (w: Watched): Promise<void> => {
    if (w.running) {
      w.again = true;
      return;
    }
    w.running = true;
    try {
      const st = await repoState(w.repo.git);
      const op: WatchState['op'] = st.rebase !== undefined ? 'rebase' : st.merging ? 'merge' : 'none';
      const conflicts = op !== 'none' ? (await conflictedFiles(w.repo.git)).length : 0;
      if (w.closed) {
        return;
      }
      const cur: WatchState = { op, conflicts };
      const branch = pendingBranch(w.repo);
      const pending: PendingSeen = branch === undefined ? 'none' : branch === st.head ? 'onHead' : 'elsewhere';
      const notice = nextNotice(w.prev, cur, pending);
      w.prev = cur;
      if (notice) {
        onNotice(w.repo, notice);
      }
    } catch (e) {
      log(`Conflict watch failed for ${w.repo.root.fsPath}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      w.running = false;
      if (w.again && !w.closed) {
        w.again = false;
        void evaluate(w);
      }
    }
  };

  const close = (key: string, w: Watched): void => {
    w.closed = true;
    clearTimeout(w.timer);
    w.sub.dispose();
    watched.delete(key);
  };

  const sync = (): void => {
    const current = new Map(conn.repos().map((r) => [r.root.fsPath, r]));
    for (const [key, w] of watched) {
      if (current.get(key) !== w.repo) {
        close(key, w);
      }
    }
    for (const [key, repo] of current) {
      if (watched.has(key)) {
        continue;
      }
      const w: Watched = { repo, sub: { dispose: () => undefined }, running: false, again: false, closed: false };
      w.sub = repo.onDidChange(() => {
        clearTimeout(w.timer);
        w.timer = setTimeout(() => void evaluate(w), DEBOUNCE_MS);
      });
      watched.set(key, w);
      void evaluate(w);
    }
  };

  const reposSub = conn.onDidChangeRepos(sync);
  sync();
  return {
    dispose: () => {
      reposSub.dispose();
      for (const [key, w] of [...watched]) {
        close(key, w);
      }
    },
  };
}
