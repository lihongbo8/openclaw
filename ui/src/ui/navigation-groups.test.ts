import { describe, expect, it } from "vitest";
import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_TABS,
  TAB_GROUPS,
  isSettingsTab,
  tabFromPath,
} from "./navigation.ts";

describe("TAB_GROUPS", () => {
  it("exposes only the final product entries in the primary sidebar", () => {
    expect(TAB_GROUPS).toEqual([
      {
        label: "main",
        tabs: [
          "chat",
          "aics",
          "workboard",
          "usage",
          "skills",
          "sessions",
          "dreams",
          "marketplace",
          "config",
        ],
      },
    ]);
    expect(SETTINGS_TABS.every((tab) => isSettingsTab(tab))).toBe(true);
  });

  it("moves legacy technical routes into settings groups", () => {
    expect(SETTINGS_NAV_GROUPS).toEqual([
      { label: "基础设置", tabs: ["config", "channels", "communications", "appearance"] },
      {
        label: "开发者工具",
        tabs: [
          "automation",
          "mcp",
          "infrastructure",
          "aiAgents",
          "agents",
          "skillWorkshop",
          "nodes",
          "cron",
        ],
      },
      {
        label: "高级诊断",
        tabs: ["overview", "activity", "instances", "debug", "logs"],
      },
    ]);
    expect(SETTINGS_TABS).toEqual([
      "config",
      "channels",
      "communications",
      "appearance",
      "automation",
      "mcp",
      "infrastructure",
      "aiAgents",
      "agents",
      "skillWorkshop",
      "nodes",
      "cron",
      "overview",
      "activity",
      "instances",
      "debug",
      "logs",
    ]);
  });

  it("routes every published settings slice", () => {
    expect(tabFromPath("/communications")).toBe("communications");
    expect(tabFromPath("/appearance")).toBe("appearance");
    expect(tabFromPath("/automation")).toBe("automation");
    expect(tabFromPath("/infrastructure")).toBe("infrastructure");
    expect(tabFromPath("/ai-agents")).toBe("aiAgents");
    expect(tabFromPath("/config")).toBe("config");
    expect(tabFromPath("/channels")).toBe("channels");
    expect(tabFromPath("/overview")).toBe("overview");
    expect(tabFromPath("/activity")).toBe("activity");
    expect(tabFromPath("/cron")).toBe("cron");
    expect(tabFromPath("/debug")).toBe("debug");
    expect(tabFromPath("/logs")).toBe("logs");
  });
});
