import { readState, updateState } from "./stateStore";
import { flattenLayers } from "./stackInference";
import { assignGreekName } from "./agentNames";
import { ClaimConflictError, type Claim, type LayerNode } from "./types";

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
    // A claim written before displayName existed (an older state.json) falls back to its raw
    // agentName rather than rendering as "undefined" in the UI.
    .map((c) => (c.displayName ? c : { ...c, displayName: c.agentName }));
}

/** Claims a layer for an agent — re-claiming by the same agent refreshes the heartbeat. */
export async function claimLayer(
  cwd: string,
  branch: string,
  agentName: string,
  reason: string
): Promise<Claim> {
  const now = new Date().toISOString();
  const state = await updateState(cwd, (state) => {
    const active = state.claims.filter((c) => !isExpired(c, Date.now()));
    const existing = active.find((c) => c.branch === branch);
    if (existing && existing.agentName !== agentName) {
      throw new ClaimConflictError(existing);
    }
    // Re-claiming (same underlying caller, e.g. a heartbeat refresh) keeps its assigned name;
    // a brand-new claim gets the next name no other currently-active claim is using.
    const namesInUse = new Set(active.filter((c) => c.branch !== branch).map((c) => c.displayName));
    const displayName = existing?.displayName ?? assignGreekName(namesInUse);
    const claim: Claim = {
      branch,
      agentName,
      displayName,
      color: colorForAgent(displayName),
      reason,
      claimedAt: existing?.claimedAt ?? now,
      heartbeatAt: now,
    };
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
