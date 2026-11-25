import { readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(path.join(root, p), 'utf8');
const json = (p: string): Record<string, string> => JSON.parse(read(p)) as Record<string, string>;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const unescape = (s: string): string => s.replace(/\\(['"\\])/g, '$1');
// Comment-only lines are dropped so examples in comments are not mistaken for messages.
const stripComments = (t: string): string => t.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
const files = tsFiles(path.join(root, 'src')).map((f) => ({
  file: path.relative(root, f),
  text: stripComments(readFileSync(f, 'utf8')),
}));

/** Keys from `l10n.t('...')` calls and from inline `{ key: '...' }` message literals. */
function collectKeys(): Set<string> {
  const keys = new Set<string>();
  const literal = /(?:l10n\.t\(\s*|\bkey:\s*)(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  for (const { text } of files) {
    for (const m of text.matchAll(literal)) {
      keys.add(unescape(m[2]));
    }
  }
  return keys;
}

const placeholders = (s: string): string => [...new Set(s.match(/\{\d+\}/g) ?? [])].sort().join(',');

describe('l10n', () => {
  const ko = json('l10n/bundle.l10n.ko.json');
  const keys = collectKeys();

  it('finds the message keys', () => {
    expect(keys.size).toBeGreaterThan(60);
    expect(keys.has('Select a branch to switch to')).toBe(true);
  });

  it('has no dynamically built l10n.t keys (only the generic Msg renderer)', () => {
    for (const { file, text } of files) {
      for (const m of text.matchAll(/l10n\.t\(\s*([^'"\s])/g)) {
        const around = text.slice(m.index, m.index + 40);
        expect(`${file}: ${around}`).toMatch(/vscodeUi\.ts: l10n\.t\(m\.key/);
      }
    }
  });

  it('translates every message key into Korean', () => {
    const missing = [...keys].filter((k) => !(k in ko));
    expect(missing).toEqual([]);
  });

  it('has no stale Korean keys', () => {
    expect(Object.keys(ko).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('keeps {n} placeholders in the Korean strings', () => {
    for (const [k, v] of Object.entries(ko)) {
      expect(`${k} => ${placeholders(v)}`).toBe(`${k} => ${placeholders(k)}`);
    }
  });

  it('declares every %key% of package.json in both package.nls files', () => {
    const used = [...read('package.json').matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(25);
    const en = json('package.nls.json');
    const koNls = json('package.nls.ko.json');
    expect(used.filter((k) => !(k in en))).toEqual([]);
    expect(used.filter((k) => !(k in koNls))).toEqual([]);
    expect(Object.keys(en).filter((k) => !used.includes(k))).toEqual([]);
    expect(Object.keys(koNls).sort()).toEqual(Object.keys(en).sort());
  });

  it('leaves no raw English UI strings in package.json contributes', () => {
    const pkg = JSON.parse(read('package.json')) as {
      contributes: { commands: { title: string }[]; views: Record<string, { name: string }[]>; viewsContainers: Record<string, { title: string }[]> };
    };
    const titles = [
      ...pkg.contributes.commands.map((c) => c.title),
      ...Object.values(pkg.contributes.views).flat().map((v) => v.name),
      ...Object.values(pkg.contributes.viewsContainers).flat().map((v) => v.title),
    ];
    expect(titles.filter((t) => !/^%.+%$/.test(t))).toEqual([]);
  });

  it('registers the quick checkout command', () => {
    expect(read('package.json')).toContain('"junction.checkoutBranch"');
    expect(read('src/commands/register.ts')).toContain("'junction.checkoutBranch'");
  });
});
