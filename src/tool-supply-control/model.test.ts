import { describe, expect, it } from "vitest";
import type { ToolsCatalogResult } from "../../packages/gateway-protocol/src/index.js";
import type { CloudMarketplaceProjection } from "../aics-main-flow/cloud-marketplace-projection.js";
import type { ApiConnectionsReadModel } from "../api-connections/model.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { SkillStatusEntry, SkillStatusReport } from "../skills/discovery/status.js";
import { createToolSupplyControlReadModel } from "./model.js";

function skill(
  patch: Partial<SkillStatusEntry> & Pick<SkillStatusEntry, "skillKey" | "name">,
): SkillStatusEntry {
  return {
    name: patch.name,
    description: patch.description ?? "",
    source: patch.source ?? "workspace",
    bundled: patch.bundled ?? false,
    filePath: patch.filePath ?? "/tmp/SKILL.md",
    baseDir: patch.baseDir ?? "/tmp",
    skillKey: patch.skillKey,
    always: patch.always ?? false,
    disabled: patch.disabled ?? false,
    blockedByAllowlist: patch.blockedByAllowlist ?? false,
    blockedByAgentFilter: patch.blockedByAgentFilter ?? false,
    eligible: patch.eligible ?? true,
    modelVisible: patch.modelVisible ?? true,
    userInvocable: patch.userInvocable ?? true,
    commandVisible: patch.commandVisible ?? true,
    requirements: patch.requirements ?? { bins: [], anyBins: [], env: [], config: [], os: [] },
    missing: patch.missing ?? { bins: [], anyBins: [], env: [], config: [], os: [] },
    configChecks: patch.configChecks ?? [],
    install: patch.install ?? [],
  };
}

const toolsCatalogResult: ToolsCatalogResult = {
  agentId: "default",
  profiles: [],
  groups: [
    {
      id: "core",
      label: "Core",
      source: "core",
      tools: [
        {
          id: "web_search",
          label: "Web Search",
          description: "Search the web",
          source: "core",
          risk: "high",
          defaultProfiles: [],
        },
      ],
    },
    {
      id: "plugin:brave",
      label: "Brave",
      source: "plugin",
      pluginId: "brave",
      tools: [
        {
          id: "brave_search",
          label: "Brave Search",
          description: "Plugin search",
          source: "plugin",
          pluginId: "brave",
          risk: "medium",
          defaultProfiles: [],
        },
      ],
    },
  ],
};

const apiConnections: ApiConnectionsReadModel = {
  entries: [],
  metrics: { configured: 0, available: 0, risky: 0, unbound: 0, blocked: 0 },
  groups: { model: [], tool_skill: [], marketplace: [], dialog: [], custom: [] },
  riskReport: { items: [], counts: { blocking: 0, warning: 0, info: 0 } },
};

function cloudProjection(): CloudMarketplaceProjection {
  return {
    version: 1,
    updatedAt: 1,
    authority: "cloud_marketplace",
    apiHealth: {
      status: "mocked",
      gateway: "openclaw",
      actorContextRequired: true,
      blockedReasons: [],
    },
    audit: { pending: [], approved: 0, rejected: 0 },
    capabilities: {
      categoryCommon: [
        {
          id: "cap-a",
          scope: "category_common",
          category: "设计",
          label: "图片处理",
          description: "图片处理能力",
          tools: [],
          skills: [],
          approvalStatus: "requested",
          humanConfirmRequired: true,
        },
      ],
      uniqueRequests: [
        {
          id: "unique-a",
          category: "设计",
          missingCapability: "独特修图",
          capabilityType: "skill",
          neededTools: [],
          neededSkills: ["retouch"],
          reason: "缺少独特能力",
          riskLevel: "high",
          status: "requested",
          humanConfirmRequired: true,
        },
      ],
      approved: [],
      blockedReasons: [],
    },
    marketplace: { listings: [], categories: [] },
    businessSummary: {
      listings: 0,
      authorizations: 0,
      executions: 0,
      blocked: 0,
      ledgerSummary: "",
    },
    dispatcherRoleReadModel: { callableRoles: [], blockedRoles: [] },
  };
}

describe("createToolSupplyControlReadModel", () => {
  it("reuses OpenClaw tool, skill, API and cloud projections", () => {
    const skillsReport: SkillStatusReport = {
      workspaceDir: "/tmp",
      managedSkillsDir: "/tmp/skills",
      skills: [
        skill({ skillKey: "image-edit", name: "Image Edit", disabled: true }),
        skill({
          skillKey: "search",
          name: "Search",
          requirements: { bins: [], anyBins: [], env: ["SEARCH_API_KEY"], config: [], os: [] },
          missing: { bins: [], anyBins: [], env: ["SEARCH_API_KEY"], config: [], os: [] },
          eligible: false,
        }),
      ],
    };
    const model = createToolSupplyControlReadModel({
      config: { plugins: { entries: { brave: { enabled: false } } } } as OpenClawConfig,
      toolsCatalogResult,
      skillsReport,
      apiConnections,
      cloudMarketplace: cloudProjection(),
    });

    expect(
      model.localTools.find((item) => item.id === "tool:web_search")?.blockedReasons,
    ).toContain("high_risk_needs_human_approval");
    expect(
      model.localTools.find((item) => item.id === "plugin:brave:brave_search")?.blockedReasons,
    ).toContain("plugin_tool_disabled");
    expect(model.skills.find((item) => item.id === "skill:image-edit")?.blockedReasons).toContain(
      "skill_disabled",
    );
    expect(model.skills.find((item) => item.id === "skill:search")?.blockedReasons).toEqual(
      expect.arrayContaining(["skill_missing_dependency", "missing_api_binding"]),
    );
    expect(
      model.cloudCapabilities.find((item) => item.id === "cloud:cap-a")?.blockedReasons,
    ).toContain("cloud_capability_not_authorized");
    expect(
      model.cloudCapabilities.find((item) => item.id === "unique:unique-a")?.blockedReasons,
    ).toContain("unique_capability_pending");
  });

  it("lets local grant clear only the local high-risk gate", () => {
    const model = createToolSupplyControlReadModel({
      config: {
        toolSupply: {
          grants: {
            web: {
              id: "web",
              capabilityRef: "tool:web_search",
              status: "approved",
            },
          },
        },
      } as OpenClawConfig,
      toolsCatalogResult,
      skillsReport: { workspaceDir: "/tmp", managedSkillsDir: "/tmp/skills", skills: [] },
      apiConnections,
      cloudMarketplace: cloudProjection(),
    });

    expect(
      model.localTools.find((item) => item.id === "tool:web_search")?.blockedReasons,
    ).not.toContain("high_risk_needs_human_approval");
    expect(
      model.cloudCapabilities.find((item) => item.id === "cloud:cap-a")?.blockedReasons,
    ).toContain("cloud_capability_not_authorized");
  });
});
