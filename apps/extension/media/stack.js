(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");

  // Mirrors packages/core/src/labs.ts — display-only, kept here since this file isn't bundled.
  const LAB_LABELS = {
    anthropic: "Claude",
    openai: "OpenAI",
    google: "Gemini",
    meta: "Llama",
    xai: "Grok",
    mistral: "Mistral",
    unknown: "Agent",
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

  function renderCard(node, mainWorktreePath, featureShownInHeader) {
    const card = document.createElement("div");
    card.className = "node" + (node.worktreePath ? " in-worktree" : "") + (node.claim ? " claimed" : "");

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
      pill.textContent = node.worktreePath === mainWorktreePath ? "main worktree" : "checked out";
      meta.appendChild(pill);
    }
    if (node.claim) {
      // Visible in the layout, not just on hover — a recording can't show a hover state.
      const pill = document.createElement("span");
      pill.className = "agent-pill";
      pill.style.borderColor = node.claim.color;
      pill.textContent = node.claim.parentDisplayName
        ? `${node.claim.displayName} · subagent of ${node.claim.parentDisplayName}`
        : `${node.claim.displayName} · ${LAB_LABELS[node.claim.lab] || "Agent"}`;
      meta.appendChild(pill);
    }
    card.appendChild(meta);

    if (node.claim) {
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.style.background = node.claim.color;
      bubble.textContent = initials(node.claim.displayName);
      bubble.title = node.claim.parentDisplayName
        ? `${node.claim.displayName} (subagent of ${node.claim.parentDisplayName}): ${node.claim.reason}`
        : `${node.claim.displayName}: ${node.claim.reason}`;
      // Stagger the float so bubbles on different layers don't bob in lockstep.
      bubble.style.animationDelay = `-${hashFloat(node.claim.displayName) * 3}s`;

      if (node.claim.parentDisplayName) {
        const lineage = document.createElement("div");
        lineage.className = "bubble-parent";
        lineage.style.background = node.claim.parentColor || "#8B8B8B";
        lineage.textContent = initials(node.claim.parentDisplayName);
        bubble.appendChild(lineage);
      }

      card.appendChild(bubble);
    }

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.appendChild(button("Switch to", () => vscode.postMessage({ type: "switchToLayer", branch: node.branch })));
    if (!node.pr) {
      actions.appendChild(
        button("Publish as PR", () => vscode.postMessage({ type: "publishLayer", branch: node.branch }))
      );
    }
    if (node.claim) {
      actions.appendChild(button("Release", () => vscode.postMessage({ type: "releaseLayer", branch: node.branch })));
    } else {
      actions.appendChild(button("Claim", () => vscode.postMessage({ type: "claimLayer", branch: node.branch })));
    }
    actions.appendChild(
      button("New layer on top", () => vscode.postMessage({ type: "createLayer", branch: node.branch }))
    );
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

  function initials(name) {
    return name.slice(0, 2).toUpperCase();
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
