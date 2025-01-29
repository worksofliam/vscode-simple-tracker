// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { TimeManager } from './manager';
import { getGitBranch } from './git';

const tracker = new TimeManager();

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "vscode-simple-tracker" is now active!');

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
	statusBarItem.text = '$(clock) 0';
	statusBarItem.show();

	tracker.changeEvent = (projects) => {
		statusBarItem.text = `$(clock) ${Object.keys(projects).length}`;
	};

	vscode.workspace.workspaceFolders?.forEach((folder) => {
		tracker.startTracking(folder);
	});

	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((e) => {
			const ws = vscode.workspace.getWorkspaceFolder(e.uri);
			if (ws) {
				const branch = getGitBranch(ws);
				if (branch) {
					tracker.addBranch(ws, branch);
				}
			}
		}),
		vscode.workspace.onDidChangeWorkspaceFolders((e) => {
			e.added.forEach((folder) => {
				tracker.startTracking(folder);
			});
			e.removed.forEach((folder) => {
				tracker.endTracking(folder);
			});
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() {
	vscode.workspace.workspaceFolders?.forEach((folder) => {
		tracker.endTracking(folder);
	});
}
