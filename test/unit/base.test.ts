import { describe, expect, it } from 'vitest';
import { resolveBaseBranch } from '../../src/model/base';
import { BranchRef } from '../../src/git/types';

const local = (name: string): BranchRef => ({
  kind: 'local', name, shortName: name, hash: 'h', subject: '', committerTime: 0,
  isHead: false, upstreamGone: false, ahead: 0, behind: 0,
});
const remote = (rem: string, short: string): BranchRef => ({
  kind: 'remote', name: `${rem}/${short}`, shortName: short, remote: rem, hash: 'h', subject: '',
  committerTime: 0, isHead: false, upstreamGone: false, ahead: 0, behind: 0,
});

describe('resolveBaseBranch', () => {
  it('prefers origin remote for develop', () => {
    expect(resolveBaseBranch('', [local('develop'), remote('upstream', 'develop'), remote('origin', 'develop')])).toEqual({
      name: 'develop', compareRef: 'origin/develop', local: 'develop', remoteRef: 'origin/develop',
    });
  });
  it('falls back to main on non-origin remote only', () => {
    const b = resolveBaseBranch('', [remote('upstream', 'main')]);
    expect(b?.compareRef).toBe('upstream/main');
    expect(b?.local).toBeUndefined();
  });
  it('uses local only', () => {
    expect(resolveBaseBranch('', [local('develop')])).toEqual({
      name: 'develop', compareRef: 'develop', local: 'develop', remoteRef: undefined,
    });
  });
  it('configured wins and never falls through', () => {
    expect(resolveBaseBranch('release', [local('develop'), local('release')])?.name).toBe('release');
    expect(resolveBaseBranch('release', [local('develop'), local('main')])).toBeUndefined();
  });
  it('undefined when nothing matches', () => {
    expect(resolveBaseBranch('', [local('foo')])).toBeUndefined();
  });
});
