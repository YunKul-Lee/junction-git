import * as ops from '../git/operations';
import { abortFlow, MergeResult } from './mergeFlows';
import type { PushCtx } from './pushFlows';

export interface ConflictCtx extends PushCtx {
  openMergeEditor(file: string): Promise<void>;
}

type Op = 'merge' | 'rebase' | 'none';
type Choice = { kind: 'file'; file: string } | { kind: 'mine' } | { kind: 'theirs' } | { kind: 'abort' };

/** Git's "ours" is the branch being rebased onto, so "mine" and "theirs" swap during a rebase. */
export function sideFor(choice: 'mine' | 'theirs', op: Op): 'ours' | 'theirs' {
  if (op === 'rebase') {
    return choice === 'mine' ? 'theirs' : 'ours';
  }
  return choice === 'mine' ? 'ours' : 'theirs';
}

// Messages are inline `{ key, args }` literals on purpose; see branchFlows.ts.

export async function conflictListFlow(c: ConflictCtx): Promise<MergeResult> {
  const { git, ui, snap } = c;
  let files: string[];
  try {
    files = await ops.conflictedFiles(git);
  } catch (e) {
    ui.error({ key: 'Could not list conflicted files.' }, e);
    return 'failed';
  }
  if (files.length === 0) {
    ui.info({ key: 'No conflicted files.' });
    return 'done';
  }
  const op: Op = snap.state.rebase !== undefined ? 'rebase' : snap.state.merging ? 'merge' : 'none';
  const items: { label: string; labelMsg?: { key: string }; value: Choice }[] = [
    ...files.map((file) => ({ label: file, value: { kind: 'file', file } as Choice })),
    { label: '', labelMsg: { key: 'Accept Mine for All' }, value: { kind: 'mine' } },
    { label: '', labelMsg: { key: 'Accept Theirs for All' }, value: { kind: 'theirs' } },
  ];
  if (op !== 'none') {
    items.push({ label: '', labelMsg: { key: 'Abort' }, value: { kind: 'abort' } });
  }
  const picked = await ui.pick(items, { key: '{0} conflicted files. Select one to resolve.', args: [files.length] });
  if (!picked) {
    return 'cancelled';
  }
  if (picked.kind === 'file') {
    await c.openMergeEditor(picked.file);
    return 'done';
  }
  if (picked.kind === 'abort') {
    const result = await abortFlow(c);
    if (result === 'done') {
      c.pending.clear();
    }
    return result;
  }
  const choice = picked.kind;
  const confirmed = await ui.confirm(
    choice === 'mine'
      ? { key: 'Use your version for {0} files? Their changes in these files will be lost.', args: [files.length] }
      : { key: 'Use their version for {0} files? Your changes in these files will be lost.', args: [files.length] },
    [{ key: 'Replace' }],
    { modal: true },
  );
  if (confirmed === undefined) {
    return 'cancelled';
  }
  const side = sideFor(choice, op);
  for (const file of files) {
    try {
      await ops.checkoutSide(git, file, side);
    } catch (e) {
      ui.error({ key: 'Could not resolve {0}.', args: [file] }, e);
      return 'failed';
    }
  }
  return 'done';
}
