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

/**
 * Pushes `branch`. With `setUpstreamTo` it is pushed to that remote under the same name and tracked.
 * Otherwise it goes to its configured upstream. `forceWithLease` first fetches the remote so the lease
 * is taken against the current remote state; it still refuses if the remote moves afterwards.
 */
export async function push(
  git: Git,
  branch: string,
  opts: { setUpstreamTo?: string; forceWithLease?: boolean },
): Promise<void> {
  let remote = opts.setUpstreamTo;
  let dest = `refs/heads/${branch}`;
  if (!remote) {
    remote = await configValue(git, `branch.${branch}.remote`);
    dest = (await configValue(git, `branch.${branch}.merge`)) ?? dest;
    if (!remote) {
      throw new Error(`Branch ${branch} has no upstream remote`);
    }
  }
  if (opts.forceWithLease) {
    await git.run(['fetch', '--', remote]);
  }
  const args = ['push'];
  if (opts.setUpstreamTo) {
    args.push('--set-upstream');
  }
  if (opts.forceWithLease) {
    args.push('--force-with-lease');
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
