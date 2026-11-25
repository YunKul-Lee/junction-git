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
  run(args: string[], opts?: { signal?: AbortSignal; input?: string }): Promise<string>;
  /** Cached `git --version` result. */
  version(): Promise<{ major: number; minor: number }>;
}
