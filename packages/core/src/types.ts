export interface PrInfo {
  number: number;
  url: string;
  title: string;
  isDraft: boolean;
  state: "OPEN" | "MERGED" | "CLOSED";
  baseRefName: string;
}

export interface Claim {
  branch: string;
  /** The raw identifier the caller passed in — used for conflict detection, not shown in the UI. */
  agentName: string;
  /** A Greek-mythology name StackMaestro assigns to this claim, distinct from every other active claim. */
  displayName: string;
  color: string;
  reason: string;
  claimedAt: string;
  heartbeatAt: string;
}

export interface LayerNode {
  branch: string;
  parentBranch: string;
  headCommit: string;
  /** Commits on this branch not on its parent — how "thick" this layer is. */
  commitCount: number;
  worktreePath: string | null;
  pr: PrInfo | null;
  claim: Claim | null;
  title: string | null;
  /** Name of the multi-layer feature plan this branch belongs to, if any. */
  feature: string | null;
  children: LayerNode[];
}

export interface StackForest {
  trunk: string;
  /** Repo root of the main worktree — the shared coordination point across worktrees. */
  mainWorktreePath: string;
  roots: LayerNode[];
}

export interface StackState {
  version: 1;
  claims: Claim[];
  /** `parentBranch` is the stacking order declared at creation time (via createLayer/planFeature) —
   *  authoritative over ancestry inference, which alone can't order layers before they have commits. */
  layerNotes: Record<string, { title?: string; feature?: string; parentBranch?: string }>;
}

export class ClaimConflictError extends Error {
  constructor(public readonly holder: Claim) {
    super(`"${holder.branch}" is already claimed by ${holder.agentName}`);
  }
}
