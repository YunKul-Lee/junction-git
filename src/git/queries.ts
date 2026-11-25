import * as fs from 'fs/promises';
import * as path from 'path';
import {
  LOG_FORMAT,
  parseAheadBehind,
  parseLog,
  parseNameStatus,
  parseRecentCheckouts,
  parseRefs,
  REF_FORMAT,
} from './parse';
import { BranchRef, Commit, FileChange, Git, GitError, RepoState } from './types';

export async function listBranches(git: Git): Promise<BranchRef[]> {
  const remotes = (await git.run(['remote'])).split('\n').filter(Boolean);
  const out = await git.run(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes']);
  return parseRefs(out, remotes);
}

const FALLBACK_CONCURRENCY = 8;

export async function aheadOf(
  git: Git,
  baseRef: string,
  branchNames: string[],
  opts?: { forceFallback?: boolean },
): Promise<Map<string, number>> {
  if (!opts?.forceFallback) {
    const v = await git.version();
    if (v.major > 2 || (v.major === 2 && v.minor >= 41)) {
      const out = await git.run([
        'for-each-ref',
        `--format=%(refname:short)%00%(ahead-behind:${baseRef})`,
        'refs/heads',
      ]);
      const all = parseAheadBehind(out);
      const result = new Map<string, number>();
      for (const name of branchNames) {
        const n = all.get(name);
        if (n !== undefined) {
          result.set(name, n);
        }
      }
      return result;
    }
  }
  const result = new Map<string, number>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < branchNames.length) {
      const name = branchNames[next++];
      const out = await git.run(['rev-list', '--count', `${baseRef}..${name}`]);
      result.set(name, Number(out.trim()));
    }
  };
  await Promise.all(Array.from({ length: Math.min(FALLBACK_CONCURRENCY, branchNames.length) }, worker));
  return result;
}

export async function mergedInto(git: Git, baseRef: string): Promise<Set<string>> {
  const out = await git.run(['for-each-ref', '--merged', baseRef, '--format=%(refname:short)', 'refs/heads']);
  return new Set(out.split('\n').filter(Boolean));
}

export async function recentCheckouts(git: Git, limit = 100): Promise<string[]> {
  let out: string;
  try {
    out = await git.run(['reflog', 'show', '--format=%gs', '-n', '1000', 'HEAD']);
  } catch (e) {
    // Empty repository: HEAD has no reflog yet.
    if (e instanceof GitError && /ambiguous argument|unknown revision|bad revision|does not have any commits/.test(e.stderr)) {
      return [];
    }
    throw e;
  }
  return parseRecentCheckouts(out).slice(0, limit);
}

export async function logRange(
  git: Git,
  exclude: string,
  include: string,
  page: { skip: number; limit: number },
): Promise<Commit[]> {
  const out = await git.run([
    'log',
    `--format=${LOG_FORMAT}`,
    `--skip=${page.skip}`,
    '-n',
    String(page.limit),
    `${exclude}..${include}`,
  ]);
  return parseLog(out);
}

export async function commitFiles(git: Git, hash: string): Promise<FileChange[]> {
  const out = await git.run([
    'diff-tree', '--no-commit-id', '-r', '-M', '--name-status', '--root', '-m', '--first-parent', hash,
  ]);
  return parseNameStatus(out);
}

export async function rangeFiles(
  git: Git,
  baseRef: string,
  tip: string,
): Promise<{ mergeBase: string; files: FileChange[] }> {
  const mergeBase = (await git.run(['merge-base', baseRef, tip])).trim();
  const out = await git.run(['diff', '--name-status', '-M', mergeBase, tip]);
  return { mergeBase, files: parseNameStatus(out) };
}

async function gitPathExists(git: Git, name: string): Promise<string | undefined> {
  const p = (await git.run(['rev-parse', '--git-path', name])).trim();
  const full = path.resolve(git.root, p);
  try {
    await fs.access(full);
    return full;
  } catch {
    return undefined;
  }
}

async function readInt(file: string): Promise<number | undefined> {
  try {
    const n = parseInt((await fs.readFile(file, 'utf8')).trim(), 10);
    return Number.isNaN(n) ? undefined : n;
  } catch {
    return undefined;
  }
}

export async function repoState(git: Git): Promise<RepoState> {
  const status = await git.run(['status', '--porcelain=v2', '--branch']);
  let head: string | undefined;
  let detached = false;
  let dirty = false;
  for (const line of status.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length);
      if (value === '(detached)') {
        detached = true;
      } else {
        head = value;
      }
    } else if (line && !line.startsWith('#') && !line.startsWith('?')) {
      dirty = true;
    }
  }

  const merging = (await gitPathExists(git, 'MERGE_HEAD')) !== undefined;
  let rebase: RepoState['rebase'];
  const merge = await gitPathExists(git, 'rebase-merge');
  if (merge) {
    const step = await readInt(path.join(merge, 'msgnum'));
    const total = await readInt(path.join(merge, 'end'));
    rebase = { step: step ?? 0, total: total ?? 0 };
  } else {
    const apply = await gitPathExists(git, 'rebase-apply');
    if (apply) {
      const step = await readInt(path.join(apply, 'next'));
      const total = await readInt(path.join(apply, 'last'));
      rebase = { step: step ?? 0, total: total ?? 0 };
    }
  }
  return { head, detached, dirty, merging, ...(rebase ? { rebase } : {}) };
}

export async function remoteUrl(git: Git, remote: string): Promise<string | undefined> {
  try {
    const out = (await git.run(['remote', 'get-url', remote])).trim();
    return out || undefined;
  } catch (e) {
    if (e instanceof GitError && /No such remote/i.test(e.stderr)) {
      return undefined;
    }
    throw e;
  }
}
