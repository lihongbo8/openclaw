import { t } from "../i18n/index.ts";
import type { IconName } from "./icons.js";
import { normalizeLowercaseStringOrEmpty } from "./string-coerce.ts";

export type Tab =
  | "aics"
  | "apiManagement"
  | "agents"
  | "activity"
  | "overview"
  | "businessOverview"
  | "workboard"
  | "channels"
  | "instances"
  | "sessions"
  | "usage"
  | "cron"
  | "skills"
  | "reviewCenter"
  | "skillWorkshop"
  | "nodes"
  | "chat"
  | "config"
  | "communications"
  | "appearance"
  | "automation"
  | "mcp"
  | "infrastructure"
  | "aiAgents"
  | "debug"
  | "logs"
  | "dreams"
  | "goals"
  | "company"
  | "projects"
  | "observation"
  | "attribution";

const PRIMARY_NAV_TABS = [
  "chat",
  "businessOverview",
  "observation",
  "attribution",
  "goals",
  "company",
  "workboard",
  "aics",
  "skills",
  "reviewCenter",
  "apiManagement",
  "usage",
  "sessions",
  "dreams",
  "config",
] as const satisfies readonly Tab[];

const SETTINGS_GENERAL_TABS = ["appearance"] as const satisfies readonly Tab[];

export const TAB_GROUPS = [{ label: "main", tabs: PRIMARY_NAV_TABS }] as const;

export const SETTINGS_NAV_GROUPS = [{ label: "Settings", tabs: SETTINGS_GENERAL_TABS }] as const;

export const SETTINGS_TABS = [...SETTINGS_GENERAL_TABS] as const satisfies readonly Tab[];

export const BUYER_STOREFRONT_URL = "http://127.0.0.1:3026/us";

const DISPLAY_TAB_TITLES: Partial<Record<Tab, string>> = {
  chat: "迭界AI",
  businessOverview: "经营概览",
  observation: "数据分析",
  attribution: "归因分析",
  goals: "公司目标",
  company: "规划方案",
  aics: "岗位执行",
  workboard: "任务调度",
  apiManagement: "API 管理",
  dreams: "记忆与进化",
  usage: "费用与授权",
  skills: "工具与 Skill",
  reviewCenter: "审核中心",
  sessions: "对话记录",
  config: "Settings",
  channels: "渠道",
  communications: "通信",
  appearance: "Appearance",
  automation: "自动化",
  mcp: "MCP",
  infrastructure: "基础设施",
  aiAgents: "AI 与代理",
  agents: "代理",
  skillWorkshop: "技能工坊",
  nodes: "节点",
  cron: "定时任务",
  overview: "控制概览",
  activity: "活动",
  instances: "实例",
  debug: "调试",
  logs: "Logs",
};

const DISPLAY_TAB_SUBTITLES: Partial<Record<Tab, string>> = {
  chat: "主对话框作为管理助手：解释状态、准备建议、导航确认点。",
  businessOverview: "发起经营意图，查看主流程状态与经营观察入口。",
  observation: "只处理观察数据、数据缺口、异常和初步可信度。",
  attribution: "基于观察包分析完成判断、差距、原因、置信度和影响程度。",
  goals: "管理公司目标、目标依据、确认材料和治理检查。",
  company: "把已确认目标拆成规划方案与岗位工作项。",
  workboard: "任务调度只做预检、能力匹配和派发，不直接执行岗位。",
  aics: "岗位执行只运行已授权调度任务，并展示执行结果。",
  apiManagement: "多个模型/API Key、供给对象与调用计量。",
  reviewCenter: "本地上架前审核岗位包、能力绑定、跑通性、合格性和风险。",
  skillWorkshop: "在提案成为上线技能之前，进行审查、优化并应用。",
  usage: "查看岗位授权、执行费用和计量摘要。",
  sessions: "查看对话记录、运行状态和会话级配置。",
  dreams: "睡眠时进行记忆巩固。",
  config: "Context Profile、Appearance、Gateway。",
};

const TAB_PATHS: Record<Tab, string> = {
  aics: "/aics",
  apiManagement: "/api-management",
  agents: "/agents",
  activity: "/activity",
  overview: "/overview",
  businessOverview: "/business-overview",
  workboard: "/workboard",
  channels: "/channels",
  instances: "/instances",
  sessions: "/sessions",
  usage: "/usage",
  cron: "/cron",
  skills: "/skills",
  reviewCenter: "/review-center",
  skillWorkshop: "/skills/workshop",
  nodes: "/nodes",
  chat: "/chat",
  observation: "/observation",
  attribution: "/attribution",
  goals: "/goals",
  company: "/company",
  projects: "/projects",
  config: "/config",
  communications: "/communications",
  appearance: "/appearance",
  automation: "/automation",
  mcp: "/mcp",
  infrastructure: "/infrastructure",
  aiAgents: "/ai-agents",
  debug: "/debug",
  logs: "/logs",
  dreams: "/dreaming",
};

const PATH_ALIASES: Record<string, Tab> = {
  "/dreams": "dreams",
  "/skills/workshop": "skillWorkshop",
};

/**
 * Maps a tab to its parent tab when it should render as an indented sub-item
 * under the parent in the sidebar. Sub-items still get their own routes.
 */
export const TAB_PARENTS: Partial<Record<Tab, Tab>> = {};

export function isChildTab(tab: Tab): boolean {
  return Object.hasOwn(TAB_PARENTS, tab);
}

export function childTabsOf(parent: Tab): Tab[] {
  return (Object.entries(TAB_PARENTS) as Array<[Tab, Tab]>)
    .filter(([, p]) => p === parent)
    .map(([child]) => child);
}

const PATH_TO_TAB = new Map<string, Tab>([
  ...Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as Tab] as const),
  ...Object.entries(PATH_ALIASES),
]);

export function normalizeBasePath(basePath: string): string {
  if (!basePath) {
    return "";
  }
  let base = basePath.trim();
  if (!base.startsWith("/")) {
    base = `/${base}`;
  }
  if (base === "/") {
    return "";
  }
  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return base;
}

export function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }
  let normalized = path.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function pathForTab(tab: Tab, basePath = ""): string {
  const base = normalizeBasePath(basePath);
  const path = TAB_PATHS[tab];
  return base ? `${base}${path}` : path;
}

export function isPrimaryNavTab(tab: Tab): boolean {
  return (PRIMARY_NAV_TABS as readonly Tab[]).includes(tab);
}

export function isSettingsTab(tab: Tab): boolean {
  return (SETTINGS_TABS as readonly Tab[]).includes(tab);
}

export function isTabInGroup(group: (typeof TAB_GROUPS)[number], tab: Tab): boolean {
  return (group.tabs as readonly Tab[]).includes(tab);
}

export function tabFromPath(pathname: string, basePath = ""): Tab | null {
  const base = normalizeBasePath(basePath);
  let path = pathname || "/";
  if (base) {
    if (path === base) {
      path = "/";
    } else if (path.startsWith(`${base}/`)) {
      path = path.slice(base.length);
    }
  }
  let normalized = normalizeLowercaseStringOrEmpty(normalizePath(path));
  if (normalized.endsWith("/index.html")) {
    normalized = "/";
  }
  if (normalized === "/") {
    return "chat";
  }
  return PATH_TO_TAB.get(normalized) ?? null;
}

export function inferBasePathFromPathname(pathname: string): string {
  let normalized = normalizePath(pathname);
  if (normalized.endsWith("/index.html")) {
    normalized = normalizePath(normalized.slice(0, -"/index.html".length));
  }
  if (normalized === "/") {
    return "";
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }
  for (let i = 0; i < segments.length; i++) {
    const candidate = normalizeLowercaseStringOrEmpty(`/${segments.slice(i).join("/")}`);
    if (PATH_TO_TAB.has(candidate)) {
      const prefix = segments.slice(0, i);
      return prefix.length ? `/${prefix.join("/")}` : "";
    }
  }
  return `/${segments.join("/")}`;
}

export function iconForTab(tab: Tab): IconName {
  switch (tab) {
    case "aics":
      return "brain";
    case "apiManagement":
      return "link";
    case "agents":
      return "folder";
    case "chat":
      return "messageSquare";
    case "overview":
      return "barChart";
    case "businessOverview":
      return "barChart";
    case "activity":
      return "activity";
    case "workboard":
      return "folder";
    case "channels":
      return "link";
    case "instances":
      return "radio";
    case "sessions":
      return "fileText";
    case "usage":
      return "barChart";
    case "cron":
      return "loader";
    case "skills":
      return "zap";
    case "reviewCenter":
      return "check";
    case "skillWorkshop":
      return "wrench";
    case "nodes":
      return "monitor";
    case "config":
      return "settings";
    case "communications":
      return "send";
    case "appearance":
      return "spark";
    case "automation":
      return "terminal";
    case "mcp":
      return "wrench";
    case "infrastructure":
      return "globe";
    case "aiAgents":
      return "brain";
    case "debug":
      return "bug";
    case "logs":
      return "scrollText";
    case "dreams":
      return "moon";
    case "goals":
      return "barChart";
    case "company":
      return "activity";
    case "observation":
      return "eye";
    case "attribution":
      return "search";
    default:
      return "folder";
  }
}

export function titleForTab(tab: Tab) {
  if (tab === "config") {
    return t("nav.settings");
  }
  if (tab === "apiManagement") {
    return "API Management";
  }
  if (tab === "businessOverview") {
    return "经营概览";
  }
  return t(`tabs.${tab}`);
}

export function displayTitleForTab(tab: Tab) {
  return DISPLAY_TAB_TITLES[tab] ?? titleForTab(tab);
}

export function subtitleForTab(tab: Tab) {
  if (tab === "skills") {
    return "";
  }
  if (DISPLAY_TAB_SUBTITLES[tab]) return DISPLAY_TAB_SUBTITLES[tab] ?? "";
  return t(`subtitles.${tab}`);
}
