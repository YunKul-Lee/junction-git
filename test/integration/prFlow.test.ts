import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPrFlow, PrEnv } from '../../src/flows/prFlow';
import { BranchRef } from '../../src/git/types';
import { PrServer } from '../../src/pr/providers';
import { loadSnapshot, RepoSnapshot } from '../../src/model/repoModel';
import { FakeUi } from '../helpers/fakeUi';
import { makeRepo, TestRepo } from '../helpers/repo';

const DC_URL = 'ssh://git@git.acme.com:7999/PROJ/web.git';

describe('createPrFlow', () => {
  let repo: TestRepo;
  beforeEach(async () => {
    repo = await makeRepo();
    // Fetch URL is fake; pushes still go to the local bare repo.
    await repo.sh('config', 'remote.origin.pushurl', repo.remoteDir);
    await repo.sh('config', 'remote.origin.url', DC_URL);
    await repo.sh('checkout', '-b', 'feature/x');
    await repo.commit('work');
    await repo.sh('push', '-u', 'origin', 'feature/x');
  });
  afterEach(() => repo.cleanup());

  class Env implements PrEnv {
    opened: string[] = [];
    saved: PrServer[] = [];
    bumps: string[] = [];
    settingsOpened = 0;
    constructor(
      public configured: PrServer[] = [],
      public nag = 0,
    ) {}
    servers = (): PrServer[] => this.configured;
    saveServer = (s: PrServer): Promise<void> => {
      this.saved.push(s);
      return Promise.resolve();
    };
    open = (u: string): Promise<void> => {
      this.opened.push(u);
      return Promise.resolve();
    };
    openSettings = (): void => {
      this.settingsOpened++;
    };
    nagCount = (): number => this.nag;
    bumpNag = (h: string): void => {
      this.bumps.push(h);
    };
  }

  const known: PrServer[] = [{ gitHost: 'git.acme.com', webUrl: 'https://git.acme.com', type: 'bitbucket-datacenter' }];
  const snapOf = (): Promise<RepoSnapshot> => loadSnapshot(repo.git, { baseBranch: '' });
  const run = async (ui: FakeUi, env: Env, target?: string) => {
    const snap = await snapOf();
    const b = snap.branches.find((x) => x.kind === 'local' && x.name === 'feature/x') as BranchRef;
    return createPrFlow({ git: repo.git, ui, snap, env }, b, target);
  };
  const DC_PR =
    'https://git.acme.com/projects/PROJ/repos/web/pull-requests?create&sourceBranch=refs%2Fheads%2Ffeature%2Fx&targetBranch=refs%2Fheads%2Fdevelop';

  it('opens immediately without prompts when a server is configured', async () => {
    const ui = new FakeUi();
    const env = new Env(known, 3);
    expect(await run(ui, env)).toBe('done');
    expect(ui.of('input')).toHaveLength(0);
    expect(ui.of('confirm')).toHaveLength(0);
    expect(env.opened).toEqual([DC_PR]);
    expect(env.saved).toHaveLength(0);
  });

  it('uses the upstream branch name as the PR source when it differs from the local name', async () => {
    await repo.sh('push', '-u', 'origin', 'feature/x:feature/y');
    const ui = new FakeUi();
    const env = new Env(known, 3);
    expect(await run(ui, env)).toBe('done');
    expect(env.opened).toEqual([DC_PR.replace('feature%2Fx', 'feature%2Fy')]);
  });

  it('confirms a guessed address and saves it when none is configured', async () => {
    const ui = new FakeUi(['https://git.acme.com']);
    const env = new Env([], 3);
    expect(await run(ui, env)).toBe('done');
    expect(ui.of('input')[0].opts?.value).toBe('https://git.acme.com');
    expect(env.saved).toEqual([{ gitHost: 'git.acme.com', webUrl: 'https://git.acme.com', type: 'bitbucket-datacenter' }]);
    expect(env.opened).toEqual([DC_PR]);
  });

  it('cancelling the address input does nothing', async () => {
    const ui = new FakeUi([undefined]);
    const env = new Env([]);
    expect(await run(ui, env)).toBe('cancelled');
    expect(env.opened).toHaveLength(0);
    expect(env.saved).toHaveLength(0);
  });

  it('rejects an invalid address instead of saving it', async () => {
    const ui = new FakeUi(['https://']);
    const env = new Env([]);
    expect(await run(ui, env)).toBe('cancelled');
    expect(ui.validationErrors).toEqual([{ key: 'Enter an http(s) URL.' }]);
    expect(env.saved).toHaveLength(0);
    expect(env.opened).toHaveLength(0);
  });

  it('strips trailing slashes from the confirmed address', async () => {
    const env = new Env([], 3);
    await run(new FakeUi(['https://git.acme.com/']), env);
    expect(env.saved[0].webUrl).toBe('https://git.acme.com');
  });

  it('asks for the server type when the address cannot be guessed', async () => {
    await repo.sh('config', 'remote.origin.url', 'https://code.example.org/team/web.git');
    const ui = new FakeUi(['https://code.example.org', 'bitbucket-cloud']);
    const env = new Env([], 3);
    expect(await run(ui, env)).toBe('done');
    expect(ui.of('input')[0].opts?.value).toBe('https://');
    expect(env.saved).toEqual([{ gitHost: 'code.example.org', webUrl: 'https://code.example.org', type: 'bitbucket-cloud' }]);
  });

  describe('with unpushed commits', () => {
    beforeEach(() => repo.commit('local only'));

    it('cancelling the push prompt opens nothing', async () => {
      const ui = new FakeUi([undefined]);
      const env = new Env(known);
      expect(await run(ui, env)).toBe('cancelled');
      expect(ui.of('confirm')[0].msg).toEqual({ key: 'Push {0} before creating the pull request?', args: ['feature/x'] });
      expect(env.opened).toHaveLength(0);
    });

    it('pushes after confirmation, then opens', async () => {
      const ui = new FakeUi([0]);
      const env = new Env(known, 3);
      expect(await run(ui, env)).toBe('done');
      const local = (await repo.sh('rev-parse', 'feature/x')).trim();
      expect((await repo.sh('ls-remote', repo.remoteDir, 'refs/heads/feature/x')).startsWith(local)).toBe(true);
      expect(env.opened).toEqual([DC_PR]);
    });
  });

  it('uses the given target branch', async () => {
    const env = new Env(known, 3);
    await run(new FakeUi(), env, 'release/1.0');
    expect(env.opened[0]).toContain('targetBranch=refs%2Fheads%2Frelease%2F1.0');
  });

  it('shows the wrong-address hint until the nag limit', async () => {
    const env = new Env(known, 0);
    const ui = new FakeUi();
    await run(ui, env);
    expect(ui.of('info')[0].msg).toEqual({ key: 'Wrong address?' });
    expect(ui.of('info')[0].actions).toEqual([{ key: 'Open Settings' }]);
    expect(env.bumps).toEqual(['git.acme.com']);
    ui.infoPick?.(0);
    expect(env.settingsOpened).toBe(1);

    const env3 = new Env(known, 3);
    const ui3 = new FakeUi();
    await run(ui3, env3);
    expect(ui3.of('info')).toHaveLength(0);
    expect(env3.bumps).toHaveLength(0);
  });

  it('errors when the remote has no owner/repo path', async () => {
    await repo.sh('config', 'remote.origin.url', 'https://git.acme.com/web.git');
    const ui = new FakeUi();
    const env = new Env(known, 3);
    expect(await run(ui, env)).toBe('failed');
    expect(ui.of('error')[0].msg).toEqual({ key: 'Could not build a pull request URL for this remote.' });
  });
});
