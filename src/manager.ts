import { mkdir, readFile, writeFile } from "fs/promises";
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

type SchemaVersion = "v1" | "v2";
const CURRENT_SCHEMA_VERSION: SchemaVersion = `v1`;
interface TrackerFile {
  version: SchemaVersion;
  day: DayData
}

export type ActiveProjectList = { [id: string]: Date };
interface ProjectFilter { id?: string, all?: boolean };

const TRACKER_DIR = path.join(env.HOME || ".", ".vscode-tracker");

function secondsSize(pastTime: Date) {
  return (new Date().getTime() - pastTime.getTime()) / 1000;
}

function dateString(minusDays = 0) {
  // get dd/mm/yyyy
  const specificDate = new Date();
  specificDate.setDate(specificDate.getDate() - minusDays);
  return `${specificDate.getDate()}-${specificDate.getMonth() + 1}-${specificDate.getFullYear()}`;
}

class DayManager {
  private exists = false;
  private filePath: string;
  private store: TrackerFile = { version: CURRENT_SCHEMA_VERSION, day: { projects: {}, saves: {} } };
  constructor(dateString: string) {
    this.filePath = path.join(TRACKER_DIR, `.vscode-tracker-${dateString}.json`);
  }

  public get stats(): DayData|undefined {
    return this.store.day;
  }

  public get doesExist() {
    return this.exists;
  }

  async load() {
    try {
      const contents = await readFile(this.filePath, "utf-8");
      this.store = JSON.parse(contents);

      // If we need to make changes to the schema...
      if (this.store.version !== CURRENT_SCHEMA_VERSION) {
        DayManager.validateDaySchema(this.store.day, { all: true });

        this.store.version = CURRENT_SCHEMA_VERSION;
      }

      this.exists = true;
    } catch (error) {
      // console.log("Failed to load tracker file", error);
      this.exists = false;
    }
  }

  public async save(activeProjects: ActiveProjectList) {
    await this.checkForChanges(activeProjects);
    const contents = JSON.stringify(this.store, null, 2);
    this.exists = true;
    return await writeFile(this.filePath, contents, "utf-8");
  }

  /**
 * Reloads the tracker file and merges the data with the current store
 * and then saves it back to the file
 */
  async checkForChanges(activeProjects: ActiveProjectList) {
    let loadedContents: string|undefined;
    try {
      loadedContents = await readFile(this.filePath, "utf-8");
    } catch (e) {
      loadedContents = undefined;
    }

    if (!loadedContents) {
      return;
    }

    const loadedStore = JSON.parse(loadedContents);

    if (!this.store.day || !loadedStore.day) {
      return;
    }

    let updatedProjects: { [id: string]: TrackerDetails } = loadedStore.day.projects;

    for (const pid of Object.keys(activeProjects)) {
      if (this.store.day.projects[pid]) {
        updatedProjects[pid] = this.store.day.projects[pid];
      }
    }

    this.store.day.projects = updatedProjects;
  }

  /**
   * Change specific properties for a project for today
   */
  public updateDetails(projectId: string, details: Partial<TrackerDetails>) {
    const ADD_PROPS: (keyof TrackerDetails)[] = [`seconds`, `tasks`, `debugs`];
    const today = dateString();

    this.validate({ id: projectId });

    const existingProjects: any = this.store.day.projects[projectId];

    for (const key in details) {
      if (Array.isArray((details as any)[key])) {
        // Merge
        existingProjects[key] = [...new Set([...(existingProjects[key] || []), ...(details as any)[key]])];
      } else {
        if (ADD_PROPS.includes(key as keyof TrackerDetails)) {
          existingProjects[key] += (details as any)[key];
        } else {
          existingProjects[key] = (details as any)[key];
        }
      }
    }
  }

  addSave(ext: string) {
    this.validate();

    if (!this.store.day.saves[ext]) {
      this.store.day.saves[ext] = 0;
    }

    this.store.day.saves[ext]++;
  }

  validate(project?: ProjectFilter) {
    DayManager.validateDaySchema(this.store.day, project);
  }

  /**
   * Used to ensure the schema is correct for a specific day
   */
  private static validateDaySchema(dayObj: DayData, project: ProjectFilter = {}) {
    if (!dayObj.projects) {
      dayObj.projects = {};
    }

    if (!dayObj.saves) {
      dayObj.saves = {};
    }

    const fixProject = (id: string) => {
      if (dayObj.projects[id]) {
        if (!dayObj.projects[id].branches) {
          dayObj.projects[id].branches = [];
        }

        if (!dayObj.projects[id].seconds) {
          dayObj.projects[id].seconds = 0;
        }

        if (!dayObj.projects[id].tasks) {
          dayObj.projects[id].tasks = 0;
        }

        if (!dayObj.projects[id].debugs) {
          dayObj.projects[id].debugs = 0;
        }

      } else {
        dayObj.projects[id] = { seconds: 0, branches: [], tasks: 0, debugs: 0 };
      }
    };

    if (project.id) {
      fixProject(project.id);
    } else if (project.all) {
      for (const id in dayObj.projects) {
        fixProject(id);
      }
    }
  }
}

export class TimeManager {
  private days: { [day: string]: DayManager } = {};
  private activeProjects: ActiveProjectList = {};

  private get today() {
    return this.days[dateString()];
  }

  getTracking() {
    return Object.keys(this.activeProjects);
  }

  async load() {
    await mkdir(TRACKER_DIR, { recursive: true });

    const today = dateString();
    const todayManager = new DayManager(today);
    await todayManager.load();
    this.days[today] = todayManager;
  }

  public async save() {
    const today = dateString();
    const todayManager = this.days[today];
    if (!todayManager) {
      return;
    }

    await todayManager.save(this.activeProjects);
  }

  /**
   * Returns time and branches worked on for a specific branch over a certain amount of days
   */
  public async getStatsForPeriod(project: string, days: number): Promise<TrackerDetails> {
    const dayKeys = this.getDays(days);
    const stats: TrackerDetails = { seconds: 0, branches: [], tasks: 0, debugs: 0 };

    for (const day of dayKeys) {
      const dayStats = await this.getStats(day);
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
  public async getStats(day: string): Promise<DayData | undefined> {
    if (!this.days[day]) {
      this.days[day] = new DayManager(day);
      await this.days[day].load();
    }

    if (this.days[day] && this.days[day].doesExist) {
      const storedStats: DayData = JSON.parse(JSON.stringify(this.days[day].stats));

      return storedStats;
    }
  }

  /**
   * Gets days where data is available
   */
  public getDays(lastAmount: number) {
    let dayKeys = [];
    for (let i = 0; i < lastAmount; i++) {
      let key = dateString(i);
      dayKeys.push(key);
    }
    return dayKeys;
  }

  startTracking(ws: WorkspaceFolder) {
    this.activeProjects[ws.name] = new Date();
  }

  endTracking(ws: WorkspaceFolder) {
    this.updateDaySeconds(ws.name);

    delete this.activeProjects[ws.name];
  }

  addBranch(ws: WorkspaceFolder, branch: string) {
    this.today.updateDetails(ws.name, { branches: [branch] });
  }

  incrementTasks(ws: WorkspaceFolder) {
    this.today.updateDetails(ws.name, { tasks: 1 });
  }

  incrementDebugs(ws: WorkspaceFolder) {
    this.today.updateDetails(ws.name, { debugs: 1 });
  }

  addSave(ext: string) {
    this.today.addSave(ext);
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

    this.today.updateDetails(specificProject, { seconds });

    this.activeProjects[specificProject] = new Date();
  }
}