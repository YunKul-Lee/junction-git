import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryPendingStore, PendingPush, PendingPushStore } from '../../src/flows/pendingPush';
import { finishMergeFlow, PushCtx, pushFlow, resumePendingPushFlow } from '../../src/flows/pushFlows';
import { checkoutSide } from '../../src/git/operations';
import { BranchRef } from '../../src/git/types';
import { loadSnapshot, RepoSnapshot } from '../../src/model/repoModel';
import { FakeUi } from '../helpers/fakeUi';
import { makeRepo, TestRepo } from '../helpers/repo';

describe('push with merge', () => {
  let repo: TestRepo;
  const extraDirs: string[] = [];
  afterEach(async () => {
    await repo.cleanup();
    await Promise.all(extraDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  const ref = (snap: RepoSnapshot, name: string): BranchRef => {
    const b = snap.branches.find((x) => x.kind === 'local' && x.name === name);
    if (!b) {
      throw new Error(`no branch ${name}`);
    }
    return b;
  };
  const head = async (): Promise<string> => (await repo.sh('rev-parse', '--abbrev-ref', 'HEAD')).trim();
  const rev = async (r: string): Promise<string> => (await repo.sh('rev-parse', r)).trim();
  const remoteSha = async (b: string): Promise<string> =>
    (await repo.sh('ls-remote', 'origin', `refs/heads/${b}`)).split('\t')[0];
  const merging = (): boolean => existsSync(path.join(repo.dir, '.git', 'MERGE_HEAD'));

  /** Pushes a commit writing `file` to origin/<branch> from a second clone; returns its sha. */
  async function pushFromOtherClone(branch: string, file = 'other.txt', content = `${branch} ${Math.random()}\n`): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'junction-other-'));
    extraDirs.push(dir);
    const other = path.join(dir, 'c');
    const c = (...a: string[]): Promise<string> =>
      repo.sh('-C', other, '-c', 'user.name=O', '-c', 'user.email=o@example.com', ...a);
    await repo.sh('clone', repo.remoteDir, other);
    await c('checkout', branch);
    await fs.writeFile(path.join(other, file), content);
    await c('add', file);
    await c('commit', '-m', 'other');
    await c('push', 'origin', branch);
    return (await c('rev-parse', 'HEAD')).trim();
  }

  async function ctx(ui: FakeUi, pending: PendingPushStore = memoryPendingStore()): Promise<PushCtx> {
    return { git: repo.git, ui, snap: await loadSnapshot(repo.git, { baseBranch: '' }), pending };
  }

  /** feature/p is pushed, then the remote and the local branch each gain one commit. Returns the remote sha. */
  async function rejectedSetup(conflict = false): Promise<string> {
    await repo.sh('checkout', '-b', 'feature/p');
    await repo.commit('p1');
    await repo.sh('push', '-u', 'origin', 'feature/p');
    const remote = conflict
      ? await pushFromOtherClone('feature/p', 'shared.txt', 'theirs\n')
      : await pushFromOtherClone('feature/p');
    if (conflict) {
      await repo.commit('p2', 'shared.txt', 'ours\n');
    } else {
      await repo.commit('p2');
    }
    return remote;
  }

  /** Runs the rejected push into a conflicting merge; returns the remote sha and the store holding the marker. */
  async function conflictingMerge(): Promise<{ remote: string; pending: PendingPushStore }> {
    const remote = await rejectedSetup(true);
    const pending = memoryPendingStore();
    const c = await ctx(new FakeUi([0]), pending);
    expect(await pushFlow(c, ref(c.snap, 'feature/p'))).toBe('conflicts');
    return { remote, pending };
  }

  it('rejected push + Merge merges the remote and pushes', async () => {
    repo = await makeRepo();
    const remote = await rejectedSetup();
    const ui = new FakeUi([0]);
    const c = await ctx(ui);
    expect(await pushFlow(c, ref(c.snap, 'feature/p'))).toBe('done');
    const local = await rev('HEAD');
    expect(await remoteSha('feature/p')).toBe(local);
    expect((await repo.sh('rev-list', '--parents', '-n', '1', 'HEAD')).trim().split(' ')).toHaveLength(3);
    expect(await repo.sh('merge-base', '--is-ancestor', remote, 'HEAD')).toBe('');
    expect(await repo.sh('log', '-1', '--format=%s')).toContain('origin/feature/p');
    const first = ui.of('confirm')[0];
    expect(first.msg.key).toBe('Push was rejected.');
    expect(first.actions?.map((a) => a.key)).toEqual(['Merge and Push', 'Force Push (with lease)']);
    expect(first.opts?.modal).toBe(true);
    expect(first.opts?.detail).toEqual({
      key: '{0} has {1} commits that are not in your branch.',
      args: ['origin/feature/p', 1],
    });
  });

  it('merges the configured upstream, not the local name', async () => {
    repo = await makeRepo();
    await repo.sh('checkout', '-b', 'other');
    await repo.commit('o1');
    await repo.sh('push', '-u', 'origin', 'other');
    await repo.sh('branch', '-m', 'other', 'topic');
    await pushFromOtherClone('other');
    await repo.commit('t1');
    const c = await ctx(new FakeUi([0]));
    expect(await pushFlow(c, ref(c.snap, 'topic'))).toBe('done');
    expect(await remoteSha('other')).toBe(await rev('topic'));
    expect(await repo.sh('log', '-1', '--format=%s')).toContain('origin/other');
  });

  it('dirty tree stops before switching', async () => {
    repo = await makeRepo();
    await rejectedSetup();
    await repo.sh('checkout', 'develop');
    await fs.writeFile(path.join(repo.dir, 'README.md'), 'edited\n');
    const before = await remoteSha('feature/p');
    const ui = new FakeUi([0]);
    const c = await ctx(ui);
    expect(await pushFlow(c, ref(c.snap, 'feature/p'))).toBe('failed');
    expect(ui.of('error')[0].msg.key).toBe('Commit or stash your changes first.');
    expect(await head()).toBe('develop');
    expect(await remoteSha('feature/p')).toBe(before);
  });

  it('non-HEAD branch: Checkout and Merge switches then merges', async () => {
    repo = await makeRepo();
    await rejectedSetup();
    await repo.sh('checkout', 'develop');
    const ui = new FakeUi([0]);
    const c = await ctx(ui);
    expect(await pushFlow(c, ref(c.snap, 'feature/p'))).toBe('done');
    expect(ui.of('confirm')[0].actions?.[0].key).toBe('Checkout and Merge');
    expect(await head()).toBe('feature/p');
    expect(await remoteSha('feature/p')).toBe(await rev('feature/p'));
  });

  it('conflicting merge returns conflicts and records the pending push', async () => {
    repo = await makeRepo();
    const { remote, pending } = await conflictingMerge();
    expect(pending.get()).toEqual({ branch: 'feature/p', tip: remote });
    expect(merging()).toBe(true);
    expect(await remoteSha('feature/p')).toBe(remote);
  });

  it('finishMergeFlow clears the marker before continuing and pushes', async () => {
    repo = await makeRepo();
    const { pending } = await conflictingMerge();
    await checkoutSide(repo.git, 'shared.txt', 'theirs');
    const order: string[] = [];
    const spy: PendingPushStore = {
      get: (): PendingPush | undefined => pending.get(),
      set: (p) => pending.set(p),
      clear: () => {
        order.push(merging() ? 'clear while merging' : 'clear after merge');
        pending.clear();
      },
    };
    const c = await ctx(new FakeUi(), spy);
    expect(await finishMergeFlow(c, { push: true })).toBe('done');
    expect(order[0]).toBe('clear while merging');
    expect(pending.get()).toBeUndefined();
    expect(merging()).toBe(false);
    expect(await remoteSha('feature/p')).toBe(await rev('HEAD'));
  });

  it('finishMergeFlow push:false only completes the merge', async () => {
    repo = await makeRepo();
    const { remote, pending } = await conflictingMerge();
    await checkoutSide(repo.git, 'shared.txt', 'ours');
    const c = await ctx(new FakeUi(), pending);
    expect(await finishMergeFlow(c, { push: false })).toBe('done');
    expect(pending.get()).toBeUndefined();
    expect(merging()).toBe(false);
    expect(await remoteSha('feature/p')).toBe(remote);
  });

  it('finishMergeFlow keeps the marker when the merge cannot be concluded yet', async () => {
    repo = await makeRepo();
    const { remote, pending } = await conflictingMerge();
    const c = await ctx(new FakeUi(), pending);
    expect(await finishMergeFlow(c, { push: true })).toBe('conflicts');
    expect(pending.get()).toEqual({ branch: 'feature/p', tip: remote });
    expect(merging()).toBe(true);
  });

  it('finishMergeFlow completes the merge but does not push when HEAD is another branch', async () => {
    repo = await makeRepo();
    const remote = await rejectedSetup(true);
    // The marker names a branch other than the one being merged.
    const pending = memoryPendingStore();
    const c0 = await ctx(new FakeUi([0]), pending);
    expect(await pushFlow(c0, ref(c0.snap, 'feature/p'))).toBe('conflicts');
    pending.set({ branch: 'develop', tip: remote });
    await checkoutSide(repo.git, 'shared.txt', 'theirs');
    const ui = new FakeUi();
    const c = await ctx(ui, pending);
    expect(await finishMergeFlow(c, { push: true })).toBe('done');
    expect(merging()).toBe(false);
    expect(ui.of('info')[0].msg).toEqual({
      key: 'The merge is complete. {0} was not pushed because another branch is checked out.',
      args: ['develop'],
    });
    expect(pending.get()).toBeUndefined();
    expect(await remoteSha('feature/p')).toBe(remote);
  });

  it('leftover markers block the push', async () => {
    repo = await makeRepo();
    const { remote, pending } = await conflictingMerge();
    await repo.sh('add', 'shared.txt');
    const ui = new FakeUi();
    const c = await ctx(ui, pending);
    expect(await finishMergeFlow(c, { push: true })).toBe('failed');
    expect(ui.of('error')[0].msg).toEqual({
      key: 'Conflict markers are left in {0}. Fix them and push again.',
      args: ['shared.txt'],
    });
    expect(pending.get()).toBeUndefined();
    expect(await remoteSha('feature/p')).toBe(remote);
  });

  it('resume pushes after a merge finished outside Junction', async () => {
    repo = await makeRepo();
    const { pending } = await conflictingMerge();
    await checkoutSide(repo.git, 'shared.txt', 'theirs');
    await repo.sh('commit', '--no-edit');
    const ui = new FakeUi([0]);
    const c = await ctx(ui, pending);
    expect(await resumePendingPushFlow(c)).toBe('done');
    expect(ui.of('confirm')[0].msg).toEqual({ key: 'The merge is finished. Push {0} now?', args: ['feature/p'] });
    expect(await remoteSha('feature/p')).toBe(await rev('HEAD'));
    expect(pending.get()).toBeUndefined();
  });

  it('resume: a push rejected again can merge and stop on conflicts', async () => {
    repo = await makeRepo();
    const { pending } = await conflictingMerge();
    await checkoutSide(repo.git, 'shared.txt', 'ours');
    await repo.sh('commit', '--no-edit');
    // The remote moves again, conflicting with the merge result.
    const newer = await pushFromOtherClone('feature/p', 'shared.txt', 'theirs again\n');
    const ui = new FakeUi([0, 0]);
    const c = await ctx(ui, pending);
    expect(await resumePendingPushFlow(c)).toBe('conflicts');
    expect(ui.of('confirm').map((x) => x.msg.key)).toEqual(['The merge is finished. Push {0} now?', 'Push was rejected.']);
    expect(pending.get()).toEqual({ branch: 'feature/p', tip: newer });
    expect(merging()).toBe(true);
    expect(await remoteSha('feature/p')).toBe(newer);
  });

  it('resume keeps the marker while the merge is still in progress', async () => {
    repo = await makeRepo();
    const { remote, pending } = await conflictingMerge();
    const ui = new FakeUi([0]);
    const c = await ctx(ui, pending);
    expect(await resumePendingPushFlow(c)).toBe('cancelled');
    expect(ui.of('confirm')).toHaveLength(0);
    expect(pending.get()).toEqual({ branch: 'feature/p', tip: remote });
  });

  it('resume clears the marker silently after an abort', async () => {
    repo = await makeRepo();
    const { remote, pending } = await conflictingMerge();
    await repo.sh('merge', '--abort');
    const ui = new FakeUi([0]);
    const c = await ctx(ui, pending);
    expect(await resumePendingPushFlow(c)).toBe('cancelled');
    expect(ui.of('confirm')).toHaveLength(0);
    expect(pending.get()).toBeUndefined();
    expect(await remoteSha('feature/p')).toBe(remote);
  });

  it('resume clears the marker when HEAD is another branch', async () => {
    repo = await makeRepo();
    const { remote, pending } = await conflictingMerge();
    await checkoutSide(repo.git, 'shared.txt', 'theirs');
    await repo.sh('commit', '--no-edit');
    await repo.sh('checkout', 'develop');
    const ui = new FakeUi([0]);
    const c = await ctx(ui, pending);
    expect(await resumePendingPushFlow(c)).toBe('cancelled');
    expect(ui.of('confirm')).toHaveLength(0);
    expect(pending.get()).toBeUndefined();
    expect(await remoteSha('feature/p')).toBe(remote);
  });
});
