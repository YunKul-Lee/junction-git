import { execFile } from 'child_process';
import { Git, GitError } from './types';

const MAX_BUFFER = 64 * 1024 * 1024;

export function createGit(
  gitPath: string,
  root: string,
  log?: (line: string) => void,
  env?: Record<string, string>,
): Git {
  let cachedVersion: Promise<{ major: number; minor: number }> | undefined;

  const run: Git['run'] = (args, opts) =>
    new Promise<string>((resolve, reject) => {
      const fullArgs = ['-c', 'core.quotepath=false', ...args];
      log?.(`git ${args.join(' ')}`);
      const child = execFile(
        gitPath,
        fullArgs,
        {
          cwd: root,
          maxBuffer: MAX_BUFFER,
          encoding: 'utf8',
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...env },
          signal: opts?.signal,
        },
        (error, stdout, stderr) => {
          if (error) {
            const code = (error as NodeJS.ErrnoException & { code?: unknown }).code;
            const exitCode = typeof code === 'number' ? code : null;
            reject(new GitError(args, exitCode, stderr || error.message));
            return;
          }
          resolve(stdout);
        },
      );
      if (opts?.input !== undefined) {
        child.stdin?.on('error', () => undefined);
        child.stdin?.end(opts.input);
      }
    });

  return {
    root,
    run,
    version() {
      cachedVersion ??= run(['--version']).then((out) => {
        const m = /(\d+)\.(\d+)/.exec(out);
        if (!m) {
          throw new Error(`Unable to parse git version: ${out.trim()}`);
        }
        return { major: Number(m[1]), minor: Number(m[2]) };
      });
      return cachedVersion;
    },
  };
}
