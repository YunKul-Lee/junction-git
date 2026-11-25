import * as vscode from 'vscode';
import { registerCommands } from './commands/register';
import { BranchTreeProvider } from './views/branchTree';
import { connectGitApi } from './vscode/gitApi';

export async function activate(ctx: vscode.ExtensionContext): Promise<{ tree: BranchTreeProvider }> {
  const output = vscode.window.createOutputChannel('Junction');
  const log = (line: string): void => output.appendLine(line);
  const conn = await connectGitApi(log);
  const tree = new BranchTreeProvider(conn, log);
  const treeView = vscode.window.createTreeView('junction.branches', { treeDataProvider: tree });

  const onFilter = (text: string | undefined): void => {
    treeView.message = text ? vscode.l10n.t('Filter: "{0}"', text) : undefined;
    void vscode.commands.executeCommand('setContext', 'junction.filterActive', !!text);
  };

  ctx.subscriptions.push(
    output,
    conn,
    tree,
    treeView,
    tree.onDidChangeFilter(onFilter),
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) {
        tree.refresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('junction')) {
        tree.refresh();
      }
    }),
  );
  registerCommands(ctx, { tree, conn });
  return { tree };
}

export function deactivate(): void {}
