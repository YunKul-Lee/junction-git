import * as vscode from 'vscode';
import { PrServer, serversFromScopes } from '../pr/providers';

export interface JunctionSettings {
  baseBranch: string;
  branchSort: 'recent' | 'name';
  groupByFolder: boolean;
  commitLimit: number;
  confirmMerge: boolean;
  pullRequestServers: PrServer[];
}

export function readSettings(scope?: vscode.Uri): JunctionSettings {
  const cfg = vscode.workspace.getConfiguration('junction', scope);
  return {
    baseBranch: cfg.get<string>('baseBranch', ''),
    branchSort: cfg.get<'recent' | 'name'>('branchSort', 'recent'),
    groupByFolder: cfg.get<boolean>('groupByFolder', true),
    commitLimit: Math.max(1, cfg.get<number>('commitLimit', 50)),
    confirmMerge: cfg.get<boolean>('confirmMerge', true),
    // Every scope's entries, most specific first (VS Code would otherwise let one scope's array hide the others).
    pullRequestServers: serversFromScopes(cfg.inspect<PrServer[]>('pullRequest.servers')),
  };
}

/** Adds or replaces (by gitHost, case-insensitive) a server in the user (Global) settings only. */
export async function saveServer(s: PrServer): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('junction');
  const current = cfg.inspect<PrServer[]>('pullRequest.servers')?.globalValue ?? [];
  const host = s.gitHost.toLowerCase();
  const next = current.filter((x) => x.gitHost.toLowerCase() !== host);
  const i = current.findIndex((x) => x.gitHost.toLowerCase() === host);
  next.splice(i < 0 ? next.length : i, 0, s);
  await cfg.update('pullRequest.servers', next, vscode.ConfigurationTarget.Global);
}

export function openServersSettings(): Thenable<unknown> {
  return vscode.commands.executeCommand('workbench.action.openSettings', 'junction.pullRequest.servers');
}
