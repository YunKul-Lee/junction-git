import * as vscode from 'vscode';
import { BranchTreeProvider } from './views/branchTree';

export function activate(ctx: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Junction');
  const treeView = vscode.window.createTreeView('junction.branches', {
    treeDataProvider: new BranchTreeProvider(),
  });
  ctx.subscriptions.push(output, treeView);
}

export function deactivate(): void {}
