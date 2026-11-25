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

function sameRecord<T extends object>(a: T | undefined, b: T | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a) as (keyof T)[];
  const kb = Object.keys(b) as (keyof T)[];
  if (ka.length !== kb.length) return false;
  return ka.every((k) => {
    const va = a[k];
    const vb = b[k];
    return va !== null && vb !== null && typeof va === 'object' && typeof vb === 'object'
      ? sameRecord(va as object, vb as object)
      : va === vb;
  });
}

function sameList<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): boolean {
  return a.length === b.length && a.every((x, i) => eq(x, b[i]));
}

/** Cheap structural equality: an unchanged snapshot needs no re-render. */
export function sameSnapshot(a: RepoSnapshot, b: RepoSnapshot): boolean {
  return (
    a.root === b.root &&
    sameList(a.branches, b.branches, sameRecord) &&
    sameList(a.remotes, b.remotes) &&
    sameList(a.recent, b.recent) &&
    sameRecord(a.base, b.base) &&
    sameRecord(a.state, b.state) &&
    a.merged.size === b.merged.size &&
    [...a.merged].every((n) => b.merged.has(n)) &&
    a.aheadOfBase.size === b.aheadOfBase.size &&
    [...a.aheadOfBase].every(([k, v]) => b.aheadOfBase.get(k) === v)
  );
}
