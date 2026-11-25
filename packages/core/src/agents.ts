import * as crypto from "node:crypto";
import { readState, updateState } from "./stateStore";
import { assignGreekName } from "./agentNames";
import { LAB_STYLES, type Lab } from "./labs";
import type { AgentRecord } from "./types";

export interface RegisterAgentInput {
  /** The task/instruction this agent was given, in its own words. */
  initialPrompt: string;
  lab?: Lab;
  /** The agentId of whichever agent spawned this one, if any. Must already be registered. */
  parentAgentId?: string;
}

/**
 * Registers an agent's identity — call this once, before it claims or works on anything. This is
 * the one piece of contract StackMaestro asks of every caller, whatever's driving it (Claude,
 * Codex, a human via the extension, or anything else): say what you were asked to do, and who (if
 * anyone) spawned you. Returns a persistent agentId — pass it to every claim_layer call this agent
 * makes, and hand it to any sub-agent it spawns as that agent's parentAgentId.
 */
export async function registerAgent(cwd: string, input: RegisterAgentInput): Promise<AgentRecord> {
  if (input.parentAgentId && !(await getAgent(cwd, input.parentAgentId))) {
    throw new Error(`No registered agent with id "${input.parentAgentId}" — register the parent agent first.`);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const lab: Lab = input.lab ?? "unknown";

  const state = await updateState(cwd, (state) => {
    const namesInUse = new Set(Object.values(state.agents).map((a) => a.displayName));
    const record: AgentRecord = {
      id,
      displayName: assignGreekName(namesInUse),
      lab,
      initialPrompt: input.initialPrompt,
      parentAgentId: input.parentAgentId ?? null,
      color: LAB_STYLES[lab].color,
      createdAt: now,
      lastSeenAt: now,
    };
    return { ...state, agents: { ...state.agents, [id]: record } };
  });

  return state.agents[id];
}

export async function getAgent(cwd: string, agentId: string): Promise<AgentRecord | null> {
  const state = await readState(cwd);
  return state.agents[agentId] ?? null;
}

export async function listAgents(cwd: string): Promise<AgentRecord[]> {
  const state = await readState(cwd);
  return Object.values(state.agents);
}
