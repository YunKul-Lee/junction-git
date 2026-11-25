export type ServerType = 'bitbucket-cloud' | 'bitbucket-datacenter' | 'github' | 'gitlab' | 'none';

export interface PrServer {
  gitHost: string;
  /** Web address of the server; not needed for `none`. */
  webUrl?: string;
  type: ServerType;
}

export interface ParsedRemote {
  host: string;
  /** Path segments with a trailing `.git` removed from the last one. */
  segments: string[];
  port?: number;
  scheme: 'http' | 'https' | 'ssh' | 'scp' | 'other';
}

const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const SCP_LIKE = /^(?:[^@\s/]+@)?([^\s/:]+):(.*)$/;
const DATACENTER_SSH_PORT = 7999;

/** Parses scp-like (`git@host:path`), `ssh://` and `https://` remote URLs. */
export function parseRemote(url: string): ParsedRemote | undefined {
  try {
    let host: string;
    let path: string;
    let port: number | undefined;
    let scheme: ParsedRemote['scheme'];
    if (SCHEME_URL.test(url)) {
      const parsed = new URL(url);
      host = parsed.hostname;
      path = parsed.pathname;
      port = parsed.port ? Number(parsed.port) : undefined;
      const proto = parsed.protocol.replace(/:$/, '').toLowerCase();
      scheme = proto === 'http' || proto === 'https' || proto === 'ssh' ? proto : 'other';
    } else {
      const m = SCP_LIKE.exec(url);
      if (!m) return undefined;
      host = m[1];
      path = m[2];
      scheme = 'scp';
    }
    host = host.toLowerCase();
    if (!host) return undefined;

    const segments = path.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) return undefined;
    segments[segments.length - 1] = segments[segments.length - 1].replace(/\.git$/, '');
    if (segments[segments.length - 1] === '') segments.pop();
    if (segments.length === 0) return undefined;

    return port === undefined ? { host, segments, scheme } : { host, segments, port, scheme };
  } catch {
    return undefined;
  }
}

/** Picks the configured server whose gitHost matches the remote host (case-insensitive). */
export function findServer(remoteUrl: string, configured: PrServer[]): PrServer | undefined {
  const parsed = parseRemote(remoteUrl);
  if (!parsed) return undefined;
  return configured.find((s) => s.gitHost.toLowerCase() === parsed.host);
}

const PUBLIC_HOSTS: Record<string, ServerType> = {
  'github.com': 'github',
  'gitlab.com': 'gitlab',
  'bitbucket.org': 'bitbucket-cloud',
};

/** github.com, gitlab.com and bitbucket.org need no settings entry; any other host returns undefined. */
export function guessPublic(remoteUrl: string): PrServer | undefined {
  const parsed = parseRemote(remoteUrl);
  const type = parsed ? PUBLIC_HOSTS[parsed.host] : undefined;
  return parsed && type ? { gitHost: parsed.host, webUrl: `https://${parsed.host}`, type } : undefined;
}

/** Guesses a Bitbucket Data Center server from a `/scm/` clone path or the 7999 SSH port. */
export function guessDataCenter(remoteUrl: string): PrServer | undefined {
  const parsed = parseRemote(remoteUrl);
  if (!parsed) return undefined;
  const scmIndex = parsed.segments.indexOf('scm');
  if (scmIndex === -1 && parsed.port !== DATACENTER_SSH_PORT) return undefined;
  const context = scmIndex === -1 ? [] : parsed.segments.slice(0, scmIndex);
  const webUrl = `https://${parsed.host}${context.map((c) => `/${c}`).join('')}`;
  return { gitHost: parsed.host, webUrl, type: 'bitbucket-datacenter' };
}

const DEFAULT_TYPE_ORDER: ServerType[] = ['bitbucket-datacenter', 'bitbucket-cloud', 'github', 'gitlab'];

/**
 * Server types in the order the first-use prompt offers them, most likely first: Bitbucket Data Center when
 * the Data Center guess matches, else a type named in the host (e.g. `gitlab.acme.com`). `none` is always last.
 */
export function serverTypeOrder(remoteUrl: string): ServerType[] {
  const host = parseRemote(remoteUrl)?.host ?? '';
  const first: ServerType | undefined = guessDataCenter(remoteUrl)
    ? 'bitbucket-datacenter'
    : host.includes('github')
      ? 'github'
      : host.includes('gitlab')
        ? 'gitlab'
        : host.includes('bitbucket')
          ? 'bitbucket-datacenter'
          : undefined;
  const rest = DEFAULT_TYPE_ORDER.filter((t) => t !== first);
  return [...(first ? [first] : []), ...rest, 'none'];
}

/** The repository path on the server: for an http(s) remote, the web address's own path prefix is removed. */
function repoPath(base: string, parsed: ParsedRemote): string[] {
  if (parsed.scheme !== 'http' && parsed.scheme !== 'https') return parsed.segments;
  let prefix: string[];
  try {
    prefix = new URL(base).pathname.split('/').filter((s) => s.length > 0);
  } catch {
    return parsed.segments;
  }
  const matches = prefix.length > 0 && prefix.every((p, i) => parsed.segments[i] === p);
  return matches ? parsed.segments.slice(prefix.length) : parsed.segments;
}

/** Branch names in a GitHub compare path: encoded, but `/` stays as is. */
const ghBranch = (s: string): string => encodeURIComponent(s).replace(/%2F/g, '/');

/** Builds the "create pull request" page URL, or undefined if it cannot be built. */
export function buildPrUrl(server: PrServer, remoteUrl: string, source: string, target: string): string | undefined {
  if (server.type === 'none') return undefined;
  const parsed = parseRemote(remoteUrl);
  if (!parsed || parsed.segments.length < 2) return undefined;
  // A hand-written entry may leave out webUrl when the web host is the git host.
  const base = (server.webUrl || `https://${server.gitHost}`).replace(/\/+$/, '');
  const enc = encodeURIComponent;
  const repo = parsed.segments[parsed.segments.length - 1];
  const owner = parsed.segments[parsed.segments.length - 2];

  switch (server.type) {
    case 'github':
      return `${base}/${owner}/${repo}/compare/${ghBranch(target)}...${ghBranch(source)}?expand=1`;
    case 'gitlab': {
      const path = repoPath(base, parsed);
      if (path.length < 2) return undefined;
      return `${base}/${path.join('/')}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${enc(source)}&merge_request%5Btarget_branch%5D=${enc(target)}`;
    }
    case 'bitbucket-cloud':
      return `${base}/${owner}/${repo}/pull-requests/new?source=${enc(source)}&dest=${enc(target)}`;
    case 'bitbucket-datacenter': {
      const query = `?create&sourceBranch=${enc('refs/heads/' + source)}&targetBranch=${enc('refs/heads/' + target)}`;
      const projectPath = owner.startsWith('~') ? `users/${owner.slice(1)}` : `projects/${owner.toUpperCase()}`;
      return `${base}/${projectPath}/repos/${repo}/pull-requests${query}`;
    }
  }
}

/**
 * True when the pull request menu should be offered for the remote: it is a parseable remote host (local
 * and Windows drive paths are not) and no settings entry turns pull requests off for it.
 */
export function prAvailable(remoteUrl: string, configured: PrServer[]): boolean {
  const server = findServer(remoteUrl, configured);
  if (server) return server.type !== 'none';
  const parsed = parseRemote(remoteUrl);
  return !!parsed && parsed.scheme !== 'other' && parsed.host.length >= 2;
}

/**
 * The servers from every settings scope, most specific first: VS Code replaces arrays across scopes,
 * so a workspace list would otherwise hide the user's global entries. `findServer` picks the first match.
 */
export function serversFromScopes(
  inspected: { workspaceFolderValue?: PrServer[]; workspaceValue?: PrServer[]; globalValue?: PrServer[] } | undefined,
): PrServer[] {
  const list = (v: unknown): PrServer[] => (Array.isArray(v) ? v : []);
  return [...list(inspected?.workspaceFolderValue), ...list(inspected?.workspaceValue), ...list(inspected?.globalValue)];
}
