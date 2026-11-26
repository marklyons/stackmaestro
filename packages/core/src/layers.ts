import { runGit, tryRunGit } from "./exec";
import { updateState, readState } from "./stateStore";
import { flattenLayers } from "./stackInference";
import type { LayerNode } from "./types";

/** Creates a new branch for a layer without touching the current checkout. Records the declared
 *  parent so the stack view can order it correctly before it has any commits of its own — ancestry
 *  inference alone can't tell "stacked on parentBranch" apart from "stacked on trunk" until then. */
export async function createLayer(
  cwd: string,
  parentBranch: string,
  branchName: string,
  title?: string
): Promise<void> {
  // `--` stops git from treating a caller-supplied name as a flag — a branch named e.g. "-D"
  // without it would make this `git branch -D <parentBranch>`, deleting parentBranch instead of
  // creating anything. Both args are caller-controlled (parentBranch defaults to trunk, but
  // create_layer lets a caller name any branch), so both need to be shielded.
  await runGit(["branch", "--", branchName, parentBranch], cwd);
  await updateState(cwd, (state) => ({
    ...state,
    layerNotes: {
      ...state.layerNotes,
      [branchName]: { ...state.layerNotes[branchName], ...(title ? { title } : {}), parentBranch },
    },
  }));
}

export interface PlannedLayer {
  /** New branch name for this layer. */
  branch: string;
  /** Short human-readable description of what this layer does. */
  title: string;
  /** Branch this layer stacks on top of. Omit to chain onto the previous planned layer (or the trunk for the first one). */
  parentBranch?: string;
}

export interface PlanFeatureResult {
  feature: string;
  created: { branch: string; parentBranch: string; title: string }[];
  skipped: { branch: string; reason: string }[];
}

/**
 * Creates several stacked layers for one feature in a single call, so they
 * show up together in the stack view immediately rather than trickling in
 * one `create_layer` call at a time. Branches that already exist are
 * skipped (not overwritten) so a partially-applied plan can be re-run safely.
 */
export async function planFeature(
  cwd: string,
  featureName: string,
  trunk: string,
  layers: PlannedLayer[]
): Promise<PlanFeatureResult> {
  const created: PlanFeatureResult["created"] = [];
  const skipped: PlanFeatureResult["skipped"] = [];
  let previousBranch = trunk;

  for (const layer of layers) {
    const parentBranch = layer.parentBranch ?? previousBranch;
    const exists = await tryRunGit(["rev-parse", "--verify", `refs/heads/${layer.branch}`], cwd);
    if (exists) {
      skipped.push({ branch: layer.branch, reason: "a branch with this name already exists" });
      previousBranch = layer.branch;
      continue;
    }
    await runGit(["branch", "--", layer.branch, parentBranch], cwd);
    created.push({ branch: layer.branch, parentBranch, title: layer.title });
    previousBranch = layer.branch;
  }

  if (created.length > 0) {
    await updateState(cwd, (state) => {
      const layerNotes = { ...state.layerNotes };
      for (const layer of created) {
        layerNotes[layer.branch] = { title: layer.title, feature: featureName, parentBranch: layer.parentBranch };
      }
      return { ...state, layerNotes };
    });
  }

  return { feature: featureName, created, skipped };
}

export async function setLayerTitle(cwd: string, branch: string, title: string): Promise<void> {
  await updateState(cwd, (state) => ({
    ...state,
    layerNotes: { ...state.layerNotes, [branch]: { ...state.layerNotes[branch], title } },
  }));
}

export async function annotateWithNotes(cwd: string, roots: LayerNode[]): Promise<void> {
  const state = await readState(cwd);
  for (const node of flattenLayers(roots)) {
    const note = state.layerNotes[node.branch];
    node.title = note?.title ?? null;
    node.feature = note?.feature ?? null;
  }
}
