import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
const text = readFileSync(join(__dirname, '../../package.json'), 'utf8');

describe('package.json pull request contributions', () => {
  it('declares junction.pullRequest.servers with every server type and an optional webUrl', () => {
    const prop = pkg.contributes.configuration.properties['junction.pullRequest.servers'];
    expect(prop.default).toEqual([]);
    expect(prop.items.required).toEqual(['gitHost', 'type']);
    expect(prop.items.properties.type.enum).toEqual(['bitbucket-cloud', 'bitbucket-datacenter', 'github', 'gitlab', 'none']);
  });

  it('uses the generic command and context key names', () => {
    const ids = pkg.contributes.commands.map((c: { command: string }) => c.command);
    expect(ids).toContain('junction.pullRequest.changeWebUrl');
    expect(text).toContain('junction.hasPullRequest');
  });

  it('keeps no Bitbucket-only setting, command or context key', () => {
    expect(text).not.toMatch(/junction\.bitbucket\.|junction\.hasBitbucket/);
  });
});
