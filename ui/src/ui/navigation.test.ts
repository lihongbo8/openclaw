import { describe, expect, it } from "vitest";
import {
  TAB_GROUPS,
  SETTINGS_NAV_GROUPS,
  SETTINGS_TABS,
  displayTitleForTab,
  iconForTab,
  inferBasePathFromPathname,
  isPrimaryNavTab,
  isSettingsTab,
  normalizeBasePath,
  normalizePath,
  pathForTab,
  subtitleForTab,
  tabFromPath,
  titleForTab,
  type Tab,
} from "./navigation.ts";

/** All valid tab identifiers derived from visible groups plus routed settings slices. */
const ALL_TABS: Tab[] = Array.from(
  new Set<Tab>([...(TAB_GROUPS.flatMap((group) => group.tabs) as Tab[]), ...SETTINGS_TABS]),
);

const leadingSlashNormalizerCases = [
  { name: "normalizeBasePath", normalize: normalizeBasePath, input: "ui", expected: "/ui" },
  { name: "normalizePath", normalize: normalizePath, input: "chat", expected: "/chat" },
];

describe("iconForTab", () => {
  it("returns stable icons for every tab", () => {
    expect(Object.fromEntries(ALL_TABS.map((tab) => [tab, iconForTab(tab)]))).toEqual({
      chat: "messageSquare",
      businessOverview: "barChart",
      observation: "eye",
      attribution: "search",
      goals: "barChart",
      company: "activity",
      workboard: "folder",
      aics: "brain",
      skills: "zap",
      apiManagement: "link",
      usage: "barChart",
      sessions: "fileText",
      dreams: "moon",
      config: "settings",
      appearance: "spark",
    });
  });

  it("returns a fallback icon for unknown tab", () => {
    // TypeScript won't allow this normally, but runtime could receive unexpected values
    const unknownTab = "unknown" as Tab;
    expect(iconForTab(unknownTab)).toBe("folder");
  });
});

describe("titleForTab", () => {
  it("returns expected titles for every tab", () => {
    expect(Object.fromEntries(ALL_TABS.map((tab) => [tab, titleForTab(tab)]))).toEqual({
      chat: "Main Chat",
      businessOverview: "经营概览",
      observation: "tabs.observation",
      attribution: "tabs.attribution",
      goals: "Goal Management",
      company: "Company Management",
      workboard: "Workboard",
      aics: "Role Workbench",
      skills: "Skills",
      apiManagement: "API Management",
      usage: "Usage Records",
      sessions: "Sessions",
      dreams: "Dreaming",
      config: "Settings",
      appearance: "Appearance",
    });
  });

  it("returns product-facing titles for the primary navigation", () => {
    expect(
      Object.fromEntries(TAB_GROUPS[0].tabs.map((tab) => [tab, displayTitleForTab(tab)])),
    ).toEqual({
      chat: "迭界AI",
      businessOverview: "经营概览",
      observation: "数据分析",
      attribution: "归因分析",
      goals: "公司目标",
      company: "规划方案",
      workboard: "任务调度",
      aics: "岗位执行",
      skills: "工具与 Skill",
      apiManagement: "API 管理",
      usage: "费用与授权",
      sessions: "对话记录",
      dreams: "记忆与进化",
      config: "Settings",
    });
  });
});

describe("subtitleForTab", () => {
  it("returns expected subtitles for every tab", () => {
    expect(Object.fromEntries(ALL_TABS.map((tab) => [tab, subtitleForTab(tab)]))).toEqual({
      chat: "Start work in natural language.",
      businessOverview: "发起经营意图，查看主流程状态与经营观察入口。",
      observation: "subtitles.observation",
      attribution: "subtitles.attribution",
      goals: "Annual, quarterly, monthly, and weekly operating goals.",
      company: "Departments, people operations, and operating accountability.",
      workboard: "Agent work queue and session handoff.",
      aics: "Dispatched role tasks, execution state, blockers, and returned artifacts.",
      skills: "Tool permissions, Skills, API bindings, and cloud capability control.",
      apiManagement: "API 供给、绑定配置路径、SecretRef 与风险监控。",
      usage: "Conversation, role task, and cost records.",
      sessions: "Active sessions and defaults.",
      dreams: "Memory dreaming, consolidation, and reflection.",
      config: "Edit openclaw.json.",
      appearance: "Theme, UI, and setup wizard settings.",
    });
  });
});

describe("leading slash path normalizers", () => {
  it.each(leadingSlashNormalizerCases)(
    "$name adds leading slash if missing",
    ({ expected, input, normalize }) => {
      expect(normalize(input)).toBe(expected);
    },
  );
});

describe("normalizeBasePath", () => {
  it("returns empty string for falsy input", () => {
    expect(normalizeBasePath("")).toBe("");
  });

  it("removes trailing slash", () => {
    expect(normalizeBasePath("/ui/")).toBe("/ui");
  });

  it("returns empty string for root path", () => {
    expect(normalizeBasePath("/")).toBe("");
  });

  it("handles nested paths", () => {
    expect(normalizeBasePath("/apps/openclaw")).toBe("/apps/openclaw");
  });
});

describe("normalizePath", () => {
  it("returns / for falsy input", () => {
    expect(normalizePath("")).toBe("/");
  });

  it("removes trailing slash except for root", () => {
    expect(normalizePath("/chat/")).toBe("/chat");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("pathForTab", () => {
  it("returns correct path without base", () => {
    expect(pathForTab("aics")).toBe("/aics");
    expect(pathForTab("apiManagement")).toBe("/api-management");
    expect(pathForTab("chat")).toBe("/chat");
    expect(pathForTab("businessOverview")).toBe("/business-overview");
    expect(pathForTab("overview")).toBe("/overview");
  });

  it("prepends base path", () => {
    expect(pathForTab("chat", "/ui")).toBe("/ui/chat");
    expect(pathForTab("sessions", "/apps/openclaw")).toBe("/apps/openclaw/sessions");
  });
});

describe("tabFromPath", () => {
  it("returns tab for valid path", () => {
    expect(tabFromPath("/chat")).toBe("chat");
    expect(tabFromPath("/business-overview")).toBe("businessOverview");
    expect(tabFromPath("/goals")).toBe("goals");
    expect(tabFromPath("/company")).toBe("company");
    expect(tabFromPath("/projects")).toBe("projects");
    expect(tabFromPath("/aics")).toBe("aics");
    expect(tabFromPath("/api-management")).toBe("apiManagement");
    expect(tabFromPath("/admin-console")).toBeNull();
    expect(tabFromPath("/marketplace")).toBeNull();
    expect(tabFromPath("/overview")).toBe("overview");
    expect(tabFromPath("/activity")).toBe("activity");
    expect(tabFromPath("/sessions")).toBe("sessions");
    expect(tabFromPath("/dreaming")).toBe("dreams");
    expect(tabFromPath("/dreams")).toBe("dreams");
  });

  it("returns main chat for root path", () => {
    expect(tabFromPath("/")).toBe("chat");
  });

  it("handles base paths", () => {
    expect(tabFromPath("/ui/chat", "/ui")).toBe("chat");
    expect(tabFromPath("/apps/openclaw/sessions", "/apps/openclaw")).toBe("sessions");
  });

  it("returns null for unknown path", () => {
    expect(tabFromPath("/unknown")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(tabFromPath("/CHAT")).toBe("chat");
    expect(tabFromPath("/Overview")).toBe("overview");
  });
});

describe("inferBasePathFromPathname", () => {
  it("returns empty string for root", () => {
    expect(inferBasePathFromPathname("/")).toBe("");
  });

  it("returns empty string for direct tab path", () => {
    expect(inferBasePathFromPathname("/aics")).toBe("");
    expect(inferBasePathFromPathname("/goals")).toBe("");
    expect(inferBasePathFromPathname("/company")).toBe("");
    expect(inferBasePathFromPathname("/projects")).toBe("");
    expect(inferBasePathFromPathname("/api-management")).toBe("");
    expect(inferBasePathFromPathname("/business-overview")).toBe("");
    expect(inferBasePathFromPathname("/chat")).toBe("");
    expect(inferBasePathFromPathname("/overview")).toBe("");
    expect(inferBasePathFromPathname("/dreaming")).toBe("");
    expect(inferBasePathFromPathname("/dreams")).toBe("");
  });

  it("infers base path from nested paths", () => {
    expect(inferBasePathFromPathname("/ui/chat")).toBe("/ui");
    expect(inferBasePathFromPathname("/apps/openclaw/sessions")).toBe("/apps/openclaw");
  });

  it("handles index.html suffix", () => {
    expect(inferBasePathFromPathname("/index.html")).toBe("");
    expect(inferBasePathFromPathname("/ui/index.html")).toBe("/ui");
  });
});

describe("TAB_GROUPS", () => {
  it("contains only the product-facing primary sidebar group", () => {
    expect(TAB_GROUPS.map((g) => g.label)).toEqual(["main"]);
    expect(TAB_GROUPS[0].tabs).toEqual([
      "chat",
      "businessOverview",
      "observation",
      "attribution",
      "goals",
      "company",
      "workboard",
      "aics",
      "skills",
      "apiManagement",
      "usage",
      "sessions",
      "dreams",
      "config",
    ]);
    expect(TAB_GROUPS[0].tabs.every((tab) => isPrimaryNavTab(tab))).toBe(true);
  });

  it("all tabs are unique", () => {
    const allTabs = TAB_GROUPS.flatMap((g) => g.tabs);
    const uniqueTabs = new Set(allTabs);
    expect(uniqueTabs.size).toBe(allTabs.length);
  });

  it("keeps technical slices routed under settings navigation groups", () => {
    expect(SETTINGS_NAV_GROUPS.map((group) => group.label)).toEqual(["Settings"]);
    expect(SETTINGS_TABS).toEqual(["appearance"]);
    expect(SETTINGS_TABS.every((tab) => isSettingsTab(tab))).toBe(true);
  });
});
