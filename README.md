# StackMaestro

A stack-first view of your branches and PRs, inferred from git ancestry —
no hand-maintained plan, no backend, no database. Coordination state
(claims, agent identity, layer titles) lives in one file,
`.git/stackmaestro/state.json`, shared across every worktree of a clone.

[![Watch the StackMaestro demo](https://img.youtube.com/vi/KyPuRHNJK50/maxresdefault.jpg)](https://www.youtube.com/watch?v=KyPuRHNJK50)

Read more: [StackMaestro: trying to make agent-written code understandable by humans](https://mklyons.com/blog/stackmaestro).

Three ways to use it: a Cursor/VS Code sidebar, an MCP server for any
agent's chat, and a standalone desktop app.

## Prerequisites

- **[GitHub CLI (`gh`)](https://cli.github.com), installed *and* authenticated**
  (`gh auth login`) — required. StackMaestro shells out to it for every
  PR/stack operation (`gh pr create`, `gh pr list`, `gh api .../stacks`);
  without it, publishing and PR status just fail.
- Node 20+, [pnpm](https://pnpm.io) (`corepack enable` picks up the
  version this repo pins automatically)
- A regular git repo with a GitHub remote

## Build once

```bash
git clone https://github.com/marklyons/stackmaestro && cd stackmaestro
pnpm install
pnpm -r build
```

## Install

### Cursor / VS Code extension

```bash
pnpm --filter stackmaestro package              # → apps/extension/stackmaestro-0.1.0.vsix
cursor --install-extension apps/extension/stackmaestro-0.1.0.vsix
```

No `cursor` on your PATH? Cmd+Shift+P → "Shell Command: Install 'cursor'
command in PATH", or substitute `code`. Open any git repo afterward — the
Explorer sidebar gets a "StackMaestro" section under your file tree.

### MCP server (Claude Code, Cursor chat, any MCP client)

Claude Code:
```bash
claude mcp add --scope user stackmaestro -- node /absolute/path/to/stackmaestro/apps/mcp-server/dist/index.js
```

Cursor — add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "stackmaestro": {
      "command": "node",
      "args": ["/absolute/path/to/stackmaestro/apps/mcp-server/dist/index.js"]
    }
  }
}
```

Exposes 9 tools: `list_stack`, `plan_feature`, `register_agent`,
`claim_layer`, `release_layer`, `create_layer`, `ensure_worktree`,
`publish_layer`, `sync_github_stack`.

### Desktop app (standalone, no editor)

```bash
pnpm --filter @stackmaestro/desktop package:app   # macOS only → apps/desktop/release/StackMaestro.app
open apps/desktop/release/StackMaestro.app
```

Quick iteration without a real app bundle: `pnpm --filter @stackmaestro/desktop start`.

## How it works

- **Stack = git ancestry.** A branch's parent is its closest real ancestor
  by commit graph — no naming convention, no separate plan file.
  `plan_feature`/`create_layer` also record the declared parent at
  creation time, so a freshly-planned stack shows up correctly nested
  before anyone's committed a line.
- **Claims** mark "someone's working on this layer" — name, reason, 90
  -minute TTL. A conflicting claim is rejected with who already holds it.
- **Agent identity.** Call `register_agent` once (prompt, optional `lab`
  for branding, optional `parentAgentId` if spawned by another agent)
  before claiming anything. You get an `agentId` and a Greek-mythology
  name, shown as a floating badge with a lab-colored icon, and a
  "subagent of X" lineage tag when applicable.
- **Publishing** pushes the branch, opens a draft PR against its stack
  parent, and registers/extends it as a real GitHub stack (native
  Stacked-PRs API) — linked on github.com, not just base-branch-chained.

## Not yet

- Marketplace publishing / a signed desktop installer
- UI for picking a sibling on a genuine fork (two children on one layer)
- Agent registrations aren't pruned (claims expire; registrations don't)
- Remote/team visibility — claims are local-machine-only by design

## License

[MIT](LICENSE)
