(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");

  // Mirrors packages/core/src/labs.ts — display-only, kept here since this file isn't bundled.
  // These glyphs are abstract stand-ins, not the real brand logos (no logo assets to embed, and
  // reproducing trademarked artwork isn't something to do without rights) — just enough to tell
  // labs apart at a glance by color + shape.
  const LAB_ICONS = {
    anthropic: { label: "Claude", glyph: "✻", color: "#D97757" },
    openai: { label: "OpenAI", glyph: "◉", color: "#10A37F" },
    google: { label: "Gemini", glyph: "◆", color: "#4285F4" },
    meta: { label: "Meta", glyph: "∞", color: "#0668E1" },
    xai: { label: "Grok", glyph: "✕", color: "#1D1D1F" },
    mistral: { label: "Mistral", glyph: "▲", color: "#FA520F" },
    unknown: { label: "Agent", glyph: "●", color: "#8B8B8B" },
  };

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "error") {
      root.innerHTML = `<div class="error">${escapeHtml(message.message)}</div>`;
      return;
    }
    if (message.type === "stack") {
      render(message.forest);
    }
  });

  // A "stack" is a flat line from trunk to tip, not a nested tree. Most repos
  // are one straight line; if a branch point really forks, that's a separate
  // chain rendered as its own flat stack below, not a box inside a box.
  function toChains(roots) {
    const chains = [];
    function walk(node, soFar) {
      const chain = [...soFar, node];
      if (!node.children || node.children.length === 0) {
        chains.push(chain);
        return;
      }
      for (const child of node.children) walk(child, chain);
    }
    for (const r of roots) walk(r, []);
    return chains;
  }

  function render(forest) {
    root.innerHTML = "";

    if (!forest.roots || forest.roots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No layers yet. Ask the agent to plan a feature, or create one on top of a branch.";
      root.appendChild(empty);
      return;
    }

    const chains = toChains(forest.roots);
    chains.forEach((chain, index) => {
      if (index > 0) {
        const sep = document.createElement("div");
        sep.className = "chain-separator";
        root.appendChild(sep);
      }
      // Tip at the top of the screen, trunk at the bottom — a stack, numbered
      // from the root (#1, right on top of trunk) up to the tip.
      root.appendChild(renderChain([...chain].reverse(), forest.mainWorktreePath, forest.trunk));
    });
  }

  // If every layer in a chain belongs to the same named feature plan, show one
  // progress header for the whole chain instead of repeating the name per card.
  function sharedFeature(nodesTipFirst) {
    const first = nodesTipFirst[0]?.feature;
    if (!first) return null;
    return nodesTipFirst.every((n) => n.feature === first) ? first : null;
  }

  function renderChain(nodesTipFirst, mainWorktreePath, trunk) {
    const wrapper = document.createElement("div");
    wrapper.className = "chain-wrapper";

    const feature = sharedFeature(nodesTipFirst);
    if (feature) {
      const published = nodesTipFirst.filter((n) => n.pr).length;
      const header = document.createElement("div");
      header.className = "feature-header";
      header.innerHTML =
        `<span class="feature-icon">◆</span><span class="feature-name">${escapeHtml(feature)}</span>` +
        `<span class="feature-progress">${published}/${nodesTipFirst.length} published</span>`;
      wrapper.appendChild(header);
    }

    const chain = document.createElement("div");
    chain.className = "chain";
    const total = nodesTipFirst.length;

    nodesTipFirst.forEach((node, i) => {
      // Numbered from the root (layer 1, sitting right on trunk) up to the tip —
      // matches how you'd talk through a stack out loud: "layer 1, then 2, then 3...".
      const layerNumber = total - i;

      const row = document.createElement("div");
      row.className = "row";

      const gutter = document.createElement("div");
      gutter.className = "gutter";
      if (i > 0) gutter.appendChild(makeEl("div", "line line-up"));
      const dot = makeEl("div", "dot " + dotClass(node));
      dot.textContent = String(layerNumber);
      gutter.appendChild(dot);
      gutter.appendChild(makeEl("div", "line line-down"));
      row.appendChild(gutter);

      row.appendChild(renderCard(node, mainWorktreePath, !!feature));
      chain.appendChild(row);
    });

    chain.appendChild(renderTrunkAnchor(trunk));
    wrapper.appendChild(chain);
    return wrapper;
  }

  // The solid foundation the whole stack sits on — not a layer itself, so it
  // gets no number, just a distinct "ground line" look to anchor the stack.
  function renderTrunkAnchor(trunk) {
    const row = document.createElement("div");
    row.className = "row trunk-row";

    const gutter = document.createElement("div");
    gutter.className = "gutter";
    gutter.appendChild(makeEl("div", "line line-up"));
    gutter.appendChild(makeEl("div", "root-marker"));
    row.appendChild(gutter);

    const anchor = document.createElement("div");
    anchor.className = "trunk-anchor";
    anchor.innerHTML = `<span class="trunk-ground"></span><span class="trunk-text">${escapeHtml(trunk)} <em>(root)</em></span>`;
    row.appendChild(anchor);

    return row;
  }

  function dotClass(node) {
    if (node.pr) return "dot-published";
    if (node.claim) return "dot-active";
    if (node.commitCount > 0) return "dot-inprogress";
    return "dot-planned";
  }

  // The agent status pill: a lab-colored icon, the agent's full name, and a status subline —
  // standalone, sitting above the card's own content, not squeezed into the meta-info row.
  function renderAgentBadge(claim) {
    const lab = LAB_ICONS[claim.lab] || LAB_ICONS.unknown;

    const badge = document.createElement("div");
    badge.className = "agent-badge";
    badge.style.borderColor = claim.color;
    badge.title = `${claim.displayName} (${lab.label}): ${claim.reason}`;
    badge.style.animationDelay = `-${hashFloat(claim.displayName) * 3}s`;

    const icon = document.createElement("span");
    icon.className = "agent-badge-icon";
    icon.style.background = claim.color;
    icon.textContent = lab.glyph;
    badge.appendChild(icon);

    const text = document.createElement("span");
    text.className = "agent-badge-text";
    const nameEl = document.createElement("span");
    nameEl.className = "agent-badge-name";
    nameEl.textContent = claim.displayName;
    const statusEl = document.createElement("span");
    statusEl.className = "agent-badge-status";
    statusEl.textContent = claim.parentDisplayName ? `subagent of ${claim.parentDisplayName}` : "Coding";
    text.append(nameEl, statusEl);
    badge.appendChild(text);

    return badge;
  }

  function renderCard(node, mainWorktreePath, featureShownInHeader) {
    const card = document.createElement("div");
    card.className = "node" + (node.worktreePath ? " in-worktree" : "") + (node.claim ? " claimed" : "");

    if (node.claim) {
      card.appendChild(renderAgentBadge(node.claim));
    }

    const titleEl = document.createElement("div");
    titleEl.className = "node-title";
    titleEl.textContent = node.title ? `${node.branch} — ${node.title}` : node.branch;
    card.appendChild(titleEl);

    const meta = document.createElement("div");
    meta.className = "node-meta";
    if (node.feature && !featureShownInHeader) {
      const chip = document.createElement("span");
      chip.className = "feature-pill";
      chip.textContent = node.feature;
      meta.appendChild(chip);
    }
    const commitText = textSpan(`${node.commitCount} commit${node.commitCount === 1 ? "" : "s"} on ${node.parentBranch}`);
    commitText.className = "meta-text";
    meta.appendChild(commitText);
    if (node.pr) {
      const pill = document.createElement("span");
      pill.className = "pr-pill";
      pill.textContent = `PR #${node.pr.number} · ${node.pr.state}${node.pr.isDraft ? " (draft)" : ""}`;
      pill.style.cursor = "pointer";
      pill.onclick = () => vscode.postMessage({ type: "openPr", url: node.pr.url });
      meta.appendChild(pill);
    }
    if (node.worktreePath) {
      const pill = document.createElement("span");
      pill.className = "worktree-pill";
      pill.textContent =
        node.worktreePath === mainWorktreePath ? "main worktree" : basename(node.worktreePath);
      pill.title = node.worktreePath;
      meta.appendChild(pill);
    }
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.appendChild(button("Switch to", () => vscode.postMessage({ type: "switchToLayer", branch: node.branch })));
    if (!node.pr || node.pr.state !== "OPEN") {
      actions.appendChild(
        button("Publish as PR", () => vscode.postMessage({ type: "publishLayer", branch: node.branch }))
      );
    }
    card.appendChild(actions);

    return card;
  }

  function makeEl(tag, className) {
    const el = document.createElement(tag);
    el.className = className;
    return el;
  }

  function button(label, onClick) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.onclick = onClick;
    return btn;
  }

  function textSpan(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
  }

  function basename(filePath) {
    return filePath.split("/").filter(Boolean).pop() || filePath;
  }

  // Deterministic 0..1 value from a name, used only to desync animation timing.
  function hashFloat(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return (hash % 1000) / 1000;
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }

  vscode.postMessage({ type: "refresh" });
})();
