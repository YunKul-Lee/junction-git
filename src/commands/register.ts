import * as path from 'path';
import * as vscode from 'vscode';
import { BranchNode, CommitNode, DiffArgs, MoreNode } from '../views/nodes';
import { BranchTreeProvider } from '../views/branchTree';
import { GitConnection } from '../vscode/gitApi';

export const EMPTY_SCHEME = 'junction-empty';

export interface CommandDeps {
  tree: BranchTreeProvider;
  conn: GitConnection;
}

export function registerCommands(ctx: vscode.ExtensionContext, deps: CommandDeps): void {
  const { tree, conn } = deps;
  const reg = (id: string, fn: (...args: never[]) => unknown): void => {
    ctx.subscriptions.push(vscode.commands.registerCommand(id, fn as (...args: unknown[]) => unknown));
  };

  ctx.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, { provideTextDocumentContent: () => '' }),
  );

  reg('junction.refresh', () => tree.refresh());

  reg('junction.filter', async () => {
    const value = await vscode.window.showInputBox({
      prompt: vscode.l10n.t('Filter branches by name'),
      value: tree.getFilter() ?? '',
    });
    if (value !== undefined) {
      tree.setFilter(value.trim() || undefined);
    }
  });
  reg('junction.clearFilter', () => tree.setFilter(undefined));

  reg('junction.openFileDiff', async (args: DiffArgs) => {
    const repo = conn.repos().find((r) => r.root.fsPath === args.root.fsPath);
    if (!repo) {
      return;
    }
    const side = (ref: string | undefined, file: string): vscode.Uri =>
      ref === undefined
        ? vscode.Uri.from({ scheme: EMPTY_SCHEME, path: `/${file}` })
        : repo.toGitUri(vscode.Uri.joinPath(args.root, file), ref);
    const left = side(args.left, args.oldPath ?? args.path);
    const right = side(args.right, args.path);
    const short = (ref?: string): string => (ref ? ref.slice(0, 7) : '∅');
    const title = `${path.posix.basename(args.path)} (${short(args.left)} ↔ ${short(args.right)})`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
  });

  reg('junction.loadMore', (node: MoreNode) => tree.loadMore(node));

  reg('junction.compareWithCurrent', (node: BranchNode) => {
    const current = tree.snapshot(node.repo.root)?.state.head ?? 'HEAD';
    tree.showCompare(node.repo.root, current, node.branch.name);
  });
  reg('junction.closeCompare', () => tree.clearCompare());

  reg('junction.copyCommitHash', (node: CommitNode) => vscode.env.clipboard.writeText(node.commit.hash));
  reg('junction.copyCommitMessage', (node: CommitNode) => vscode.env.clipboard.writeText(node.commit.subject));
}
