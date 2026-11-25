import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("stackmaestro", {
  pickRepo: () => ipcRenderer.invoke("pickRepo"),
  watchRepo: (repoPath: string) => ipcRenderer.invoke("watchRepo", repoPath),
  getStack: (repoPath: string) => ipcRenderer.invoke("getStack", repoPath),
  openExternal: (url: string) => ipcRenderer.invoke("openExternal", url),
  switchToLayer: (repoPath: string, branch: string) => ipcRenderer.invoke("switchToLayer", repoPath, branch),
  claimLayer: (repoPath: string, branch: string, agentName: string, reason: string) =>
    ipcRenderer.invoke("claimLayer", repoPath, branch, agentName, reason),
  releaseLayer: (repoPath: string, branch: string, agentName: string) =>
    ipcRenderer.invoke("releaseLayer", repoPath, branch, agentName),
  createLayer: (repoPath: string, parentBranch: string, branchName: string, title?: string) =>
    ipcRenderer.invoke("createLayer", repoPath, parentBranch, branchName, title),
  publishLayer: (repoPath: string, branch: string) => ipcRenderer.invoke("publishLayer", repoPath, branch),
  planFeature: (
    repoPath: string,
    featureName: string,
    baseBranch: string | undefined,
    layers: { branch: string; title: string; parentBranch?: string }[]
  ) => ipcRenderer.invoke("planFeature", repoPath, featureName, baseBranch, layers),
  registerAgent: (repoPath: string, initialPrompt: string, lab?: string, parentAgentId?: string) =>
    ipcRenderer.invoke("registerAgent", repoPath, initialPrompt, lab, parentAgentId),
  onStackUpdate: (callback: (payload: { ok: boolean; forest?: unknown; error?: string }) => void) => {
    const listener = (_event: unknown, payload: { ok: boolean; forest?: unknown; error?: string }) =>
      callback(payload);
    ipcRenderer.on("stack-update", listener);
    return () => ipcRenderer.removeListener("stack-update", listener);
  },
});
