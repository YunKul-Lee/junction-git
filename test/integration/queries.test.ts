import * as fs from 'fs/promises';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGit } from '../../src/git/gitCli';
import {
  aheadOf, commitFiles, listBranches, logRange, mergedInto, rangeFiles, recentCheckouts,
  remoteUrl, repoState,
} from '../../src/git/queries';
import { makeRepo, TestRepo } from '../helpers/repo';

describe('queries', () => {
  let repo: TestRepo;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await repo.cleanup();
  });

  it('listBranches', async () => {
    await repo.sh('checkout', '-b', 'feature/a');
    await repo.commit('a1');
    await repo.sh('push', '-u', 'origin', 'feature/a');
    await repo.commit('a2');
    await repo.sh('checkout', 'develop');
    await repo.sh('checkout', '-b', 'feature/gone');
    await repo.sh('push', '-u', 'origin', 'feature/gone');
    await repo.sh('checkout', 'develop');
    await repo.sh('push', 'origin', '--delete', 'feature/gone');
    await repo.sh('fetch', '--prune');
    await repo.sh('branch', 'feature/한글-#12+fix');
    await repo.sh('branch', 'features');
    const refs = await listBranches(repo.git);
    const by = (n: string) => refs.find((r) => r.name === n)!;
    expect(by('develop')).toMatchObject({ kind: 'local', isHead: true, upstream: 'origin/develop', ahead: 0 });
    expect(by('feature/a')).toMatchObject({ ahead: 1, behind: 0, upstream: 'origin/feature/a', isHead: false });
    expect(by('feature/gone')).toMatchObject({ upstreamGone: true });
    expect(by('feature/한글-#12+fix')).toMatchObject({ kind: 'local', shortName: 'feature/한글-#12+fix' });
    expect(by('features')).toBeDefined();
    expect(by('origin/feature/a')).toMatchObject({ kind: 'remote', remote: 'origin', shortName: 'feature/a' });
    expect(refs.find((r) => r.name === 'origin/HEAD' || r.name === 'origin')).toBeUndefined();
    expect(by('develop').subject).toBe('initial');
    expect(by('develop').committerTime).toBeGreaterThan(1_600_000_000);
  });

  it('aheadOf matches between default and fallback', async () => {
    await repo.sh('checkout', '-b', 'feature/a');
    await repo.commit('a1');
    await repo.commit('a2');
    await repo.sh('checkout', 'develop');
    const names = ['develop', 'feature/a'];
    const fast = await aheadOf(repo.git, 'develop', names);
    const slow = await aheadOf(repo.git, 'develop', names, { forceFallback: true });
    expect(fast.get('feature/a')).toBe(2);
    expect(fast.get('develop')).toBe(0);
    expect(Object.fromEntries(slow)).toEqual(Object.fromEntries(fast));
  });

  it('mergedInto', async () => {
    await repo.sh('checkout', '-b', 'feature/m');
    await repo.commit('m1');
    await repo.sh('checkout', 'develop');
    await repo.sh('merge', '--no-ff', '-m', 'merge m', 'feature/m');
    await repo.sh('push', 'origin', 'develop');
    await repo.sh('checkout', '-b', 'feature/open');
    await repo.commit('o1');
    await repo.sh('checkout', 'develop');
    const merged = await mergedInto(repo.git, 'origin/develop');
    expect(merged.has('feature/m')).toBe(true);
    expect(merged.has('feature/open')).toBe(false);
  });

  it('recentCheckouts', async () => {
    await repo.sh('checkout', '-b', 'feature/a');
    await repo.sh('checkout', 'develop');
    expect((await recentCheckouts(repo.git)).slice(0, 2)).toEqual(['develop', 'feature/a']);
  });

  it('logRange, commitFiles, rangeFiles', async () => {
    await repo.sh('checkout', '-b', 'feature/a');
    const c1 = await repo.commit('one', 'one.txt', 'x\n');
    await repo.commit('edit', 'README.md', 'changed\n');
    await repo.sh('mv', 'one.txt', 'renamed.txt');
    await repo.sh('commit', '-m', 'rename');
    const tip = (await repo.sh('rev-parse', 'HEAD')).trim();

    const all = await logRange(repo.git, 'develop', 'feature/a', { skip: 0, limit: 10 });
    expect(all.map((c) => c.subject)).toEqual(['rename', 'edit', 'one']);
    expect(all[0]).toMatchObject({ hash: tip, author: 'Test User' });
    expect(all[2].parents).toHaveLength(1);
    const page = await logRange(repo.git, 'develop', 'feature/a', { skip: 1, limit: 1 });
    expect(page.map((c) => c.subject)).toEqual(['edit']);

    expect(await commitFiles(repo.git, tip)).toEqual([{ status: 'R', oldPath: 'one.txt', path: 'renamed.txt' }]);
    expect(await commitFiles(repo.git, c1)).toEqual([{ status: 'A', path: 'one.txt' }]);

    const range = await rangeFiles(repo.git, 'develop', 'feature/a');
    expect(range.mergeBase).toBe((await repo.sh('rev-parse', 'develop')).trim());
    expect(range.files).toEqual(
      expect.arrayContaining([
        { status: 'M', path: 'README.md' },
        { status: 'A', path: 'renamed.txt' },
      ]),
    );
  });

  it('commitFiles handles merge, root, and unusual paths', async () => {
    const root = (await repo.sh('rev-list', '--max-parents=0', 'HEAD')).trim();
    expect(await commitFiles(repo.git, root)).toEqual([{ status: 'A', path: 'README.md' }]);

    await repo.sh('checkout', '-b', 'side');
    await repo.commit('side', 'side.txt', 's\n');
    await repo.sh('checkout', 'develop');
    await repo.commit('main', 'main.txt', 'm\n');
    await repo.sh('merge', '--no-ff', '-m', 'merge side', 'side');
    const merge = (await repo.sh('rev-parse', 'HEAD')).trim();
    // First parent is develop, so only the side branch's file appears, once.
    expect(await commitFiles(repo.git, merge)).toEqual([{ status: 'A', path: 'side.txt' }]);

    const weird = ['한글 파일.txt', 'tab\there.txt', 'quote"d.txt'];
    for (const f of weird) {
      await fs.writeFile(path.join(repo.dir, f), 'x\n');
    }
    await repo.sh('add', '-A');
    await repo.sh('commit', '-m', 'weird');
    const files = await commitFiles(repo.git, 'HEAD');
    expect(files.map((f) => f.path).sort()).toEqual([...weird].sort());
    const range = await rangeFiles(repo.git, 'side', 'develop');
    expect(range.files.map((f) => f.path)).toEqual(expect.arrayContaining(weird));
  });

  it('rangeFiles works when the tip branch name equals a file path', async () => {
    await repo.sh('checkout', '-b', 'README.md');
    await repo.commit('edit', 'README.md', 'changed\n');
    await repo.sh('checkout', 'develop');
    const range = await rangeFiles(repo.git, 'develop', 'README.md');
    expect(range.files).toEqual([{ status: 'M', path: 'README.md' }]);
  });

  it('remoteUrl', async () => {
    expect(await remoteUrl(repo.git, 'origin')).toBe(repo.remoteDir);
    expect(await remoteUrl(repo.git, 'nope')).toBeUndefined();
  });

  describe('repoState', () => {
    it('clean', async () => {
      expect(await repoState(repo.git)).toEqual({ head: 'develop', detached: false, dirty: false, merging: false });
    });
    it('dirty vs untracked', async () => {
      await fs.writeFile(path.join(repo.dir, 'untracked.txt'), 'u');
      expect((await repoState(repo.git)).dirty).toBe(false);
      await fs.writeFile(path.join(repo.dir, 'README.md'), 'changed\n');
      expect((await repoState(repo.git)).dirty).toBe(true);
    });
    it('runs status without optional locks and without scanning untracked files', async () => {
      const calls: string[][] = [];
      const git = { ...repo.git, run: (args: string[], o?: Parameters<typeof repo.git.run>[1]) => (calls.push(args), repo.git.run(args, o)) };
      await repoState(git);
      const status = calls.find((a) => a.includes('status'))!;
      expect(status.slice(0, 2)).toEqual(['--no-optional-locks', 'status']);
      expect(status).toContain('-uno');
    });
    it('detached', async () => {
      await repo.sh('checkout', '--detach');
      expect(await repoState(repo.git)).toMatchObject({ head: undefined, detached: true });
    });
    it('merging', async () => {
      await repo.sh('checkout', '-b', 'side');
      await repo.commit('side', 'f.txt', 'side\n');
      await repo.sh('checkout', 'develop');
      await repo.commit('main', 'f.txt', 'main\n');
      await repo.sh('merge', 'side').catch(() => undefined);
      expect(await repoState(repo.git)).toMatchObject({ merging: true, dirty: true });
    });
    it('rebasing', async () => {
      await repo.sh('checkout', '-b', 'side');
      await repo.commit('s1', 'f.txt', 'side\n');
      await repo.commit('s2', 'g.txt', 'g\n');
      await repo.sh('checkout', 'develop');
      await repo.commit('main', 'f.txt', 'main\n');
      await repo.sh('checkout', 'side');
      await repo.sh('rebase', 'develop').catch(() => undefined);
      const st = await repoState(repo.git);
      expect(st.rebase).toEqual({ step: 1, total: 2 });
      expect(st.merging).toBe(false);
    });
  });

  it('empty repository', async () => {
    const base = await fs.mkdtemp(path.join((await import('os')).tmpdir(), 'junction-empty-'));
    try {
      const git = createGit('git', base, undefined, { GIT_CONFIG_NOSYSTEM: '1' });
      await git.run(['init', '--initial-branch=main']);
      expect(await listBranches(git)).toEqual([]);
      expect(await repoState(git)).toMatchObject({ detached: false, dirty: false, merging: false });
      expect(await recentCheckouts(git)).toEqual([]);
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});
