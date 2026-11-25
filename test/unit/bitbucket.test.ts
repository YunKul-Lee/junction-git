import { describe, expect, it } from 'vitest';
import { buildPrUrl, findServer, guessServer, parseRemote, BitbucketServer } from '../../src/pr/bitbucket';

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

describe('guessServer', () => {
  it.each([
    ['git@bitbucket.org:acme/web.git', { gitHost: 'bitbucket.org', webUrl: 'https://bitbucket.org', type: 'cloud' }],
    ['ssh://git@git.acme.com:7999/PROJ/web.git', { gitHost: 'git.acme.com', webUrl: 'https://git.acme.com', type: 'datacenter' }],
    ['https://git.acme.com/scm/proj/web.git', { gitHost: 'git.acme.com', webUrl: 'https://git.acme.com', type: 'datacenter' }],
    ['https://git.acme.com/bitbucket/scm/proj/web.git', { gitHost: 'git.acme.com', webUrl: 'https://git.acme.com/bitbucket', type: 'datacenter' }],
  ])('guesses server for %s', (url, server) => {
    expect(guessServer(url)).toEqual(server);
  });

  it('returns undefined for unknown hosts', () => {
    expect(guessServer('git@github.com:a/b.git')).toBeUndefined();
  });
});

describe('findServer', () => {
  it('matches configured gitHost case-insensitively', () => {
    const configured: BitbucketServer[] = [{ gitHost: 'Work', webUrl: 'https://bitbucket.acme.com/', type: 'datacenter' }];
    expect(findServer('git@work:PROJ/web.git', configured)).toEqual(configured[0]);
    expect(findServer('git@WORK:PROJ/web.git', configured)).toEqual(configured[0]);
    expect(findServer('git@other:PROJ/web.git', configured)).toBeUndefined();
  });
});

describe('buildPrUrl', () => {
  const cloud: BitbucketServer = { gitHost: 'bitbucket.org', webUrl: 'https://bitbucket.org', type: 'cloud' };
  const dc: BitbucketServer = { gitHost: 'git.acme.com', webUrl: 'https://git.acme.com', type: 'datacenter' };

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
    const configured: BitbucketServer[] = [{ gitHost: 'work', webUrl: 'https://bitbucket.acme.com/', type: 'datacenter' }];
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
