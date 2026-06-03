import { t } from "../i18n/index.ts";
import type { IconName } from "./icons.js";
import { normalizeLowercaseStringOrEmpty } from "./string-coerce.ts";

export type Tab =
  | "aics"
  | "marketplace"
  | "agents"
  | "activity"
  | "overview"
  | "workboard"
  | "channels"
  | "instances"
  | "sessions"
  | "usage"
  | "cron"
  | "skills"
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
  | "dreams";

const PRIMARY_NAV_TABS = [
  "chat",
  "aics",
  "workboard",
  "usage",
  "skills",
  "sessions",
  "dreams",
  "marketplace",
  "config",
] as const satisfies readonly Tab[];

const SETTINGS_GENERAL_TABS = [
  "config",
  "channels",
  "communications",
  "appearance",
] as const satisfies readonly Tab[];

const SETTINGS_DEVELOPER_TABS = [
  "automation",
  "mcp",
  "infrastructure",
  "aiAgents",
  "agents",
  "skillWorkshop",
  "nodes",
  "cron",
] as const satisfies readonly Tab[];

const SETTINGS_DIAGNOSTIC_TABS = [
  "overview",
  "activity",
  "instances",
  "debug",
  "logs",
] as const satisfies readonly Tab[];

export const TAB_GROUPS = [{ label: "main", tabs: PRIMARY_NAV_TABS }] as const;

export const SETTINGS_NAV_GROUPS = [
  { label: "基础设置", tabs: SETTINGS_GENERAL_TABS },
  { label: "开发者工具", tabs: SETTINGS_DEVELOPER_TABS },
  { label: "高级诊断", tabs: SETTINGS_DIAGNOSTIC_TABS },
] as const;

export const SETTINGS_TABS = [
  ...SETTINGS_GENERAL_TABS,
  ...SETTINGS_DEVELOPER_TABS,
  ...SETTINGS_DIAGNOSTIC_TABS,
] as const satisfies readonly Tab[];

export const BUYER_STOREFRONT_URL = "http://127.0.0.1:8000/categories";

const DISPLAY_TAB_TITLES: Partial<Record<Tab, string>> = {
  chat: "主对话",
  aics: "我的岗位",
  workboard: "岗位任务",
  dreams: "记忆与进化",
  usage: "费用与授权",
  marketplace: "岗位商城",
  skills: "已安装工具",
  sessions: "对话记录",
  config: "设置",
  channels: "渠道",
  communications: "通信",
  appearance: "外观",
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
  logs: "日志",
};

const TAB_PATHS: Record<Tab, string> = {
  aics: "/aics",
  marketplace: "/marketplace",
  agents: "/agents",
  activity: "/activity",
  overview: "/overview",
  workboard: "/workboard",
  channels: "/channels",
  instances: "/instances",
  sessions: "/sessions",
  usage: "/usage",
  cron: "/cron",
  skills: "/skills",
  skillWorkshop: "/skills/workshop",
  nodes: "/nodes",
  chat: "/chat",
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
};

/**
 * Maps a tab to its parent tab when it should render as an indented sub-item
 * under the parent in the sidebar. Sub-items still get their own routes.
 */
export const TAB_PARENTS: Partial<Record<Tab, Tab>> = {
  skillWorkshop: "skills",
};

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
    case "marketplace":
      return "globe";
    case "agents":
      return "folder";
    case "chat":
      return "messageSquare";
    case "overview":
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
    default:
      return "folder";
  }
}

export function titleForTab(tab: Tab) {
  if (tab === "config") {
    return t("nav.settings");
  }
  return t(`tabs.${tab}`);
}

export function displayTitleForTab(tab: Tab) {
  return DISPLAY_TAB_TITLES[tab] ?? titleForTab(tab);
}

export function subtitleForTab(tab: Tab) {
  return t(`subtitles.${tab}`);
}
