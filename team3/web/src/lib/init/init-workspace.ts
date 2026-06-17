/**
 * initWorkspace - Initialize a Team3 project workspace directory structure.
 *
 * Creates the following skeleton under `workspacePath`:
 *   spec/app_design.md
 *   spec/actions.jsonl
 *   spec/decision_log.md
 *   cli/  (agent infrastructure scripts)
 *   uat/
 *   logs/
 *   .team3-project.json
 *
 * Idempotent: existing files are never overwritten.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface Team3ProjectJson {
  name: string;
  createdTime: string;
  workspace: string;
  init_workspace: boolean;
  init_daemon: string;
  daemon_heart: string;
  partner: {
    human: {
      name: string;
      avatar: string;
    };
    arch_agent: {
      name: string;
      avatar: string;
      session: {
        runing: string;
      };
    };
    uat_agent: {
      name: string;
      avatar: string;
      session: {
        runing: string;
      };
    };
    dev_agent: {
      name: string;
      avatar: string;
      session: {
        runing: string;
        done: string[];
      };
    };
  };
}

function getToday(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function deriveProjectName(workspacePath: string): string {
  return path.basename(workspacePath) || "unnamed-project";
}

const ARCH_NAMES = ["星图", "蓝图", "棋盘", "罗盘", "望远镜", "灯塔", "指南针", "瞭望塔"];
const DEV_NAMES = ["锤子", "扳手", "齿轮", "焊枪", "电钻", "螺丝刀", "工具箱", "脚手架"];
const UAT_NAMES = ["放大镜", "探针", "显微镜", "雷达", "试金石", "标尺", "天平", "测量仪"];
const HUMAN_NAMES = ["船长", "指挥官", "老板", "掌门人", "领航员", "发令员", "导演", "总指挥"];

const ARCH_ICONS = ["🏛️", "🗺️", "♟️", "🧭", "🔭", "🏗️", "📐", "🌐"];
const DEV_ICONS = ["🔨", "🔧", "⚙️", "🛠️", "💻", "🪛", "🧰", "🏭"];
const UAT_ICONS = ["🔍", "🧪", "🔬", "📡", "✅", "📏", "⚖️", "🎯"];
const HUMAN_ICONS = ["🧑‍✈️", "👨‍💼", "🫡", "🥷", "🧑‍🚀", "🎬", "🦸", "👑"];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildDefaultProjectJson(workspacePath: string): Team3ProjectJson {
  return {
    name: deriveProjectName(workspacePath),
    createdTime: getToday(),
    workspace: workspacePath,
    init_workspace: true,
    init_daemon: "",
    daemon_heart: "",
    partner: {
      human: {
        name: pickRandom(HUMAN_NAMES),
        avatar: pickRandom(HUMAN_ICONS),
      },
      arch_agent: {
        name: pickRandom(ARCH_NAMES),
        avatar: pickRandom(ARCH_ICONS),
        session: {
          runing: "",
        },
      },
      uat_agent: {
        name: pickRandom(UAT_NAMES),
        avatar: pickRandom(UAT_ICONS),
        session: {
          runing: "",
        },
      },
      dev_agent: {
        name: pickRandom(DEV_NAMES),
        avatar: pickRandom(DEV_ICONS),
        session: {
          runing: "",
          done: [],
        },
      },
    },
  };
}

const SKELETON_DIRS: string[] = ["spec", "cli", "uat", "logs"];

const SKELETON_FILES: Record<string, string> = {
  "spec/app_design.md": "# App Design\n\n> Write your product architecture here.\n",
  "spec/actions.jsonl": "",
  "spec/decision_log.md": "# Decision Log\n",
};

const CLI_FILES: string[] = [
  "simulate_human.mjs",
  "logger.mjs",
  "browser.mjs",
  "watchdog.mjs",
  "write-action.mjs",
  "validate-uat-evidence.mjs",
  "init-ui-rules.mjs",
  "init-ui-rules-core.mjs",
];

/**
 * Resolve cli/ source directory.
 * In packaged mode: $TEAM3_PKG_DIR/assets/cli
 * In dev mode: web/ sibling directory ../cli/
 */
function getCliSourceDir(): string {
  if (process.env.TEAM3_PKG_DIR) {
    return path.join(process.env.TEAM3_PKG_DIR, "assets", "cli");
  }
  return path.join(/* turbopackIgnore: true */ process.cwd(), "..", "cli");
}

function writeIfNotExists(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    return;
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * Initialize the workspace at the given path.
 * Idempotent: will not overwrite existing files.
 */
export function initWorkspace(workspacePath: string): void {
  const absPath = path.resolve(workspacePath);
  fs.mkdirSync(absPath, { recursive: true });

  for (const dir of SKELETON_DIRS) {
    fs.mkdirSync(path.join(absPath, dir), { recursive: true });
  }

  for (const [relativePath, content] of Object.entries(SKELETON_FILES)) {
    writeIfNotExists(path.join(absPath, relativePath), content);
  }

  // Copy cli scaffold
  const cliSrc = getCliSourceDir();
  const cliDest = path.join(absPath, "cli");
  for (const file of CLI_FILES) {
    const src = path.join(cliSrc, file);
    const dest = path.join(cliDest, file);
    if (fs.existsSync(src)) {
      writeIfNotExists(dest, fs.readFileSync(src, "utf-8"));
    }
  }

  // Create .team3-project.json
  const projectJsonPath = path.join(absPath, ".team3-project.json");
  if (!fs.existsSync(projectJsonPath)) {
    const projectData = buildDefaultProjectJson(absPath);
    fs.writeFileSync(projectJsonPath, JSON.stringify(projectData, null, 2) + "\n", "utf-8");
  }
}
