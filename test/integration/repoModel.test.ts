import { performance } from 'perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSnapshot } from '../../src/model/repoModel';
import { makeRepo, TestRepo } from '../helpers/repo';

describe('loadSnapshot', () => {
  let repo: TestRepo;
  afterEach(async () => {
    await repo.cleanup();
  });

  it('builds a snapshot with base, merged and ahead counts', async () => {
    repo = await makeRepo();
    await repo.sh('checkout', '-b', 'feature/merged');
    await repo.commit('m1');
    await repo.sh('checkout', 'develop');
    await repo.sh('merge', '--no-ff', '--no-edit', 'feature/merged');
    await repo.sh('push', 'origin', 'develop');
    await repo.sh('branch', 'feature/fresh');
    await repo.sh('checkout', '-b', 'feature/ahead');
    await repo.commit('a1');
    await repo.commit('a2');
    await repo.sh('checkout', 'develop');
    const snap = await loadSnapshot(repo.git, { baseBranch: '' });
    expect(snap.root).toBe(repo.git.root);
    expect(snap.base?.compareRef).toBe('origin/develop');
    expect(snap.remotes).toEqual(['origin']);
    expect(snap.merged.has('feature/merged')).toBe(true);
    expect(snap.merged.has('feature/ahead')).toBe(false);
    // No commits of its own: its tip is on develop's first-parent chain.
    expect(snap.merged.has('feature/fresh')).toBe(false);
    expect(snap.merged.has('develop')).toBe(false);
    expect(snap.aheadOfBase.get('feature/ahead')).toBe(2);
    expect(snap.aheadOfBase.get('feature/merged')).toBe(0);
    expect(snap.state.head).toBe('develop');
    expect(snap.recent).toContain('develop');
  });

  it('excludes HEAD branch from merged', async () => {
    repo = await makeRepo();
    await repo.sh('checkout', '-b', 'feature/head');
    const snap = await loadSnapshot(repo.git, { baseBranch: '' });
    expect(snap.merged.has('feature/head')).toBe(false);
  });

  it('has no base when none exists', async () => {
    repo = await makeRepo({ withRemote: false, initialBranch: 'trunk' });
    const snap = await loadSnapshot(repo.git, { baseBranch: '' });
    expect(snap.base).toBeUndefined();
    expect(snap.aheadOfBase.size).toBe(0);
    expect(snap.merged.size).toBe(0);
  });

  it('rejects when aborted', async () => {
    repo = await makeRepo();
    const ac = new AbortController();
    ac.abort();
    await expect(loadSnapshot(repo.git, { baseBranch: '' }, ac.signal)).rejects.toBeDefined();
  });

  it('loads 300 branches quickly', async () => {
    repo = await makeRepo();
    const head = (await repo.sh('rev-parse', 'HEAD')).trim();
    const input = Array.from({ length: 300 }, (_, i) => `create refs/heads/perf/b${i} ${head}\n`).join('');
    await repo.git.run(['update-ref', '--stdin'], { input });
    const t0 = performance.now();
    const snap = await loadSnapshot(repo.git, { baseBranch: '' });
    const ms = performance.now() - t0;
    if (ms > 1000) {
      console.warn(`loadSnapshot took ${ms.toFixed(0)}ms for 300 branches`);
    }
    expect(snap.branches.length).toBeGreaterThanOrEqual(300);
    expect(ms).toBeLessThan(2000);
  });
});
