import { remoteUrl } from '../git/queries';
import { BranchRef } from '../git/types';
import { RepoSnapshot } from '../model/repoModel';
import { PrServer, ServerType, buildPrUrl, findServer, guessDataCenter, guessPublic, parseRemote, serverTypeOrder } from '../pr/providers';
import type { MergeResult } from './mergeFlows';
import { PushCtx, pushFlow } from './pushFlows';

export interface PrEnv {
  /** Servers from every settings scope, most specific first (the first match wins). */
  servers(): PrServer[];
  /** Adds to or replaces (by gitHost) the entry in the user (Global) settings. */
  saveServer(s: PrServer): Promise<void>;
  open(url: string): Promise<void>;
  /** Opens the settings UI at `junction.pullRequest.servers`. */
  openSettings(): void;
  nagCount(gitHost: string): number;
  bumpNag(gitHost: string): void;
}

export interface PrCtx extends PushCtx {
  env: PrEnv;
}

// Messages are inline `{ key, args }` literals on purpose; see branchFlows.ts.

const TYPE_ITEMS: Record<ServerType, { label: string; labelMsg?: { key: string }; value: ServerType }> = {
  'bitbucket-datacenter': { label: 'Bitbucket Data Center', value: 'bitbucket-datacenter' },
  'bitbucket-cloud': { label: 'Bitbucket Cloud', value: 'bitbucket-cloud' },
  github: { label: 'GitHub', value: 'github' },
  gitlab: { label: 'GitLab', value: 'gitlab' },
  none: { label: 'No pull requests on this server', labelMsg: { key: 'No pull requests on this server' }, value: 'none' },
};

function remoteName(snap: RepoSnapshot, b: BranchRef): string | undefined {
  const of = (ref?: string): string | undefined => (ref ? snap.remotes.find((r) => ref.startsWith(`${r}/`)) : undefined);
  return (
    (b.upstreamGone ? undefined : of(b.upstream)) ??
    of(snap.base?.remoteRef) ??
    (snap.remotes.includes('origin') ? 'origin' : snap.remotes[0])
  );
}

export async function createPrFlow(c: PrCtx, b: BranchRef, target?: string): Promise<MergeResult> {
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

  const host = parsed.host;
  let server = findServer(url, env.servers());
  // Only an address the user saved can be wrong; public hosts are always right.
  let fromSettings = !!server;
  if (server?.type === 'none') {
    ui.info({ key: 'Pull requests are turned off for {0}.', args: [host] }, [{ key: 'Open Settings' }], () => env.openSettings());
    return 'cancelled';
  }
  if (!server) {
    server = guessPublic(url);
  }
  if (!server) {
    const type = await ui.pick<ServerType>(
      serverTypeOrder(url).map((t) => TYPE_ITEMS[t]),
      { key: 'What kind of server is {0}?', args: [host] },
    );
    if (!type) {
      return 'cancelled';
    }
    if (type === 'none') {
      await env.saveServer({ gitHost: host, type: 'none' });
      ui.info({ key: 'Pull requests are turned off for {0}. You can change this in settings.', args: [host] });
      return 'cancelled';
    }
    const guessed = type === 'bitbucket-datacenter' ? guessDataCenter(url)?.webUrl : undefined;
    const webUrl = await ui.input({ key: 'Web address for {0}', args: [host] }, {
      value: guessed ?? `https://${host}`,
      validate: (v) => (/^https?:\/\/[^/\s]+/.test(v.trim()) ? undefined : { key: 'Enter an http(s) URL.' }),
    });
    if (webUrl === undefined) {
      return 'cancelled';
    }
    server = { gitHost: host, webUrl: webUrl.trim().replace(/\/+$/, ''), type };
    await env.saveServer(server);
    fromSettings = true;
  }

  const needsPush = !b.upstream || b.upstreamGone || b.ahead > 0;
  if (needsPush) {
    const choice = await ui.confirm({ key: 'Push {0} before creating the pull request?', args: [b.name] }, [{ key: 'Push' }]);
    if (choice === undefined) {
      return 'cancelled';
    }
    const pushResult = await pushFlow(c, b);
    if (pushResult === 'conflicts') {
      return 'conflicts';
    }
    if (pushResult !== 'done') {
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
  if (fromSettings && env.nagCount(server.gitHost) < 3) {
    env.bumpNag(server.gitHost);
    ui.info({ key: 'Wrong address?' }, [{ key: 'Open Settings' }], () => env.openSettings());
  }
  return 'done';
}
