import * as vscode from 'vscode';
import { registerCommands } from './commands/register';
import { BranchTreeProvider } from './views/branchTree';
import { toExternalUri } from './vscode/externalUri';
import { connectGitApi } from './vscode/gitApi';
import { updateHasBitbucketContext } from './vscode/bitbucketContext';

export async function activate(ctx: vscode.ExtensionContext): Promise<{ tree: BranchTreeProvider; toExternalUri: typeof toExternalUri }> {
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
    tree.onDidLoadSnapshots(() => void updateHasBitbucketContext(tree)),
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) {
        tree.refresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('junction.bitbucket.servers')) {
        void updateHasBitbucketContext(tree);
      }
      if (e.affectsConfiguration('junction')) {
        tree.refresh();
      }
    }),
  );
  registerCommands(ctx, { tree, conn, output });
  // `toExternalUri` is exposed for the extension tests (the test project cannot import from src/).
  return { tree, toExternalUri };
}

export function deactivate(): void {}
