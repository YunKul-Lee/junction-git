/** A push that waits for a merge to finish: `tip` is the remote sha that was merged into `branch`. */
export interface PendingPush {
  branch: string;
  tip: string;
}

export interface PendingPushStore {
  get(): PendingPush | undefined;
  set(p: PendingPush): void;
  clear(): void;
}

export function memoryPendingStore(initial?: PendingPush): PendingPushStore {
  let value = initial;
  return {
    get: () => value,
    set: (p) => {
      value = p;
    },
    clear: () => {
      value = undefined;
    },
  };
}
