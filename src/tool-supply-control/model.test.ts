import { describe, expect, it } from "vitest";
import type { ToolsCatalogResult } from "../../packages/gateway-protocol/src/index.js";
import type { CloudMarketplaceProjection } from "../aics-main-flow/cloud-marketplace-projection.js";
import type { ApiConnectionsReadModel } from "../api-connections/model.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { SkillStatusEntry, SkillStatusReport } from "../skills/discovery/status.js";
import {
  createToolSupplyControlReadModel,
  findToolSupplyResolutionForRolePlanItem,
} from "./model.js";

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

const blockedApiConnections: ApiConnectionsReadModel = {
  entries: [
    {
      id: "search-api",
      name: "Search API",
      kind: "tool_skill",
      provider: "search",
      authMode: "secret_ref",
      secret: {
        mode: "secret_ref",
        source: "env",
        provider: "default",
        id: "SEARCH_API_KEY",
        status: "unresolved",
      },
      consumers: ["skill"],
      requestedScope: ["search"],
      configBindings: [{ path: "skills.entries.search.apiKey" }],
      enabled: true,
      status: "blocked",
      riskStatus: "blocked",
      risks: [
        {
          entryId: "search-api",
          code: "unresolved_secret_ref",
          severity: "blocking",
          message: "SecretRef unresolved",
        },
      ],
    },
  ],
  metrics: { configured: 1, available: 0, risky: 1, unbound: 0, blocked: 1 },
  groups: { model: [], tool_skill: [], marketplace: [], dialog: [], custom: [] },
  riskReport: { items: [], counts: { blocking: 1, warning: 0, info: 0 } },
};

function cloudProjection(): CloudMarketplaceProjection {
  return {
    version: 1,
    updatedAt: 1,
    authority: "cloud_marketplace",
    apiHealth: {
      status: "blocked",
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
    expect(model.capabilityLifecycle.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["category_common", "unique_capability", "local_tool", "skill"]),
    );
    expect(
      model.capabilityLifecycle.find((item) => item.kind === "category_common")?.formation,
    ).toContain("品类通用能力");
    expect(
      model.capabilityLifecycle.find((item) => item.kind === "unique_capability")?.acquisition,
    ).toContain("独特能力申请");
    expect(model.capabilityLifecycle.find((item) => item.kind === "category_common")).toMatchObject(
      {
        dispatchReady: false,
        nextAction: expect.objectContaining({ label: "处理云端授权" }),
      },
    );
    expect(model.capabilityLifecycle.find((item) => item.kind === "skill")).toMatchObject({
      nextAction: expect.objectContaining({ routeTab: "skills" }),
    });
  });

  it("lets local grant clear only the local high-risk gate", () => {
    const model = createToolSupplyControlReadModel({
      config: {
        toolSupply: {
          bindings: {
            browserToMarketplace: {
              id: "browserToMarketplace",
              sourceItemId: "skill:browser-automation",
              sourceKind: "skill",
              targetKind: "category_capability",
              targetId: "cloud:cap-a",
              targetTitle: "岗位商城运营通用能力",
              status: "active",
            },
          },
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
    expect(model.bindings).toContainEqual(
      expect.objectContaining({
        sourceItemId: "skill:browser-automation",
        targetKind: "category_capability",
        targetId: "cloud:cap-a",
      }),
    );
  });

  it("resolves active tool and skill bindings into dispatch-ready category capability", () => {
    const projection = cloudProjection();
    projection.capabilities.categoryCommon[0]!.approvalStatus = "approved";
    const model = createToolSupplyControlReadModel({
      config: {
        toolSupply: {
          grants: {
            web: { id: "web", capabilityRef: "tool:web_search", status: "approved" },
          },
          bindings: {
            toolBinding: {
              id: "toolBinding",
              sourceItemId: "tool:web_search",
              sourceKind: "tool",
              targetKind: "category_capability",
              targetId: "cloud:cap-a",
              status: "active",
            },
            skillBinding: {
              id: "skillBinding",
              sourceItemId: "skill:image-edit",
              sourceKind: "skill",
              targetKind: "category_capability",
              targetId: "cloud:cap-a",
              status: "active",
            },
            pausedSkillBinding: {
              id: "pausedSkillBinding",
              sourceItemId: "skill:paused",
              sourceKind: "skill",
              targetKind: "category_capability",
              targetId: "cloud:cap-a",
              status: "paused",
            },
          },
        },
      } as OpenClawConfig,
      toolsCatalogResult,
      skillsReport: {
        workspaceDir: "/tmp",
        managedSkillsDir: "/tmp/skills",
        skills: [
          skill({ skillKey: "image-edit", name: "Image Edit" }),
          skill({ skillKey: "paused", name: "Paused Skill" }),
        ],
      },
      apiConnections,
      cloudMarketplace: projection,
    });

    expect(model.resolutions).toContainEqual(
      expect.objectContaining({
        categoryCapabilityId: "cloud:cap-a",
        category: "设计",
        allowedTools: ["tool:web_search"],
        allowedSkills: ["skill:image-edit"],
        dispatchReady: true,
        blockedReasons: [],
      }),
    );
  });

  it("projects category packages from local bindings before cloud category sync finishes", () => {
    const model = createToolSupplyControlReadModel({
      config: {
        toolSupply: {
          bindings: {
            skillBinding: {
              id: "skillBinding",
              sourceItemId: "skill:image-edit",
              sourceKind: "skill",
              targetKind: "category_capability",
              targetId: "cloud:category_common:岗位商城",
              targetTitle: "岗位商城",
              status: "active",
              syncStatus: "local",
            },
          },
        },
      } as OpenClawConfig,
      toolsCatalogResult,
      skillsReport: {
        workspaceDir: "/tmp",
        managedSkillsDir: "/tmp/skills",
        skills: [skill({ skillKey: "image-edit", name: "Image Edit" })],
      },
      apiConnections,
      cloudMarketplace: null,
    });

    expect(model.categories).toContainEqual(
      expect.objectContaining({
        id: "cloud:category_common:岗位商城",
        name: "岗位商城",
        status: "pending",
      }),
    );
    expect(model.packages).toContainEqual(
      expect.objectContaining({
        category: expect.objectContaining({ name: "岗位商城" }),
        skills: [expect.objectContaining({ id: "skill:image-edit" })],
      }),
    );
  });

  it("does not use role dispatch bindings as category capability supply", () => {
    const projection = cloudProjection();
    projection.capabilities.categoryCommon[0]!.approvalStatus = "approved";
    const model = createToolSupplyControlReadModel({
      config: {
        toolSupply: {
          grants: {
            web: { id: "web", capabilityRef: "tool:web_search", status: "approved" },
          },
          bindings: {
            toolDispatchBinding: {
              id: "toolDispatchBinding",
              sourceItemId: "tool:web_search",
              sourceKind: "tool",
              targetKind: "role_dispatch",
              targetId: "role-dispatch:default",
              status: "active",
            },
            skillDispatchBinding: {
              id: "skillDispatchBinding",
              sourceItemId: "skill:image-edit",
              sourceKind: "skill",
              targetKind: "role_dispatch",
              targetId: "role-dispatch:default",
              status: "active",
            },
          },
        },
      } as OpenClawConfig,
      toolsCatalogResult,
      skillsReport: {
        workspaceDir: "/tmp",
        managedSkillsDir: "/tmp/skills",
        skills: [skill({ skillKey: "image-edit", name: "Image Edit" })],
      },
      apiConnections,
      cloudMarketplace: projection,
    });

    expect(model.resolutions).toContainEqual(
      expect.objectContaining({
        categoryCapabilityId: "cloud:cap-a",
        allowedTools: [],
        allowedSkills: [],
        dispatchReady: false,
        blockedReasons: expect.arrayContaining([
          "missing_category_binding",
          "missing_tool_binding",
          "missing_skill_binding",
        ]),
      }),
    );
  });

  it("keeps a category capability blocked when the bound skill is disabled", () => {
    const projection = cloudProjection();
    projection.capabilities.categoryCommon[0]!.approvalStatus = "approved";
    const model = createToolSupplyControlReadModel({
      config: {
        toolSupply: {
          grants: {
            web: { id: "web", capabilityRef: "tool:web_search", status: "approved" },
          },
          bindings: {
            toolBinding: {
              id: "toolBinding",
              sourceItemId: "tool:web_search",
              sourceKind: "tool",
              targetKind: "category_capability",
              targetId: "cloud:cap-a",
              status: "active",
            },
            disabledSkillBinding: {
              id: "disabledSkillBinding",
              sourceItemId: "skill:image-edit",
              sourceKind: "skill",
              targetKind: "category_capability",
              targetId: "cloud:cap-a",
              status: "active",
            },
          },
        },
      } as OpenClawConfig,
      toolsCatalogResult,
      skillsReport: {
        workspaceDir: "/tmp",
        managedSkillsDir: "/tmp/skills",
        skills: [skill({ skillKey: "image-edit", name: "Image Edit", disabled: true })],
      },
      apiConnections,
      cloudMarketplace: projection,
    });

    expect(model.resolutions[0]).toMatchObject({
      allowedTools: ["tool:web_search"],
      allowedSkills: [],
      dispatchReady: false,
      blockedReasons: expect.arrayContaining(["skill_disabled", "missing_skill_binding"]),
    });
  });

  it("keeps a category capability blocked when a bound skill is missing its API binding", () => {
    const projection = cloudProjection();
    projection.capabilities.categoryCommon[0]!.approvalStatus = "approved";
    const model = createToolSupplyControlReadModel({
      config: {
        toolSupply: {
          grants: {
            web: { id: "web", capabilityRef: "tool:web_search", status: "approved" },
          },
          bindings: {
            toolBinding: {
              id: "toolBinding",
              sourceItemId: "tool:web_search",
              sourceKind: "tool",
              targetKind: "category_capability",
              targetId: "cloud:cap-a",
              status: "active",
            },
            apiSkillBinding: {
              id: "apiSkillBinding",
              sourceItemId: "skill:search",
              sourceKind: "skill",
              targetKind: "category_capability",
              targetId: "cloud:cap-a",
              status: "active",
            },
          },
        },
      } as OpenClawConfig,
      toolsCatalogResult,
      skillsReport: {
        workspaceDir: "/tmp",
        managedSkillsDir: "/tmp/skills",
        skills: [
          skill({
            skillKey: "search",
            name: "Search",
            requirements: { bins: [], anyBins: [], env: ["SEARCH_API_KEY"], config: [], os: [] },
          }),
        ],
      },
      apiConnections,
      cloudMarketplace: projection,
    });

    expect(model.resolutions[0]).toMatchObject({
      allowedTools: ["tool:web_search"],
      allowedSkills: [],
      dispatchReady: false,
      blockedReasons: expect.arrayContaining(["missing_api_binding", "missing_skill_binding"]),
    });
  });

  it("does not treat a blocked API connection as usable for a bound skill", () => {
    const projection = cloudProjection();
    projection.capabilities.categoryCommon[0]!.approvalStatus = "approved";
    const model = createToolSupplyControlReadModel({
      config: {
        toolSupply: {
          grants: {
            web: { id: "web", capabilityRef: "tool:web_search", status: "approved" },
          },
          bindings: {
            toolBinding: {
              id: "toolBinding",
              sourceItemId: "tool:web_search",
              sourceKind: "tool",
              targetKind: "category_capability",
              targetId: "cloud:cap-a",
              status: "active",
            },
            blockedApiSkillBinding: {
              id: "blockedApiSkillBinding",
              sourceItemId: "skill:search",
              sourceKind: "skill",
              targetKind: "category_capability",
              targetId: "cloud:cap-a",
              status: "active",
            },
          },
        },
      } as OpenClawConfig,
      toolsCatalogResult,
      skillsReport: {
        workspaceDir: "/tmp",
        managedSkillsDir: "/tmp/skills",
        skills: [
          skill({
            skillKey: "search",
            name: "Search",
            requirements: { bins: [], anyBins: [], env: ["SEARCH_API_KEY"], config: [], os: [] },
          }),
        ],
      },
      apiConnections: blockedApiConnections,
      cloudMarketplace: projection,
    });

    expect(model.skills.find((item) => item.id === "skill:search")?.blockedReasons).toContain(
      "missing_api_binding",
    );
    expect(model.resolutions[0]).toMatchObject({
      allowedTools: ["tool:web_search"],
      allowedSkills: [],
      dispatchReady: false,
      blockedReasons: expect.arrayContaining(["missing_api_binding", "missing_skill_binding"]),
    });
  });

  it("matches role plan items to category capability resolutions across cloud and local refs", () => {
    const resolutions = [
      {
        categoryCapabilityId: "cloud:category_common:岗位商城",
        category: "岗位商城",
        allowedTools: ["tool:web_search"],
        allowedSkills: ["skill:image-edit"],
        dispatchReady: true,
        blockedReasons: [],
      },
    ];

    expect(
      findToolSupplyResolutionForRolePlanItem(resolutions, {
        category: "岗位商城",
      })?.allowedSkills,
    ).toEqual(["skill:image-edit"]);
    expect(
      findToolSupplyResolutionForRolePlanItem(resolutions, {
        roleCapabilityRef: "category_common:岗位商城",
      })?.allowedTools,
    ).toEqual(["tool:web_search"]);
    expect(
      findToolSupplyResolutionForRolePlanItem(resolutions, {
        roleCapabilityRef: "cloud:category_common:岗位商城",
      })?.dispatchReady,
    ).toBe(true);
  });

  it("includes category capability production Tool/Skill todos for role capability gaps", () => {
    const model = createToolSupplyControlReadModel({
      config: {},
      toolsCatalogResult,
      skillsReport: { workspaceDir: "/tmp", managedSkillsDir: "/tmp/skills", skills: [] },
      apiConnections,
      systemDevelopmentTodos: [
        {
          id: "todo-1",
          assetType: "tool",
          assetId: "tool.platform.marketplace_read_model",
          source: "system-analysis",
          sourceRolePackageId: "pkg-marketplace-ops",
          sourceRequestId: "role-capability:marketplace-ops",
          targetCategoryRef: "category:marketplace-ops@1",
          targetCategoryName: "商城运营",
          declaredCapabilities: ["marketplace.read"],
          requiredCapabilities: ["marketplace.read", "human.confirm"],
          toolRequirements: ["tool.platform.marketplace_read_model"],
          skillRequirements: ["skill.platform.marketplace_ops_diagnosis"],
          providerRequirements: ["provider.platform.model_chat_analysis"],
          humanConfirmationRules: ["包含 human.confirm 能力，执行前必须有人审确认。"],
          riskBoundaries: ["不自动上架"],
          acceptanceCriteria: ["正式品类激活时可被引用"],
          riskLevel: "低",
          reviewStatus: "待审核",
          reviewDecision: null,
          reviewFindings: [],
          nextAction: {
            label: "检查并通过",
            reason: "先执行检查，通过后再人工确认该 Tool/Skill 可供品类能力使用。",
          },
        },
      ],
    });

    expect(model.systemDevelopmentTodos).toEqual([
      expect.objectContaining({
        assetId: "tool.platform.marketplace_read_model",
        sourceRolePackageId: "pkg-marketplace-ops",
        sourceRequestId: "role-capability:marketplace-ops",
        targetCategoryName: "商城运营",
        declaredCapabilities: ["marketplace.read"],
        toolRequirements: ["tool.platform.marketplace_read_model"],
        skillRequirements: ["skill.platform.marketplace_ops_diagnosis"],
        providerRequirements: ["provider.platform.model_chat_analysis"],
        humanConfirmationRules: expect.arrayContaining([expect.stringContaining("human.confirm")]),
        acceptanceCriteria: expect.arrayContaining([expect.stringContaining("正式品类激活")]),
        nextAction: expect.objectContaining({
          reason: expect.stringContaining("品类能力"),
        }),
        reviewStatus: "待审核",
      }),
    ]);
  });
});
