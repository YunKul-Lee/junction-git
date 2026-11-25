import { describe, expect, it } from 'vitest';
import {
  parseLog,
  parseNameStatus,
  parseRecentCheckouts,
  parseRefs,
  parseTrack,
} from '../../src/git/parse';

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const H3 = 'c'.repeat(40);
const line = (...f: string[]): string => f.join('\0');

describe('parseTrack', () => {
  it.each([
    ['[ahead 2, behind 1]', { ahead: 2, behind: 1, gone: false }],
    ['[ahead 2]', { ahead: 2, behind: 0, gone: false }],
    ['[behind 1]', { ahead: 0, behind: 1, gone: false }],
    ['[gone]', { ahead: 0, behind: 0, gone: true }],
    ['', { ahead: 0, behind: 0, gone: false }],
  ])('%j', (input, expected) => {
    expect(parseTrack(input)).toEqual(expected);
  });
});

describe('parseRefs', () => {
  it('parses local and remote refs, skipping symbolic HEAD', () => {
    const out = [
      line('refs/heads/develop', H1, '*', 'origin/develop', '[ahead 1]', '1700000000', 'init'),
      line('refs/heads/feature/x', H2, ' ', '', '', '1700000100', 'work'),
      line('refs/heads/feature/gone', H2, ' ', 'origin/feature/gone', '[gone]', '1700000100', 'g'),
      line('refs/remotes/origin/HEAD', H1, ' ', '', '', '1700000000', 'init'),
      line('refs/remotes/origin/develop', H1, ' ', '', '', '1700000000', 'init'),
      line('refs/remotes/team/a/feature/y', H3, ' ', '', '', '1700000200', 'y'),
      line('refs/remotes/team/a/HEAD', H3, ' ', '', '', '1700000200', 'y'),
    ].join('\n') + '\n';
    const refs = parseRefs(out, ['origin', 'team', 'team/a']);
    expect(refs).toEqual([
      {
        kind: 'local', name: 'develop', shortName: 'develop', hash: H1, subject: 'init',
        committerTime: 1700000000, isHead: true, upstream: 'origin/develop',
        upstreamGone: false, ahead: 1, behind: 0,
      },
      {
        kind: 'local', name: 'feature/x', shortName: 'feature/x', hash: H2, subject: 'work',
        committerTime: 1700000100, isHead: false, upstream: undefined,
        upstreamGone: false, ahead: 0, behind: 0,
      },
      {
        kind: 'local', name: 'feature/gone', shortName: 'feature/gone', hash: H2, subject: 'g',
        committerTime: 1700000100, isHead: false, upstream: 'origin/feature/gone',
        upstreamGone: true, ahead: 0, behind: 0,
      },
      {
        kind: 'remote', name: 'origin/develop', shortName: 'develop', remote: 'origin', hash: H1,
        subject: 'init', committerTime: 1700000000, isHead: false, upstream: undefined,
        upstreamGone: false, ahead: 0, behind: 0,
      },
      {
        kind: 'remote', name: 'team/a/feature/y', shortName: 'feature/y', remote: 'team/a', hash: H3,
        subject: 'y', committerTime: 1700000200, isHead: false, upstream: undefined,
        upstreamGone: false, ahead: 0, behind: 0,
      },
    ]);
  });

  it('returns [] for empty output', () => {
    expect(parseRefs('', ['origin'])).toEqual([]);
  });
});

describe('parseNameStatus', () => {
  it('parses A/M/D/R/C and strips scores', () => {
    const out = ['A\tnew.ts', 'M\tsrc/한글 파일.ts', 'D\told.ts', 'R100\ta.ts\tb.ts', 'C75\tc.ts\td.ts'].join('\n') + '\n';
    expect(parseNameStatus(out)).toEqual([
      { status: 'A', path: 'new.ts' },
      { status: 'M', path: 'src/한글 파일.ts' },
      { status: 'D', path: 'old.ts' },
      { status: 'R', oldPath: 'a.ts', path: 'b.ts' },
      { status: 'C', oldPath: 'c.ts', path: 'd.ts' },
    ]);
  });
});

describe('parseRecentCheckouts', () => {
  it('extracts destinations, dedups, ignores other entries', () => {
    expect(
      parseRecentCheckouts(
        [
          'checkout: moving from develop to feature/a',
          'commit: x',
          'checkout: moving from feature/a to develop',
          'checkout: moving from develop to feature/a',
        ].join('\n'),
      ),
    ).toEqual(['feature/a', 'develop']);
  });
  it('skips detached (40-hex) targets', () => {
    expect(parseRecentCheckouts(`checkout: moving from develop to ${H1}\ncheckout: moving from ${H1} to main`)).toEqual(['main']);
  });
});

describe('parseLog', () => {
  it('parses records with parents', () => {
    const rec = (...f: string[]): string => f.join('\0') + '\x1e';
    const out = rec(H2, 'bbbbbbb', H1, 'Ann', '1700000100', 'second') + '\n' + rec(H1, 'aaaaaaa', '', 'Bob', '1700000000', 'first') + '\n';
    expect(parseLog(out)).toEqual([
      { hash: H2, shortHash: 'bbbbbbb', parents: [H1], author: 'Ann', time: 1700000100, subject: 'second' },
      { hash: H1, shortHash: 'aaaaaaa', parents: [], author: 'Bob', time: 1700000000, subject: 'first' },
    ]);
  });
  it('splits multiple parents', () => {
    expect(parseLog(`${H3}\0ccccccc\0${H1} ${H2}\0A\0five\0merge\x1e`)[0].parents).toEqual([H1, H2]);
  });
});
