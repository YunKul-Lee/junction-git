import * as path from 'path';
import * as vscode from 'vscode';
import { BranchNode, CommitNode, DiffArgs, localizedDescription, MoreNode, StatusNode } from '../views/nodes';
import { BranchTreeProvider } from '../views/branchTree';
import * as flows from '../flows/branchFlows';
import * as mergeFlows from '../flows/mergeFlows';
import { createPrFlow, PrEnv } from '../flows/prFlow';
import { MergeResult } from '../flows/mergeFlows';
import { FlowResult, Msg, Ui } from '../flows/ui';
import { BranchRef } from '../git/types';
import { fetchAll } from '../git/operations';
import { loadSnapshot } from '../model/repoModel';
import { quickCheckoutOrder } from '../model/tree';
import { GitConnection, RepoHandle } from '../vscode/gitApi';
import { openServersSettings, readSettings, saveServer } from '../vscode/settings';
import { openExternalUrl } from '../vscode/externalUri';
import { VscodeUi } from '../vscode/vscodeUi';

export const EMPTY_SCHEME = 'junction-empty';

export interface CommandDeps {
  tree: BranchTreeProvider;
  conn: GitConnection;
  output: vscode.OutputChannel;
}

export function registerCommands(ctx: vscode.ExtensionContext, deps: CommandDeps): void {
  const { tree, conn } = deps;
  const ui = new VscodeUi(deps.output);
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

  // ---- branch operations --------------------------------------------------

  /** Tells the user the operation stopped on conflicts; deliberately not awaited so the tree refreshes at once. */
  const offerConflictHandoff = async (repo: RepoHandle): Promise<void> => {
    const open = vscode.l10n.t('Open Conflicts');
    const abort = vscode.l10n.t('Abort');
    const picked = await vscode.window.showWarningMessage(vscode.l10n.t('Conflicts found.'), open, abort);
    if (picked === open) {
      await vscode.commands.executeCommand('junction.openConflicts', { repo });
    } else if (picked === abort) {
      await vscode.commands.executeCommand('junction.abortOperation', { repo });
    }
  };

  /** Runs a flow against a fresh snapshot, then refreshes the repo whatever the outcome. */
  const runFlow = async (
    repo: RepoHandle,
    title: Msg,
    flow: (c: { git: RepoHandle['git']; ui: Ui; snap: Awaited<ReturnType<typeof loadSnapshot>> }) => Promise<FlowResult | MergeResult>,
  ): Promise<void> => {
    try {
      const result = await ui.progress(title, async () => {
        const snap = await loadSnapshot(repo.git, { baseBranch: readSettings(repo.root).baseBranch });
        return flow({ git: repo.git, ui, snap });
      });
      if (result === 'conflicts') {
        void offerConflictHandoff(repo);
      }
    } catch (e) {
      ui.error({ key: 'Unexpected error: {0}', args: [e instanceof Error ? e.message : String(e)] }, e);
    } finally {
      tree.refresh(repo.root);
    }
  };

  /** Re-resolves the node's branch in the fresh snapshot so flows never act on stale state. */
  const branchFlow =
    (title: Msg, flow: (c: Parameters<Parameters<typeof runFlow>[2]>[0], b: BranchRef) => Promise<FlowResult | MergeResult>) =>
    (node: BranchNode): Promise<void> =>
      runFlow(node.repo, title, (c) => {
        const b = c.snap.branches.find((x) => x.kind === node.branch.kind && x.name === node.branch.name);
        if (!b) {
          ui.error({ key: 'Branch {0} no longer exists.', args: [node.branch.name] });
          return Promise.resolve('failed');
        }
        return flow(c, b);
      });

  const pickRepo = async (): Promise<RepoHandle | undefined> => {
    const repos = conn.repos();
    if (repos.length <= 1) {
      return repos[0];
    }
    return ui.pick(
      repos.map((r) => ({ label: path.basename(r.root.fsPath), description: r.root.fsPath, value: r })),
      { key: 'Select a repository' },
    );
  };
  const repoFlow =
    (title: Msg, flow: (c: Parameters<Parameters<typeof runFlow>[2]>[0]) => Promise<FlowResult | MergeResult>) =>
    async (): Promise<void> => {
      const repo = await pickRepo();
      if (repo) {
        await runFlow(repo, title, flow);
      }
    };

  reg('junction.checkout', branchFlow({ key: 'Switching branch…' }, flows.checkoutFlow));
  reg('junction.checkoutBranch', async () => {
    const repo = await pickRepo();
    if (!repo) {
      return;
    }
    // Pick first, outside the progress; the flow then reloads a fresh snapshot like every other command.
    let picked: BranchRef | undefined;
    try {
      const snap = await loadSnapshot(repo.git, { baseBranch: readSettings(repo.root).baseBranch });
      const items = quickCheckoutOrder(snap.branches, snap.recent, snap.state.head).map((b) => ({
        label: b.name,
        description: localizedDescription(b, {
          aheadOfBase: snap.aheadOfBase.get(b.name),
          merged: b.kind === 'local' && snap.merged.has(b.name),
          isBase: !!snap.base && (b.name === snap.base.local || b.name === snap.base.remoteRef),
        }),
        value: b,
      }));
      picked = await ui.pick(items, { key: 'Select a branch to switch to' });
    } catch (e) {
      ui.error({ key: 'Unexpected error: {0}', args: [e instanceof Error ? e.message : String(e)] }, e);
      return;
    }
    if (!picked) {
      return;
    }
    const chosen = picked;
    await runFlow(repo, { key: 'Switching branch…' }, (c) => {
      const b = c.snap.branches.find((x) => x.kind === chosen.kind && x.name === chosen.name);
      if (!b) {
        ui.error({ key: 'Branch {0} no longer exists.', args: [chosen.name] });
        return Promise.resolve('failed');
      }
      return flows.checkoutFlow(c, b);
    });
  });
  reg('junction.newBranch', branchFlow({ key: 'Creating branch…' }, flows.newBranchFlow));
  reg('junction.rename', branchFlow({ key: 'Renaming branch…' }, flows.renameFlow));
  reg('junction.delete', branchFlow({ key: 'Deleting branch…' }, flows.deleteLocalFlow));
  reg('junction.deleteRemote', branchFlow({ key: 'Deleting remote branch…' }, flows.deleteRemoteFlow));
  reg('junction.push', branchFlow({ key: 'Pushing…' }, flows.pushFlow));
  reg('junction.pull', branchFlow({ key: 'Pulling…' }, flows.pullFlow));
  reg('junction.sync', repoFlow({ key: 'Syncing…' }, flows.syncFlow));
  reg('junction.cleanupMerged', repoFlow({ key: 'Cleaning up merged branches…' }, flows.cleanupMergedFlow));
  reg(
    'junction.fetch',
    repoFlow({ key: 'Fetching…' }, async (c) => {
      try {
        await fetchAll(c.git);
        return 'done';
      } catch (e) {
        c.ui.error({ key: 'Fetch failed.' }, e);
        return 'failed';
      }
    }),
  );
  reg(
    'junction.mergeIntoCurrent',
    (node: BranchNode) =>
      branchFlow({ key: 'Merging…' }, (c, b) =>
        mergeFlows.mergeIntoCurrentFlow(c, b, { confirm: readSettings(node.repo.root).confirmMerge }),
      )(node),
  );
  reg(
    'junction.rebaseCurrentOnto',
    (node: BranchNode) =>
      branchFlow({ key: 'Rebasing…' }, (c, b) =>
        mergeFlows.rebaseCurrentOntoFlow(c, b, { confirm: readSettings(node.repo.root).confirmMerge }),
      )(node),
  );
  /** Status-node buttons pass the node; the conflict notification passes `{ repo }`. */
  const repoOf = async (node?: { repo: RepoHandle }): Promise<RepoHandle | undefined> => node?.repo ?? pickRepo();
  reg('junction.continueOperation', async (node?: StatusNode) => {
    const repo = await repoOf(node);
    if (repo) {
      await runFlow(repo, { key: 'Continuing…' }, mergeFlows.continueFlow);
    }
  });
  reg('junction.abortOperation', async (node?: StatusNode) => {
    const repo = await repoOf(node);
    if (repo) {
      await runFlow(repo, { key: 'Aborting…' }, mergeFlows.abortFlow);
    }
  });
  reg('junction.openConflicts', async (node?: StatusNode) => {
    const repo = await repoOf(node);
    if (!repo) {
      return;
    }
    await vscode.commands.executeCommand('workbench.view.scm');
    try {
      const out = await repo.git.run(['diff', '--name-only', '--diff-filter=U']);
      const first = out.split('\n').map((l) => l.trim()).find(Boolean);
      if (first) {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(repo.root, first));
      }
    } catch (e) {
      ui.error({ key: 'Could not list conflicted files.' }, e);
    }
  });
  // ---- pull requests ------------------------------------------------------

  const NAG_PREFIX = 'junction.prNag.';
  const prEnv = (root: vscode.Uri): PrEnv => ({
    servers: () => readSettings(root).bitbucketServers,
    saveServer,
    open: async (url) => {
      await openExternalUrl(url);
    },
    openSettings: () => void openServersSettings(),
    nagCount: (host) => ctx.globalState.get<number>(NAG_PREFIX + host.toLowerCase(), 0),
    bumpNag: (host) => {
      const k = NAG_PREFIX + host.toLowerCase();
      void ctx.globalState.update(k, ctx.globalState.get<number>(k, 0) + 1);
    },
  });
  const prFlow =
    (pickTarget: boolean) =>
    (node: BranchNode): Promise<void> =>
      branchFlow({ key: 'Opening pull request…' }, async (c, b) => {
        let target: string | undefined;
        if (pickTarget) {
          const names = [...new Set(c.snap.branches.filter((x) => x.kind === 'remote').map((x) => x.shortName))]
            .filter((n) => n !== 'HEAD' && n !== b.shortName)
            .sort();
          target = await c.ui.pick(
            names.map((n) => ({ label: n, value: n })),
            { key: 'Select the target branch' },
          );
          if (!target) {
            return 'cancelled';
          }
        }
        return createPrFlow({ ...c, env: prEnv(node.repo.root) }, b, target);
      })(node);
  reg('junction.createPr', prFlow(false));
  reg('junction.createPrPickTarget', prFlow(true));
  reg('junction.bitbucket.changeWebUrl', () => openServersSettings());

  reg('junction.copyBranchName', (node: BranchNode) => vscode.env.clipboard.writeText(node.branch.name));

  reg('junction.copyCommitHash', (node: CommitNode) => vscode.env.clipboard.writeText(node.commit.hash));
  reg('junction.copyCommitMessage', (node: CommitNode) => vscode.env.clipboard.writeText(node.commit.subject));
}
