import { runGh, runGit } from "./exec";
import { buildStackForest, flattenLayers, toChains } from "./stackInference";
import type { LayerNode, PrInfo } from "./types";

interface GhPr {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft: boolean;
  state: "OPEN" | "MERGED" | "CLOSED";
}

export async function fetchPrsByBranch(cwd: string): Promise<Map<string, PrInfo>> {
  const out = await runGh(
    [
      "pr",
      "list",
      "--json",
      "number,title,headRefName,baseRefName,url,isDraft,state",
      "--limit",
      "200",
      "--state",
      "all",
    ],
    cwd
  );
  const prs: GhPr[] = JSON.parse(out);
  return new Map(
    prs.map((pr) => [
      pr.headRefName,
      {
        number: pr.number,
        url: pr.url,
        title: pr.title,
        isDraft: pr.isDraft,
        state: pr.state,
        baseRefName: pr.baseRefName,
      },
    ])
  );
}

export function annotateWithPrs(roots: LayerNode[], prByBranch: Map<string, PrInfo>) {
  for (const node of flattenLayers(roots)) {
    node.pr = prByBranch.get(node.branch) ?? null;
  }
}

/** Pushes a branch (if needed) and opens a draft PR against its stack parent. Safe to call again on an
 *  already-published layer — returns the existing PR instead of erroring on a duplicate. */
export async function publishLayer(cwd: string, node: LayerNode): Promise<PrInfo> {
  const existing = (await fetchPrsByBranch(cwd)).get(node.branch);
  if (existing) return existing;

  const createArgs = [
    "pr",
    "create",
    "--draft",
    "--base",
    node.parentBranch,
    "--head",
    node.branch,
    "--title",
    node.title ?? node.branch,
    "--body",
    node.title ? `Layer: ${node.title}` : "",
  ];

  try {
    await runGh(createArgs, cwd);
  } catch (err) {
    // Most common cause: the branch isn't pushed to origin yet.
    const message = err instanceof Error ? err.message : String(err);
    if (/a pull request for branch .* already exists/i.test(message)) {
      const pr = (await fetchPrsByBranch(cwd)).get(node.branch);
      if (pr) return pr;
    }
    await runGit(["push", "-u", "origin", node.branch], cwd);
    await runGh(createArgs, cwd);
  }

  const prs = await fetchPrsByBranch(cwd);
  const pr = prs.get(node.branch);
  if (!pr) throw new Error(`Created the PR but couldn't read it back for ${node.branch}.`);

  // Best-effort: register/extend this with GitHub's native stacks feature, so the PR actually
  // shows up linked as a stack on github.com instead of just happening to chain by base branch.
  await syncGitHubStack(cwd).catch(() => undefined);

  return pr;
}

interface GhStack {
  number: number;
  pull_requests: { number: number }[];
}

export interface GitHubStackSyncResult {
  created: number[][];
  extended: { stackNumber: number; added: number[] }[];
  skipped: string[];
}

/**
 * Registers every maximal run of consecutively-published layers (from the trunk end) as a real
 * GitHub stack via its REST API, so a PR shows up linked to its neighbors on github.com instead of
 * requiring someone to click "Preview stack" by hand. Safe to call repeatedly — already-covered
 * runs are left alone, and a run that extends an existing stack is added onto it rather than
 * recreated. Never throws: a sync failure shouldn't block the publish that triggered it.
 */
export async function syncGitHubStack(cwd: string): Promise<GitHubStackSyncResult> {
  const result: GitHubStackSyncResult = { created: [], extended: [], skipped: [] };

  const nameWithOwner = await runGh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd);
  const forest = await buildStackForest(cwd);
  const prByBranch = await fetchPrsByBranch(cwd);
  annotateWithPrs(forest.roots, prByBranch);

  const existingStacks: GhStack[] = JSON.parse(await runGh(["api", `repos/${nameWithOwner}/stacks`], cwd));
  const stackedPrNumbers = new Set(existingStacks.flatMap((s) => s.pull_requests.map((p) => p.number)));

  for (const chain of toChains(forest.roots)) {
    const published: number[] = [];
    for (const node of chain) {
      if (!node.pr) break; // stop at the first not-yet-published layer
      published.push(node.pr.number);
    }
    if (published.length < 2) continue; // nothing to link yet

    if (published.every((n) => stackedPrNumbers.has(n))) continue; // already fully covered

    if (!published.some((n) => stackedPrNumbers.has(n))) {
      await runGh(
        ["api", "-X", "POST", `repos/${nameWithOwner}/stacks`, ...published.flatMap((n) => ["-F", `pull_requests[]=${n}`])],
        cwd
      );
      result.created.push(published);
      continue;
    }

    // Partially covered: extend whichever existing stack already holds the covered prefix with
    // just the new PRs on top of it.
    const covered = published.filter((n) => stackedPrNumbers.has(n));
    const added = published.filter((n) => !stackedPrNumbers.has(n));
    const hostStack = existingStacks.find((s) => covered.every((n) => s.pull_requests.some((p) => p.number === n)));
    if (!hostStack) {
      result.skipped.push(`PRs ${published.join(", ")}: covered by more than one existing stack, not extending`);
      continue;
    }
    await runGh(
      ["api", "-X", "POST", `repos/${nameWithOwner}/stacks/${hostStack.number}/add`, ...added.flatMap((n) => ["-F", `pull_requests[]=${n}`])],
      cwd
    );
    result.extended.push({ stackNumber: hostStack.number, added });
  }

  return result;
}
