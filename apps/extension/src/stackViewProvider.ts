import * as vscode from "vscode";
import * as fs from "node:fs";
import { getFullStack, gitCommonDir } from "@stackmaestro/core";

const POLL_INTERVAL_MS = 4000;
const WATCH_DEBOUNCE_MS = 250;

export class StackViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "stackmaestro.stackView";
  private view?: vscode.WebviewView;
  private fsWatcher?: fs.FSWatcher;
  private pollTimer?: ReturnType<typeof setInterval>;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private lastForestJson?: string;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; [key: string]: unknown }) => {
      switch (message.type) {
        case "refresh":
          await this.refresh();
          return;
        case "openPr":
          await vscode.env.openExternal(vscode.Uri.parse(message.url as string));
          return;
        case "switchToLayer":
          await vscode.commands.executeCommand("stackmaestro.switchToLayer", message.branch);
          return;
        case "claimLayer":
          await vscode.commands.executeCommand("stackmaestro.claimLayer", message.branch);
          return;
        case "releaseLayer":
          await vscode.commands.executeCommand("stackmaestro.releaseLayer", message.branch);
          return;
        case "publishLayer":
          await vscode.commands.executeCommand("stackmaestro.publishLayer", message.branch);
          return;
        case "createLayer":
          await vscode.commands.executeCommand("stackmaestro.createLayer", message.branch);
          return;
      }
    });

    webviewView.onDidDispose(() => this.stopWatching());
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
        this.startWatching();
      } else {
        this.stopWatching();
      }
    });

    this.refresh();
    this.startWatching();
  }

  /** Live-updates the view as branches, commits, claims, and PRs change — so the stack visibly comes
   *  together while you (or an agent in another window/worktree) work it, with no manual refresh. */
  private async startWatching() {
    this.stopWatching();
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return;

    try {
      const commonDir = await gitCommonDir(cwd);
      this.fsWatcher = fs.watch(commonDir, { recursive: true }, () => this.scheduleDebouncedRefresh());
    } catch {
      // Fall back to polling below if the platform doesn't support recursive fs.watch.
    }

    // GitHub PR state (and anything a watcher misses, e.g. remote-only changes) only ever
    // changes from our own actions or from the network, so a slow poll is enough as a backstop.
    this.pollTimer = setInterval(() => this.refresh(), POLL_INTERVAL_MS);
  }

  private stopWatching() {
    this.fsWatcher?.close();
    this.fsWatcher = undefined;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
  }

  private scheduleDebouncedRefresh() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.refresh(), WATCH_DEBOUNCE_MS);
  }

  async refresh() {
    if (!this.view) return;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      this.view.webview.postMessage({ type: "error", message: "Open a git repository folder first." });
      return;
    }
    try {
      const forest = await getFullStack(cwd);
      const json = JSON.stringify(forest);
      if (json === this.lastForestJson) return; // nothing changed — don't flicker the view
      this.lastForestJson = json;
      this.view.webview.postMessage({ type: "stack", forest });
    } catch (err) {
      this.view.webview.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "stack.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "stack.css"));
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet" />
</head>
<body>
  <div id="root">Loading stack…</div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
