import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictCtx, conflictListFlow } from '../../src/flows/conflictFlows';
import { memoryPendingStore, PendingPushStore } from '../../src/flows/pendingPush';
import { conflictedFiles } from '../../src/git/operations';
import { loadSnapshot } from '../../src/model/repoModel';
import { FakeUi } from '../helpers/fakeUi';
import { makeRepo, TestRepo } from '../helpers/repo';

describe('conflictListFlow', () => {
  let repo: TestRepo;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await repo.cleanup();
  });

  const read = async (f: string): Promise<string> => fs.readFile(path.join(repo.dir, f), 'utf8');
  const open = vi.fn<(file: string) => Promise<void>>();
  const openFile = vi.fn<(file: string) => Promise<void>>();

  async function ctx(ui: FakeUi, pending: PendingPushStore = memoryPendingStore()): Promise<ConflictCtx> {
    open.mockReset();
    open.mockResolvedValue(undefined);
    openFile.mockReset();
    openFile.mockResolvedValue(undefined);
    const snap = await loadSnapshot(repo.git, { baseBranch: '' });
    return { git: repo.git, ui, snap, pending, openMergeEditor: open, openFile };
  }

  /** develop and topic both edit README.md; HEAD is left on develop. */
  async function diverge(): Promise<void> {
    await repo.sh('switch', '-c', 'topic');
    await repo.commit('topic', 'README.md', 'topic\n');
    await repo.sh('switch', 'develop');
    await repo.commit('develop', 'README.md', 'develop\n');
  }

  async function mergeConflict(): Promise<void> {
    await diverge();
    await expect(repo.sh('merge', 'topic')).rejects.toBeDefined();
  }

  it('reports when there are no conflicted files', async () => {
    const ui = new FakeUi();
    expect(await conflictListFlow(await ctx(ui))).toBe('done');
    expect(ui.of('info')[0].msg.key).toBe('No conflicted files.');
    expect(ui.of('pick')).toHaveLength(0);
  });

  it('picking a file opens it in the merge editor', async () => {
    await mergeConflict();
    const ui = new FakeUi([{ kind: 'file', file: 'README.md' }]);
    expect(await conflictListFlow(await ctx(ui))).toBe('done');
    expect(open).toHaveBeenCalledWith('README.md');
    expect(openFile).not.toHaveBeenCalled();
  });

  it('picking a file deleted on one side opens it in a plain editor', async () => {
    await repo.commit('add a', 'a.txt', 'a\n');
    await repo.sh('switch', '-c', 'topic');
    await repo.sh('rm', '-q', 'a.txt');
    await repo.sh('commit', '-m', 'topic deletes a');
    await repo.sh('switch', 'develop');
    await repo.commit('develop edits a', 'a.txt', 'changed\n');
    await expect(repo.sh('merge', 'topic')).rejects.toBeDefined();
    const ui = new FakeUi([{ kind: 'file', file: 'a.txt' }]);
    expect(await conflictListFlow(await ctx(ui))).toBe('done');
    expect(openFile).toHaveBeenCalledWith('a.txt');
    expect(open).not.toHaveBeenCalled();
    expect(ui.of('info')[0].msg).toEqual({
      key: '{0} was deleted on one side. Edit or delete the file, then stage it.',
      args: ['a.txt'],
    });
  });

  it('accept theirs for all resolves every file after confirm', async () => {
    await mergeConflict();
    const ui = new FakeUi([{ kind: 'theirs' }, 0]);
    expect(await conflictListFlow(await ctx(ui))).toBe('done');
    expect(await conflictedFiles(repo.git)).toEqual([]);
    expect(await read('README.md')).toBe('topic\n');
  });

  it("accept mine during a rebase keeps my commit's content", async () => {
    await diverge();
    await repo.sh('switch', 'topic');
    await expect(repo.sh('rebase', 'develop')).rejects.toBeDefined();
    const ui = new FakeUi([{ kind: 'mine' }, 0]);
    expect(await conflictListFlow(await ctx(ui))).toBe('done');
    expect(await conflictedFiles(repo.git)).toEqual([]);
    expect(await read('README.md')).toBe('topic\n');
  });

  it('cancelling the bulk confirm changes nothing', async () => {
    await mergeConflict();
    const ui = new FakeUi([{ kind: 'theirs' }, undefined]);
    expect(await conflictListFlow(await ctx(ui))).toBe('cancelled');
    expect(await conflictedFiles(repo.git)).toEqual(['README.md']);
  });

  it('abort clears the pending push', async () => {
    await mergeConflict();
    const pending = memoryPendingStore({ branch: 'develop', tip: 'abc' });
    const ui = new FakeUi([{ kind: 'abort' }, 0]);
    expect(await conflictListFlow(await ctx(ui, pending))).toBe('done');
    expect(existsSync(path.join(repo.dir, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(pending.get()).toBeUndefined();
  });

  it('offers no Abort when nothing is in progress', async () => {
    await repo.commit('a', 'README.md', 'one\n');
    await fs.writeFile(path.join(repo.dir, 'README.md'), 'stashed\n');
    await repo.sh('stash');
    await repo.commit('b', 'README.md', 'two\n');
    await expect(repo.sh('stash', 'pop')).rejects.toBeDefined();
    expect(await conflictedFiles(repo.git)).toEqual(['README.md']);
    const ui = new FakeUi();
    await conflictListFlow(await ctx(ui));
    const items = ui.of('pick')[0].items as { value: { kind: string } }[];
    expect(items.map((i) => i.value.kind)).toEqual(['file', 'mine', 'theirs']);
  });
});
