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

/** Fast-forward-only pull of the current branch. */
export async function pull(git: Git): Promise<void> {
  await git.run(['pull', '--ff-only']);
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

// `ref` is fully qualified (refs/heads/x, refs/remotes/origin/x) so it can never be read as an option or a pathspec.

export async function merge(git: Git, ref: string): Promise<void> {
  await git.run(['merge', '--no-edit', ref]);
}

export async function mergeAbort(git: Git): Promise<void> {
  await git.run(['merge', '--abort']);
}

/** Concludes a merge whose conflicts were resolved and staged, keeping the prepared message. */
export async function mergeContinue(git: Git): Promise<void> {
  await git.run(['merge', '--continue'], { env: { GIT_EDITOR: 'true' } });
}

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
