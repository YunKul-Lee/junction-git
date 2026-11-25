import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkoutFlow,
  cleanupMergedFlow,
  deleteLocalFlow,
  deleteRemoteFlow,
  newBranchFlow,
  pullFlow,
  pushFlow,
  renameFlow,
  syncFlow,
} from '../../src/flows/branchFlows';
import { BranchRef } from '../../src/git/types';
import { loadSnapshot, RepoSnapshot } from '../../src/model/repoModel';
import { FakeUi } from '../helpers/fakeUi';
import { makeRepo, TestRepo } from '../helpers/repo';

describe('branch flows', () => {
  let repo: TestRepo;
  const extraDirs: string[] = [];
  afterEach(async () => {
    await repo.cleanup();
    await Promise.all(extraDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  const snapOf = (): Promise<RepoSnapshot> => loadSnapshot(repo.git, { baseBranch: '' });
  const ref = (snap: RepoSnapshot, name: string, kind: 'local' | 'remote' = 'local'): BranchRef => {
    const b = snap.branches.find((x) => x.kind === kind && x.name === name);
    if (!b) {
      throw new Error(`no branch ${name}`);
    }
    return b;
  };
  const head = async (): Promise<string> => (await repo.sh('rev-parse', '--abbrev-ref', 'HEAD')).trim();
  const rev = async (r: string): Promise<string> => (await repo.sh('rev-parse', r)).trim();
  const lsRemote = (b: string): Promise<string> => repo.sh('ls-remote', 'origin', `refs/heads/${b}`);
  const hasLocal = async (b: string): Promise<boolean> =>
    (await repo.sh('branch', '--list', b)).trim().length > 0;

  /** Pushes a commit to origin/<branch> from a second clone. */
  async function pushFromOtherClone(branch: string, create = false): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'junction-other-'));
    extraDirs.push(dir);
    const other = path.join(dir, 'c');
    const c = (...a: string[]): Promise<string> =>
      repo.sh('-C', other, '-c', 'user.name=O', '-c', 'user.email=o@example.com', ...a);
    await repo.sh('clone', repo.remoteDir, other);
    if (create) {
      await c('checkout', '-b', branch);
    } else {
      await c('checkout', branch);
    }
    await fs.writeFile(path.join(other, 'other.txt'), `${branch} ${Math.random()}\n`);
    await c('add', 'other.txt');
    await c('commit', '-m', 'other');
    await c('push', 'origin', branch);
    return (await c('rev-parse', 'HEAD')).trim();
  }

  async function ctx(ui: FakeUi): Promise<{ git: typeof repo.git; ui: FakeUi; snap: RepoSnapshot }> {
    return { git: repo.git, ui, snap: await snapOf() };
  }

  describe('checkout', () => {
    it('switches on a clean tree without confirming', async () => {
      repo = await makeRepo();
      await repo.sh('branch', 'feature/a');
      const ui = new FakeUi();
      const c = await ctx(ui);
      expect(await checkoutFlow(c, ref(c.snap, 'feature/a'))).toBe('done');
      expect(await head()).toBe('feature/a');
      expect(ui.of('confirm')).toHaveLength(0);
    });

    it('dirty + cancel leaves HEAD and files untouched', async () => {
      repo = await makeRepo();
      await repo.sh('branch', 'feature/a');
      const file = path.join(repo.dir, 'README.md');
      await fs.writeFile(file, 'edited\n');
      const ui = new FakeUi();
      const c = await ctx(ui);
      expect(await checkoutFlow(c, ref(c.snap, 'feature/a'))).toBe('cancelled');
      expect(await head()).toBe('develop');
      expect(await fs.readFile(file, 'utf8')).toBe('edited\n');
      expect(ui.of('confirm')).toHaveLength(1);
    });

    it('dirty + Stash and Switch stashes and switches', async () => {
      repo = await makeRepo();
      await repo.sh('branch', 'feature/a');
      await fs.writeFile(path.join(repo.dir, 'README.md'), 'edited\n');
      const ui = new FakeUi([0]);
      const c = await ctx(ui);
      expect(await checkoutFlow(c, ref(c.snap, 'feature/a'))).toBe('done');
      expect(await head()).toBe('feature/a');
      expect((await repo.sh('stash', 'list')).trim().split('\n')).toHaveLength(1);
      expect((await repo.sh('status', '--porcelain')).trim()).toBe('');
      expect(ui.of('info')).toHaveLength(1);
    });

    it('does not pop an unrelated older stash when nothing was stashed and the switch fails', async () => {
      repo = await makeRepo();
      const file = path.join(repo.dir, 'README.md');
      await fs.writeFile(file, 'old\n');
      await repo.sh('stash', 'push', '-m', 'older');
      await repo.sh('branch', 'feature/a');
      await fs.writeFile(file, 'dirty\n');
      const ui = new FakeUi([0]);
      const c = await ctx(ui); // snapshot sees a dirty tree
      await repo.sh('checkout', '--', 'README.md'); // ...which is clean by the time we stash
      await repo.sh('branch', '-D', 'feature/a'); // so the switch fails
      expect(await checkoutFlow(c, ref(c.snap, 'feature/a'))).toBe('failed');
      expect(await repo.sh('stash', 'list')).toContain('older');
      expect(await fs.readFile(file, 'utf8')).toBe('initial\n');
    });

    it('remote without local creates a tracking local branch', async () => {
      repo = await makeRepo();
      await repo.sh('checkout', '-b', 'feature/r');
      await repo.commit('r1');
      await repo.sh('push', 'origin', 'feature/r');
      await repo.sh('checkout', 'develop');
      await repo.sh('branch', '-D', 'feature/r');
      const c = await ctx(new FakeUi());
      expect(await checkoutFlow(c, ref(c.snap, 'origin/feature/r', 'remote'))).toBe('done');
      expect(await head()).toBe('feature/r');
      expect((await repo.sh('rev-parse', '--abbrev-ref', 'feature/r@{upstream}')).trim()).toBe('origin/feature/r');
    });

    it('remote with existing local switches to it', async () => {
      repo = await makeRepo();
      await repo.sh('checkout', '-b', 'feature/r');
      const local = await repo.commit('r1');
      await repo.sh('push', 'origin', 'feature/r');
      await repo.sh('checkout', 'develop');
      const c = await ctx(new FakeUi());
      expect(await checkoutFlow(c, ref(c.snap, 'origin/feature/r', 'remote'))).toBe('done');
      expect(await head()).toBe('feature/r');
      expect(await rev('feature/r')).toBe(local);
    });

    it('fails while a rebase is in progress', async () => {
      repo = await makeRepo();
      await repo.sh('branch', 'feature/a');
      const dir = path.join(repo.dir, '.git', 'rebase-merge');
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'msgnum'), '1');
      await fs.writeFile(path.join(dir, 'end'), '2');
      const ui = new FakeUi();
      const c = await ctx(ui);
      expect(await checkoutFlow(c, ref(c.snap, 'feature/a'))).toBe('failed');
      expect(ui.of('error')).toHaveLength(1);
      expect(await head()).toBe('develop');
    });
  });

  describe('new branch', () => {
    it('starts from the base remote ref when created from the base branch', async () => {
      repo = await makeRepo();
      const remoteHash = await rev('origin/develop');
      await repo.commit('local only');
      const ui = new FakeUi(['feature/n']);
      const c = await ctx(ui);
      expect(await newBranchFlow(c, ref(c.snap, 'develop'))).toBe('done');
      expect(await head()).toBe('feature/n');
      expect(await rev('feature/n')).toBe(remoteHash);
    });

    it('validate rejects invalid and existing names', async () => {
      repo = await makeRepo();
      await repo.sh('branch', 'taken');
      const ui = new FakeUi();
      const c = await ctx(ui);
      await newBranchFlow(c, ref(c.snap, 'develop'));
      const validate = ui.of('input')[0].opts!.validate!;
      expect(validate('a..b')).toBeDefined();
      expect(validate('-x')).toBeDefined();
      expect(validate('has space')).toBeDefined();
      expect(validate('x.lock')).toBeDefined();
      expect(validate('taken')).toBeDefined();
      expect(validate('feature/ok')).toBeUndefined();
    });

    it('carries uncommitted changes without asking', async () => {
      repo = await makeRepo();
      await fs.writeFile(path.join(repo.dir, 'README.md'), 'edited\n');
      const ui = new FakeUi(['feature/n']);
      const c = await ctx(ui);
      expect(await newBranchFlow(c, ref(c.snap, 'develop'))).toBe('done');
      expect(ui.of('confirm')).toHaveLength(0);
      expect(await fs.readFile(path.join(repo.dir, 'README.md'), 'utf8')).toBe('edited\n');
    });
  });

  describe('rename', () => {
    it('renames and notes that the remote branch was not renamed', async () => {
      repo = await makeRepo();
      const ui = new FakeUi(['trunk']);
      const c = await ctx(ui);
      expect(await renameFlow(c, ref(c.snap, 'develop'))).toBe('done');
      expect(await hasLocal('trunk')).toBe(true);
      expect(await hasLocal('develop')).toBe(false);
      await expect(repo.sh('rev-parse', '--abbrev-ref', 'trunk@{upstream}')).rejects.toThrow();
      expect(ui.of('info').map((i) => i.msg.key)).toEqual(['Remote branch was not renamed.']);
    });
  });

  describe('delete local', () => {
    it('deletes a merged branch without confirming', async () => {
      repo = await makeRepo();
      await repo.sh('branch', 'feature/m');
      const ui = new FakeUi();
      const c = await ctx(ui);
      expect(await deleteLocalFlow(c, ref(c.snap, 'feature/m'))).toBe('done');
      expect(await hasLocal('feature/m')).toBe(false);
      expect(ui.of('confirm')).toHaveLength(0);
    });

    async function unmerged(): Promise<void> {
      await repo.sh('checkout', '-b', 'feature/u');
      await repo.commit('u1');
      await repo.sh('checkout', 'develop');
    }

    it('unmerged + cancel keeps the branch and reports the commit count', async () => {
      repo = await makeRepo();
      await unmerged();
      const ui = new FakeUi();
      const c = await ctx(ui);
      expect(await deleteLocalFlow(c, ref(c.snap, 'feature/u'))).toBe('cancelled');
      expect(await hasLocal('feature/u')).toBe(true);
      expect(ui.of('confirm')[0].msg.args).toEqual(['feature/u', 1]);
      expect(ui.of('confirm')[0].opts?.modal).toBe(true);
    });

    it('unmerged + Delete Anyway deletes', async () => {
      repo = await makeRepo();
      await unmerged();
      const c = await ctx(new FakeUi([0]));
      expect(await deleteLocalFlow(c, ref(c.snap, 'feature/u'))).toBe('done');
      expect(await hasLocal('feature/u')).toBe(false);
    });

    it('refuses to delete the current branch', async () => {
      repo = await makeRepo();
      const ui = new FakeUi();
      const c = await ctx(ui);
      expect(await deleteLocalFlow(c, ref(c.snap, 'develop'))).toBe('failed');
      expect(ui.of('error')[0].msg.key).toBe('Cannot delete the current branch.');
      expect(await hasLocal('develop')).toBe(true);
    });
  });

  describe('delete remote', () => {
    it('cancel keeps it, confirm removes it', async () => {
      repo = await makeRepo();
      await repo.sh('checkout', '-b', 'feature/d');
      await repo.commit('d1');
      await repo.sh('push', 'origin', 'feature/d');
      await repo.sh('checkout', 'develop');

      let ui = new FakeUi();
      let c = await ctx(ui);
      expect(await deleteRemoteFlow(c, ref(c.snap, 'origin/feature/d', 'remote'))).toBe('cancelled');
      expect(await lsRemote('feature/d')).not.toBe('');
      expect(ui.of('confirm')[0].opts?.modal).toBe(true);

      ui = new FakeUi([0]);
      c = await ctx(ui);
      expect(await deleteRemoteFlow(c, ref(c.snap, 'origin/feature/d', 'remote'))).toBe('done');
      expect(await lsRemote('feature/d')).toBe('');
    });
  });

  describe('push', () => {
    it('creates the remote branch and sets the upstream when there is none', async () => {
      repo = await makeRepo();
      await repo.sh('checkout', '-b', 'feature/p');
      const h = await repo.commit('p1');
      const c = await ctx(new FakeUi());
      expect(await pushFlow(c, ref(c.snap, 'feature/p'))).toBe('done');
      expect((await lsRemote('feature/p')).split('\t')[0]).toBe(h);
      expect((await repo.sh('rev-parse', '--abbrev-ref', 'feature/p@{upstream}')).trim()).toBe('origin/feature/p');
    });

    async function rejectedSetup(): Promise<void> {
      await repo.sh('checkout', '-b', 'feature/p');
      await repo.commit('p1');
      await repo.sh('push', '-u', 'origin', 'feature/p');
      await pushFromOtherClone('feature/p');
      await repo.commit('p2');
    }

    it('rejected push + confirm force-pushes with lease', async () => {
      repo = await makeRepo();
      await rejectedSetup();
      const ui = new FakeUi([0]);
      const c = await ctx(ui);
      expect(await pushFlow(c, ref(c.snap, 'feature/p'))).toBe('done');
      expect((await lsRemote('feature/p')).split('\t')[0]).toBe(await rev('feature/p'));
      expect(ui.of('confirm')[0].opts?.modal).toBe(true);
      expect(ui.of('confirm')[0].opts?.detail?.args).toEqual(['origin/feature/p', 1]);
    });

    it('fails and keeps the remote when it moves after the confirmation', async () => {
      repo = await makeRepo();
      await rejectedSetup();
      let newer = '';
      const ui = new FakeUi([
        async () => {
          newer = await pushFromOtherClone('feature/p');
          return 0;
        },
      ]);
      const c = await ctx(ui);
      expect(await pushFlow(c, ref(c.snap, 'feature/p'))).toBe('failed');
      expect(ui.of('error')).toHaveLength(1);
      expect((await lsRemote('feature/p')).split('\t')[0]).toBe(newer);
    });

    it('rejected push + cancel leaves the remote alone', async () => {
      repo = await makeRepo();
      await rejectedSetup();
      const before = await lsRemote('feature/p');
      const c = await ctx(new FakeUi());
      expect(await pushFlow(c, ref(c.snap, 'feature/p'))).toBe('cancelled');
      expect(await lsRemote('feature/p')).toBe(before);
    });

    it('reports when no remote is configured', async () => {
      repo = await makeRepo({ withRemote: false });
      const ui = new FakeUi();
      const c = await ctx(ui);
      expect(await pushFlow(c, ref(c.snap, 'develop'))).toBe('failed');
      expect(ui.of('error')[0].msg.key).toBe('No remote configured.');
    });
  });

  describe('pull', () => {
    it('fast-forwards a non-HEAD branch from its upstream', async () => {
      repo = await makeRepo();
      await repo.sh('checkout', '-b', 'feature/p');
      await repo.commit('p1');
      await repo.sh('push', '-u', 'origin', 'feature/p');
      await repo.sh('checkout', 'develop');
      const remoteHash = await pushFromOtherClone('feature/p');
      await repo.sh('fetch', 'origin');
      const c = await ctx(new FakeUi());
      expect(await pullFlow(c, ref(c.snap, 'feature/p'))).toBe('done');
      expect(await rev('feature/p')).toBe(remoteHash);
      expect(await head()).toBe('develop');
    });

    it('pulls the current branch', async () => {
      repo = await makeRepo();
      const remoteHash = await pushFromOtherClone('develop');
      const c = await ctx(new FakeUi());
      expect(await pullFlow(c, ref(c.snap, 'develop'))).toBe('done');
      expect(await rev('HEAD')).toBe(remoteHash);
    });
  });

  describe('sync', () => {
    it('fast-forwards the base branch without leaving the current branch', async () => {
      repo = await makeRepo();
      await repo.sh('checkout', '-b', 'feature/x');
      const remoteHash = await pushFromOtherClone('develop');
      const c = await ctx(new FakeUi());
      expect(await syncFlow(c)).toBe('done');
      expect(await rev('develop')).toBe(remoteHash);
      expect(await head()).toBe('feature/x');
    });

    it('fails while a merge is in progress', async () => {
      repo = await makeRepo();
      await fs.writeFile(path.join(repo.dir, '.git', 'MERGE_HEAD'), `${await rev('HEAD')}\n`);
      const ui = new FakeUi();
      const c = await ctx(ui);
      expect(await syncFlow(c)).toBe('failed');
      expect(ui.of('error')).toHaveLength(1);
    });
  });

  describe('cleanup merged', () => {
    it('deletes only the selected merged branches', async () => {
      repo = await makeRepo();
      await repo.sh('branch', 'feature/m1');
      await repo.sh('branch', 'feature/m2');
      await repo.sh('checkout', '-b', 'feature/u');
      await repo.commit('u1');
      await repo.sh('checkout', 'develop');
      const ui = new FakeUi(['all']);
      const c = await ctx(ui);
      expect(await cleanupMergedFlow(c)).toBe('done');
      expect(ui.of('pickMany')[0].items).toHaveLength(2);
      expect(ui.of('pickMany')[0].items!.every((i) => i.picked)).toBe(true);
      expect(await hasLocal('feature/m1')).toBe(false);
      expect(await hasLocal('feature/m2')).toBe(false);
      expect(await hasLocal('feature/u')).toBe(true);
      expect(await hasLocal('develop')).toBe(true);
    });

    it('deletes nothing when the picker is dismissed', async () => {
      repo = await makeRepo();
      await repo.sh('branch', 'feature/m1');
      const c = await ctx(new FakeUi());
      expect(await cleanupMergedFlow(c)).toBe('cancelled');
      expect(await hasLocal('feature/m1')).toBe(true);
    });

    it('informs when there is nothing to clean up', async () => {
      repo = await makeRepo();
      const ui = new FakeUi();
      const c = await ctx(ui);
      expect(await cleanupMergedFlow(c)).toBe('done');
      expect(ui.of('info')[0].msg.key).toBe('No merged branches to clean up.');
    });
  });
});
