export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`git ${args.join(' ')} failed (exit ${exitCode ?? 'null'}): ${stderr.trim()}`);
    this.name = 'GitError';
  }
}

export interface Git {
  readonly root: string;
  /** Resolves with stdout; rejects with GitError on failure. */
  run(args: string[], opts?: { signal?: AbortSignal; input?: string; env?: Record<string, string> }): Promise<string>;
  /** Cached `git --version` result. */
  version(): Promise<{ major: number; minor: number }>;
}

export interface BranchRef {
  kind: 'local' | 'remote';
  /** local: 'feature/x', remote: 'origin/feature/x' */
  name: string;
  /** Name without the remote prefix; equals `name` for local branches. */
  shortName: string;
  remote?: string;
  hash: string;
  subject: string;
  /** Unix seconds. */
  committerTime: number;
  isHead: boolean;
  /** e.g. 'origin/feature/x' */
  upstream?: string;
  upstreamGone: boolean;
  /** Relative to upstream; 0 when there is no upstream. */
  ahead: number;
  behind: number;
}

export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  time: number;
  subject: string;
}

export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';

export interface FileChange {
  status: ChangeStatus;
  path: string;
  oldPath?: string;
}

export interface RepoState {
  /** Branch name; undefined when detached. */
  head?: string;
  detached: boolean;
  dirty: boolean;
  merging: boolean;
  rebase?: { step: number; total: number };
}

export interface BaseBranch {
  name: string;
  /** 'origin/develop' or 'develop' */
  compareRef: string;
  local?: string;
  remoteRef?: string;
}
