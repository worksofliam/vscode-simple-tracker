import { readFile, writeFile } from "fs/promises";
import path from "path";
import { env } from "process";
import { WorkspaceFolder } from "vscode";

interface OptionalTrackerDetails {
  branches?: string[];
}

interface TrackerDetails extends OptionalTrackerDetails {
  seconds: number;
}

interface TrackerFile {
  [date: string]: {
    projects: {
      [project: string]: TrackerDetails;
    }
  }
}

export type ActiveProjectList = {[id: string]: Date};
const TRACKER_FILE = path.join(env.HOME || ".", ".vscode-tracker.json");

export class TimeManager {
  private store: TrackerFile = {};
  private activeProjects: ActiveProjectList = {};

  changeEvent?: (projects: ActiveProjectList) => void;

  async load() {
    // load from file
    
    try {
      const contents = await readFile(TRACKER_FILE, "utf-8");
      this.store = JSON.parse(contents);
    } catch (error) {
      console.error("Failed to load tracker file", error);
    }
  }

  private save() {
    // save to file
    const contents = JSON.stringify(this.store, null, 2);
    return writeFile(TRACKER_FILE, contents, "utf-8");
  }

  private trigger() {
    if (this.changeEvent) {
      this.changeEvent(this.activeProjects);
    }
  }

  private dateString() {
    // get dd/mm/yyyy
    const now = new Date();
    return `${now.getDate()}/${now.getMonth()}/${now.getFullYear()}`;
  }

  startTracking(ws: WorkspaceFolder) {
    this.activeProjects[ws.name] = new Date();

    this.trigger();
  }

  private getProjectDetails(ws: WorkspaceFolder): OptionalTrackerDetails {
    const today = this.dateString();
    
    if (this.store[today] && this.store[today].projects[ws.name]) {
      return this.store[today].projects[ws.name];
    }

    return {};
  }

  private updateDetails(ws: WorkspaceFolder, details: OptionalTrackerDetails) {
    const today = this.dateString();
    if (!this.store[today]) {
      this.store[today] = { projects: {} };
    }

    const existingData = this.store[today].projects[ws.name] || { seconds: 0 };

    this.store[today].projects[ws.name] = {
      ...existingData,
      ...details
    };
  }

  addBranch(ws: WorkspaceFolder, branch: string) {
    const details = this.getProjectDetails(ws);
    if (!details.branches) {
      details.branches = [];
    }

    if (details.branches.includes(branch)) {return;}

    details.branches.push(branch);
    this.updateDetails(ws, details);
  }

  endTracking(ws: WorkspaceFolder) {
    const start = this.activeProjects[ws.name];
    if (!start) {return;}

    let seconds = Math.max(0, (new Date().getTime() - start.getTime()) / 1000);

    const today = this.dateString();
    if (!this.store[today]) {
      this.store[today] = { projects: {} };
    }

    if (!this.store[today].projects[ws.name]) {
      this.store[today].projects[ws.name] = { seconds: 0 };
    }

    this.store[today].projects[ws.name].seconds += seconds;

    delete this.activeProjects[ws.name];
    this.trigger();

    this.save();
  }
}