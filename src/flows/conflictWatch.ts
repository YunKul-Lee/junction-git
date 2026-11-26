export interface WatchState {
  op: 'merge' | 'rebase' | 'none';
  conflicts: number;
}

export type Notice =
  | { kind: 'remaining'; count: number }
  | { kind: 'allResolved'; op: 'merge' | 'rebase'; withPush: boolean }
  | { kind: 'mergeEnded' };

/** Whether a rejected push waits to be pushed, and whether it is for the checked-out branch. */
export type PendingSeen = 'none' | 'elsewhere' | 'onHead';

/** Decides which notice to show when a repository's state changes. Pure. */
export function nextNotice(
  prev: WatchState | undefined,
  cur: WatchState,
  pending: PendingSeen,
): Notice | undefined {
  if (cur.op === 'none') {
    // Covers restart, SCM commit and an outside abort; the resume flow sorts them out.
    return pending !== 'none' && (prev === undefined || prev.op === 'merge') ? { kind: 'mergeEnded' } : undefined;
  }
  if (prev && prev.op === cur.op && cur.conflicts < prev.conflicts) {
    return cur.conflicts > 0
      ? { kind: 'remaining', count: cur.conflicts }
      : { kind: 'allResolved', op: cur.op, withPush: cur.op === 'merge' && pending === 'onHead' };
  }
  return undefined;
}
