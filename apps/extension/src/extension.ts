import * as vscode from "vscode";
import { StackViewProvider } from "./stackViewProvider";
import { registerCommands } from "./commands";

export function activate(context: vscode.ExtensionContext) {
  const provider = new StackViewProvider(context.extensionUri);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(StackViewProvider.viewType, provider));
  registerCommands(context, provider);
}

export function deactivate() {}
