import { describe, expect, it } from 'vitest';
import { sideFor } from '../../src/flows/conflictFlows';

describe('sideFor', () => {
  it('maps rebase sides in reverse', () => {
    expect(sideFor('mine', 'merge')).toBe('ours');
    expect(sideFor('theirs', 'merge')).toBe('theirs');
    expect(sideFor('mine', 'none')).toBe('ours');
    expect(sideFor('theirs', 'none')).toBe('theirs');
    expect(sideFor('mine', 'rebase')).toBe('theirs');
    expect(sideFor('theirs', 'rebase')).toBe('ours');
  });
});
