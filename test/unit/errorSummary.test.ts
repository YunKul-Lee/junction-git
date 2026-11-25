import { describe, expect, it } from 'vitest';
import { errorSummary } from '../../src/flows/ui';

describe('errorSummary', () => {
  it('picks the rejection line for a push', () => {
    const stderr =
      'To /tmp/remote.git\n ! [rejected]        feature/p -> feature/p (fetch first)\nerror: failed to push some refs to \'/tmp/remote.git\'\n';
    expect(errorSummary(stderr)).toBe('! [rejected]        feature/p -> feature/p (fetch first)');
  });
  it('picks fatal lines', () => {
    expect(errorSummary('hint: x\nfatal: not a git repository\n')).toBe('fatal: not a git repository');
  });
  it('falls back to the first line', () => {
    expect(errorSummary('\nsomething odd\nmore\n')).toBe('something odd');
    expect(errorSummary('')).toBe('');
  });
});
