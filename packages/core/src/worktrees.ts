import * as path from "node:path";
import { runGit } from "./exec";

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
  isBare: boolean;
}

/**
 * `git worktree list` always lists the main worktree first, and every
 * worktree of a repo shares the same common `.git` dir — that's what makes
 * it possible to coordinate across worktrees without a server.
 */
export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const out = await runGit(["worktree", "list", "--porcelain"], cwd);
  const blocks = out.split(/\n\n+/).filter(Boolean);
  const worktrees: WorktreeInfo[] = [];

  blocks.forEach((block, index) => {
    let worktreePath = "";
    let branch: string | null = null;
    let isBare = false;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) worktreePath = line.slice("worktree ".length);
      else if (line.startsWith("branch refs/heads/")) branch = line.slice("branch refs/heads/".length);
      else if (line === "bare") isBare = true;
    }
    worktrees.push({ path: worktreePath, branch, isMain: index === 0, isBare });
  });

  return worktrees;
}

/** Absolute path to the `.git` dir shared by every worktree of this repo. */
export async function gitCommonDir(cwd: string): Promise<string> {
  const raw = await runGit(["rev-parse", "--git-common-dir"], cwd);
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}

export function worktreePathFor(mainWorktreePath: string, branch: string): string {
  const slug = branch.replace(/[\\/]/g, "-");
  return path.join(path.dirname(mainWorktreePath), `${path.basename(mainWorktreePath)}.worktrees`, slug);
}

/** Returns the path a branch is checked out at, creating a worktree for it if needed. */
export async function ensureWorktree(cwd: string, branch: string): Promise<string> {
  const worktrees = await listWorktrees(cwd);
  const existing = worktrees.find((w) => w.branch === branch);
  if (existing) return existing.path;

  const main = worktrees.find((w) => w.isMain);
  if (!main) throw new Error("Could not find the main worktree.");

  const target = worktreePathFor(main.path, branch);
  // `--` stops a caller-supplied branch name like "--detach" from being read as a flag.
  await runGit(["worktree", "add", target, "--", branch], cwd);
  return target;
}
