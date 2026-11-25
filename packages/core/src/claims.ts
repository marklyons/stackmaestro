import { readState, updateState } from "./stateStore";
import { flattenLayers } from "./stackInference";
import { assignGreekName } from "./agentNames";
import { ClaimConflictError, type Claim, type LayerNode } from "./types";

export interface ClaimIdentity {
  /** Raw identifier for conflict detection — can just mirror agentId when you have one. */
  agentName: string;
  /** From registerAgent — when given, the claim inherits its registered name, lab, and parent lineage. */
  agentId?: string;
}

const CLAIM_TTL_MINUTES = 90;
const AGENT_COLOR_PALETTE = [
  "#D97757",
  "#10A37F",
  "#4285F4",
  "#0668E1",
  "#E5484D",
  "#FA520F",
  "#8B5CF6",
  "#F59E0B",
];

function colorForAgent(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AGENT_COLOR_PALETTE[hash % AGENT_COLOR_PALETTE.length];
}

function isExpired(claim: Claim, now: number): boolean {
  return now - new Date(claim.heartbeatAt).getTime() > CLAIM_TTL_MINUTES * 60_000;
}

export async function listActiveClaims(cwd: string): Promise<Claim[]> {
  const state = await readState(cwd);
  const now = Date.now();
  return state.claims
    .filter((c) => !isExpired(c, now))
    // A claim written before this field existed (an older state.json) gets a harmless default
    // instead of rendering as "undefined" in the UI.
    .map((c) => ({
      ...c,
      displayName: c.displayName ?? c.agentName,
      agentId: c.agentId ?? null,
      lab: c.lab ?? "unknown",
      parentAgentId: c.parentAgentId ?? null,
      parentDisplayName: c.parentDisplayName ?? null,
      parentColor: c.parentColor ?? null,
    }));
}

/** Claims a layer — re-claiming with the same agentName refreshes the heartbeat. Pass `agentId`
 *  (from registerAgent) to get the agent's registered name, lab branding, and parent lineage;
 *  without it, the claim still works but falls back to an ad-hoc name with no lab/lineage info. */
export async function claimLayer(
  cwd: string,
  branch: string,
  identity: ClaimIdentity,
  reason: string
): Promise<Claim> {
  const now = new Date().toISOString();
  const state = await updateState(cwd, (state) => {
    const active = state.claims.filter((c) => !isExpired(c, Date.now()));
    const existing = active.find((c) => c.branch === branch);
    if (existing && existing.agentName !== identity.agentName) {
      throw new ClaimConflictError(existing);
    }

    let claim: Claim;
    if (identity.agentId) {
      const agent = state.agents[identity.agentId];
      if (!agent) {
        throw new Error(`No registered agent with id "${identity.agentId}" — call register_agent first.`);
      }
      const parent = agent.parentAgentId ? state.agents[agent.parentAgentId] : null;
      claim = {
        branch,
        agentName: identity.agentName,
        agentId: agent.id,
        displayName: agent.displayName,
        lab: agent.lab,
        color: agent.color,
        parentAgentId: agent.parentAgentId,
        parentDisplayName: parent?.displayName ?? null,
        parentColor: parent?.color ?? null,
        reason,
        claimedAt: existing?.claimedAt ?? now,
        heartbeatAt: now,
      };
    } else {
      // Re-claiming (same underlying caller, e.g. a heartbeat refresh) keeps its assigned name;
      // a brand-new claim gets the next name no other currently-active claim is using.
      const namesInUse = new Set(active.filter((c) => c.branch !== branch).map((c) => c.displayName));
      const displayName = existing?.displayName ?? assignGreekName(namesInUse);
      claim = {
        branch,
        agentName: identity.agentName,
        agentId: null,
        displayName,
        lab: "unknown",
        color: colorForAgent(displayName),
        parentAgentId: null,
        parentDisplayName: null,
        parentColor: null,
        reason,
        claimedAt: existing?.claimedAt ?? now,
        heartbeatAt: now,
      };
    }

    return { ...state, claims: [...active.filter((c) => c.branch !== branch), claim] };
  });
  return state.claims.find((c) => c.branch === branch)!;
}

export async function releaseClaim(cwd: string, branch: string, agentName?: string): Promise<void> {
  await updateState(cwd, (state) => ({
    ...state,
    claims: state.claims.filter((c) => !(c.branch === branch && (!agentName || c.agentName === agentName))),
  }));
}

export function annotateWithClaims(roots: LayerNode[], claims: Claim[]) {
  const claimByBranch = new Map(claims.map((c) => [c.branch, c]));
  for (const node of flattenLayers(roots)) {
    node.claim = claimByBranch.get(node.branch) ?? null;
  }
}
