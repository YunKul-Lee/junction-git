import { BranchRef } from '../git/types';

export type TreeEntry =
  | { type: 'folder'; name: string; path: string; children: TreeEntry[] }
  | { type: 'branch'; label: string; branch: BranchRef };

export interface BuildOptions {
  groupByFolder: boolean;
  sort: 'recent' | 'name';
  recent: string[];
}

export interface BranchBadges {
  aheadOfBase?: number;
  merged: boolean;
  isBase: boolean;
}

type Cmp = (a: BranchRef, b: BranchRef) => number;

const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

function makeComparator(opts: BuildOptions): Cmp {
  if (opts.sort === 'name') {
    return (a, b) => byName(a.shortName, b.shortName);
  }
  const index = new Map<string, number>();
  opts.recent.forEach((n, i) => {
    if (!index.has(n)) {
      index.set(n, i);
    }
  });
  const rank = (b: BranchRef): number => (b.kind === 'local' ? index.get(b.name) ?? Infinity : Infinity);
  return (a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) {
      return ra < rb ? -1 : 1;
    }
    return b.committerTime - a.committerTime || byName(a.shortName, b.shortName);
  };
}

interface Node {
  folders: Map<string, Node>;
  branches: { label: string; branch: BranchRef }[];
  best?: BranchRef;
}

function newNode(): Node {
  return { folders: new Map(), branches: [] };
}

export function buildEntries(branches: BranchRef[], opts: BuildOptions): TreeEntry[] {
  const cmp = makeComparator(opts);
  if (!opts.groupByFolder) {
    return [...branches].sort(cmp).map((branch) => ({ type: 'branch', label: branch.shortName, branch }));
  }

  const root = newNode();
  for (const branch of branches) {
    const parts = branch.shortName.split('/');
    const label = parts.pop() as string;
    let node = root;
    for (const part of parts) {
      let next = node.folders.get(part);
      if (!next) {
        next = newNode();
        node.folders.set(part, next);
      }
      node = next;
      if (!node.best || cmp(branch, node.best) < 0) {
        node.best = branch;
      }
    }
    node.branches.push({ label, branch });
  }

  const emit = (node: Node, prefix: string): TreeEntry[] => {
    const folders = [...node.folders.entries()].sort(([na, a], [nb, b]) =>
      opts.sort === 'name' ? byName(na, nb) : cmp(a.best as BranchRef, b.best as BranchRef),
    );
    const out: TreeEntry[] = folders.map(([name, child]) => ({
      type: 'folder',
      name,
      path: prefix + name,
      children: emit(child, `${prefix}${name}/`),
    }));
    for (const { label, branch } of [...node.branches].sort((a, b) => cmp(a.branch, b.branch))) {
      out.push({ type: 'branch', label, branch });
    }
    return out;
  };
  return emit(root, '');
}

export function describeBranch(b: BranchRef, badges: BranchBadges): string {
  if (badges.merged && !badges.isBase) {
    return '✓ merged';
  }
  const parts: string[] = [];
  if (!badges.isBase && badges.aheadOfBase !== undefined && badges.aheadOfBase > 0) {
    parts.push(`↑${badges.aheadOfBase}`);
  }
  if (b.ahead > 0) {
    parts.push(`⇡${b.ahead}`);
  }
  if (b.behind > 0) {
    parts.push(`⇣${b.behind}`);
  }
  if (b.upstreamGone) {
    parts.push('(remote deleted)');
  }
  return parts.join('  ');
}
