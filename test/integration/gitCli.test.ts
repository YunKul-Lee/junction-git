import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGit } from '../../src/git/gitCli';
import { GitError } from '../../src/git/types';
import { makeRepo, TestRepo } from '../helpers/repo';

describe('gitCli', () => {
  let repo: TestRepo;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await repo.cleanup();
  });

  it('run returns stdout', async () => {
    expect(await repo.git.run(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('develop\n');
  });

  it('run throws GitError with stderr and exit code', async () => {
    const err = await repo.git.run(['checkout', 'nope']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    const ge = err as GitError;
    expect(ge.exitCode).not.toBe(0);
    expect(ge.stderr).toContain('nope');
  });

  it('version parses', async () => {
    const v = await repo.git.version();
    expect(v.major).toBeGreaterThanOrEqual(2);
  });

  it('version does not cache a rejection', async () => {
    const git = createGit('git-binary-that-does-not-exist', repo.dir);
    await expect(git.version()).rejects.toBeDefined();
    const first = git.version();
    const second = git.version();
    await first.catch(() => undefined);
    expect(first).toBe(second);
    await expect(first).rejects.toBeDefined();
    // a new call after settling must create a fresh promise
    expect(git.version()).not.toBe(first);
    await git.version().catch(() => undefined);
  });

  it('log hook receives command line', async () => {
    const lines: string[] = [];
    const git = createGit('git', repo.dir, (l) => lines.push(l));
    await git.run(['checkout', 'nope']).catch(() => undefined);
    expect(lines.some((l) => l.startsWith('git checkout nope'))).toBe(true);
  });

  it('abort signal kills process', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(repo.git.run(['status'], { signal: ac.signal })).rejects.toBeDefined();
  });

  it('passes stdin input', async () => {
    const out = await repo.git.run(['hash-object', '--stdin'], { input: 'hello\n' });
    expect(out.trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  it('commit helper returns hash and pushes remote', async () => {
    const h = await repo.commit('second');
    expect(h).toMatch(/^[0-9a-f]{40}$/);
    expect((await repo.sh('rev-parse', 'HEAD')).trim()).toBe(h);
    expect(await repo.sh('remote')).toBe('origin\n');
  });
});
