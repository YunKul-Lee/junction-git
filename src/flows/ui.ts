/** A user-facing message. `key` is the English source string, also used as the l10n key. */
export type Msg = { key: string; args?: (string | number)[] };

export type FlowResult = 'done' | 'cancelled' | 'failed';

export interface Ui {
  /** Resolves with the chosen action index, or undefined when dismissed. */
  confirm(msg: Msg, actions: Msg[], opts?: { modal?: boolean; detail?: Msg }): Promise<number | undefined>;
  input(
    prompt: Msg,
    opts?: { value?: string; validate?: (v: string) => Msg | undefined },
  ): Promise<string | undefined>;
  pickMany<T>(items: { label: string; picked: boolean; value: T }[], title: Msg): Promise<T[] | undefined>;
  pick<T>(items: { label: string; labelMsg?: Msg; description?: string; value: T }[], title: Msg): Promise<T | undefined>;
  /** `onPick` is called with the index of the clicked action; it never blocks the caller. */
  info(msg: Msg, actions?: Msg[], onPick?: (index: number) => void): void;
  error(msg: Msg, err?: unknown): void;
  progress<T>(title: Msg, fn: (signal: AbortSignal) => Promise<T>): Promise<T>;
}

/** The most informative stderr line: the first `error:`, `fatal:` or `!` line, else the first line. */
export function errorSummary(stderr: string): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /^(error:|fatal:|!)/.test(l)) ?? lines[0] ?? '';
}
