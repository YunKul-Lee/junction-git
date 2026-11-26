import * as fs from 'fs/promises';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkoutSide, conflictedFiles, conflictStages, leftoverMarkers } from '../../src/git/operations';
import { makeRepo, TestRepo } from '../helpers/repo';

const NESTED = 'dir with space/파일.txt';
const GLOB = 'app/[s]/page.tsx';
const PLAIN = 'app/s/page.tsx';

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

  it('checkoutSide rethrows when the path is unknown and deletes nothing', async () => {
    await expect(checkoutSide(repo.git, 'missing.txt', 'theirs')).rejects.toBeDefined();
    expect(await read('README.md')).toBe('initial\n');
  });

  it('leftoverMarkers is independent of diff.noprefix config', async () => {
    await repo.sh('config', 'diff.noprefix', 'true');
    const before = (await repo.sh('rev-parse', 'HEAD')).trim();
    await repo.commit('markers', NESTED, '<<<<<<< HEAD\nx\n');
    expect(await leftoverMarkers(repo.git, before, 'HEAD')).toEqual([NESTED]);
  });

  it('leftoverMarkers is not confused by an added line starting with "++ "', async () => {
    const before = (await repo.sh('rev-parse', 'HEAD')).trim();
    await repo.commit('tricky', 'c.txt', '++ x\n<<<<<<< HEAD\n');
    expect(await leftoverMarkers(repo.git, before, 'HEAD')).toEqual(['c.txt']);
  });
  /** `app/[s]/page.tsx` is conflicted next to a tracked `app/s/page.tsx` that a glob pathspec would also match. */
  async function globConflict(topicDeletes: boolean): Promise<void> {
    await repo.commit('glob base', GLOB, 'base\n');
    await repo.commit('plain', PLAIN, 'plain\n');
    await repo.sh('switch', '-c', 'topic');
    if (topicDeletes) {
      await repo.sh('rm', '-q', '--', `:(literal)${GLOB}`);
      await repo.sh('commit', '-m', 'topic deletes');
    } else {
      await repo.commit('topic edit', GLOB, 'topic\n');
    }
    await repo.sh('switch', 'develop');
    await repo.commit('develop edit', GLOB, 'develop\n');
    await expect(repo.sh('merge', 'topic')).rejects.toBeDefined();
    expect(await conflictedFiles(repo.git)).toEqual([GLOB]);
  }
  const untouched = async (): Promise<void> => {
    expect(await read(PLAIN)).toBe('plain\n');
    expect((await repo.sh('status', '--porcelain', '--', ':(literal)' + PLAIN)).trim()).toBe('');
  };

  it('checkoutSide treats glob characters literally when deleting', async () => {
    await globConflict(true);
    expect(await checkoutSide(repo.git, GLOB, 'theirs')).toBe('deleted');
    expect(await exists(GLOB)).toBe(false);
    await untouched();
  });

  it('checkoutSide treats glob characters literally when checking out', async () => {
    await globConflict(false);
    expect(await checkoutSide(repo.git, GLOB, 'theirs')).toBe('kept');
    expect(await read(GLOB)).toBe('topic\n');
    expect(await conflictedFiles(repo.git)).toEqual([]);
    await untouched();
  });

  it('checkoutSide checkout path does not overwrite an edited glob-matching file', async () => {
    await globConflict(false);
    await fs.writeFile(path.join(repo.dir, PLAIN), 'edited\n');
    expect(await checkoutSide(repo.git, GLOB, 'theirs')).toBe('kept');
    expect(await read(PLAIN)).toBe('edited\n');
    expect((await repo.sh('diff', '--cached', '--name-only')).trim()).toBe(GLOB);
  });

  it('conflictStages reports which sides have a version', async () => {
    await globConflict(true);
    expect([...(await conflictStages(repo.git, GLOB))].sort()).toEqual([1, 2]);
    expect([...(await conflictStages(repo.git, PLAIN))]).toEqual([]);
  });

  it('leftoverMarkers unquotes names git C-quotes', async () => {
    const name = 'q"uote\\back.txt';
    const before = (await repo.sh('rev-parse', 'HEAD')).trim();
    await repo.commit('markers', name, '<<<<<<< HEAD\n');
    expect(await leftoverMarkers(repo.git, before, 'HEAD')).toEqual([name]);
  });

  it('leftoverMarkers unquotes octal escapes and tabs', async () => {
    const name = 'tab\there\x01.txt';
    const before = (await repo.sh('rev-parse', 'HEAD')).trim();
    await repo.commit('markers', name, '<<<<<<< HEAD\n');
    expect(await leftoverMarkers(repo.git, before, 'HEAD')).toEqual([name]);
  });
});
