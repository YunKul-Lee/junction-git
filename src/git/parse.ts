import { BranchRef, ChangeStatus, Commit, FileChange } from './types';

export const REF_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(committerdate:unix)',
  '%(subject)',
].join('%00');

export const LOG_FORMAT = '%H%x00%h%x00%P%x00%an%x00%at%x00%s%x1e';

export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  if (track.includes('gone')) {
    return { ahead: 0, behind: 0, gone: true };
  }
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0, gone: false };
}

export function parseRefs(out: string, remotes: string[]): BranchRef[] {
  const byLength = [...remotes].sort((a, b) => b.length - a.length);
  const refs: BranchRef[] = [];
  for (const line of out.split('\n')) {
    if (!line) {
      continue;
    }
    const [refname, hash, head, upstream, track, time, ...rest] = line.split('\0');
    const subject = rest.join('\0');
    const { ahead, behind, gone } = parseTrack(track ?? '');
    const common = {
      hash,
      subject,
      committerTime: Number(time) || 0,
      upstream: upstream || undefined,
      upstreamGone: gone,
      ahead,
      behind,
    };
    if (refname.startsWith('refs/heads/')) {
      const name = refname.slice('refs/heads/'.length);
      refs.push({ kind: 'local', name, shortName: name, isHead: head === '*', ...common });
    } else if (refname.startsWith('refs/remotes/')) {
      const name = refname.slice('refs/remotes/'.length);
      const remote = byLength.find((r) => name.startsWith(`${r}/`));
      if (!remote) {
        continue;
      }
      const shortName = name.slice(remote.length + 1);
      if (shortName === 'HEAD') {
        continue;
      }
      refs.push({ kind: 'remote', name, shortName, remote, isHead: false, ...common });
    }
  }
  return refs;
}

export function parseLog(out: string): Commit[] {
  const commits: Commit[] = [];
  for (const rec of out.split('\x1e')) {
    const text = rec.replace(/^\n+/, '');
    if (!text.trim()) {
      continue;
    }
    const [hash, shortHash, parents, author, time, ...rest] = text.split('\0');
    commits.push({
      hash,
      shortHash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author,
      time: Number(time),
      subject: rest.join('\0'),
    });
  }
  return commits;
}

export function parseNameStatus(out: string): FileChange[] {
  const changes: FileChange[] = [];
  for (const line of out.split('\n')) {
    if (!line) {
      continue;
    }
    const parts = line.split('\t');
    const status = parts[0][0] as ChangeStatus;
    if (status === 'R' || status === 'C') {
      changes.push({ status, oldPath: parts[1], path: parts[2] });
    } else {
      changes.push({ status, path: parts[1] });
    }
  }
  return changes;
}

export function parseRecentCheckouts(reflogOut: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of reflogOut.split('\n')) {
    const m = /^checkout: moving from .+ to (.+)$/.exec(line);
    if (!m) {
      continue;
    }
    const target = m[1];
    if (/^[0-9a-f]{40}$/.test(target) || seen.has(target)) {
      continue;
    }
    seen.add(target);
    result.push(target);
  }
  return result;
}

/** Parses `name\0ahead behind` lines into a name -> ahead map. */
export function parseAheadBehind(out: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of out.split('\n')) {
    if (!line) {
      continue;
    }
    const [name, counts] = line.split('\0');
    map.set(name, Number(counts.split(' ')[0]));
  }
  return map;
}
