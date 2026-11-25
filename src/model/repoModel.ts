import { aheadOf, listBranches, mergedInto, recentCheckouts, repoState } from '../git/queries';
import { BaseBranch, BranchRef, Git, RepoState } from '../git/types';
import { resolveBaseBranch } from './base';

export interface RepoSnapshot {
  root: string;
  branches: BranchRef[];
  remotes: string[];
  base?: BaseBranch;
  aheadOfBase: Map<string, number>;
  merged: Set<string>;
  recent: string[];
  state: RepoState;
}

export async function loadSnapshot(
  git: Git,
  cfg: { baseBranch: string },
  signal?: AbortSignal,
): Promise<RepoSnapshot> {
  const aborted = (): void => {
    if (signal?.aborted) {
      throw new Error('loadSnapshot aborted');
    }
  };
  aborted();
  const [remoteOut, branches, state, recent] = await Promise.all([
    git.run(['remote'], { signal }),
    listBranches(git),
    repoState(git),
    recentCheckouts(git),
  ]);
  aborted();
  const remotes = remoteOut.split('\n').filter(Boolean);
  const base = resolveBaseBranch(cfg.baseBranch, branches);

  let aheadOfBase = new Map<string, number>();
  let merged = new Set<string>();
  if (base) {
    const localNames = branches.filter((b) => b.kind === 'local').map((b) => b.name);
    [aheadOfBase, merged] = await Promise.all([
      aheadOf(git, base.compareRef, localNames),
      mergedInto(git, base.compareRef),
    ]);
    aborted();
    const head = branches.find((b) => b.kind === 'local' && b.isHead);
    if (head) {
      merged.delete(head.name);
    }
    if (base.local) {
      merged.delete(base.local);
    }
  }
  return { root: git.root, branches, remotes, base, aheadOfBase, merged, recent, state };
}
