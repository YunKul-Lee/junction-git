import { describe, expect, it } from 'vitest';
import { BranchRef } from '../../src/git/types';
import { RepoSnapshot, sameSnapshot } from '../../src/model/repoModel';

function br(name: string, extra: Partial<BranchRef> = {}): BranchRef {
  return {
    kind: 'local', name, shortName: name, hash: 'h', subject: 's', committerTime: 1000,
    isHead: false, upstreamGone: false, ahead: 0, behind: 0, ...extra,
  };
}

function snap(extra: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    root: '/r',
    branches: [br('develop', { isHead: true }), br('feature/a', { upstream: 'origin/feature/a' })],
    remotes: ['origin'],
    base: { name: 'develop', compareRef: 'origin/develop', local: 'develop', remoteRef: 'origin/develop' },
    aheadOfBase: new Map([['feature/a', 2]]),
    merged: new Set(['feature/m']),
    recent: ['develop'],
    state: { head: 'develop', detached: false, dirty: false, merging: false },
    ...extra,
  };
}

describe('sameSnapshot', () => {
  it('is true for structurally equal snapshots', () => {
    expect(sameSnapshot(snap(), snap())).toBe(true);
  });

  it('detects branch changes', () => {
    expect(sameSnapshot(snap(), snap({ branches: [br('develop', { isHead: true })] }))).toBe(false);
    expect(sameSnapshot(snap(), snap({ branches: [br('develop', { isHead: true }), br('feature/a', { hash: 'x' })] }))).toBe(false);
    expect(sameSnapshot(snap(), snap({ branches: [br('develop'), br('feature/a', { upstream: 'origin/feature/a' })] }))).toBe(false);
  });

  it('detects ahead, merged, state and base changes', () => {
    expect(sameSnapshot(snap(), snap({ aheadOfBase: new Map([['feature/a', 3]]) }))).toBe(false);
    expect(sameSnapshot(snap(), snap({ aheadOfBase: new Map() }))).toBe(false);
    expect(sameSnapshot(snap(), snap({ merged: new Set() }))).toBe(false);
    expect(sameSnapshot(snap(), snap({ merged: new Set(['feature/n']) }))).toBe(false);
    expect(sameSnapshot(snap(), snap({ state: { head: 'develop', detached: false, dirty: true, merging: false } }))).toBe(false);
    expect(
      sameSnapshot(snap(), snap({ state: { head: 'develop', detached: false, dirty: false, merging: false, rebase: { step: 1, total: 2 } } })),
    ).toBe(false);
    expect(sameSnapshot(snap(), snap({ base: undefined }))).toBe(false);
    expect(sameSnapshot(snap(), snap({ base: { name: 'main', compareRef: 'main', local: 'main' } }))).toBe(false);
  });

  it('detects remote and recent-order changes', () => {
    expect(sameSnapshot(snap(), snap({ remotes: [] }))).toBe(false);
    expect(sameSnapshot(snap(), snap({ recent: ['feature/a', 'develop'] }))).toBe(false);
  });
});
