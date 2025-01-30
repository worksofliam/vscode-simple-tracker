import { readFile, writeFile } from "fs/promises";
import path from "path";
import { env } from "process";
import { WorkspaceFolder } from "vscode";

export interface TrackerDetails {
  branches: string[];
  seconds: number;
}

interface DayData {
  projects: {
    [project: string]: TrackerDetails;
  }
  saves: {
    [ext: string]: number
  }
}

type SchemaVersion = "v1";
const CURRENT_SCHEMA_VERSION: SchemaVersion = `v1`;
interface TrackerFile {
  version: SchemaVersion;
  days: {[date: string]: DayData}
}

export type ActiveProjectList = { [id: string]: Date };

const TRACKER_FILE = path.join(env.HOME || ".", `.vscode-tracker-${new Date().getFullYear()}.json`);

function secondsSize(pastTime: Date) {
  return (new Date().getTime() - pastTime.getTime()) / 1000;
}

function dateString(minusDays = 0) {
  // get dd/mm/yyyy
  const specificDate = new Date();
  specificDate.setDate(specificDate.getDate() - minusDays);
  return `${specificDate.getDate()}/${specificDate.getMonth()+1}/${specificDate.getFullYear()}`;
}

export class TimeManager {
  private store: TrackerFile = {version: "v1", days: {}};
  private activeProjects: ActiveProjectList = {};

	getTracking() {
		return Object.keys(this.activeProjects);
	}

  async load() {
    // load from file

    try {
      const contents = await readFile(TRACKER_FILE, "utf-8");
      this.store = JSON.parse(contents);

      if (this.store.version !== CURRENT_SCHEMA_VERSION) {
        for (const day in this.store) {
          this.validateDaySchema(day, {all: true});
        }
      }
    } catch (error) {
      console.error("Failed to load tracker file", error);
    }
  }

  public save() {
    // save to file
    const contents = JSON.stringify(this.store);
    return writeFile(TRACKER_FILE, contents, "utf-8");
  }

  /**
   * Returns time and branches worked on for a specific branch over a certain amount of days
   */
  public getStatsForPeriod(project: string, days: number): TrackerDetails {
    const dayKeys = this.getDays(days);
    const stats: TrackerDetails = { seconds: 0, branches: [] };

    for (const day of dayKeys) {
      const dayStats = this.getStats(day);
      if (dayStats && dayStats.projects[project]) {
        stats.seconds += dayStats.projects[project].seconds;

        if (dayStats.projects[project].branches) {
          stats.branches = [...new Set([...(stats.branches!), ...dayStats.projects[project].branches])];
        }
      }
    }

    return stats;
  }

  /**
   * Gets data for a specific day
   */
  public getStats(day: string): DayData|undefined {
    // TODO: honestly is there a better way to deep clone?
    if (this.store.days[day]) {
      const storedStats: DayData = JSON.parse(JSON.stringify(this.store.days[day]));

      if (day === dateString()) {
        for (const wsName in storedStats.projects) {
          const activeProjectStarted = this.activeProjects[wsName];
          if (activeProjectStarted) {
            const secondsSinceThen = secondsSize(activeProjectStarted);
            storedStats.projects[wsName].seconds += secondsSinceThen;
          }
        }
      }

      return storedStats;
    }
  }

  /**
   * Gets days where data is available
   */
  public getDays(lastAmount?: number) {
    if (lastAmount) {
      let dayKeys = [];
      for (let i = 0; i < lastAmount; i++) {
        let key = dateString(i);
        dayKeys.push(key);
      }
      return dayKeys;

    } else {
      return Object.keys(this.store).reverse();
    }
  }

  startTracking(ws: WorkspaceFolder) {
    this.activeProjects[ws.name] = new Date();
  }
  
  private validateDaySchema(chosenDay: string, project: { id?: string, all?: boolean } = {}) {
    if (!this.store.days[chosenDay]) {
      this.store.days[chosenDay] = { projects: {}, saves: {} };
    }

    if (!this.store.days[chosenDay].projects) {
      this.store.days[chosenDay].projects = {};
    }

    if (!this.store.days[chosenDay].saves) {
      this.store.days[chosenDay].saves = {};
    }

    const fixProject = (id: string) => {
      if (this.store.days[chosenDay].projects[id]) {
        if (!this.store.days[chosenDay].projects[id].branches) {
          this.store.days[chosenDay].projects[id].branches = [];
        }

        if (!this.store.days[chosenDay].projects[id].seconds) {
          this.store.days[chosenDay].projects[id].seconds = 0;
        }

      } else {
        this.store.days[chosenDay].projects[id] = { seconds: 0, branches: [] };
      }
    };

    if (project.id) {
      fixProject(project.id);
    } else if (project.all) {
      for (const id in this.store.days[chosenDay].projects) {
        fixProject(id);
      }
    }
  }

  private updateDetails(projectId: string, details: Partial<TrackerDetails>) {
    const ADD_PROPS = [`seconds`];
    const today = dateString();
    
    this.validateDaySchema(today, {id: projectId});

    const existingData: any = this.store.days[today].projects[projectId];

    for (const key in details) {
      if (Array.isArray((details as any)[key])) {
        // Merge
        existingData[key] = [...new Set([...(existingData[key] || []), ...(details as any)[key]])];
      } else {
        if (ADD_PROPS.includes(key)) {
          existingData[key] += (details as any)[key];
        } else {
          existingData[key] = (details as any)[key];
        }
      }
    }
  }

  addBranch(ws: WorkspaceFolder, branch: string) {
    this.updateDetails(ws.name, { branches: [branch] });
  }

  addSave(ext: string) {
    const today = dateString();
    
    this.validateDaySchema(today);

    if (!this.store.days[today].saves[ext]) {
      this.store.days[today].saves[ext] = 0;
    }

    this.store.days[today].saves[ext]++;
  }

  public updateAllDaySeconds() {
    for (const wsName in this.activeProjects) {
      this.updateDaySeconds(wsName);
    }
  }

  private updateDaySeconds(specificProject: string) {
    const start = this.activeProjects[specificProject];
    if (!start) { return; }

    let seconds = Math.max(0, secondsSize(start));

    this.updateDetails(specificProject, { seconds });

    this.activeProjects[specificProject] = new Date();
  }

  endTracking(ws: WorkspaceFolder) {
    this.updateDaySeconds(ws.name);

    delete this.activeProjects[ws.name];
  }
}