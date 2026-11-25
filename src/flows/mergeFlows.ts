import * as ops from '../git/operations';
import { repoState } from '../git/queries';
import { BranchRef, Git, GitError } from '../git/types';
import type { FlowCtx } from './branchFlows';
import type { FlowResult } from './ui';

/** `'conflicts'`: the operation stopped on conflicts and is still in progress. */
export type MergeResult = FlowResult | 'conflicts';

const fullRef = (b: BranchRef): string => (b.kind === 'local' ? `refs/heads/${b.name}` : `refs/remotes/${b.name}`);

async function stoppedOnConflicts(git: Git): Promise<boolean> {
  const state = await repoState(git);
  return state.merging || state.rebase !== undefined;
}

export async function mergeIntoCurrentFlow(c: FlowCtx, b: BranchRef, opts: { confirm: boolean }): Promise<MergeResult> {
  const { git, ui, snap } = c;
  if (snap.state.rebase || snap.state.merging) {
    ui.error({ key: 'A rebase or merge is in progress.' });
    return 'failed';
  }
  if (snap.state.dirty) {
    ui.error({ key: 'Commit or stash your changes first.' });
    return 'failed';
  }
  const current = snap.state.head ?? 'HEAD';
  if (opts.confirm) {
    const choice = await ui.confirm({ key: 'Merge {0} into {1}?', args: [b.name, current] }, [{ key: 'Merge' }], {
      modal: true,
    });
    if (choice === undefined) {
      return 'cancelled';
    }
  }
  try {
    await ops.merge(git, fullRef(b));
    return 'done';
  } catch (e) {
    if (e instanceof GitError && (await stoppedOnConflicts(git))) {
      return 'conflicts';
    }
    ui.error({ key: 'Could not merge {0}.', args: [b.name] }, e);
    return 'failed';
  }
}

export async function rebaseCurrentOntoFlow(c: FlowCtx, b: BranchRef, opts: { confirm: boolean }): Promise<MergeResult> {
  const { git, ui, snap } = c;
  if (snap.state.rebase || snap.state.merging) {
    ui.error({ key: 'A rebase or merge is in progress.' });
    return 'failed';
  }
  if (snap.state.dirty) {
    ui.error({ key: 'Commit or stash your changes first.' });
    return 'failed';
  }
  const current = snap.state.head ?? 'HEAD';
  if (opts.confirm) {
    const head = snap.branches.find((x) => x.kind === 'local' && x.isHead);
    const pushed = head !== undefined && head.upstream !== undefined && !head.upstreamGone;
    const choice = await ui.confirm(
      { key: 'Rebase {0} onto {1}?', args: [current, b.name] },
      [{ key: 'Rebase' }],
      {
        modal: true,
        detail: pushed
          ? { key: 'This branch is already pushed. You will need to force push after rebasing.' }
          : undefined,
      },
    );
    if (choice === undefined) {
      return 'cancelled';
    }
  }
  try {
    await ops.rebase(git, fullRef(b));
    return 'done';
  } catch (e) {
    if (e instanceof GitError && (await stoppedOnConflicts(git))) {
      return 'conflicts';
    }
    ui.error({ key: 'Could not rebase onto {0}.', args: [b.name] }, e);
    return 'failed';
  }
}

export async function continueFlow(c: FlowCtx): Promise<MergeResult> {
  const { git, ui, snap } = c;
  if (!snap.state.rebase && !snap.state.merging) {
    ui.error({ key: 'No rebase or merge is in progress.' });
    return 'failed';
  }
  try {
    if (snap.state.rebase) {
      await ops.rebaseContinue(git);
    } else {
      await ops.mergeContinue(git);
    }
    // A rebase can stop again on the next commit and still exit non-zero; either way re-check below.
    return (await stoppedOnConflicts(git)) ? 'conflicts' : 'done';
  } catch (e) {
    if (e instanceof GitError && (await stoppedOnConflicts(git))) {
      return 'conflicts';
    }
    ui.error({ key: 'Could not continue.' }, e);
    return 'failed';
  }
}

export async function abortFlow(c: FlowCtx): Promise<FlowResult> {
  const { git, ui, snap } = c;
  try {
    if (snap.state.rebase) {
      await ops.rebaseAbort(git);
    } else if (snap.state.merging) {
      await ops.mergeAbort(git);
    } else {
      ui.error({ key: 'No rebase or merge is in progress.' });
      return 'failed';
    }
    return 'done';
  } catch (e) {
    ui.error({ key: 'Could not abort.' }, e);
    return 'failed';
  }
}
