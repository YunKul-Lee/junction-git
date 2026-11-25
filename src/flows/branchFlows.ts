import * as ops from '../git/operations';
import { logRange } from '../git/queries';
import { BranchRef, Git, GitError } from '../git/types';
import { RepoSnapshot } from '../model/repoModel';
import { Msg, Ui } from './ui';

export type { FlowResult } from './ui';
import type { FlowResult } from './ui';

export interface FlowCtx {
  git: Git;
  ui: Ui;
  snap: RepoSnapshot;
}

// User messages are written as inline `{ key: 'English text', args }` literals on purpose: the key is
// both the English text and the l10n key, and a test scans the sources for them.

const isNonFastForward = (e: unknown): boolean =>
  e instanceof GitError && /non-fast-forward|\[rejected\]|Not possible to fast-forward|diverging/i.test(e.stderr);

function inProgress(c: FlowCtx): boolean {
  if (c.snap.state.rebase || c.snap.state.merging) {
    c.ui.error({ key: 'A rebase or merge is in progress.' });
    return true;
  }
  return false;
}

function remoteOf(snap: RepoSnapshot, ref: string): { remote: string; branch: string } | undefined {
  const remote = snap.remotes.find((r) => ref.startsWith(`${r}/`));
  return remote ? { remote, branch: ref.slice(remote.length + 1) } : undefined;
}

/** Sync approximation of `git check-ref-format --branch`; the flow re-checks with git before creating. */
function invalidNameReason(name: string): Msg | undefined {
  if (
    name === '' ||
    name === '@' ||
    name.startsWith('-') ||
    name.startsWith('/') ||
    name.endsWith('/') ||
    name.endsWith('.') ||
    name.includes('..') ||
    name.includes('//') ||
    name.includes('@{') ||
    // eslint-disable-next-line no-control-regex
    /[\s~^:?*[\\\x00-\x1f\x7f]/.test(name) ||
    name.split('/').some((p) => p.startsWith('.') || p.endsWith('.lock'))
  ) {
    return { key: '"{0}" is not a valid branch name.', args: [name] };
  }
  return undefined;
}

function nameValidator(snap: RepoSnapshot): (v: string) => Msg | undefined {
  return (v) => {
    const value = v.trim();
    if (value === '') {
      return { key: 'Enter a branch name.' };
    }
    const invalid = invalidNameReason(value);
    if (invalid) {
      return invalid;
    }
    if (snap.branches.some((b) => b.kind === 'local' && b.name === value)) {
      return { key: 'Branch {0} already exists.', args: [value] };
    }
    return undefined;
  };
}

async function validateWithGit(c: FlowCtx, name: string): Promise<boolean> {
  try {
    await c.git.run(['check-ref-format', '--branch', name]);
    return true;
  } catch (e) {
    c.ui.error({ key: '"{0}" is not a valid branch name.', args: [name] }, e);
    return false;
  }
}

export async function checkoutFlow(c: FlowCtx, ref: BranchRef): Promise<FlowResult> {
  const { git, ui, snap } = c;
  if (inProgress(c)) {
    return 'failed';
  }
  const existingLocal =
    ref.kind === 'remote' ? snap.branches.find((b) => b.kind === 'local' && b.name === ref.shortName) : undefined;
  const target = ref.kind === 'local' ? ref : existingLocal;
  if (target?.isHead) {
    return 'done';
  }
  const switchNow = (): Promise<void> =>
    target ? ops.switchBranch(git, target.name) : ops.switchTrack(git, ref.name, ref.shortName);

  let stashed = false;
  try {
    if (snap.state.dirty) {
      const choice = await ui.confirm({ key: 'You have uncommitted changes.' }, [
        { key: 'Stash and Switch' },
        { key: 'Switch Anyway' },
      ]);
      if (choice === undefined) {
        return 'cancelled';
      }
      if (choice === 0) {
        await ops.stash(git, `junction: auto-stash before switching to ${ref.shortName}`);
        stashed = true;
      }
    }
    await switchNow();
  } catch (e) {
    if (stashed) {
      // The switch failed after stashing: put the changes back so nothing is left hidden.
      try {
        await ops.stashPop(git);
        stashed = false;
      } catch {
        ui.info({ key: 'Changes were stashed. Use "Stash Pop" in Source Control to restore them.' });
      }
    }
    ui.error({ key: 'Could not switch to {0}.', args: [ref.shortName] }, e);
    return 'failed';
  }
  if (stashed) {
    ui.info({ key: 'Changes were stashed. Use "Stash Pop" in Source Control to restore them.' });
  }
  return 'done';
}

export async function newBranchFlow(c: FlowCtx, from: BranchRef): Promise<FlowResult> {
  const { git, ui, snap } = c;
  const base = snap.base;
  const startPoint = from.kind === 'local' && base?.local === from.name && base.remoteRef ? base.remoteRef : from.name;
  const entered = await ui.input({ key: 'New branch name' }, { validate: nameValidator(snap) });
  if (entered === undefined) {
    return 'cancelled';
  }
  const name = entered.trim();
  const problem = nameValidator(snap)(name);
  if (problem) {
    ui.error(problem);
    return 'failed';
  }
  if (!(await validateWithGit(c, name))) {
    return 'failed';
  }
  try {
    await ops.createBranch(git, name, startPoint);
  } catch (e) {
    ui.error({ key: 'Could not create branch {0}.', args: [name] }, e);
    return 'failed';
  }
  return 'done';
}

export async function renameFlow(c: FlowCtx, b: BranchRef): Promise<FlowResult> {
  const { git, ui, snap } = c;
  const entered = await ui.input({ key: 'New name for {0}', args: [b.name] }, { value: b.name, validate: nameValidator(snap) });
  if (entered === undefined || entered.trim() === b.name) {
    return 'cancelled';
  }
  const name = entered.trim();
  const problem = nameValidator(snap)(name);
  if (problem) {
    ui.error(problem);
    return 'failed';
  }
  if (!(await validateWithGit(c, name))) {
    return 'failed';
  }
  try {
    await ops.renameBranch(git, b.name, name);
  } catch (e) {
    ui.error({ key: 'Could not rename branch {0}.', args: [b.name] }, e);
    return 'failed';
  }
  if (b.upstream) {
    ui.info({ key: 'Remote branch was not renamed.' });
  }
  return 'done';
}

export async function deleteLocalFlow(c: FlowCtx, b: BranchRef): Promise<FlowResult> {
  const { git, ui, snap } = c;
  if (b.isHead || snap.state.head === b.name) {
    ui.error({ key: 'Cannot delete the current branch.' });
    return 'failed';
  }
  try {
    await ops.deleteLocal(git, b.name, false);
    return 'done';
  } catch (e) {
    if (!(e instanceof GitError) || !e.stderr.includes('not fully merged')) {
      ui.error({ key: 'Could not delete branch {0}.', args: [b.name] }, e);
      return 'failed';
    }
  }
  try {
    const against = snap.base?.compareRef ?? b.upstream ?? 'HEAD';
    const unmerged = (await logRange(git, against, b.name, { skip: 0, limit: 100000 })).length;
    const choice = await ui.confirm(
      { key: 'Branch {0} has {1} unmerged commits that will be lost.', args: [b.name, unmerged] },
      [{ key: 'Delete Anyway' }],
      { modal: true },
    );
    if (choice === undefined) {
      return 'cancelled';
    }
    await ops.deleteLocal(git, b.name, true);
    return 'done';
  } catch (e) {
    ui.error({ key: 'Could not delete branch {0}.', args: [b.name] }, e);
    return 'failed';
  }
}

export async function deleteRemoteFlow(c: FlowCtx, b: BranchRef): Promise<FlowResult> {
  const { git, ui } = c;
  if (!b.remote) {
    ui.error({ key: 'No remote configured.' });
    return 'failed';
  }
  const choice = await ui.confirm(
    { key: 'Delete remote branch {0}? This affects everyone.', args: [b.name] },
    [{ key: 'Delete' }],
    { modal: true },
  );
  if (choice === undefined) {
    return 'cancelled';
  }
  try {
    await ops.deleteRemote(git, b.remote, b.shortName);
    return 'done';
  } catch (e) {
    ui.error({ key: 'Could not delete remote branch {0}.', args: [b.name] }, e);
    return 'failed';
  }
}

export async function pushFlow(c: FlowCtx, b: BranchRef): Promise<FlowResult> {
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
    return 'done';
  } catch (e) {
    if (!isNonFastForward(e)) {
      ui.error({ key: 'Could not push {0}.', args: [b.name] }, e);
      return 'failed';
    }
  }
  const choice = await ui.confirm(
    { key: 'Push was rejected. Force push with lease?' },
    [{ key: 'Force Push (with lease)' }],
    { modal: true },
  );
  if (choice === undefined) {
    return 'cancelled';
  }
  try {
    await ops.push(git, b.name, { setUpstreamTo, forceWithLease: true });
    return 'done';
  } catch (e) {
    ui.error({ key: 'Could not push {0}.', args: [b.name] }, e);
    return 'failed';
  }
}

export async function pullFlow(c: FlowCtx, b: BranchRef): Promise<FlowResult> {
  const { git, ui, snap } = c;
  try {
    if (b.isHead) {
      await ops.pull(git);
      return 'done';
    }
    const up = b.upstream ? remoteOf(snap, b.upstream) : undefined;
    if (!up || b.upstreamGone) {
      ui.error({ key: 'Branch {0} has no upstream to pull from.', args: [b.name] });
      return 'failed';
    }
    await ops.fastForward(git, up.remote, up.branch, b.name);
    return 'done';
  } catch (e) {
    if (isNonFastForward(e)) {
      ui.info({ key: '{0} cannot be fast-forwarded.', args: [b.name] });
      return 'failed';
    }
    ui.error({ key: 'Could not pull {0}.', args: [b.name] }, e);
    return 'failed';
  }
}

export async function syncFlow(c: FlowCtx): Promise<FlowResult> {
  const { git, ui, snap } = c;
  if (inProgress(c)) {
    return 'failed';
  }
  try {
    await ops.fetchAll(git);
  } catch (e) {
    ui.error({ key: 'Fetch failed.' }, e);
    return 'failed';
  }
  const base = snap.base;
  if (!base?.local || !base.remoteRef) {
    return 'done';
  }
  try {
    if (snap.state.head === base.local) {
      await ops.mergeFfOnly(git, base.remoteRef);
    } else {
      const up = remoteOf(snap, base.remoteRef);
      if (up) {
        await ops.fastForward(git, up.remote, up.branch, base.local);
      }
    }
  } catch (e) {
    if (isNonFastForward(e)) {
      ui.info({ key: '{0} cannot be fast-forwarded.', args: [base.local] });
      return 'done';
    }
    ui.error({ key: 'Could not update {0}.', args: [base.local] }, e);
    return 'failed';
  }
  return 'done';
}

export async function cleanupMergedFlow(c: FlowCtx): Promise<FlowResult> {
  const { git, ui, snap } = c;
  if (inProgress(c)) {
    return 'failed';
  }
  const candidates = [...snap.merged].filter((n) => n !== snap.state.head && n !== snap.base?.local).sort();
  if (candidates.length === 0) {
    ui.info({ key: 'No merged branches to clean up.' });
    return 'done';
  }
  const chosen = await ui.pickMany(
    candidates.map((n) => ({ label: n, picked: true, value: n })),
    { key: 'Delete merged branches' },
  );
  if (!chosen || chosen.length === 0) {
    return 'cancelled';
  }
  const failed: string[] = [];
  let firstError: unknown;
  for (const name of chosen) {
    try {
      // Never forced: git re-checks that the branch is merged.
      await ops.deleteLocal(git, name, false);
    } catch (e) {
      failed.push(name);
      firstError ??= e;
    }
  }
  if (failed.length > 0) {
    ui.error({ key: 'Could not delete {0} branches: {1}', args: [failed.length, failed.join(', ')] }, firstError);
    return 'failed';
  }
  return 'done';
}
