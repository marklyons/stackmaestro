import * as vscode from "vscode";
import * as os from "node:os";
import {
  ClaimConflictError,
  claimLayer as coreClaimLayer,
  createLayer as coreCreateLayer,
  findLayer,
  flattenLayers,
  getFullStack,
  publishLayer as corePublishLayer,
  releaseClaim,
  runGit,
  tryRunGit,
} from "@stackmaestro/core";
import type { StackViewProvider } from "./stackViewProvider";

function cwdOrThrow(): string {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) throw new Error("Open a git repository folder first.");
  return cwd;
}

function currentAgentName(): string {
  const configured = vscode.workspace.getConfiguration("stackmaestro").get<string>("agentName", "");
  return configured.trim() || os.userInfo().username;
}

async function pickBranch(cwd: string, placeHolder: string, filter?: (layer: ReturnType<typeof flattenLayers>[number]) => boolean) {
  const forest = await getFullStack(cwd);
  const layers = flattenLayers(forest.roots).filter((l) => (filter ? filter(l) : true));
  if (layers.length === 0) return undefined;
  const pick = await vscode.window.showQuickPick(
    layers.map((l) => ({
      label: l.title ? `${l.branch} — ${l.title}` : l.branch,
      description: l.pr ? `PR #${l.pr.number}` : "no PR yet",
      branch: l.branch,
    })),
    { placeHolder }
  );
  return pick?.branch;
}

export function registerCommands(context: vscode.ExtensionContext, provider: StackViewProvider) {
  context.subscriptions.push(
    vscode.commands.registerCommand("stackmaestro.refreshStack", () => provider.refresh()),

    vscode.commands.registerCommand("stackmaestro.switchToLayer", async (branchArg?: string) => {
      const cwd = cwdOrThrow();
      const branch = branchArg ?? (await pickBranch(cwd, "Switch to which layer?"));
      if (!branch) return;

      const current = await tryRunGit(["branch", "--show-current"], cwd);
      if (current === branch) {
        vscode.window.showInformationMessage(`Already on "${branch}".`);
        return;
      }

      // A plain checkout in the current working directory — same window,
      // same worktree. No new window, no worktree created on your behalf.
      // Parallel worktrees are an explicit, separate thing (see
      // ensure_worktree in the MCP server) for when agents genuinely need to
      // work two layers at once; a human clicking "Switch to" just wants to
      // move up or down the stack in place.
      try {
        await runGit(["checkout", branch], cwd);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/already (used|checked out)/.test(message)) {
          vscode.window.showWarningMessage(
            `"${branch}" is already checked out in another worktree:\n${message}`
          );
          return;
        }
        if (/overwritten by checkout|local changes/.test(message)) {
          vscode.window.showWarningMessage(
            `Can't switch — you have uncommitted changes that would be overwritten. Commit or stash them first.`
          );
          return;
        }
        throw err;
      }

      vscode.window.showInformationMessage(`Switched to "${branch}".`);
      await provider.refresh();
    }),

    vscode.commands.registerCommand("stackmaestro.createLayer", async (parentArg?: string) => {
      const cwd = cwdOrThrow();
      const parent = parentArg ?? (await pickBranch(cwd, "Stack the new layer on top of which branch?"));
      if (!parent) return;

      const branchName = await vscode.window.showInputBox({ prompt: "New branch name" });
      if (!branchName) return;
      const title = await vscode.window.showInputBox({ prompt: "What is this layer? (optional)" });

      await coreCreateLayer(cwd, parent, branchName, title || undefined);
      await provider.refresh();

      const switchNow = await vscode.window.showInformationMessage(
        `Created "${branchName}" on top of "${parent}". Switch to it now?`,
        "Switch",
        "Not now"
      );
      if (switchNow === "Switch") {
        await vscode.commands.executeCommand("stackmaestro.switchToLayer", branchName);
      }
    }),

    vscode.commands.registerCommand("stackmaestro.publishLayer", async (branchArg?: string) => {
      const cwd = cwdOrThrow();
      const branch = branchArg ?? (await pickBranch(cwd, "Publish which layer as a draft PR?", (l) => !l.pr));
      if (!branch) return;

      const forest = await getFullStack(cwd);
      const node = findLayer(forest.roots, branch);
      if (!node) {
        vscode.window.showErrorMessage(`Couldn't find layer "${branch}".`);
        return;
      }

      const pr = await corePublishLayer(cwd, node);
      vscode.window.showInformationMessage(`Published #${pr.number}: ${pr.url}`);
      await provider.refresh();
    }),

    vscode.commands.registerCommand("stackmaestro.claimLayer", async (branchArg?: string) => {
      const cwd = cwdOrThrow();
      const branch = branchArg ?? (await pickBranch(cwd, "Claim which layer?"));
      if (!branch) return;

      const reason = await vscode.window.showInputBox({ prompt: "Why are you claiming this layer?" });
      if (!reason) return;

      try {
        await coreClaimLayer(cwd, branch, currentAgentName(), reason);
      } catch (err) {
        if (err instanceof ClaimConflictError) {
          vscode.window.showWarningMessage(
            `Already claimed by ${err.holder.agentName}: "${err.holder.reason}"`
          );
          return;
        }
        throw err;
      }
      await provider.refresh();
    }),

    vscode.commands.registerCommand("stackmaestro.releaseLayer", async (branchArg?: string) => {
      const cwd = cwdOrThrow();
      const branch = branchArg ?? (await pickBranch(cwd, "Release which layer?"));
      if (!branch) return;
      await releaseClaim(cwd, branch, currentAgentName());
      await provider.refresh();
    })
  );
}
