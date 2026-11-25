import * as path from 'path';
import * as vscode from 'vscode';
import { BranchRef, ChangeStatus, Commit, FileChange } from '../git/types';
import { BranchBadges, describeBranch, TreeEntry } from '../model/tree';
import { RepoSnapshot } from '../model/repoModel';
import { RepoHandle } from '../vscode/gitApi';

const { Collapsed, Expanded, None } = vscode.TreeItemCollapsibleState;

export interface DiffArgs {
  root: vscode.Uri;
  left?: string;
  right?: string;
  path: string;
  oldPath?: string;
}

export function relativeTime(unixSeconds: number): string {
  const diff = unixSeconds - Date.now() / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const rtf = new Intl.RelativeTimeFormat(vscode.env.language, { numeric: 'auto' });
  for (const [unit, secs] of units) {
    if (Math.abs(diff) >= secs) {
      return rtf.format(Math.round(diff / secs), unit);
    }
  }
  return rtf.format(Math.round(diff), 'second');
}

const key = (repo: RepoHandle): string => repo.root.fsPath;

export class RepoNode extends vscode.TreeItem {
  constructor(readonly repo: RepoHandle) {
    super(path.basename(repo.root.fsPath), Expanded);
    this.id = `repo:${key(repo)}`;
    this.contextValue = 'repo';
    this.iconPath = new vscode.ThemeIcon('repo');
  }
}

export class SectionNode extends vscode.TreeItem {
  constructor(
    readonly repo: RepoHandle,
    readonly snap: RepoSnapshot,
    readonly remote: string | undefined,
    expanded: boolean,
  ) {
    super(remote === undefined ? vscode.l10n.t('Local') : vscode.l10n.t('Remote: {0}', remote), expanded ? Expanded : Collapsed);
    this.id = `section:${key(repo)}:${remote ?? ''}`;
    this.contextValue = remote === undefined ? 'section-local' : 'section-remote';
  }
}

export class FolderNode extends vscode.TreeItem {
  constructor(
    readonly repo: RepoHandle,
    readonly snap: RepoSnapshot,
    readonly section: SectionNode,
    readonly entry: Extract<TreeEntry, { type: 'folder' }>,
    expanded: boolean,
  ) {
    super(entry.name, expanded ? Expanded : Collapsed);
    // VS Code keeps saved expand state per id and ignores a new collapsibleState,
    // so filtered (force-expanded) folders get their own ids.
    this.id = `folder:${section.id}:${entry.path}${expanded ? ':filtered' : ''}`;
    this.contextValue = 'folder';
    this.iconPath = vscode.ThemeIcon.Folder;
  }
}

export class BranchNode extends vscode.TreeItem {
  readonly commitsKey: string;
  constructor(
    readonly repo: RepoHandle,
    readonly snap: RepoSnapshot,
    readonly branch: BranchRef,
    label: string,
    hasChildren: boolean,
  ) {
    super(label, hasChildren ? Collapsed : None);
    this.id = `branch:${key(repo)}:${branch.kind}:${branch.name}`;
    this.commitsKey = this.id;
    const base = snap.base;
    const isBase = !!base && (branch.name === base.local || branch.name === base.remoteRef);
    const merged = branch.kind === 'local' && snap.merged.has(branch.name);
    if (branch.kind === 'remote') {
      this.contextValue = 'branch-remote';
    } else if (branch.isHead) {
      this.contextValue = 'branch-local-head';
    } else if (merged) {
      this.contextValue = 'branch-local-merged';
    } else {
      this.contextValue = 'branch-local';
    }
    this.iconPath = new vscode.ThemeIcon(
      branch.isHead ? 'circle-filled' : this.contextValue === 'branch-local-merged' ? 'check' : 'git-branch',
    );
    this.description = localizedDescription(branch, {
      aheadOfBase: snap.aheadOfBase.get(branch.name),
      merged,
      isBase,
    });
    this.tooltip = tooltipFor(branch);
  }
}

/** `describeBranch` with its English tokens translated. */
export function localizedDescription(b: BranchRef, badges: BranchBadges): string {
  return describeBranch(b, badges)
    .replace('✓ merged', vscode.l10n.t('✓ merged'))
    .replace('(remote deleted)', vscode.l10n.t('(remote deleted)'));
}

function tooltipFor(b: BranchRef): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**${escapeMd(b.name)}**\n\n`);
  md.appendText(`${b.subject} (${relativeTime(b.committerTime)})`);
  if (b.upstream) {
    md.appendMarkdown('\n\n');
    md.appendText(vscode.l10n.t('Upstream: {0}', b.upstream));
    md.appendMarkdown('\n\n');
    md.appendText(vscode.l10n.t('Ahead {0}, behind {1}', b.ahead, b.behind));
  }
  return md;
}

const escapeMd = (s: string): string => s.replace(/([\\`*_{}[\]()#+\-.!<>|])/g, '\\$1');

export class RangeChangesNode extends vscode.TreeItem {
  constructor(
    readonly repo: RepoHandle,
    readonly baseRef: string,
    readonly tip: BranchRef,
    parentId: string,
  ) {
    super(vscode.l10n.t('All changes vs {0}', baseRef), Collapsed);
    this.id = `${parentId}/range`;
    this.contextValue = 'range-changes';
    this.iconPath = new vscode.ThemeIcon('diff-multiple');
  }
}

export class CommitNode extends vscode.TreeItem {
  constructor(
    readonly repo: RepoHandle,
    readonly commit: Commit,
    parentId: string,
  ) {
    super(`${commit.shortHash}  ${commit.subject}`, Collapsed);
    this.id = `${parentId}/commit:${commit.hash}`;
    this.contextValue = 'commit';
    this.description = relativeTime(commit.time);
    this.iconPath = new vscode.ThemeIcon('git-commit');
    this.tooltip = `${commit.shortHash} ${commit.subject}\n${commit.author}`;
  }
}

export class FileNode extends vscode.TreeItem {
  constructor(
    repo: RepoHandle,
    change: FileChange,
    refs: { left?: string; right?: string },
    parentId: string,
  ) {
    super(path.posix.basename(change.path), None);
    this.id = `${parentId}/file:${change.path}`;
    this.contextValue = 'file';
    this.resourceUri = vscode.Uri.from({ scheme: 'junction-file', path: `/${change.path}` });
    this.iconPath = vscode.ThemeIcon.File;
    const dir = path.posix.dirname(change.path);
    this.description = `${statusLetter(change.status)}${dir === '.' ? '' : `  ${dir}`}`;
    this.tooltip = change.oldPath ? `${change.oldPath} → ${change.path}` : change.path;
    const args: DiffArgs = {
      root: repo.root,
      left: change.status === 'A' ? undefined : refs.left,
      right: change.status === 'D' ? undefined : refs.right,
      path: change.path,
      oldPath: change.oldPath,
    };
    this.command = { command: 'junction.openFileDiff', title: vscode.l10n.t('Open Diff'), arguments: [args] };
  }
}

const statusLetter = (s: ChangeStatus): string => s;

export class MoreNode extends vscode.TreeItem {
  constructor(
    readonly parent: Node,
    readonly moreKey: string,
  ) {
    super(vscode.l10n.t('Load more…'), None);
    this.id = `${moreKey}/more`;
    this.contextValue = 'more';
    this.command = { command: 'junction.loadMore', title: vscode.l10n.t('Load more…'), arguments: [this] };
  }
}

export class CompareNode extends vscode.TreeItem {
  constructor(
    readonly repo: RepoHandle,
    readonly a: string,
    readonly b: string,
  ) {
    super(vscode.l10n.t('Compare: {0} ↔ {1}', a, b), Expanded);
    this.id = `compare:${key(repo)}:${a}:${b}`;
    this.contextValue = 'compare';
    this.iconPath = new vscode.ThemeIcon('git-compare');
  }
}

export class CompareSideNode extends vscode.TreeItem {
  readonly commitsKey: string;
  constructor(
    readonly repo: RepoHandle,
    /** Commits reachable from `only` but not from `other`. */
    readonly only: string,
    readonly other: string,
    parentId: string,
  ) {
    super(vscode.l10n.t('Only in {0}', only), Expanded);
    this.id = `${parentId}/side:${only}`;
    this.commitsKey = this.id;
    this.contextValue = 'compare-side';
  }
}

export class StatusNode extends vscode.TreeItem {
  constructor(
    readonly repo: RepoHandle,
    kind: 'rebase' | 'merge',
    label: string,
    id: string,
  ) {
    super(label, None);
    this.id = id;
    this.contextValue = kind === 'rebase' ? 'status-rebase' : 'status-merge';
    this.iconPath = new vscode.ThemeIcon('warning');
  }
}

export class ErrorNode extends vscode.TreeItem {
  constructor(message: string, id: string) {
    super(message, None);
    this.id = id;
    this.contextValue = 'error';
    this.iconPath = new vscode.ThemeIcon('error');
  }
}

export type Node =
  | RepoNode
  | SectionNode
  | FolderNode
  | BranchNode
  | RangeChangesNode
  | CommitNode
  | FileNode
  | MoreNode
  | CompareNode
  | CompareSideNode
  | StatusNode
  | ErrorNode;
