import * as fs from 'fs/promises';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkoutSide, conflictedFiles, leftoverMarkers } from '../../src/git/operations';
import { makeRepo, TestRepo } from '../helpers/repo';

const NESTED = 'dir with space/파일.txt';

describe('conflict operations', () => {
  let repo: TestRepo;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await repo.cleanup();
  });

  const read = (f: string): Promise<string> => fs.readFile(path.join(repo.dir, f), 'utf8');
  const exists = (f: string): Promise<boolean> =>
    fs.access(path.join(repo.dir, f)).then(
      () => true,
      () => false,
    );

  /** develop and topic edit README.md and the nested file differently; the merge is left conflicted on develop. */
  async function conflictingMerge(): Promise<void> {
    await repo.commit('base nested', NESTED, 'base\n');
    await repo.sh('switch', '-c', 'topic');
    await repo.commit('topic edit', 'README.md', 'topic\n');
    await repo.commit('topic nested', NESTED, 'topic\n');
    await repo.sh('switch', 'develop');
    await repo.commit('develop edit', 'README.md', 'develop\n');
    await repo.commit('develop nested', NESTED, 'develop\n');
    await expect(repo.sh('merge', 'topic')).rejects.toBeDefined();
  }

  it('conflictedFiles lists unmerged paths', async () => {
    expect(await conflictedFiles(repo.git)).toEqual([]);
    await conflictingMerge();
    expect(await conflictedFiles(repo.git)).toEqual(['README.md', NESTED]);
  });

  it("checkoutSide ours keeps HEAD's content and stages it", async () => {
    await conflictingMerge();
    expect(await checkoutSide(repo.git, 'README.md', 'ours')).toBe('kept');
    expect(await read('README.md')).toBe('develop\n');
    expect(await conflictedFiles(repo.git)).toEqual([NESTED]);
  });

  it("checkoutSide theirs takes the merged branch's content", async () => {
    await conflictingMerge();
    expect(await checkoutSide(repo.git, NESTED, 'theirs')).toBe('kept');
    expect(await read(NESTED)).toBe('topic\n');
    expect(await conflictedFiles(repo.git)).toEqual(['README.md']);
  });

  it('checkoutSide deletes when the chosen side removed the file', async () => {
    await repo.commit('add a', 'a.txt', 'a\n');
    await repo.sh('switch', '-c', 'topic');
    await repo.sh('rm', '-q', 'a.txt');
    await repo.sh('commit', '-m', 'topic deletes a');
    await repo.sh('switch', 'develop');
    await repo.commit('develop edits a', 'a.txt', 'changed\n');
    await expect(repo.sh('merge', 'topic')).rejects.toBeDefined();
    expect(await conflictedFiles(repo.git)).toEqual(['a.txt']);
    expect(await checkoutSide(repo.git, 'a.txt', 'theirs')).toBe('deleted');
    expect(await exists('a.txt')).toBe(false);
    expect(await conflictedFiles(repo.git)).toEqual([]);
  });

  it('leftoverMarkers finds committed markers', async () => {
    const before = (await repo.sh('rev-parse', 'HEAD')).trim();
    await repo.commit('markers', NESTED, '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> topic\n');
    expect(await leftoverMarkers(repo.git, before, 'HEAD')).toEqual([NESTED]);
  });

  it('leftoverMarkers ignores trailing whitespace and seven-char text mid-line', async () => {
    const before = (await repo.sh('rev-parse', 'HEAD')).trim();
    await repo.commit('ws', 'a.txt', 'a  \n');
    await repo.commit('mid', 'b.txt', 'x <<<<<<< y\n');
    expect(await leftoverMarkers(repo.git, before, 'HEAD')).toEqual([]);
  });
});
