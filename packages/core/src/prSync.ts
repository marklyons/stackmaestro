import { runGh, runGit } from "./exec";
import { flattenLayers } from "./stackInference";
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
  return pr;
}
