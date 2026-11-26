import { runGit, tryRunGit } from "./exec";
import { listWorktrees } from "./worktrees";
import { readState } from "./stateStore";
import type { LayerNode, StackForest } from "./types";

interface BranchRef {
  name: string;
  sha: string;
}

export async function fetchDefaultBranch(cwd: string): Promise<string> {
  const symbolic = await tryRunGit(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
  if (symbolic) return symbolic.replace("refs/remotes/origin/", "");

  for (const candidate of ["main", "master"]) {
    if (await tryRunGit(["rev-parse", "--verify", `refs/heads/${candidate}`], cwd)) return candidate;
  }
  throw new Error("Couldn't determine the trunk branch (no origin/HEAD, no main, no master).");
}

async function listLocalBranches(cwd: string): Promise<BranchRef[]> {
  const out = await runGit(["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/"], cwd);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, sha] = line.split(" ");
      return { name, sha };
    });
}

async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  return (await tryRunGit(["merge-base", "--is-ancestor", ancestor, descendant], cwd)) !== null;
}

async function commitsBetween(cwd: string, from: string, to: string): Promise<number> {
  const out = await runGit(["rev-list", "--count", `${from}..${to}`], cwd);
  return Number(out);
}

/**
 * Picks the closest ancestor branch as the parent — the same idea Sapling
 * uses the commit graph for, rather than a separately declared "base".
 * Among candidates that are real ancestors, the one with the fewest commits
 * between it and the branch is the most specific parent.
 */
async function inferParent(cwd: string, branch: string, candidates: string[]): Promise<string | null> {
  let best: { name: string; distance: number } | null = null;
  for (const candidate of candidates) {
    if (candidate === branch) continue;
    if (!(await isAncestor(cwd, candidate, branch))) continue;
    const distance = await commitsBetween(cwd, candidate, branch);
    if (distance === 0) continue; // identical tip — not a real ancestor relationship
    if (!best || distance < best.distance) best = { name: candidate, distance };
  }
  return best?.name ?? null;
}

export async function buildStackForest(cwd: string): Promise<StackForest> {
  const trunk = await fetchDefaultBranch(cwd);
  const branches = (await listLocalBranches(cwd)).filter((b) => b.name !== trunk);
  const candidateNames = [trunk, ...branches.map((b) => b.name)];
  const branchNameSet = new Set(candidateNames);
  const state = await readState(cwd).catch(() => null);

  const parentOf = new Map<string, string>();
  for (const branch of branches) {
    // A parent declared at creation time (createLayer/planFeature) is authoritative — ancestry
    // inference alone can't order two sibling-looking branches before either has real commits.
    // Only trust it if it still resolves to a real branch that's still a real ancestor, so a
    // branch that was later rebased elsewhere by hand still falls back to honest inference.
    const declared = state?.layerNotes[branch.name]?.parentBranch;
    if (declared && branchNameSet.has(declared) && (await isAncestor(cwd, declared, branch.name))) {
      parentOf.set(branch.name, declared);
      continue;
    }
    const others = candidateNames.filter((c) => c !== branch.name);
    parentOf.set(branch.name, (await inferParent(cwd, branch.name, others)) ?? trunk);
  }

  const worktrees = await listWorktrees(cwd);
  const worktreeByBranch = new Map(worktrees.filter((w) => w.branch).map((w) => [w.branch as string, w.path]));
  const main = worktrees.find((w) => w.isMain);
  if (!main) throw new Error("Could not find the main worktree for this repository.");

  const nodeByBranch = new Map<string, LayerNode>();
  for (const branch of branches) {
    nodeByBranch.set(branch.name, {
      branch: branch.name,
      parentBranch: parentOf.get(branch.name) ?? trunk,
      headCommit: branch.sha,
      commitCount: 0,
      worktreePath: worktreeByBranch.get(branch.name) ?? null,
      pr: null,
      claim: null,
      title: null,
      feature: null,
      children: [],
    });
  }

  for (const node of nodeByBranch.values()) {
    node.commitCount = await commitsBetween(cwd, node.parentBranch, node.branch);
  }

  const roots: LayerNode[] = [];
  for (const node of nodeByBranch.values()) {
    const parent = nodeByBranch.get(node.parentBranch);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return { trunk, mainWorktreePath: main.path, roots };
}

export function findLayer(roots: LayerNode[], branch: string): LayerNode | null {
  for (const node of roots) {
    if (node.branch === branch) return node;
    const found = findLayer(node.children, branch);
    if (found) return found;
  }
  return null;
}

export function flattenLayers(roots: LayerNode[]): LayerNode[] {
  return roots.flatMap((node) => [node, ...flattenLayers(node.children)]);
}

/** Every root-to-leaf path through the forest, trunk-most node first — the order GitHub's stack
 *  API wants (bottom to top), and the same shape the webview renders (tip-first there, reversed). */
export function toChains(roots: LayerNode[]): LayerNode[][] {
  const chains: LayerNode[][] = [];
  function walk(node: LayerNode, soFar: LayerNode[]) {
    const chain = [...soFar, node];
    if (node.children.length === 0) {
      chains.push(chain);
      return;
    }
    for (const child of node.children) walk(child, chain);
  }
  for (const root of roots) walk(root, []);
  return chains;
}
