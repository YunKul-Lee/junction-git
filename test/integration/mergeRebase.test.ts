import * as fs from 'fs/promises';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abortFlow, continueFlow, mergeIntoCurrentFlow, rebaseCurrentOntoFlow } from '../../src/flows/mergeFlows';
import { repoState } from '../../src/git/queries';
import { BranchRef } from '../../src/git/types';
import { loadSnapshot, RepoSnapshot } from '../../src/model/repoModel';
import { FakeUi } from '../helpers/fakeUi';
import { makeRepo, TestRepo } from '../helpers/repo';

describe('merge and rebase flows', () => {
  let repo: TestRepo;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await repo.cleanup();
  });

  const snapOf = (): Promise<RepoSnapshot> => loadSnapshot(repo.git, { baseBranch: '' });
  const ref = (snap: RepoSnapshot, name: string): BranchRef => snap.branches.find((b) => b.kind === 'local' && b.name === name)!;
  const rev = async (r: string): Promise<string> => (await repo.sh('rev-parse', r)).trim();
  const ctx = async (answers: unknown[] = []): Promise<{ ui: FakeUi; c: { git: typeof repo.git; ui: FakeUi; snap: RepoSnapshot } }> => {
    const ui = new FakeUi(answers);
    return { ui, c: { git: repo.git, ui, snap: await snapOf() } };
  };

  /** develop and `topic` both edit README.md differently, with HEAD on develop. */
  async function conflicting(): Promise<void> {
    await repo.sh('switch', '-c', 'topic');
    await repo.commit('topic edit', 'README.md', 'topic\n');
    await repo.sh('switch', 'develop');
    await repo.commit('develop edit', 'README.md', 'develop\n');
  }

  it('merges without conflicts', async () => {
    await repo.sh('switch', '-c', 'topic');
    const t = await repo.commit('topic work', 'topic.txt', 'x\n');
    await repo.sh('switch', 'develop');
    await repo.commit('develop work', 'dev.txt', 'y\n');
    const { c } = await ctx([0]);
    expect(await mergeIntoCurrentFlow(c, ref(c.snap, 'topic'), { confirm: true })).toBe('done');
    expect((await repo.sh('merge-base', '--is-ancestor', t, 'HEAD').then(() => true))).toBe(true);
  });

  it('merge commit message names the branch by its short name', async () => {
    await repo.sh('switch', '-c', 'topic');
    await repo.commit('topic work', 'topic.txt', 'x\n');
    await repo.sh('push', 'origin', 'topic');
    await repo.sh('switch', 'develop');
    await repo.commit('develop work', 'dev.txt', 'y\n');
    const { c } = await ctx();
    expect(await mergeIntoCurrentFlow(c, ref(c.snap, 'topic'), { confirm: false })).toBe('done');
    expect((await repo.sh('log', '-1', '--format=%s')).trim()).toBe("Merge branch 'topic' into develop");

    await repo.sh('switch', '-c', 'other', 'HEAD~1');
    await repo.commit('other work', 'other.txt', 'z\n');
    const { c: c2 } = await ctx();
    const remote = c2.snap.branches.find((b) => b.kind === 'remote' && b.name === 'origin/topic')!;
    expect(await mergeIntoCurrentFlow(c2, remote, { confirm: false })).toBe('done');
    expect((await repo.sh('log', '-1', '--format=%s')).trim()).toBe("Merge remote-tracking branch 'origin/topic' into other");
  });

  it('merge conflict hands off and abort restores HEAD', async () => {
    await conflicting();
    const before = await rev('HEAD');
    const { c } = await ctx();
    expect(await mergeIntoCurrentFlow(c, ref(c.snap, 'topic'), { confirm: false })).toBe('conflicts');
    expect((await repoState(repo.git)).merging).toBe(true);
    const cancelled = await ctx([undefined]);
    expect(await abortFlow(cancelled.c)).toBe('cancelled');
    expect((await repoState(repo.git)).merging).toBe(true);
    expect(cancelled.ui.of('confirm')[0].msg.key).toBe('Abort the merge? Conflict resolutions you made will be lost.');
    expect(cancelled.ui.of('confirm')[0].opts?.modal).toBe(true);
    const next = await ctx([0]);
    expect(await abortFlow(next.c)).toBe('done');
    expect((await repoState(repo.git)).merging).toBe(false);
    expect(await rev('HEAD')).toBe(before);
  });

  it('rebase abort asks first, then restores the pre-rebase HEAD', async () => {
    await conflicting();
    await repo.sh('switch', 'topic');
    const before = await rev('HEAD');
    const { c } = await ctx();
    expect(await rebaseCurrentOntoFlow(c, ref(c.snap, 'develop'), { confirm: false })).toBe('conflicts');
    const next = await ctx([0]);
    expect(await abortFlow(next.c)).toBe('done');
    expect(next.ui.of('confirm')[0].msg.key).toBe(
      'Abort the rebase? Commits already replayed and your conflict resolutions will be lost.',
    );
    expect((await repoState(repo.git)).rebase).toBeUndefined();
    expect(await rev('HEAD')).toBe(before);
  });

  it('rebase conflict reports step/total and continue finishes', async () => {
    await conflicting();
    await repo.sh('switch', 'topic');
    const { c } = await ctx();
    expect(await rebaseCurrentOntoFlow(c, ref(c.snap, 'develop'), { confirm: false })).toBe('conflicts');
    const state = await repoState(repo.git);
    expect(state.rebase).toEqual({ step: 1, total: 1 });
    await fs.writeFile(path.join(repo.dir, 'README.md'), 'resolved\n');
    await repo.sh('add', 'README.md');
    const next = await ctx();
    expect(await continueFlow(next.c)).toBe('done');
    expect((await repoState(repo.git)).rebase).toBeUndefined();
    expect(await repo.sh('rev-parse', '--abbrev-ref', 'HEAD')).toBe('topic\n');
  });

  it('refuses a dirty tree without asking', async () => {
    await repo.sh('switch', '-c', 'topic');
    await repo.commit('topic work', 'topic.txt', 'x\n');
    await repo.sh('switch', 'develop');
    await fs.writeFile(path.join(repo.dir, 'README.md'), 'dirty\n');
    const { ui, c } = await ctx([0]);
    expect(await mergeIntoCurrentFlow(c, ref(c.snap, 'topic'), { confirm: true })).toBe('failed');
    expect(await rebaseCurrentOntoFlow(c, ref(c.snap, 'topic'), { confirm: true })).toBe('failed');
    expect(ui.of('confirm')).toHaveLength(0);
    expect(ui.of('error')[0].msg.key).toBe('Commit or stash your changes first.');
  });

  it('cancelled confirmation leaves HEAD alone', async () => {
    await repo.sh('switch', '-c', 'topic');
    await repo.commit('topic work', 'topic.txt', 'x\n');
    await repo.sh('switch', 'develop');
    const before = await rev('HEAD');
    const { ui, c } = await ctx([undefined]);
    expect(await mergeIntoCurrentFlow(c, ref(c.snap, 'topic'), { confirm: true })).toBe('cancelled');
    expect(await rev('HEAD')).toBe(before);
    expect(ui.of('confirm')[0].msg).toEqual({ key: 'Merge {0} into {1}?', args: ['topic', 'develop'] });
  });

  it('warns about force push when rebasing a pushed branch', async () => {
    await repo.sh('switch', '-c', 'other');
    await repo.commit('other work', 'other.txt', 'x\n');
    await repo.sh('switch', 'develop');
    const { ui, c } = await ctx([undefined]);
    expect(await rebaseCurrentOntoFlow(c, ref(c.snap, 'other'), { confirm: true })).toBe('cancelled');
    const call = ui.of('confirm')[0];
    expect(call.msg).toEqual({ key: 'Rebase {0} onto {1}?', args: ['develop', 'other'] });
    expect(call.opts?.detail?.key).toBe('This branch is already pushed. You will need to force push after rebasing.');
  });
});
