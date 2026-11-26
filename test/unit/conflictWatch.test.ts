import { describe, expect, it } from 'vitest';
import { nextNotice, type WatchState } from '../../src/flows/conflictWatch';

const merge = (conflicts: number): WatchState => ({ op: 'merge', conflicts });
const rebase = (conflicts: number): WatchState => ({ op: 'rebase', conflicts });
const none: WatchState = { op: 'none', conflicts: 0 };

describe('nextNotice', () => {
  it('reports remaining conflicts when a merge count drops', () => {
    expect(nextNotice(merge(3), merge(2), 'none')).toEqual({ kind: 'remaining', count: 2 });
  });

  it('reports all resolved with push when a merge reaches 0 and a push is pending', () => {
    expect(nextNotice(merge(1), merge(0), 'onHead')).toEqual({ kind: 'allResolved', op: 'merge', withPush: true });
  });

  it('reports all resolved without push when no push is pending', () => {
    expect(nextNotice(merge(1), merge(0), 'none')).toEqual({ kind: 'allResolved', op: 'merge', withPush: false });
  });

  it('offers no push when the pending push is for a branch other than HEAD', () => {
    expect(nextNotice(merge(1), merge(0), 'elsewhere')).toEqual({ kind: 'allResolved', op: 'merge', withPush: false });
  });

  it('reports mergeEnded for a pending push on another branch, so the resume flow can clear it', () => {
    expect(nextNotice(merge(0), none, 'elsewhere')).toEqual({ kind: 'mergeEnded' });
  });

  it('never pairs a rebase with a push', () => {
    expect(nextNotice(rebase(1), rebase(0), 'onHead')).toEqual({ kind: 'allResolved', op: 'rebase', withPush: false });
  });

  it('reports mergeEnded on first sight of no operation with a pending push', () => {
    expect(nextNotice(undefined, none, 'onHead')).toEqual({ kind: 'mergeEnded' });
  });

  it('reports mergeEnded when a merge ends with a pending push', () => {
    expect(nextNotice(merge(0), none, 'onHead')).toEqual({ kind: 'mergeEnded' });
  });

  it('stays quiet when no operation persists', () => {
    expect(nextNotice(none, none, 'onHead')).toBeUndefined();
  });

  it('stays quiet when a merge ends without a pending push', () => {
    expect(nextNotice(merge(0), none, 'none')).toBeUndefined();
  });

  it('stays quiet when a rebase ends', () => {
    expect(nextNotice(rebase(0), none, 'onHead')).toBeUndefined();
  });

  it('stays quiet when conflicts rise', () => {
    expect(nextNotice(rebase(0), rebase(2), 'none')).toBeUndefined();
  });

  it('stays quiet on first sight of an in-progress merge', () => {
    expect(nextNotice(undefined, merge(2), 'onHead')).toBeUndefined();
  });

  it('stays quiet when the count is unchanged', () => {
    expect(nextNotice(merge(2), merge(2), 'onHead')).toBeUndefined();
  });
});
