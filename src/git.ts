import { ExtensionContext, WorkspaceFolder, commands, extensions, window, workspace } from "vscode";
import { API, Branch, GitExtension, Repository } from "./gitApi";
import { TimeManager } from "./manager";

let gitLookedUp: boolean;
let gitAPI: API | undefined;

function getGitAPI(): API | undefined {
  if (!gitLookedUp) {
    try {
      gitAPI = extensions.getExtension<GitExtension>(`vscode.git`)?.exports.getAPI(1);
    }
    catch (error) {
      console.log(`Git extension issue.`, error);
    }
    finally {
      gitLookedUp = true;
    }
  }
  return gitAPI;
}

export function getGitBranch(workspaceFolder: WorkspaceFolder) {
  const gitApi = getGitAPI();
  if (gitApi) {
    const repo = gitApi.getRepository(workspaceFolder.uri);
    if (repo) {
      return repo.state.HEAD?.name;
    }
  }
}
