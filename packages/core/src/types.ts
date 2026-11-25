import type { Lab } from "./labs";

export interface PrInfo {
  number: number;
  url: string;
  title: string;
  isDraft: boolean;
  state: "OPEN" | "MERGED" | "CLOSED";
  baseRefName: string;
}

/**
 * An agent identity, registered once via `registerAgent` before it claims or works on anything.
 * This is the contract StackMaestro expects from ANY caller — Claude, Codex, a human via the
 * extension, or anything else: say what you were asked to do, and who (if anyone) spawned you.
 */
export interface AgentRecord {
  id: string;
  /** A Greek-mythology name assigned on registration, distinct from every other registered agent. */
  displayName: string;
  lab: Lab;
  /** The task/instruction this agent was given, in its own words. */
  initialPrompt: string;
  /** The agentId of whichever agent spawned this one, if any. */
  parentAgentId: string | null;
  color: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface Claim {
  branch: string;
  /** The raw identifier the caller passed in — used for conflict detection, not shown in the UI. */
  agentName: string;
  /** Set when the caller registered via `registerAgent` first — links back to that identity. */
  agentId: string | null;
  /** A Greek-mythology name StackMaestro assigns to this claim, distinct from every other active claim. */
  displayName: string;
  lab: Lab;
  color: string;
  /** Denormalized from the agent's own parent, so the UI can show "subagent of X" without a second lookup. */
  parentAgentId: string | null;
  parentDisplayName: string | null;
  parentColor: string | null;
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
  /** Every agent identity ever registered in this repo, keyed by id. Not pruned — this is a small
   *  amount of bookkeeping data, and old entries are what let a UI show lineage history later. */
  agents: Record<string, AgentRecord>;
}

export class ClaimConflictError extends Error {
  constructor(public readonly holder: Claim) {
    super(`"${holder.branch}" is already claimed by ${holder.agentName}`);
  }
}
