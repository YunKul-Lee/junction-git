import * as vscode from 'vscode';
import { errorSummary, Msg, Ui } from '../flows/ui';
import { GitError } from '../git/types';

const text = (m: Msg): string => vscode.l10n.t(m.key, ...(m.args ?? []));

export class VscodeUi implements Ui {
  constructor(private readonly output: vscode.OutputChannel) {}

  async confirm(msg: Msg, actions: Msg[], opts?: { modal?: boolean; detail?: Msg }): Promise<number | undefined> {
    const labels = actions.map(text);
    const picked = await vscode.window.showWarningMessage(
      text(msg),
      { modal: opts?.modal ?? false, detail: opts?.detail ? text(opts.detail) : undefined },
      ...labels,
    );
    const i = picked === undefined ? -1 : labels.indexOf(picked);
    return i < 0 ? undefined : i;
  }

  input(
    prompt: Msg,
    opts?: { value?: string; validate?: (v: string) => Msg | undefined },
  ): Promise<string | undefined> {
    const validate = opts?.validate;
    return Promise.resolve(
      vscode.window.showInputBox({
        prompt: text(prompt),
        value: opts?.value,
        validateInput: validate
          ? (v) => {
              const m = validate(v);
              return m ? text(m) : undefined;
            }
          : undefined,
      }),
    );
  }

  async pickMany<T>(items: { label: string; picked: boolean; value: T }[], title: Msg): Promise<T[] | undefined> {
    const picked = await vscode.window.showQuickPick(items, { canPickMany: true, title: text(title) });
    return picked?.map((i) => i.value);
  }

  async pick<T>(items: { label: string; description?: string; value: T }[], title: Msg): Promise<T | undefined> {
    return (await vscode.window.showQuickPick(items, { title: text(title) }))?.value;
  }

  info(msg: Msg): void {
    void vscode.window.showInformationMessage(text(msg));
  }

  error(msg: Msg, err?: unknown): void {
    let message = text(msg);
    if (err instanceof GitError) {
      const first = errorSummary(err.stderr);
      if (first) {
        message = `${message} ${first}`;
      }
      this.output.appendLine(`git ${err.args.join(' ')} (exit ${err.exitCode ?? 'null'})`);
      this.output.appendLine(err.stderr.trimEnd());
    } else if (err !== undefined) {
      this.output.appendLine(String(err instanceof Error ? err.stack ?? err.message : err));
    }
    void vscode.window.showErrorMessage(message);
  }

  progress<T>(title: Msg, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return Promise.resolve(
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: text(title), cancellable: false },
        () => fn(new AbortController().signal),
      ),
    );
  }
}
