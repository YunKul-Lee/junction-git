import * as ops from '../git/operations';
import { isAncestor, repoState } from '../git/queries';
import { BranchRef, GitError } from '../git/types';
import { FlowCtx, inProgress, isNonFastForward, remoteOf } from './branchFlows';
import { continueFlow, MergeResult } from './mergeFlows';
import { PendingPushStore } from './pendingPush';
import type { FlowResult, Msg } from './ui';

export interface PushCtx extends FlowCtx {
  pending: PendingPushStore;
}

// Messages are inline `{ key, args }` literals on purpose; see branchFlows.ts.

export async function pushFlow(c: PushCtx, b: BranchRef): Promise<MergeResult> {
  const { git, ui, snap } = c;
  if (snap.remotes.length === 0) {
    ui.error({ key: 'No remote configured.' });
    return 'failed';
  }
  const hasUpstream = !!b.upstream && !b.upstreamGone;
  const setUpstreamTo = hasUpstream
    ? undefined
    : ((snap.base?.remoteRef && remoteOf(snap, snap.base.remoteRef)?.remote) ?? snap.remotes[0]);
  try {
    await ops.push(git, b.name, { setUpstreamTo });
    return pushed(c, b);
  } catch (e) {
    if (!isNonFastForward(e)) {
      ui.error({ key: 'Could not push {0}.', args: [b.name] }, e);
      return 'failed';
    }
  }
  try {
    // Look at the remote as it is now: the user confirms against exactly this state.
    const { remote, dest } = await ops.pushTarget(git, b.name, setUpstreamTo);
    await ops.fetchRemote(git, remote);
    const tip = await ops.remoteTip(git, remote, dest);
    if (!tip) {
      ui.error({ key: 'Could not push {0}.', args: [b.name] });
      return 'failed';
    }
    const remoteShort = `${remote}/${dest.replace(/^refs\/heads\//, '')}`;
    const lost = await ops.countNotIn(git, tip, b.name);
    if (lost > 0) {
      const choice = await ui.confirm(
        { key: 'Push was rejected.' },
        [b.isHead ? { key: 'Merge and Push' } : { key: 'Checkout and Merge' }, { key: 'Force Push (with lease)' }],
        { modal: true, detail: { key: '{0} has {1} commits that are not in your branch.', args: [remoteShort, lost] } },
      );
      if (choice === undefined) {
        return 'cancelled';
      }
      if (choice === 0) {
        return await mergeRemote(c, b, remoteShort, tip);
      }
    }
    const detail: Msg =
      lost > 0
        ? {
            key: '{0} has {1} commits that are not in your branch. They will be discarded from the remote.',
            args: [remoteShort, lost],
          }
        : { key: 'The remote branch will be overwritten.' };
    const choice = await ui.confirm(
      { key: 'Push was rejected. Force push with lease?' },
      [{ key: 'Force Push (with lease)' }],
      { modal: true, detail },
    );
    if (choice === undefined) {
      return 'cancelled';
    }
    await ops.push(git, b.name, { setUpstreamTo, forceWithLease: { expect: tip } });
    return pushed(c, b);
  } catch (e) {
    ui.error({ key: 'Could not push {0}.', args: [b.name] }, e);
    return 'failed';
  }
}

/** A finished push of the branch settles any push that was waiting on it. */
function pushed(c: PushCtx, b: BranchRef): 'done' {
  if (c.pending.get()?.branch === b.name) {
    c.pending.clear();
  }
  return 'done';
}

/** Merges `remoteShort` (the rejected push's destination, at `tip`) into `b`, then pushes again. */
async function mergeRemote(c: PushCtx, b: BranchRef, remoteShort: string, tip: string): Promise<MergeResult> {
  const { git, ui, snap, pending } = c;
  if (inProgress(c)) {
    return 'failed';
  }
  // Checked before switching, so a dirty tree never leaves the user on another branch with nothing merged.
  if (snap.state.dirty) {
    ui.error({ key: 'Commit or stash your changes first.' });
    return 'failed';
  }
  if (!b.isHead) {
    try {
      await ops.switchBranch(git, b.name);
    } catch (e) {
      ui.error({ key: 'Could not switch to {0}.', args: [b.name] }, e);
      return 'failed';
    }
  }
  try {
    await ops.merge(git, remoteShort);
  } catch (e) {
    if (e instanceof GitError && (await repoState(git)).merging) {
      pending.set({ branch: b.name, tip });
      return 'conflicts';
    }
    ui.error({ key: 'Could not merge {0}.', args: [remoteShort] }, e);
    return 'failed';
  }
  return pushAfterMerge(c, { ...b, isHead: true }, tip);
}

/** Pushes `b` (checked out) after `tip` was merged into it, unless the merge left conflict markers. */
async function pushAfterMerge(c: PushCtx, b: BranchRef, tip: string): Promise<MergeResult> {
  const { git, ui, pending } = c;
  let files: string[];
  try {
    files = await ops.leftoverMarkers(git, tip, 'HEAD');
  } catch (e) {
    ui.error({ key: 'Could not push {0}.', args: [b.name] }, e);
    return 'failed';
  }
  if (files.length > 0) {
    pending.clear();
    ui.error({ key: 'Conflict markers are left in {0}. Fix them and push again.', args: [files.join(', ')] });
    return 'failed';
  }
  // A second rejection (the remote moved again) shows the same choice once more.
  return pushFlow(c, b);
}

const headBranch = (c: PushCtx, name: string): BranchRef | undefined =>
  c.snap.branches.find((x) => x.kind === 'local' && x.isHead && x.name === name);

/** Concludes the merge; with `push`, then pushes the branch a rejected push was waiting on. */
export async function finishMergeFlow(c: PushCtx, opts: { push: boolean }): Promise<MergeResult> {
  const p = c.pending.get();
  // Cleared first: once the merge commit exists, a repo-state watcher must not offer the push a second time.
  c.pending.clear();
  const result = await continueFlow(c);
  if (result !== 'done' && opts.push && p) {
    // The merge is not finished (files still conflicted, or git refused): keep waiting to push.
    c.pending.set(p);
  }
  if (result !== 'done' || !opts.push || !p) {
    return result;
  }
  const b = headBranch(c, p.branch);
  return b ? pushAfterMerge(c, b, p.tip) : result;
}

/** Offers the waiting push once a merge that started from a rejected push was finished some other way. */
export async function resumePendingPushFlow(c: PushCtx): Promise<FlowResult> {
  const { git, ui, snap, pending } = c;
  const p = pending.get();
  if (!p || snap.state.merging) {
    return 'cancelled';
  }
  const b = headBranch(c, p.branch);
  // Another branch, or HEAD lacks the merged tip (the merge was aborted): the push no longer applies.
  if (snap.state.head !== p.branch || !b || !(await isAncestor(git, p.tip, 'HEAD').catch(() => false))) {
    pending.clear();
    return 'cancelled';
  }
  pending.clear();
  const choice = await ui.confirm({ key: 'The merge is finished. Push {0} now?', args: [p.branch] }, [{ key: 'Push' }]);
  if (choice === undefined) {
    return 'cancelled';
  }
  const result = await pushAfterMerge(c, b, p.tip);
  // A second rejection whose merge stops on conflicts leaves the repo merging; the conflict watcher takes it from there.
  return result === 'conflicts' ? 'failed' : result;
}
