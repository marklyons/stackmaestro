# StackMaestro

A stack-first view of your branches and PRs for Cursor/VS Code — plus an MCP
server so the chat agent can work the stack directly. Modeled on the
Sapling/Mercurial "stack of diffs" workflow: a branch is a first-class layer
whether or not it has become a GitHub PR yet, structure comes from git
commit ancestry (not a hand-maintained plan), and it works across git
worktrees so several agents can work different layers in parallel without
colliding.

## How it fits together

```
packages/core     Pure TS, no editor dependency. Everything both the
                   extension and the MCP server need:
                     - stackInference.ts   infers the stack from git ancestry
                     - worktrees.ts         finds/creates worktrees, and the
                                            shared .git-common-dir
                     - prSync.ts            matches layers to GitHub PRs,
                                            publishes unpublished ones
                     - stateStore.ts        the shared, lock-protected state
                                            file (claims + layer titles)
                     - claims.ts            claim/release a layer
apps/extension     VS Code/Cursor sidebar (lives in the Explorer panel,
                   alongside your file tree): the stack graph webview +
                   commands (switch/claim/release/publish/new layer). Live
                   -updates as branches/commits/claims/PRs change — no
                   manual refresh needed.
apps/mcp-server    Same core logic, exposed as MCP tools so Cursor's (or
                   Claude's) chat can drive the stack directly.
apps/desktop       A standalone Electron app — pick any repo on disk and see
                   all of its stacks at once, laid out as horizontally
                   -scrollable columns (built for a wide window, where
                   several independent stacks make more sense side by side
                   than stacked vertically in a sidebar). No editor required.
```

There's no hosted backend and no database. Coordination state
(`claims`, i.e. who's working on which layer and why, plus optional layer
titles) lives in a single JSON file at `<git-common-dir>/stackmaestro/state.json`
— under `.git`, so every worktree of the same clone sees the same file, and
it never gets committed to the repo. Reads/writes go through a small
lockfile so two agent processes claiming at once can't corrupt it.

## The stack model

There is no separate "create a plan" step required. Whenever something asks
for the stack, `packages/core` looks at your local branches and:

1. Finds the trunk (`origin/HEAD`, falling back to `main`/`master`).
2. For every other local branch, finds its closest real ancestor among the
   other branches/trunk (by `git merge-base --is-ancestor` + fewest commits
   between them) and calls that its parent layer.
3. Builds a tree from that, so branches that fan out from the same point show
   up as siblings, not a forced line.
4. Annotates each layer with: its GitHub PR (if `gh pr list` finds one by
   head branch), which worktree (if any) currently has it checked out, and
   any active claim.

That's it — if you only ever work with `git branch`/`git checkout -b`, the
stack view still reflects reality. No branch-naming convention is required
(the `feature/widget/1-schema` style names in the examples below are just a
convention I used for the demo, not something the tool enforces).

Pure ancestry inference has one blind spot: two freshly-created sibling
-looking branches with zero commits of their own are indistinguishable from
each other by commit graph alone (a stacked-but-empty layer and a layer off
trunk look identical until someone commits). So `create_layer` and
`plan_feature` record the parent you declared at creation time, and the
stack view trusts that declared parent — as long as it's still a real
ancestor — over the ancestry guess. This is what makes a freshly-planned
5-layer feature show up as a stack immediately, before anyone has written a
line of code, instead of as five flat siblings of trunk.

## Claims ("the floating bubbles")

Before an agent (via the MCP server) or a person (via the extension) starts
work on a layer, it claims it: a branch, an agent name, and a reason. A
second claim on the same branch by a *different* agent is rejected with who
already holds it. Claims auto-expire after 90 minutes of inactivity. The
stack view renders each active claim as a small colored circle ("bubble")
pinned to that layer's card, with the agent's initials — gently floating so
active work reads as alive on screen, not just a static icon.

## Agent identity: the one contract every caller follows

StackMaestro doesn't care what's driving a claim — Claude, Codex, a human
clicking a button in the extension, anything else. What it does care about
is this one piece of contract: **register your identity before you claim or
touch anything**, via the `register_agent` tool.

```
register_agent({ repoPath, initialPrompt, lab?, parentAgentId? })
  → { id, displayName, lab, color, ... }
```

- `initialPrompt` — what you were asked to do, in your own words.
- `lab` — which lab's model is driving you (`anthropic`, `openai`, `google`,
  `meta`, `xai`, `mistral`), purely for branding/color in the UI. Omit if
  you don't know.
- `parentAgentId` — if another agent spawned you to work a specific layer,
  its id. This is what makes hierarchy visible: tell Claude to kick off a
  feature and it registers as, say, "Dionysus" with Anthropic's color; if
  Dionysus then spawns three sub-agents to each take a layer, those
  register with `parentAgentId` set to Dionysus's id, and every claim they
  make shows a small lineage badge — "subagent of Dionysus" — right in the
  stack view, not just in a tooltip.

Registration returns an `agentId` — pass it to every `claim_layer` call you
make (alongside a stable `agentName` used only for conflict detection), and
hand it to any sub-agent you spawn as *its* `parentAgentId` when that agent
registers itself. Skipping registration still works (`claim_layer` without
an `agentId` falls back to an ad-hoc Greek name with no lab or lineage), but
you lose the branding and the "who spawned whom" picture.

Names are assigned from a Greek-mythology pool, guaranteed distinct from
every other currently-active claim, and stable for that agent's whole
session (re-claiming / heartbeat-refreshing keeps the same name).

## Using it from Cursor's (or Claude's) chat

Add the MCP server to your MCP config — Cursor: `~/.cursor/mcp.json` (or the
project's `.cursor/mcp.json`); Claude Code: `claude mcp add`.

```json
{
  "mcpServers": {
    "stackmaestro": {
      "command": "node",
      "args": ["/Users/marklyons/stackmaestro/apps/mcp-server/dist/index.js"]
    }
  }
}
```

It exposes eight tools: `list_stack`, `plan_feature`, `register_agent`,
`claim_layer`, `release_layer`, `create_layer`, `ensure_worktree`,
`publish_layer` — all take an explicit `repoPath` so one server instance
can work across repos.

`plan_feature` is the one to reach for when kicking off something new: tell
the agent *"let's add task comments — split it into layers for the data
model, validation, routes, frontend client, and UI"* and it creates all of
those branches, correctly stacked, in one call — they appear together in
the sidebar instantly instead of trickling in one at a time, each tagged
with the feature name so the sidebar shows a shared progress header
(`n/total published`) across the whole plan.

From there, a natural prompt like *"claim the API layer of the widget stack
and start wiring it up"* resolves to `list_stack` → `claim_layer` →
`ensure_worktree`, then the agent edits inside the returned worktree path —
each layer in its own worktree means you can point separate agent sessions
(separate Cursor chat tabs/windows, or Cursor's own background agents) at
different layers of the same stack at the same time without them colliding,
and watch the sidebar's claim bubbles show who's working where live.

## Running the extension

```bash
pnpm install
pnpm --filter stackmaestro build          # or `pnpm --filter stackmaestro watch`
```

Then, in this folder in VS Code or Cursor: Run and Debug → "Run Extension"
(F5). Open any git repo as the workspace — the Explorer panel on the left
gets a new "Stack" section, under your file tree, showing the inferred
stack.

## Running the desktop app

```bash
pnpm install
pnpm --filter @stackmaestro/desktop start   # builds, then launches Electron
```

Pick any git repo from the "Open Repository…" screen. It live-updates the
same way the extension does (watching the shared git dir), and lays out
every independent stack in that repo as its own horizontally-scrollable
column — useful once you have more than one feature stacked at a time,
which the sidebar's vertical layout doesn't show side by side as naturally.
Claim/release/publish/switch all work the same as the extension; "New
layer on top" and "Claim" use a small in-app text prompt instead of VS
Code's command palette input.

## What's intentionally not here yet

- **Publishing to the Marketplace**, or packaging/signing the desktop app
  as an installer. Both are set up to refine locally and hand to colleagues
  (`pnpm --filter stackmaestro package` for the extension, `pnpm --filter
  @stackmaestro/desktop start` for the app) rather than released yet, per
  the plan to demo first and maybe open-source later.
- **A tree view for genuinely branching stacks** (one layer with two
  children). The inference and data model already support it; both UIs
  render children under a parent fine, but no interface yet for picking
  "which sibling" when creating a layer vs. just naming the parent branch.
- **Agent records are never pruned.** Claims expire after 90 minutes, but
  every agent ever registered stays in `state.json` forever — fine for a
  single demo repo, not something to leave running indefinitely.
- **Remote/team visibility.** Claims are local-machine-only by design (that's
  what makes them need no server) — they coordinate parallel agents on one
  machine's worktrees, not a distributed team. Not a target for this tool;
  GitHub PR review is still the cross-team coordination mechanism.
