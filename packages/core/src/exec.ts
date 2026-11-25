import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

export async function tryRunGit(args: string[], cwd: string): Promise<string | null> {
  try {
    return await runGit(args, cwd);
  } catch {
    return null;
  }
}

export async function runGh(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}
