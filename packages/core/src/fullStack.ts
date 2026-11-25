import { buildStackForest } from "./stackInference";
import { fetchPrsByBranch, annotateWithPrs } from "./prSync";
import { listActiveClaims, annotateWithClaims } from "./claims";
import { annotateWithNotes } from "./layers";
import type { StackForest } from "./types";

/** The one call both the extension and the MCP server use: git ancestry +
 *  GitHub PR status + who's claimed what + any custom layer titles. */
export async function getFullStack(cwd: string): Promise<StackForest> {
  const forest = await buildStackForest(cwd);

  const [prs, claims] = await Promise.all([
    fetchPrsByBranch(cwd).catch(() => new Map()),
    listActiveClaims(cwd).catch(() => []),
  ]);
  annotateWithPrs(forest.roots, prs);
  annotateWithClaims(forest.roots, claims);
  await annotateWithNotes(cwd, forest.roots).catch(() => undefined);

  return forest;
}
