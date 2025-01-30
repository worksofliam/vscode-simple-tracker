// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { TimeManager, TrackerDetails } from './manager';
import { getGitBranch } from './git';
import path from 'path';

let tracker: TimeManager;
let updateInterval: NodeJS.Timeout;

const HALF_MINUTE = 30 * 1000;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "vscode-simple-tracker" is now active!');

	tracker = new TimeManager();
	await tracker.load();

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);

	const updateStats = () => {
		const md = getStatsMd();
		statusBarItem.tooltip = md;
	};

	if (vscode.workspace.workspaceFolders) {
		statusBarItem.text = `$(clock) ${vscode.workspace.workspaceFolders.length}`;
		statusBarItem.show();

		updateInterval = setInterval(() => {
			statusBarItem.text = `$(clock) ${tracker.getTracking().length}`;
			tracker.updateAllDaySeconds();

			updateStats();
	
			// Let's do a backup save!
			tracker.save();
		}, HALF_MINUTE);

		vscode.workspace.workspaceFolders.forEach((folder) => {
			tracker.startTracking(folder);
		});
	}

	context.subscriptions.push(
		{dispose: () => {
			clearInterval(updateInterval);
		}},
		statusBarItem,

		// Branch and extension tracking
		vscode.workspace.onDidSaveTextDocument((e) => {
			const ws = vscode.workspace.getWorkspaceFolder(e.uri);
			if (ws) {
				const branch = getGitBranch(ws);
				if (branch) {
					tracker.addBranch(ws, branch);
				}
			}

			tracker.addSave(path.extname(e.fileName));
		}),

		// Workspace tracker
		vscode.workspace.onDidChangeWorkspaceFolders((e) => {
			e.added.forEach((folder) => {
				tracker.startTracking(folder);
			});
			e.removed.forEach((folder) => {
				tracker.endTracking(folder);
			});
		}),

		// Tasks executed
		vscode.tasks.onDidStartTask(e => {
			if (e.execution.task.scope) {
				const scope = e.execution.task.scope;
				if (typeof scope === `object`) {
					tracker.incrementTasks(scope);
				}
			}
		}),

		// Debug tracking
		vscode.debug.onDidStartDebugSession(e => {
			if (e.workspaceFolder) {
				tracker.incrementDebugs(e.workspaceFolder);
			}
		}),
	);
}

// This method is called when your extension is deactivated
export async function deactivate() {
	if (tracker) {
		// It's too risky having the save it. It half writes and then the process cuts it off.

		// vscode.workspace.workspaceFolders?.forEach((folder) => {
		// 	tracker.endTracking(folder);
		// });

		// await tracker.save();
	}
}

function getStatsMd() {
	const projectIds = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.map((f) => f.name) : [];

	let markdown: string[] = [];

	projectIds.forEach((id, i) => {
		const today = tracker.getStatsForPeriod(id, 1);
		const week = tracker.getStatsForPeriod(id, 7);

		markdown.push(
			`### ${id}`,
			``,
			`#### Today`,
			``,
			`* $(history) ${formatSeconds(today.seconds)}`,
			...(today.branches!.length ? [`* $(git-branch) worked on ${today.branches!.join(", ")}`] : []),
			``,
			`#### This Week`,
			``,
			`* $(history) ${formatSeconds(week.seconds)}`,
			...(week.branches!.length ? [`* $(git-branch) worked on ${week.branches!.join(", ")}`] : [])
		);

		if (i < projectIds.length - 1) {
			markdown.push(
				``,
				`---`,
				``
			);
		}
	});

	const md = new vscode.MarkdownString(markdown.join("\n"));
	md.supportThemeIcons = true;
	return md;
}

function formatSeconds(seconds: number) {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return `${hours}h ${minutes}m`;
}