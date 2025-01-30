import { readFile, writeFile } from "fs/promises";
import path from "path";
import { env } from "process";
import { WorkspaceFolder } from "vscode";

export interface TrackerDetails {
  branches: string[];
  tasks: number;
  debugs: number;
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

type SchemaVersion = "v1"|"v2";
const CURRENT_SCHEMA_VERSION: SchemaVersion = `v2`;
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
  private store: TrackerFile = {version: CURRENT_SCHEMA_VERSION, days: {}};
  private activeProjects: ActiveProjectList = {};

	getTracking() {
		return Object.keys(this.activeProjects);
	}

  async load() {
    try {
      const contents = await readFile(TRACKER_FILE, "utf-8");
      this.store = JSON.parse(contents);

      // If we need to make changes to the schema...
      if (this.store.version !== CURRENT_SCHEMA_VERSION) {
        for (const day in this.store.days) {
          this.validateDaySchema(day, {all: true});
        }

        this.store.version = CURRENT_SCHEMA_VERSION;
      }
    } catch (error) {
      console.log("Failed to load tracker file", error);
    }
  }

  /**
   * Reloads the tracker file and merges the data with the current store
   * and then saves it back to the file
   */
  async checkForChanges() {
    const loadedContents = await readFile(TRACKER_FILE, "utf-8");
    const loadedStore = JSON.parse(loadedContents);

    const today = dateString();
    
    if (!this.store.days[today] || !loadedStore.days || !loadedStore.days[today]) {
      return;
    }

    let updatedProjects: {[id: string]: TrackerDetails} = loadedStore.days[today].projects;

    for (const pid of Object.keys(this.activeProjects)) {
      if (this.store.days[today].projects[pid]) {
        updatedProjects[pid] = this.store.days[today].projects[pid];
      }
    }
    
    this.store.days[today].projects = updatedProjects;
  }

  public async save() {
    await this.checkForChanges();
    const contents = JSON.stringify(this.store, null, 2);
    return await writeFile(TRACKER_FILE, contents, "utf-8");
  }

  /**
   * Returns time and branches worked on for a specific branch over a certain amount of days
   */
  public getStatsForPeriod(project: string, days: number): TrackerDetails {
    const dayKeys = this.getDays(days);
    const stats: TrackerDetails = { seconds: 0, branches: [], tasks: 0, debugs: 0 };

    for (const day of dayKeys) {
      const dayStats = this.getStats(day);
      if (dayStats && dayStats.projects[project]) {
        stats.seconds += dayStats.projects[project].seconds;

        if (dayStats.projects[project].branches) {
          stats.branches = [...new Set([...(stats.branches!), ...dayStats.projects[project].branches])];
        }

        stats.tasks += dayStats.projects[project].tasks;
        stats.debugs += dayStats.projects[project].debugs;
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

  endTracking(ws: WorkspaceFolder) {
    this.updateDaySeconds(ws.name);

    delete this.activeProjects[ws.name];
  }
  
  /**
   * Used to ensure the schema is correct for a specific day
   */
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

        if (!this.store.days[chosenDay].projects[id].tasks) {
          this.store.days[chosenDay].projects[id].tasks = 0;
        }

        if (!this.store.days[chosenDay].projects[id].debugs) {
          this.store.days[chosenDay].projects[id].debugs = 0;
        }

      } else {
        this.store.days[chosenDay].projects[id] = { seconds: 0, branches: [], tasks: 0, debugs: 0 };
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

  /**
   * Change specific properties for a project for today
   */
  private updateDetails(projectId: string, details: Partial<TrackerDetails>) {
    const ADD_PROPS: (keyof TrackerDetails)[] = [`seconds`, `tasks`, `debugs`];
    const today = dateString();
    
    this.validateDaySchema(today, {id: projectId});

    const existingData: any = this.store.days[today].projects[projectId];

    for (const key in details) {
      if (Array.isArray((details as any)[key])) {
        // Merge
        existingData[key] = [...new Set([...(existingData[key] || []), ...(details as any)[key]])];
      } else {
        if (ADD_PROPS.includes(key as keyof TrackerDetails)) {
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

  incrementTasks(ws: WorkspaceFolder) {
    this.updateDetails(ws.name, { tasks: 1 });
  }

  incrementDebugs(ws: WorkspaceFolder) {
    this.updateDetails(ws.name, { debugs: 1 });
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
}