import { describe, expect, it } from 'vitest';
import { buildPrUrl, findServer, guessDataCenter, guessPublic, parseRemote, prAvailable, serversFromScopes, serverTypeOrder, PrServer } from '../../src/pr/providers';

const enc = encodeURIComponent;
const DC_QUERY = (src: string, dst: string) =>
  `?create&sourceBranch=${enc('refs/heads/' + src)}&targetBranch=${enc('refs/heads/' + dst)}`;

describe('parseRemote', () => {
  it.each([
    ['git@bitbucket.org:acme/web.git', 'bitbucket.org', ['acme', 'web']],
    ['https://jdoe@bitbucket.org/acme/web.git', 'bitbucket.org', ['acme', 'web']],
    ['ssh://git@git.acme.com:7999/PROJ/web.git', 'git.acme.com', ['PROJ', 'web']],
    ['https://git.acme.com/scm/proj/web.git/', 'git.acme.com', ['scm', 'proj', 'web']],
    ['git@GIT.Acme.COM:PROJ/web', 'git.acme.com', ['PROJ', 'web']],
  ])('parses %s', (url, host, segments) => {
    expect(parseRemote(url)).toMatchObject({ host, segments });
  });

  it('returns undefined for unparseable input', () => {
    expect(parseRemote('not a url')).toBeUndefined();
    expect(parseRemote('')).toBeUndefined();
    expect(parseRemote('https://')).toBeUndefined();
  });
});

describe('guessPublic', () => {
  it.each([
    ['git@bitbucket.org:acme/web.git', { gitHost: 'bitbucket.org', webUrl: 'https://bitbucket.org', type: 'bitbucket-cloud' }],
    ['git@github.com:acme/web.git', { gitHost: 'github.com', webUrl: 'https://github.com', type: 'github' }],
    ['https://gitlab.com/acme/web.git', { gitHost: 'gitlab.com', webUrl: 'https://gitlab.com', type: 'gitlab' }],
  ])('guesses %s', (url, server) => {
    expect(guessPublic(url)).toEqual(server);
  });

  it('returns undefined for other hosts', () => {
    expect(guessPublic('git@git.acme.com:PROJ/web.git')).toBeUndefined();
    expect(guessPublic('ssh://git@git.acme.com:7999/PROJ/web.git')).toBeUndefined();
  });
});

describe('guessDataCenter', () => {
  it.each([
    ['ssh://git@git.acme.com:7999/PROJ/web.git', { gitHost: 'git.acme.com', webUrl: 'https://git.acme.com', type: 'bitbucket-datacenter' }],
    ['https://git.acme.com/scm/proj/web.git', { gitHost: 'git.acme.com', webUrl: 'https://git.acme.com', type: 'bitbucket-datacenter' }],
    ['https://git.acme.com/bitbucket/scm/proj/web.git', { gitHost: 'git.acme.com', webUrl: 'https://git.acme.com/bitbucket', type: 'bitbucket-datacenter' }],
  ])('guesses Data Center for %s', (url, server) => {
    expect(guessDataCenter(url)).toEqual(server);
  });

  it('returns undefined without a Data Center hint', () => {
    expect(guessDataCenter('git@github.com:a/b.git')).toBeUndefined();
    expect(guessDataCenter('git@git.acme.com:PROJ/web.git')).toBeUndefined();
  });
});

describe('findServer', () => {
  it('matches configured gitHost case-insensitively', () => {
    const configured: PrServer[] = [{ gitHost: 'Work', webUrl: 'https://bitbucket.acme.com/', type: 'bitbucket-datacenter' }];
    expect(findServer('git@work:PROJ/web.git', configured)).toEqual(configured[0]);
    expect(findServer('git@WORK:PROJ/web.git', configured)).toEqual(configured[0]);
    expect(findServer('git@other:PROJ/web.git', configured)).toBeUndefined();
  });
});

describe('buildPrUrl', () => {
  const cloud: PrServer = { gitHost: 'bitbucket.org', webUrl: 'https://bitbucket.org', type: 'bitbucket-cloud' };
  const dc: PrServer = { gitHost: 'git.acme.com', webUrl: 'https://git.acme.com', type: 'bitbucket-datacenter' };

  it.each([
    [
      'cloud scp remote',
      cloud, 'git@bitbucket.org:acme/web.git', 'feature/x', 'develop',
      'https://bitbucket.org/acme/web/pull-requests/new?source=feature%2Fx&dest=develop',
    ],
    [
      'cloud https remote with user',
      cloud, 'https://jdoe@bitbucket.org/acme/web.git', 'feature/x', 'develop',
      'https://bitbucket.org/acme/web/pull-requests/new?source=feature%2Fx&dest=develop',
    ],
    [
      'datacenter ssh remote',
      dc, 'ssh://git@git.acme.com:7999/PROJ/web.git', 'feature/x', 'develop',
      `https://git.acme.com/projects/PROJ/repos/web/pull-requests${DC_QUERY('feature/x', 'develop')}`,
    ],
    [
      'datacenter scm https remote uses project key in upper case',
      dc, 'https://git.acme.com/scm/proj/web.git', 'feature/x', 'develop',
      `https://git.acme.com/projects/PROJ/repos/web/pull-requests${DC_QUERY('feature/x', 'develop')}`,
    ],
    [
      'datacenter with context path',
      { ...dc, webUrl: 'https://git.acme.com/bitbucket' }, 'https://git.acme.com/bitbucket/scm/proj/web.git', 'feature/x', 'develop',
      `https://git.acme.com/bitbucket/projects/PROJ/repos/web/pull-requests${DC_QUERY('feature/x', 'develop')}`,
    ],
    [
      'datacenter personal repo',
      dc, 'ssh://git@git.acme.com:7999/~jdoe/web.git', 'feature/x', 'develop',
      `https://git.acme.com/users/jdoe/repos/web/pull-requests${DC_QUERY('feature/x', 'develop')}`,
    ],
    [
      'non-ascii and special characters in branch',
      cloud, 'git@bitbucket.org:acme/web.git', 'feature/한글-#12+fix', 'develop',
      `https://bitbucket.org/acme/web/pull-requests/new?source=${enc('feature/한글-#12+fix')}&dest=develop`,
    ],
  ])('%s', (_name, server, remote, src, dst, expected) => {
    expect(buildPrUrl(server, remote, src, dst)).toBe(expected);
  });

  it('uses an SSH alias resolved through configured servers', () => {
    const configured: PrServer[] = [{ gitHost: 'work', webUrl: 'https://bitbucket.acme.com/', type: 'bitbucket-datacenter' }];
    const server = findServer('git@work:PROJ/web.git', configured)!;
    expect(buildPrUrl(server, 'git@work:PROJ/web.git', 'feature/x', 'develop')).toBe(
      `https://bitbucket.acme.com/projects/PROJ/repos/web/pull-requests${DC_QUERY('feature/x', 'develop')}`,
    );
  });

  it('returns undefined when owner/repo cannot be found or URL is bad', () => {
    expect(buildPrUrl(cloud, 'garbage', 'a', 'b')).toBeUndefined();
    expect(buildPrUrl(cloud, 'https://bitbucket.org/web.git', 'a', 'b')).toBeUndefined();
    expect(buildPrUrl(cloud, 'https://bitbucket.org/', 'a', 'b')).toBeUndefined();
  });
});

describe('prAvailable', () => {
  it.each([
    'git@bitbucket.org:acme/web.git',
    'git@github.com:acme/web.git',
    'https://gitlab.com/acme/web.git',
    'git@git.acme.com:PROJ/repo.git',
    'ssh://git@git.acme.com/PROJ/repo.git',
    'work-alias:PROJ/repo.git',
  ])('is true for a remote host: %s', (url) => {
    expect(prAvailable(url, [])).toBe(true);
  });

  it.each(['/tmp/remote.git', 'file:///tmp/remote.git', 'C:\\repos\\remote.git', 'not a url'])(
    'is false for a local path or garbage: %s',
    (url) => {
      expect(prAvailable(url, [])).toBe(false);
    },
  );

  it('is false for a server configured as none', () => {
    expect(prAvailable('git@git.acme.com:PROJ/repo.git', [{ gitHost: 'git.acme.com', type: 'none' }])).toBe(false);
  });

  it('is true for a configured server of another type', () => {
    expect(prAvailable('git@git.acme.com:PROJ/repo.git', [{ gitHost: 'git.acme.com', webUrl: 'https://git.acme.com', type: 'gitlab' }])).toBe(true);
  });
});

describe('buildPrUrl for GitHub and GitLab', () => {
  const github: PrServer = { gitHost: 'github.com', webUrl: 'https://github.com', type: 'github' };
  const gitlab: PrServer = { gitHost: 'gitlab.com', webUrl: 'https://gitlab.com', type: 'gitlab' };
  const mr = (src: string, dst: string) =>
    `/-/merge_requests/new?merge_request%5Bsource_branch%5D=${enc(src)}&merge_request%5Btarget_branch%5D=${enc(dst)}`;

  it('builds a GitHub compare URL keeping slashes and encoding the rest', () => {
    expect(buildPrUrl(github, 'git@github.com:acme/web.git', 'feature/한글#1', 'develop')).toBe(
      'https://github.com/acme/web/compare/develop...feature/%ED%95%9C%EA%B8%80%231?expand=1',
    );
  });

  it('builds a GitHub Enterprise compare URL', () => {
    const ghe: PrServer = { gitHost: 'github.acme.com', webUrl: 'https://github.acme.com', type: 'github' };
    expect(buildPrUrl(ghe, 'https://github.acme.com/acme/web.git', 'feature/x', 'develop')).toBe(
      'https://github.acme.com/acme/web/compare/develop...feature/x?expand=1',
    );
  });

  it('builds a GitLab MR URL with nested groups', () => {
    expect(buildPrUrl(gitlab, 'git@gitlab.com:acme/team/sub/web.git', 'feature/x', 'develop')).toBe(
      `https://gitlab.com/acme/team/sub/web${mr('feature/x', 'develop')}`,
    );
  });

  it('strips the GitLab web context path from an https remote and keeps ssh paths', () => {
    const self: PrServer = { gitHost: 'gitlab.acme.com', webUrl: 'https://gitlab.acme.com/gitlab', type: 'gitlab' };
    const expected = `https://gitlab.acme.com/gitlab/acme/web${mr('feature/x', 'develop')}`;
    expect(buildPrUrl(self, 'https://gitlab.acme.com/gitlab/acme/web.git', 'feature/x', 'develop')).toBe(expected);
    expect(buildPrUrl(self, 'git@gitlab.acme.com:acme/web.git', 'feature/x', 'develop')).toBe(expected);
  });

  it('defaults a missing webUrl to https://<gitHost>', () => {
    expect(buildPrUrl({ gitHost: 'github.acme.com', type: 'github' }, 'git@github.acme.com:a/b.git', 'x', 'y')).toBe(
      'https://github.acme.com/a/b/compare/y...x?expand=1',
    );
  });

  it('returns undefined for none or a single-segment path', () => {
    expect(buildPrUrl({ gitHost: 'h', type: 'none' }, 'git@h:a/b.git', 'x', 'y')).toBeUndefined();
    expect(buildPrUrl(github, 'https://github.com/web.git', 'x', 'y')).toBeUndefined();
    expect(buildPrUrl(gitlab, 'https://gitlab.com/web.git', 'x', 'y')).toBeUndefined();
  });
});

describe('serversFromScopes', () => {
  const s = (gitHost: string): PrServer => ({ gitHost, webUrl: `https://${gitHost}`, type: 'bitbucket-datacenter' });

  it('concatenates folder, workspace and global values in that order', () => {
    expect(
      serversFromScopes({ workspaceFolderValue: [s('a')], workspaceValue: [s('b')], globalValue: [s('c'), s('a')] }),
    ).toEqual([s('a'), s('b'), s('c'), s('a')]);
  });

  it('handles missing scopes', () => {
    expect(serversFromScopes(undefined)).toEqual([]);
    expect(serversFromScopes({ globalValue: [s('c')] })).toEqual([s('c')]);
  });

  it('lets a workspace none entry win over a global entry for the same host', () => {
    const list = serversFromScopes({
      workspaceValue: [{ gitHost: 'h', type: 'none' }],
      globalValue: [{ gitHost: 'h', webUrl: 'https://h', type: 'github' }],
    });
    expect(findServer('git@h:P/r.git', list)?.type).toBe('none');
  });

  it('lets the workspace entry win in findServer', () => {
    const list = serversFromScopes({ workspaceValue: [{ ...s('h'), webUrl: 'https://ws' }], globalValue: [s('h')] });
    expect(findServer('git@h:P/r.git', list)?.webUrl).toBe('https://ws');
  });
});

describe('serverTypeOrder', () => {
  it('puts Bitbucket Data Center first when the Data Center guess matches', () => {
    expect(serverTypeOrder('ssh://git@git.acme.com:7999/PROJ/web.git')[0]).toBe('bitbucket-datacenter');
  });

  it.each([
    ['git@github.acme.com:a/b.git', 'github'],
    ['https://gitlab.acme.com/a/b.git', 'gitlab'],
    ['git@bitbucket.acme.com:a/b.git', 'bitbucket-datacenter'],
  ])('puts the type hinted by the host first: %s', (url, first) => {
    expect(serverTypeOrder(url)[0]).toBe(first);
  });

  it('lists every type once with none last', () => {
    const order = serverTypeOrder('git@git.acme.com:a/b.git');
    expect([...order].sort()).toEqual(['bitbucket-cloud', 'bitbucket-datacenter', 'github', 'gitlab', 'none']);
    expect(order[order.length - 1]).toBe('none');
  });
});
