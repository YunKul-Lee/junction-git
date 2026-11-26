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

describe('docs', () => {
  const readme = readFileSync(join(__dirname, '../../README.md'), 'utf8');
  const changelog = readFileSync(join(__dirname, '../../CHANGELOG.md'), 'utf8');

  it('documents the generic setting and no Bitbucket-only names', () => {
    expect(readme).toContain('junction.pullRequest.servers');
    expect(readme).not.toMatch(/junction\.bitbucket\.|"type": "(cloud|datacenter)"/);
    for (const t of ['bitbucket-cloud', 'bitbucket-datacenter', 'github', 'gitlab', 'none']) {
      expect(readme).toContain(`"${t}"`);
    }
  });

  it('does not promise per-server menu hiding', () => {
    expect(readme).not.toContain('hides the pull request menu for that server');
  });

  it('matches the package version in the changelog', () => {
    expect(pkg.version).toBe('0.3.0');
    expect(changelog).toContain(`## ${pkg.version}`);
  });
});
