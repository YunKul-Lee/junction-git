import { Msg, Ui } from '../../src/flows/ui';

export interface UiCall {
  method: 'confirm' | 'input' | 'pickMany' | 'pick' | 'info' | 'error' | 'progress';
  msg: Msg;
  actions?: Msg[];
  items?: { label: string; picked?: boolean; value: unknown }[];
  opts?: { value?: string; validate?: (v: string) => Msg | undefined; modal?: boolean };
  err?: unknown;
}

/** Scripted Ui: interactive methods consume `answers` in order; an empty queue answers undefined (cancel). */
export class FakeUi implements Ui {
  readonly calls: UiCall[] = [];
  constructor(public answers: unknown[] = []) {}

  of(method: UiCall['method']): UiCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  private next<T>(): T | undefined {
    return this.answers.shift() as T | undefined;
  }

  async confirm(msg: Msg, actions: Msg[], opts?: { modal?: boolean; detail?: Msg }): Promise<number | undefined> {
    this.calls.push({ method: 'confirm', msg, actions, opts });
    return this.next<number>();
  }
  async input(
    prompt: Msg,
    opts?: { value?: string; validate?: (v: string) => Msg | undefined },
  ): Promise<string | undefined> {
    this.calls.push({ method: 'input', msg: prompt, opts });
    return this.next<string>();
  }
  async pickMany<T>(items: { label: string; picked: boolean; value: T }[], title: Msg): Promise<T[] | undefined> {
    this.calls.push({ method: 'pickMany', msg: title, items });
    const a = this.next<'all' | T[]>();
    return a === 'all' ? items.map((i) => i.value) : (a as T[] | undefined);
  }
  async pick<T>(items: { label: string; description?: string; value: T }[], title: Msg): Promise<T | undefined> {
    this.calls.push({ method: 'pick', msg: title, items });
    return this.next<T>();
  }
  info(msg: Msg): void {
    this.calls.push({ method: 'info', msg });
  }
  error(msg: Msg, err?: unknown): void {
    this.calls.push({ method: 'error', msg, err });
  }
  progress<T>(title: Msg, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.calls.push({ method: 'progress', msg: title });
    return fn(new AbortController().signal);
  }
}
