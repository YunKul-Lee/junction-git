import { Git } from './types';

// Branch names always travel as their own argv entries. Git forbids branch names starting with '-',
// and `--` / fully qualified refs are used wherever the command supports them.

export async function switchBranch(git: Git, name: string): Promise<void> {
  await git.run(['switch', '--', name]);
}

/** Creates local `localName` tracking `remoteBranch` (e.g. 'origin/x') and switches to it. */
export async function switchTrack(git: Git, remoteBranch: string, localName: string): Promise<void> {
  await git.run(['switch', '--track', '-c', localName, remoteBranch]);
}

/** Creates `name` at `startPoint` without upstream tracking and switches to it; local changes carry over. */
export async function createBranch(git: Git, name: string, startPoint: string): Promise<void> {
  await git.run(['switch', '--no-track', '-c', name, startPoint]);
}

export async function renameBranch(git: Git, oldName: string, newName: string): Promise<void> {
  await git.run(['branch', '-m', '--', oldName, newName]);
}

export async function unsetUpstream(git: Git, name: string): Promise<void> {
  await git.run(['branch', '--unset-upstream', '--', name]);
}

/** Sha of the newest stash, or '' when there is none. */
export async function stashTip(git: Git): Promise<string> {
  try {
    return (await git.run(['rev-parse', '-q', '--verify', 'refs/stash'])).trim();
  } catch {
    return '';
  }
}

/** Without `force` git refuses to delete a branch that is not fully merged. */
export async function deleteLocal(git: Git, name: string, force: boolean): Promise<void> {
  await git.run(['branch', force ? '-D' : '-d', '--', name]);
}

export async function deleteRemote(git: Git, remote: string, shortName: string): Promise<void> {
  await git.run(['push', remote, '--delete', `refs/heads/${shortName}`]);
}

async function configValue(git: Git, key: string): Promise<string | undefined> {
  try {
    return (await git.run(['config', '--get', key])).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Where `branch` is pushed: its upstream remote and ref, or `setUpstreamTo` under the same name. */
export async function pushTarget(
  git: Git,
  branch: string,
  setUpstreamTo?: string,
): Promise<{ remote: string; dest: string }> {
  if (setUpstreamTo) {
    return { remote: setUpstreamTo, dest: `refs/heads/${branch}` };
  }
  const remote = await configValue(git, `branch.${branch}.remote`);
  if (!remote) {
    throw new Error(`Branch ${branch} has no upstream remote`);
  }
  return { remote, dest: (await configValue(git, `branch.${branch}.merge`)) ?? `refs/heads/${branch}` };
}

export async function fetchRemote(git: Git, remote: string): Promise<void> {
  await git.run(['fetch', '--', remote]);
}

/** Sha of the remote-tracking ref for `dest` on `remote`, or undefined when it does not exist. */
export async function remoteTip(git: Git, remote: string, dest: string): Promise<string | undefined> {
  try {
    const out = await git.run(['rev-parse', '-q', '--verify', `refs/remotes/${remote}/${dest.replace(/^refs\/heads\//, '')}`]);
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Number of commits reachable from `sha` but not from `branch`. */
export async function countNotIn(git: Git, sha: string, branch: string): Promise<number> {
  const out = await git.run(['rev-list', '--count', sha, '--not', `refs/heads/${branch}`]);
  return Number(out.trim());
}

/**
 * Pushes `branch`, to `setUpstreamTo` (and tracks it) or else its configured upstream.
 * `forceWithLease.expect` is the remote sha the user confirmed overwriting: the push fails if the remote moved.
 */
export async function push(
  git: Git,
  branch: string,
  opts: { setUpstreamTo?: string; forceWithLease?: { expect: string } },
): Promise<void> {
  const { remote, dest } = await pushTarget(git, branch, opts.setUpstreamTo);
  const args = ['push'];
  if (opts.setUpstreamTo) {
    args.push('--set-upstream');
  }
  if (opts.forceWithLease) {
    args.push(`--force-with-lease=${dest}:${opts.forceWithLease.expect}`);
  }
  args.push('--', remote, `refs/heads/${branch}:${dest}`);
  await git.run(args);
}

/** Pulls the current branch as the user's git config says (pull.rebase, pull.ff, ...). GIT_EDITOR=true keeps a merge from opening an editor. */
export async function pull(git: Git): Promise<void> {
  await git.run(['pull'], { env: { GIT_EDITOR: 'true' } });
}

/** Updates local branch `local` to `remote/remoteBranch`; git refuses anything but a fast-forward. */
export async function fastForward(git: Git, remote: string, remoteBranch: string, local: string): Promise<void> {
  await git.run(['fetch', '--', remote, `refs/heads/${remoteBranch}:refs/heads/${local}`]);
}

export async function mergeFfOnly(git: Git, ref: string): Promise<void> {
  await git.run(['merge', '--ff-only', ref]);
}

export async function fetchAll(git: Git): Promise<void> {
  await git.run(['fetch', '--all', '--prune']);
}

export async function stash(git: Git, message: string): Promise<void> {
  await git.run(['stash', 'push', '-m', message]);
}

export async function stashPop(git: Git): Promise<void> {
  await git.run(['stash', 'pop']);
}

/** `name` is a short branch name (`topic`, `origin/topic`) so git's default message reads well; branch names never start with '-'. */
export async function merge(git: Git, name: string): Promise<void> {
  await git.run(['merge', '--no-edit', name]);
}

export async function mergeAbort(git: Git): Promise<void> {
  await git.run(['merge', '--abort']);
}

/** Concludes a merge whose conflicts were resolved and staged, keeping the prepared message. */
export async function mergeContinue(git: Git): Promise<void> {
  await git.run(['merge', '--continue'], { env: { GIT_EDITOR: 'true' } });
}

/** `onto` is fully qualified (refs/heads/x, refs/remotes/origin/x) so it can never be read as an option. */
export async function rebase(git: Git, onto: string): Promise<void> {
  await git.run(['rebase', onto]);
}

/** GIT_EDITOR=true keeps git from opening an editor for the commit message. */
export async function rebaseContinue(git: Git): Promise<void> {
  await git.run(['rebase', '--continue'], { env: { GIT_EDITOR: 'true' } });
}

export async function rebaseAbort(git: Git): Promise<void> {
  await git.run(['rebase', '--abort']);
}

/** Paths with unresolved merge conflicts, sorted. */
export async function conflictedFiles(git: Git): Promise<string[]> {
  const out = await git.run(['-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=U', '-z']);
  return out.split('\0').filter((f) => f !== '').sort();
}

/** `--literal-pathspecs` keeps names like `app/[id]/page.tsx` from matching other files as globs. */
const LITERAL = '--literal-pathspecs';

/** Index stages present for `file`: 1 base, 2 ours, 3 theirs. Empty when the file is not conflicted. */
export async function conflictStages(git: Git, file: string): Promise<Set<1 | 2 | 3>> {
  const unmerged = await git.run([LITERAL, 'ls-files', '-u', '-z', '--', file]);
  // Entries look like "<mode> <sha> <stage>\t<path>".
  return new Set(
    unmerged
      .split('\0')
      .filter((e) => e !== '')
      .map((e) => Number(e.split('\t')[0].split(' ')[2]) as 1 | 2 | 3),
  );
}

/**
 * Resolves `file` with one side's version and stages it. When the file is conflicted and that side
 * has no version (it deleted the file), the file is removed instead. Any other failure propagates.
 */
export async function checkoutSide(git: Git, file: string, side: 'ours' | 'theirs'): Promise<'kept' | 'deleted'> {
  const stages = await conflictStages(git, file);
  if (stages.size > 0 && !stages.has(side === 'ours' ? 2 : 3)) {
    await git.run([LITERAL, 'rm', '-q', '--', file]);
    return 'deleted';
  }
  await git.run([LITERAL, 'checkout', `--${side}`, '--', file]);
  await git.run([LITERAL, 'add', '--', file]);
  return 'kept';
}

const C_ESCAPES: Record<string, string> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '"': '"', '\\': '\\' };

/** Undoes git's C-style quoting of a path (`"a\"b"`); octal escapes are UTF-8 bytes. */
function unquoteC(quoted: string): string {
  const bytes: number[] = [];
  const body = Array.from(quoted.slice(1, -1)); // code points, so astral characters stay whole
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = body[i + 1];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4).join(''), 8));
      i += 3;
    } else {
      bytes.push(...Buffer.from(C_ESCAPES[next] ?? next, 'utf8'));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** The new-side path of a `+++ ` header line, or '' for /dev/null. */
function dstPath(line: string): string {
  const name = line.slice(4);
  if (name.startsWith('"b/')) {
    return unquoteC(name.replace(/\t$/, '')).slice(2);
  }
  // git appends a tab after names containing spaces
  return name.startsWith('b/') ? name.slice(2).replace(/\t$/, '') : '';
}

/** Files that gained conflict marker lines between `from` and `to`. */
export async function leftoverMarkers(git: Git, from: string, to: string): Promise<string[]> {
  // Explicit prefixes keep user diff.noprefix / diff.mnemonicPrefix config from changing the header format.
  const out = await git.run([
    '-c',
    'core.quotePath=false',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '-U0',
    from,
    to,
  ]);
  const files = new Set<string>();
  let current = '';
  let inHunk = false;
  for (const line of out.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      current = '';
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (!inHunk && line.startsWith('+++ ')) {
      current = dstPath(line);
    } else if (inHunk && current && /^\+(<{7}|={7}|>{7})( |$)/.test(line)) {
      files.add(current);
    }
  }
  return [...files];
}
