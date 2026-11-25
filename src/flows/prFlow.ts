import { remoteUrl } from '../git/queries';
import { BranchRef, Git } from '../git/types';
import { RepoSnapshot } from '../model/repoModel';
import { PrServer, buildPrUrl, findServer, guessDataCenter, guessPublic, parseRemote } from '../pr/providers';
import { pushFlow } from './branchFlows';
import { FlowResult, Ui } from './ui';

export interface PrEnv {
  /** Servers from every settings scope, most specific first (the first match wins). */
  servers(): PrServer[];
  /** Adds to or replaces (by gitHost) the entry in the user (Global) settings. */
  saveServer(s: PrServer): Promise<void>;
  open(url: string): Promise<void>;
  /** Opens the settings UI at `junction.bitbucket.servers`. */
  openSettings(): void;
  nagCount(gitHost: string): number;
  bumpNag(gitHost: string): void;
}

export interface PrCtx {
  git: Git;
  ui: Ui;
  snap: RepoSnapshot;
  env: PrEnv;
}

// Messages are inline `{ key, args }` literals on purpose; see branchFlows.ts.

function remoteName(snap: RepoSnapshot, b: BranchRef): string | undefined {
  const of = (ref?: string): string | undefined => (ref ? snap.remotes.find((r) => ref.startsWith(`${r}/`)) : undefined);
  return (
    (b.upstreamGone ? undefined : of(b.upstream)) ??
    of(snap.base?.remoteRef) ??
    (snap.remotes.includes('origin') ? 'origin' : snap.remotes[0])
  );
}

export async function createPrFlow(c: PrCtx, b: BranchRef, target?: string): Promise<FlowResult> {
  const { git, ui, snap, env } = c;
  const remote = remoteName(snap, b);
  const url = remote ? await remoteUrl(git, remote) : undefined;
  if (!url) {
    ui.error({ key: 'No remote configured.' });
    return 'failed';
  }
  const parsed = parseRemote(url);
  if (!parsed) {
    ui.error({ key: 'Could not build a pull request URL for this remote.' });
    return 'failed';
  }
  const targetBranch = target ?? snap.base?.name;
  if (!targetBranch) {
    ui.error({ key: 'Could not build a pull request URL for this remote.' });
    return 'failed';
  }

  let server = findServer(url, env.servers());
  if (!server) {
    const guess = guessPublic(url) ?? guessDataCenter(url);
    const webUrl = await ui.input({ key: 'Bitbucket web URL for {0}', args: [parsed.host] }, {
        value: guess?.webUrl ?? 'https://',
        validate: (v) => (/^https?:\/\/[^/\s]+/.test(v.trim()) ? undefined : { key: 'Enter an http(s) URL.' }),
      },
    );
    if (webUrl === undefined) {
      return 'cancelled';
    }
    let type = guess?.type;
    if (!type) {
      type = await ui.pick<PrServer['type']>(
        [
          { label: 'Bitbucket Cloud', value: 'bitbucket-cloud' },
          { label: 'Bitbucket Data Center', value: 'bitbucket-datacenter' },
        ],
        { key: 'Bitbucket server type' },
      );
      if (!type) {
        return 'cancelled';
      }
    }
    server = { gitHost: parsed.host, webUrl: webUrl.trim().replace(/\/+$/, ''), type };
    await env.saveServer(server);
  }

  const needsPush = !b.upstream || b.upstreamGone || b.ahead > 0;
  if (needsPush) {
    const choice = await ui.confirm({ key: 'Push {0} before creating the pull request?', args: [b.name] }, [{ key: 'Push' }]);
    if (choice === undefined) {
      return 'cancelled';
    }
    if ((await pushFlow({ git, ui, snap }, b)) !== 'done') {
      return 'failed';
    }
  }

  // The branch as it exists on the server: the upstream's name when tracked, else the name the push just used.
  const upstream = b.upstreamGone ? undefined : b.upstream;
  const upstreamRemote = upstream ? snap.remotes.find((r) => upstream.startsWith(`${r}/`)) : undefined;
  const source = upstream && upstreamRemote ? upstream.slice(upstreamRemote.length + 1) : b.name;
  const prUrl = buildPrUrl(server, url, source, targetBranch);
  if (!prUrl) {
    ui.error({ key: 'Could not build a pull request URL for this remote.' });
    return 'failed';
  }
  await env.open(prUrl);
  if (env.nagCount(server.gitHost) < 3) {
    env.bumpNag(server.gitHost);
    ui.info({ key: 'Wrong address?' }, [{ key: 'Open Settings' }], () => env.openSettings());
  }
  return 'done';
}
