import * as vscode from 'vscode';
import { commitFiles, logRange, rangeFiles } from '../git/queries';
import { Commit } from '../git/types';
import { loadSnapshot, RepoSnapshot } from '../model/repoModel';
import { buildEntries, TreeEntry } from '../model/tree';
import { GitConnection, RepoHandle } from '../vscode/gitApi';
import { readSettings } from '../vscode/settings';
import {
  BranchNode,
  CommitNode,
  CompareNode,
  CompareSideNode,
  ErrorNode,
  FileNode,
  FolderNode,
  MoreNode,
  Node,
  RangeChangesNode,
  RepoNode,
  SectionNode,
  StatusNode,
} from './nodes';

type LoadResult = { snap: RepoSnapshot } | { error: string };

const REFRESH_DEBOUNCE_MS = 300;

export class BranchTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly filterEmitter = new vscode.EventEmitter<string | undefined>();
  readonly onDidChangeFilter = this.filterEmitter.event;

  private results = new Map<string, Promise<LoadResult>>();
  private snaps = new Map<string, RepoSnapshot>();
  private shown = new Map<string, number>();
  private subscribed = new Map<string, vscode.Disposable>();
  private pending = new Set<string>();
  private pendingAll = false;
  private timer: NodeJS.Timeout | undefined;
  private running: { abort: AbortController; roots: Set<string> | 'all' } | undefined;
  private filter: string | undefined;
  private filterRaw: string | undefined;
  private compare: { root: string; a: string; b: string } | undefined;
  private readonly sub: vscode.Disposable;

  constructor(
    private readonly conn: GitConnection,
    private readonly log: (line: string) => void,
  ) {
    this.sub = conn.onDidChangeRepos(() => {
      this.syncSubscriptions(conn.repos());
      this.refresh();
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.running?.abort.abort();
    this.sub.dispose();
    this.subscribed.forEach((d) => d.dispose());
    this.changeEmitter.dispose();
    this.filterEmitter.dispose();
  }

  // ---- public API -------------------------------------------------------

  refresh(root?: vscode.Uri): void {
    if (root) {
      this.pending.add(root.fsPath);
    } else {
      this.pendingAll = true;
    }
    if (this.running) {
      // Restart: the aborted run's targets must be covered by the next one.
      this.running.abort.abort();
      if (this.running.roots === 'all') {
        this.pendingAll = true;
      } else {
        this.running.roots.forEach((r) => this.pending.add(r));
      }
      this.running = undefined;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.runRefresh(), REFRESH_DEBOUNCE_MS);
  }

  setFilter(text: string | undefined): void {
    this.filterRaw = text || undefined;
    this.filter = this.filterRaw?.toLowerCase();
    this.filterEmitter.fire(text || undefined);
    this.changeEmitter.fire(undefined);
  }

  getFilter(): string | undefined {
    return this.filterRaw;
  }

  showCompare(root: vscode.Uri, a: string, b: string): void {
    this.compare = { root: root.fsPath, a, b };
    this.changeEmitter.fire(undefined);
  }

  clearCompare(): void {
    this.compare = undefined;
    this.changeEmitter.fire(undefined);
  }

  snapshot(root: vscode.Uri): RepoSnapshot | undefined {
    return this.snaps.get(root.fsPath);
  }

  /** Shows `commitLimit` more commits under the node's parent. */
  loadMore(node: MoreNode): void {
    const limit = readSettings(this.repoOf(node.parent)?.root).commitLimit;
    this.shown.set(node.moreKey, (this.shown.get(node.moreKey) ?? limit) + limit);
    this.changeEmitter.fire(node.parent);
  }

  // ---- loading ----------------------------------------------------------

  private async runRefresh(): Promise<void> {
    const all = this.pendingAll;
    const roots = new Set(this.pending);
    this.pendingAll = false;
    this.pending.clear();
    const abort = new AbortController();
    this.running = { abort, roots: all ? 'all' : roots };
    const targets = this.conn.repos().filter((r) => all || roots.has(r.root.fsPath));
    const fresh = await Promise.all(targets.map(async (r) => [r, await this.load(r, abort.signal)] as const));
    if (abort.signal.aborted) {
      return;
    }
    this.running = undefined;
    const live = new Set(this.conn.repos().map((r) => r.root.fsPath));
    for (const k of [...this.results.keys()]) {
      if (!live.has(k)) {
        this.results.delete(k);
        this.snaps.delete(k);
      }
    }
    for (const [repo, result] of fresh) {
      this.store(repo, result);
    }
    this.changeEmitter.fire(undefined);
  }

  private async load(repo: RepoHandle, signal?: AbortSignal): Promise<LoadResult> {
    try {
      const snap = await loadSnapshot(repo.git, { baseBranch: readSettings(repo.root).baseBranch }, signal);
      return { snap };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!signal?.aborted) {
        this.log(`Failed to load ${repo.root.fsPath}: ${message}`);
      }
      return { error: message };
    }
  }

  private store(repo: RepoHandle, result: LoadResult): void {
    const k = repo.root.fsPath;
    this.results.set(k, Promise.resolve(result));
    if ('snap' in result) {
      this.snaps.set(k, result.snap);
    } else {
      this.snaps.delete(k);
    }
  }

  private result(repo: RepoHandle): Promise<LoadResult> {
    const k = repo.root.fsPath;
    let p = this.results.get(k);
    if (!p) {
      const lazy = this.load(repo);
      p = lazy;
      this.results.set(k, lazy);
      // Only store if no newer refresh replaced this entry in the meantime.
      void lazy.then((r) => {
        if (this.results.get(k) === lazy) {
          this.store(repo, r);
        }
      });
    }
    return p;
  }

  private syncSubscriptions(repos: RepoHandle[]): void {
    const live = new Set(repos.map((r) => r.root.fsPath));
    for (const [k, d] of [...this.subscribed]) {
      if (!live.has(k)) {
        d.dispose();
        this.subscribed.delete(k);
      }
    }
    for (const r of repos) {
      if (!this.subscribed.has(r.root.fsPath)) {
        this.subscribed.set(
          r.root.fsPath,
          r.onDidChange(() => this.refresh(r.root)),
        );
      }
    }
  }

  private repoOf(node: Node): RepoHandle | undefined {
    return 'repo' in node ? (node.repo as RepoHandle) : undefined;
  }

  // ---- TreeDataProvider -------------------------------------------------

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    try {
      return await this.children(element);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.log(`Failed to load tree children: ${message}`);
      return [new ErrorNode(vscode.l10n.t('Failed to load branches: {0}', message), `error:${element?.id ?? 'root'}`)];
    }
  }

  private async children(element?: Node): Promise<Node[]> {
    if (!element) {
      const repos = this.conn.repos();
      this.syncSubscriptions(repos);
      if (repos.length === 1) {
        return this.repoChildren(repos[0]);
      }
      return repos.map((r) => new RepoNode(r));
    }
    if (element instanceof RepoNode) {
      return this.repoChildren(element.repo);
    }
    if (element instanceof SectionNode) {
      return this.sectionChildren(element);
    }
    if (element instanceof FolderNode) {
      return this.entryNodes(element.repo, element.snap, element.section, element.entry.children);
    }
    if (element instanceof BranchNode) {
      return this.branchChildren(element);
    }
    if (element instanceof RangeChangesNode) {
      const { mergeBase, files } = await rangeFiles(element.repo.git, element.baseRef, element.tip.name);
      const refs = { left: mergeBase, right: element.tip.hash };
      return files.map((f) => new FileNode(element.repo, f, refs, element.id as string));
    }
    if (element instanceof CommitNode) {
      const c = element.commit;
      const files = await commitFiles(element.repo.git, c.hash);
      const refs = { left: c.parents.length > 0 ? `${c.hash}^` : undefined, right: c.hash };
      return files.map((f) => new FileNode(element.repo, f, refs, element.id as string));
    }
    if (element instanceof CompareNode) {
      const id = element.id as string;
      return [
        new CompareSideNode(element.repo, element.a, element.b, id),
        new CompareSideNode(element.repo, element.b, element.a, id),
      ];
    }
    if (element instanceof CompareSideNode) {
      return this.commitNodes(element, element.repo, element.other, element.only, element.commitsKey);
    }
    return [];
  }

  private async repoChildren(repo: RepoHandle): Promise<Node[]> {
    const result = await this.result(repo);
    const id = repo.root.fsPath;
    if ('error' in result) {
      return [new ErrorNode(vscode.l10n.t('Failed to load branches: {0}', result.error), `error:${id}`)];
    }
    const { snap } = result;
    const out: Node[] = [];
    if (snap.state.rebase) {
      const { step, total } = snap.state.rebase;
      out.push(new StatusNode(repo, 'rebase', vscode.l10n.t('Rebase in progress ({0}/{1})', step, total), `status-rebase:${id}`));
    }
    if (snap.state.merging) {
      out.push(new StatusNode(repo, 'merge', vscode.l10n.t('Merge in progress'), `status-merge:${id}`));
    }
    if (this.compare?.root === id) {
      out.push(new CompareNode(repo, this.compare.a, this.compare.b));
    }
    out.push(new SectionNode(repo, snap, undefined, true));
    snap.remotes.forEach((remote, i) => out.push(new SectionNode(repo, snap, remote, i === 0)));
    return out;
  }

  private sectionChildren(section: SectionNode): Node[] {
    const { repo, snap } = section;
    const cfg = readSettings(repo.root);
    const branches = snap.branches.filter((b) =>
      section.remote === undefined ? b.kind === 'local' : b.kind === 'remote' && b.remote === section.remote,
    );
    const entries = this.applyFilter(
      buildEntries(branches, { groupByFolder: cfg.groupByFolder, sort: cfg.branchSort, recent: snap.recent }),
    );
    return this.entryNodes(repo, snap, section, entries);
  }

  private applyFilter(entries: TreeEntry[]): TreeEntry[] {
    const f = this.filter;
    if (!f) {
      return entries;
    }
    const out: TreeEntry[] = [];
    for (const e of entries) {
      if (e.type === 'branch') {
        if (e.branch.shortName.toLowerCase().includes(f)) {
          out.push(e);
        }
      } else {
        const children = this.applyFilter(e.children);
        if (children.length > 0) {
          out.push({ ...e, children });
        }
      }
    }
    return out;
  }

  private entryNodes(repo: RepoHandle, snap: RepoSnapshot, section: SectionNode, entries: TreeEntry[]): Node[] {
    const base = snap.base;
    return entries.map((e) => {
      if (e.type === 'folder') {
        return new FolderNode(repo, snap, section, e, this.filter !== undefined);
      }
      const b = e.branch;
      const isBase = !!base && (b.name === base.local || b.name === base.remoteRef);
      const hasChildren = base ? (isBase ? b.name === base.local && !!base.remoteRef : true) : false;
      return new BranchNode(repo, snap, b, e.label, hasChildren);
    });
  }

  private async branchChildren(node: BranchNode): Promise<Node[]> {
    const { repo, snap, branch } = node;
    const base = snap.base;
    if (!base) {
      return [];
    }
    const id = node.id as string;
    const isBase = branch.name === base.local || branch.name === base.remoteRef;
    if (!isBase) {
      const range = new RangeChangesNode(repo, base.compareRef, branch, id);
      return [range, ...(await this.commitNodes(node, repo, base.compareRef, branch.name, node.commitsKey))];
    }
    if (branch.name === base.local && base.remoteRef) {
      // Commits on the remote base that this local base has not received yet.
      return this.commitNodes(node, repo, base.local, base.remoteRef, node.commitsKey);
    }
    return [];
  }

  private async commitNodes(
    parent: Node,
    repo: RepoHandle,
    exclude: string,
    include: string,
    moreKey: string,
  ): Promise<Node[]> {
    const limit = this.shown.get(moreKey) ?? readSettings(repo.root).commitLimit;
    const commits: Commit[] = await logRange(repo.git, exclude, include, { skip: 0, limit: limit + 1 });
    const out: Node[] = commits.slice(0, limit).map((c) => new CommitNode(repo, c, parent.id as string));
    if (commits.length > limit) {
      out.push(new MoreNode(parent, moreKey));
    }
    return out;
  }
}
