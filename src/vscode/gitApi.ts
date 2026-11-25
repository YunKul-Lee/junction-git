import * as vscode from 'vscode';
import { createGit } from '../git/gitCli';
import { Git } from '../git/types';

/** The subset of the built-in vscode.git extension API (v1) that Junction uses. */
interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: { readonly onDidChange: vscode.Event<void> };
}
interface GitApi {
  readonly git: { readonly path: string };
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
  readonly repositories: GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}
interface GitExtension {
  getAPI(version: 1): GitApi;
}

export interface RepoHandle {
  root: vscode.Uri;
  git: Git;
  onDidChange: vscode.Event<void>;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

export interface GitConnection extends vscode.Disposable {
  repos(): RepoHandle[];
  onDidChangeRepos: vscode.Event<void>;
}

export async function connectGitApi(log: (l: string) => void): Promise<GitConnection> {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) {
    throw new Error('The built-in Git extension (vscode.git) is not available.');
  }
  const exports = ext.isActive ? ext.exports : await ext.activate();
  const api = exports.getAPI(1);

  const reposChanged = new vscode.EventEmitter<void>();
  const handles = new Map<string, { handle: RepoHandle; emitter: vscode.EventEmitter<void>; sub: vscode.Disposable }>();

  const handleFor = (repo: GitRepository): RepoHandle => {
    const key = repo.rootUri.fsPath;
    let entry = handles.get(key);
    if (!entry) {
      const emitter = new vscode.EventEmitter<void>();
      const sub = repo.state.onDidChange(() => emitter.fire());
      const handle: RepoHandle = {
        root: repo.rootUri,
        git: createGit(api.git.path, key, log),
        onDidChange: emitter.event,
        toGitUri: (uri, ref) => api.toGitUri(uri, ref),
      };
      entry = { handle, emitter, sub };
      handles.set(key, entry);
    }
    return entry.handle;
  };

  const subs: vscode.Disposable[] = [
    api.onDidOpenRepository(() => reposChanged.fire()),
    api.onDidCloseRepository((repo) => {
      const entry = handles.get(repo.rootUri.fsPath);
      entry?.sub.dispose();
      entry?.emitter.dispose();
      handles.delete(repo.rootUri.fsPath);
      reposChanged.fire();
    }),
    api.onDidChangeState(() => reposChanged.fire()),
    reposChanged,
  ];

  return {
    repos: () => api.repositories.map(handleFor),
    onDidChangeRepos: reposChanged.event,
    dispose: () => {
      subs.forEach((s) => s.dispose());
      handles.forEach((e) => {
        e.sub.dispose();
        e.emitter.dispose();
      });
      handles.clear();
    },
  };
}
