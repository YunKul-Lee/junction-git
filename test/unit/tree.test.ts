import { describe, expect, it } from 'vitest';
import { BranchRef } from '../../src/git/types';
import { buildEntries, describeBranch, TreeEntry } from '../../src/model/tree';

function br(shortName: string, extra: Partial<BranchRef> = {}): BranchRef {
  return {
    kind: 'local', name: shortName, shortName, hash: 'h', subject: 's', committerTime: 1000,
    isHead: false, upstreamGone: false, ahead: 0, behind: 0, ...extra,
  };
}

function shape(entries: TreeEntry[]): unknown[] {
  return entries.map((e) => (e.type === 'folder' ? { folder: e.name, children: shape(e.children) } : e.label));
}

describe('buildEntries', () => {
  const input = [br('feature/a'), br('feature/b/c'), br('feature'), br('develop')];

  it('groups by folder: folders first, then branches', () => {
    const out = buildEntries(input, { groupByFolder: true, sort: 'name', recent: [] });
    expect(shape(out)).toEqual([{ folder: 'feature', children: [{ folder: 'b', children: ['c'] }, 'a'] }, 'develop', 'feature']);
    const folder = out[0];
    expect(folder.type === 'folder' && folder.path).toBe('feature');
  });

  it('applies recent order, folder ranked by best member', () => {
    const out = buildEntries(input, { groupByFolder: true, sort: 'recent', recent: ['develop', 'feature/b/c'] });
    expect(shape(out)).toEqual([{ folder: 'feature', children: [{ folder: 'b', children: ['c'] }, 'a'] }, 'develop', 'feature']);
    const out2 = buildEntries(input, { groupByFolder: true, sort: 'recent', recent: ['feature', 'develop'] });
    expect(shape(out2)).toEqual([{ folder: 'feature', children: [{ folder: 'b', children: ['c'] }, 'a'] }, 'feature', 'develop']);
  });

  it('recent: known first by index, rest by committerTime desc, unknown names ignored', () => {
    const bs = [br('old', { committerTime: 1 }), br('new', { committerTime: 9 }), br('picked', { committerTime: 0 })];
    const out = buildEntries(bs, { groupByFolder: false, sort: 'recent', recent: ['v1.0', 'picked', 'abc1234'] });
    expect(shape(out)).toEqual(['picked', 'new', 'old']);
  });

  it('remote branches ignore recent and use committerTime', () => {
    const bs = [
      br('a', { kind: 'remote', name: 'origin/a', remote: 'origin', committerTime: 1 }),
      br('b', { kind: 'remote', name: 'origin/b', remote: 'origin', committerTime: 2 }),
    ];
    const out = buildEntries(bs, { groupByFolder: false, sort: 'recent', recent: ['origin/a', 'a'] });
    expect(shape(out)).toEqual(['b', 'a']);
  });

  it('flat list uses shortName as label', () => {
    const out = buildEntries(input, { groupByFolder: false, sort: 'name', recent: [] });
    expect(shape(out)).toEqual(['develop', 'feature', 'feature/a', 'feature/b/c']);
  });

  it('name sort is numeric', () => {
    const out = buildEntries([br('feature/10'), br('feature/2')], { groupByFolder: false, sort: 'name', recent: [] });
    expect(shape(out)).toEqual(['feature/2', 'feature/10']);
  });
});

describe('describeBranch', () => {
  const b = (e: Partial<BranchRef> = {}) => br('x', e);
  it('merged', () => expect(describeBranch(b(), { merged: true, isBase: false })).toBe('✓ merged'));
  it('ahead of base', () => expect(describeBranch(b(), { aheadOfBase: 7, merged: false, isBase: false })).toBe('↑7'));
  it('ahead of base and upstream', () =>
    expect(describeBranch(b({ ahead: 1 }), { aheadOfBase: 2, merged: false, isBase: false })).toBe('↑2  ⇡1'));
  it('base behind', () => expect(describeBranch(b({ behind: 5 }), { aheadOfBase: 3, merged: true, isBase: true })).toBe('⇣5'));
  it('upstream gone', () => expect(describeBranch(b({ upstreamGone: true }), { merged: false, isBase: false })).toBe('(remote deleted)'));
  it('nothing', () => expect(describeBranch(b(), { merged: false, isBase: false })).toBe(''));
  it('merged wins over gone', () =>
    expect(describeBranch(b({ upstreamGone: true }), { merged: true, isBase: false })).toBe('✓ merged'));
});
