(function () {
  const RECENTS_KEY = "stackmaestro.recentRepos";
  const LAB_LABELS = {
    anthropic: "Claude",
    openai: "OpenAI",
    google: "Gemini",
    meta: "Llama",
    xai: "Grok",
    mistral: "Mistral",
    unknown: "Agent",
  };

  const launcherEl = document.getElementById("launcher");
  const appEl = document.getElementById("app");
  const openRepoBtn = document.getElementById("open-repo-btn");
  const changeRepoBtn = document.getElementById("change-repo-btn");
  const recentListEl = document.getElementById("recent-list");
  const topbarRepoEl = document.getElementById("topbar-repo");
  const topbarStatusEl = document.getElementById("topbar-status");
  const boardEl = document.getElementById("board");

  let currentRepoPath = null;
  let unsubscribe = null;

  // ---------- Recent repos (local convenience only, not synced anywhere) ----------

  function getRecents() {
    try {
      return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function addRecent(repoPath) {
    try {
      const recents = [repoPath, ...getRecents().filter((p) => p !== repoPath)].slice(0, 8);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
    } catch {
      // Private window / blocked storage — recents just won't persist, not fatal.
    }
  }

  function renderRecents() {
    recentListEl.innerHTML = "";
    for (const repoPath of getRecents()) {
      const item = document.createElement("div");
      item.className = "recent-item";
      item.textContent = repoPath;
      item.title = repoPath;
      item.onclick = () => openRepo(repoPath);
      recentListEl.appendChild(item);
    }
  }

  // ---------- Repo selection ----------

  openRepoBtn.onclick = async () => {
    const repoPath = await window.stackmaestro.pickRepo();
    if (repoPath) openRepo(repoPath);
  };

  changeRepoBtn.onclick = () => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    currentRepoPath = null;
    appEl.hidden = true;
    launcherEl.hidden = false;
    renderRecents();
  };

  async function openRepo(repoPath) {
    currentRepoPath = repoPath;
    addRecent(repoPath);
    launcherEl.hidden = true;
    appEl.hidden = false;
    topbarRepoEl.textContent = repoPath;
    topbarStatusEl.textContent = "loading…";
    boardEl.innerHTML = "";

    if (unsubscribe) unsubscribe();
    unsubscribe = window.stackmaestro.onStackUpdate((payload) => {
      topbarStatusEl.textContent = "live";
      if (payload.ok) render(payload.forest);
      else renderError(payload.error);
    });
    await window.stackmaestro.watchRepo(repoPath);
  }

  renderRecents();

  // ---------- Modal (text prompt replacement) ----------

  const modalOverlay = document.getElementById("modal-overlay");
  const modalLabel = document.getElementById("modal-label");
  const modalInput = document.getElementById("modal-input");
  const modalOk = document.getElementById("modal-ok");
  const modalCancel = document.getElementById("modal-cancel");

  function ask(label, defaultValue) {
    return new Promise((resolve) => {
      modalLabel.textContent = label;
      modalInput.value = defaultValue || "";
      modalOverlay.hidden = false;
      modalInput.focus();

      function cleanup(value) {
        modalOverlay.hidden = true;
        modalOk.onclick = null;
        modalCancel.onclick = null;
        modalInput.onkeydown = null;
        resolve(value);
      }

      modalOk.onclick = () => cleanup(modalInput.value.trim() || null);
      modalCancel.onclick = () => cleanup(null);
      modalInput.onkeydown = (e) => {
        if (e.key === "Enter") cleanup(modalInput.value.trim() || null);
        if (e.key === "Escape") cleanup(null);
      };
    });
  }

  // ---------- Stack rendering (same visual language as the Cursor/VS Code sidebar,
  //            laid out as horizontally-scrollable columns instead of one vertical list —
  //            built for a wide window where several stacks can sit side by side) ----------

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

  function sharedFeature(nodesTipFirst) {
    const first = nodesTipFirst[0]?.feature;
    if (!first) return null;
    return nodesTipFirst.every((n) => n.feature === first) ? first : null;
  }

  function render(forest) {
    boardEl.innerHTML = "";

    if (!forest.roots || forest.roots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No layers yet in this repo.";
      boardEl.appendChild(empty);
      return;
    }

    const chains = toChains(forest.roots);
    for (const chain of chains) {
      boardEl.appendChild(renderColumn([...chain].reverse(), forest.mainWorktreePath, forest.trunk));
    }
  }

  function renderError(message) {
    boardEl.innerHTML = "";
    const err = document.createElement("div");
    err.className = "error";
    err.textContent = message;
    boardEl.appendChild(err);
  }

  function renderColumn(nodesTipFirst, mainWorktreePath, trunk) {
    const column = document.createElement("div");
    column.className = "stack-column";

    const feature = sharedFeature(nodesTipFirst);
    if (feature) {
      const published = nodesTipFirst.filter((n) => n.pr).length;
      const header = document.createElement("div");
      header.className = "feature-header";
      header.innerHTML =
        `<span class="feature-icon">◆</span><span class="feature-name">${escapeHtml(feature)}</span>` +
        `<span class="feature-progress">${published}/${nodesTipFirst.length} published</span>`;
      column.appendChild(header);
    }

    const chain = document.createElement("div");
    chain.className = "chain";
    const total = nodesTipFirst.length;

    nodesTipFirst.forEach((node, i) => {
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
    column.appendChild(chain);
    return column;
  }

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
      pill.onclick = () => window.stackmaestro.openExternal(node.pr.url);
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
    if (node.claim) {
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

    actions.appendChild(
      button("Switch to", async () => {
        const result = await window.stackmaestro.switchToLayer(currentRepoPath, node.branch);
        if (!result.ok) alert(result.error);
      })
    );

    if (!node.pr) {
      actions.appendChild(
        button("Publish as PR", async () => {
          const result = await window.stackmaestro.publishLayer(currentRepoPath, node.branch);
          if (!result.ok) alert(result.error);
        })
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

  function initials(name) {
    return name.slice(0, 2).toUpperCase();
  }

  function basename(filePath) {
    return filePath.split("/").filter(Boolean).pop() || filePath;
  }

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
})();
