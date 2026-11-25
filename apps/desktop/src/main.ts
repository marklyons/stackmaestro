import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  claimLayer,
  createLayer,
  fetchDefaultBranch,
  findLayer,
  getFullStack,
  gitCommonDir,
  planFeature,
  publishLayer,
  registerAgent,
  releaseClaim,
  runGit,
  tryRunGit,
  type Lab,
} from "@stackmaestro/core";

let win: BrowserWindow | null = null;
let watcher: fs.FSWatcher | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastForestJson: string | null = null;
let watchedRepoPath: string | null = null;

const POLL_INTERVAL_MS = 4000;
const WATCH_DEBOUNCE_MS = 250;
const ICON_PATH = path.join(__dirname, "..", "build", "icon-1024.png");

if (process.platform === "darwin" && fs.existsSync(ICON_PATH)) {
  app.dock?.setIcon(ICON_PATH);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#1e1e1e",
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  stopWatching();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function stopWatching() {
  watcher?.close();
  watcher = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  watchedRepoPath = null;
  lastForestJson = null;
}

async function pushStackUpdate(repoPath: string) {
  if (!win || win.isDestroyed()) return;
  try {
    const forest = await getFullStack(repoPath);
    const json = JSON.stringify(forest);
    if (json === lastForestJson) return;
    lastForestJson = json;
    win.webContents.send("stack-update", { ok: true, forest });
  } catch (err) {
    win.webContents.send("stack-update", { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function scheduleDebouncedUpdate(repoPath: string) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => pushStackUpdate(repoPath), WATCH_DEBOUNCE_MS);
}

ipcMain.handle("pickRepo", async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("watchRepo", async (_event, repoPath: string) => {
  stopWatching();
  watchedRepoPath = repoPath;

  try {
    const commonDir = await gitCommonDir(repoPath);
    watcher = fs.watch(commonDir, { recursive: true }, () => scheduleDebouncedUpdate(repoPath));
  } catch {
    // Fall back to polling alone if recursive fs.watch isn't supported on this platform.
  }
  pollTimer = setInterval(() => pushStackUpdate(repoPath), POLL_INTERVAL_MS);
  await pushStackUpdate(repoPath);
});

ipcMain.handle("getStack", async (_event, repoPath: string) => {
  try {
    return { ok: true, forest: await getFullStack(repoPath) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("openExternal", async (_event, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("switchToLayer", async (_event, repoPath: string, branch: string) => {
  try {
    const current = await tryRunGit(["branch", "--show-current"], repoPath);
    if (current === branch) return { ok: true, alreadyOn: true };
    await runGit(["checkout", branch], repoPath);
    if (watchedRepoPath === repoPath) await pushStackUpdate(repoPath);
    return { ok: true, alreadyOn: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
});

ipcMain.handle(
  "claimLayer",
  async (_event, repoPath: string, branch: string, agentName: string, reason: string) => {
    try {
      const claim = await claimLayer(repoPath, branch, { agentName }, reason);
      if (watchedRepoPath === repoPath) await pushStackUpdate(repoPath);
      return { ok: true, claim };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
);

ipcMain.handle("releaseLayer", async (_event, repoPath: string, branch: string, agentName: string) => {
  try {
    await releaseClaim(repoPath, branch, agentName);
    if (watchedRepoPath === repoPath) await pushStackUpdate(repoPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle(
  "createLayer",
  async (_event, repoPath: string, parentBranch: string, branchName: string, title: string | undefined) => {
    try {
      await createLayer(repoPath, parentBranch, branchName, title);
      if (watchedRepoPath === repoPath) await pushStackUpdate(repoPath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
);

ipcMain.handle("publishLayer", async (_event, repoPath: string, branch: string) => {
  try {
    const forest = await getFullStack(repoPath);
    const node = findLayer(forest.roots, branch);
    if (!node) return { ok: false, error: `No layer named "${branch}" found.` };
    const pr = await publishLayer(repoPath, node);
    if (watchedRepoPath === repoPath) await pushStackUpdate(repoPath);
    return { ok: true, pr };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle(
  "planFeature",
  async (
    _event,
    repoPath: string,
    featureName: string,
    baseBranch: string | undefined,
    layers: { branch: string; title: string; parentBranch?: string }[]
  ) => {
    try {
      const trunk = baseBranch ?? (await fetchDefaultBranch(repoPath));
      const result = await planFeature(repoPath, featureName, trunk, layers);
      if (watchedRepoPath === repoPath) await pushStackUpdate(repoPath);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
);

ipcMain.handle(
  "registerAgent",
  async (
    _event,
    repoPath: string,
    initialPrompt: string,
    lab: string | undefined,
    parentAgentId: string | undefined
  ) => {
    try {
      const agent = await registerAgent(repoPath, { initialPrompt, lab: lab as Lab | undefined, parentAgentId });
      return { ok: true, agent };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
);
