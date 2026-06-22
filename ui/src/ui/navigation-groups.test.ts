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
        ],
      },
    ]);
    expect(SETTINGS_TABS.every((tab) => isSettingsTab(tab))).toBe(true);
  });

  it("moves legacy technical routes into settings groups", () => {
    expect(SETTINGS_NAV_GROUPS).toEqual([{ label: "Settings", tabs: ["appearance"] }]);
    expect(SETTINGS_TABS).toEqual(["appearance"]);
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
