import * as vscode from 'vscode';
import { BitbucketServer } from '../pr/bitbucket';

export interface JunctionSettings {
  baseBranch: string;
  branchSort: 'recent' | 'name';
  groupByFolder: boolean;
  commitLimit: number;
  confirmMerge: boolean;
  bitbucketServers: BitbucketServer[];
}

export function readSettings(scope?: vscode.Uri): JunctionSettings {
  const cfg = vscode.workspace.getConfiguration('junction', scope);
  return {
    baseBranch: cfg.get<string>('baseBranch', ''),
    branchSort: cfg.get<'recent' | 'name'>('branchSort', 'recent'),
    groupByFolder: cfg.get<boolean>('groupByFolder', true),
    commitLimit: Math.max(1, cfg.get<number>('commitLimit', 50)),
    confirmMerge: cfg.get<boolean>('confirmMerge', true),
    bitbucketServers: cfg.get<BitbucketServer[]>('bitbucket.servers', []),
  };
}
