export interface BitbucketServer {
  gitHost: string;
  webUrl: string;
  type: 'cloud' | 'datacenter';
}

export interface ParsedRemote {
  host: string;
  /** Path segments with a trailing `.git` removed from the last one. */
  segments: string[];
  port?: number;
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
    if (SCHEME_URL.test(url)) {
      const parsed = new URL(url);
      host = parsed.hostname;
      path = parsed.pathname;
      port = parsed.port ? Number(parsed.port) : undefined;
    } else {
      const m = SCP_LIKE.exec(url);
      if (!m) return undefined;
      host = m[1];
      path = m[2];
    }
    host = host.toLowerCase();
    if (!host) return undefined;

    const segments = path.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) return undefined;
    segments[segments.length - 1] = segments[segments.length - 1].replace(/\.git$/, '');
    if (segments[segments.length - 1] === '') segments.pop();
    if (segments.length === 0) return undefined;

    return port === undefined ? { host, segments } : { host, segments, port };
  } catch {
    return undefined;
  }
}

/** Picks the configured server whose gitHost matches the remote host (case-insensitive). */
export function findServer(remoteUrl: string, configured: BitbucketServer[]): BitbucketServer | undefined {
  const parsed = parseRemote(remoteUrl);
  if (!parsed) return undefined;
  return configured.find((s) => s.gitHost.toLowerCase() === parsed.host);
}

/** Guesses a server for bitbucket.org or a Bitbucket Data Center host; otherwise undefined. */
export function guessServer(remoteUrl: string): BitbucketServer | undefined {
  const parsed = parseRemote(remoteUrl);
  if (!parsed) return undefined;
  if (parsed.host === 'bitbucket.org') {
    return { gitHost: parsed.host, webUrl: 'https://bitbucket.org', type: 'cloud' };
  }
  const scmIndex = parsed.segments.indexOf('scm');
  if (scmIndex === -1 && parsed.port !== DATACENTER_SSH_PORT) return undefined;
  const context = scmIndex === -1 ? [] : parsed.segments.slice(0, scmIndex);
  const webUrl = `https://${parsed.host}${context.map((c) => `/${c}`).join('')}`;
  return { gitHost: parsed.host, webUrl, type: 'datacenter' };
}

/** Builds the "create pull request" page URL, or undefined if owner/repo cannot be found. */
export function buildPrUrl(
  server: BitbucketServer,
  remoteUrl: string,
  source: string,
  target: string,
): string | undefined {
  const parsed = parseRemote(remoteUrl);
  if (!parsed || parsed.segments.length < 2) return undefined;
  const repo = parsed.segments[parsed.segments.length - 1];
  const owner = parsed.segments[parsed.segments.length - 2];
  const base = server.webUrl.replace(/\/+$/, '');

  if (server.type === 'cloud') {
    return `${base}/${owner}/${repo}/pull-requests/new?source=${encodeURIComponent(source)}&dest=${encodeURIComponent(target)}`;
  }

  const query = `?create&sourceBranch=${encodeURIComponent('refs/heads/' + source)}&targetBranch=${encodeURIComponent('refs/heads/' + target)}`;
  const projectPath = owner.startsWith('~')
    ? `users/${owner.slice(1)}`
    : `projects/${owner.toUpperCase()}`;
  return `${base}/${projectPath}/repos/${repo}/pull-requests${query}`;
}
