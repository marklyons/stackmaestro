import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ClaimConflictError,
  claimLayer,
  createLayer,
  ensureWorktree,
  fetchDefaultBranch,
  findLayer,
  getFullStack,
  planFeature,
  publishLayer,
  releaseClaim,
} from "@stackmaestro/core";

const server = new McpServer({ name: "stackmaestro", version: "0.1.0" });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  return {
    content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
    isError: true,
  };
}

server.registerTool(
  "list_stack",
  {
    description:
      "Lists the stack of branches (layers) for a repo, inferred from git ancestry (so it includes branches that " +
      "never became a PR). Each layer is annotated with its GitHub PR status, where it's checked out (which " +
      "worktree, if any), and which agent — if any — has claimed it.",
    inputSchema: { repoPath: z.string().describe("Absolute path to the git repository") },
  },
  async ({ repoPath }) => {
    try {
      return ok(await getFullStack(repoPath));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "claim_layer",
  {
    description:
      "Claims a layer (branch) for an agent before working on it, so other agents on the same stack don't step " +
      "on it. Fails if another agent already holds the claim. Re-claiming with the same agentName refreshes it.",
    inputSchema: {
      repoPath: z.string(),
      branch: z.string(),
      agentName: z.string().describe("A stable name identifying the calling agent/session"),
      reason: z.string().describe("Why you're working on this layer, shown to other agents and the user"),
    },
  },
  async ({ repoPath, branch, agentName, reason }) => {
    try {
      return ok(await claimLayer(repoPath, branch, agentName, reason));
    } catch (err) {
      if (err instanceof ClaimConflictError) {
        return errorResult(`Already claimed by ${err.holder.agentName}: "${err.holder.reason}"`);
      }
      return errorResult(err);
    }
  }
);

server.registerTool(
  "release_layer",
  {
    description: "Releases your claim on a layer once you're done working on it.",
    inputSchema: { repoPath: z.string(), branch: z.string(), agentName: z.string() },
  },
  async ({ repoPath, branch, agentName }) => {
    try {
      await releaseClaim(repoPath, branch, agentName);
      return ok({ released: branch });
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "create_layer",
  {
    description:
      "Creates a new branch stacked on top of an existing layer (or the trunk). Does not check it out — use " +
      "ensure_worktree to get a working directory for it.",
    inputSchema: {
      repoPath: z.string(),
      parentBranch: z.string().describe("Branch (or trunk) this new layer stacks on top of"),
      branchName: z.string(),
      title: z.string().optional().describe("Short human-readable description of this layer"),
    },
  },
  async ({ repoPath, parentBranch, branchName, title }) => {
    try {
      await createLayer(repoPath, parentBranch, branchName, title);
      return ok({ created: branchName, parentBranch });
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "plan_feature",
  {
    description:
      "Breaks a feature into several small, stacked layers (branches) in one call, so the whole plan shows up " +
      "together in the stack view immediately instead of trickling in. By default each layer stacks on top of " +
      "the previous one in the list (a straight stack from trunk to tip) — pass an explicit parentBranch on a " +
      "layer only if it should branch off something other than the previous layer. Call this once, up front, " +
      "right after you and the user agree on how a feature should be sliced — before claiming or editing anything. " +
      "Safe to call again with the same plan: branches that already exist are reported as skipped, not recreated.",
    inputSchema: {
      repoPath: z.string(),
      featureName: z.string().describe("Short name for the overall feature, shown as a group label in the stack view"),
      baseBranch: z
        .string()
        .optional()
        .describe("Branch the first layer stacks on. Defaults to the repo's trunk (main/master) if omitted."),
      layers: z
        .array(
          z.object({
            branch: z.string().describe("New branch name for this layer"),
            title: z.string().describe("Short description of what this layer does"),
            parentBranch: z
              .string()
              .optional()
              .describe("Stack this layer on a specific branch instead of chaining onto the previous layer"),
          })
        )
        .min(1)
        .describe("The layers in stack order, trunk-most first"),
    },
  },
  async ({ repoPath, featureName, baseBranch, layers }) => {
    try {
      const trunk = baseBranch ?? (await fetchDefaultBranch(repoPath));
      return ok(await planFeature(repoPath, featureName, trunk, layers));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "ensure_worktree",
  {
    description:
      "Returns a working-directory path for a branch, creating a new git worktree for it if one doesn't already " +
      "exist. Use this before editing files for a layer so parallel agents on different layers never share a " +
      "working directory.",
    inputSchema: { repoPath: z.string(), branch: z.string() },
  },
  async ({ repoPath, branch }) => {
    try {
      return ok({ path: await ensureWorktree(repoPath, branch) });
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "publish_layer",
  {
    description: "Pushes a layer's branch and opens a draft GitHub PR against its inferred stack parent.",
    inputSchema: { repoPath: z.string(), branch: z.string() },
  },
  async ({ repoPath, branch }) => {
    try {
      const forest = await getFullStack(repoPath);
      const node = findLayer(forest.roots, branch);
      if (!node) return errorResult(`No layer named "${branch}" found.`);
      return ok(await publishLayer(repoPath, node));
    } catch (err) {
      return errorResult(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
