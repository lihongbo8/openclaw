import { describe, expect, it } from "vitest";
import {
  buildCapabilityCategoryPackProjection,
  buildCapabilityPreflight,
  buildCapabilityRoutingProjection,
  buildLocalKnowledgeSafeBindingExport,
  buildLocalCapabilityStore,
  normalizeCatalogLookupRef,
} from "./capability-routing-store.ts";
import type { SkillStatusEntry, SkillStatusReport, ToolsCatalogResult } from "./types.ts";

function skill(overrides: Partial<SkillStatusEntry>): SkillStatusEntry {
  return {
    name: "Image Review",
    description: "Review image deliverables",
    source: "workspace",
    filePath: "/workspace/skills/image-review/SKILL.md",
    baseDir: "/workspace/skills/image-review",
    skillKey: "image-review",
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    requirements: { bins: [], env: [], config: [], os: [] },
    missing: { bins: [], env: [], config: [], os: [] },
    configChecks: [],
    install: [],
    ...overrides,
  };
}

describe("capability-routing-store", () => {
  it("projects local tools and skills into catalog-ref addressable entries", () => {
    const toolsCatalogResult: ToolsCatalogResult = {
      agentId: "main",
      profiles: [],
      groups: [
        {
          id: "plugin:image",
          label: "image",
          source: "plugin",
          pluginId: "image-plugin",
          tools: [
            {
              id: "image.inspect",
              label: "Image Inspect",
              description: "Inspect images",
              source: "plugin",
              pluginId: "image-plugin",
              risk: "high",
              defaultProfiles: [],
            },
          ],
        },
      ],
    };
    const skillsReport: SkillStatusReport = {
      workspaceDir: "/workspace",
      managedSkillsDir: "/workspace/skills",
      skills: [
        skill({
          skillKey: "image-review",
          clawhub: {
            status: "linked",
            valid: true,
            registry: "clawhub",
            slug: "image-review",
            installedVersion: "1.2.0",
            installedAt: 1,
          },
        }),
        skill({ skillKey: "disabled-skill", name: "Disabled Skill", disabled: true }),
      ],
    };

    const store = buildLocalCapabilityStore({ toolsCatalogResult, skillsReport });

    expect(store.summary).toMatchObject({
      total: 3,
      tools: 1,
      skills: 2,
      available: 2,
      disabled: 1,
      gated: 1,
      highRisk: 1,
    });
    expect(store.refIndex.get("tool:image.inspect")?.label).toBe("Image Inspect");
    expect(store.refIndex.get("plugin:image-plugin:image.inspect")?.kind).toBe("tool");
    expect(store.refIndex.get("skill:image-review")?.kind).toBe("skill");
    expect(store.refIndex.get("clawhub:image-review")?.version).toBe("1.2.0");
  });

  it("routes cloud role capability refs without requiring implementations to live locally", () => {
    const projection = buildCapabilityRoutingProjection({
      roles: [
        {
          catalogRefs: [
            "tool:web.fetch@1.0",
            "skill:market-research",
            "api:replicate.image.generate",
            "mcp:zapier.gmail.send",
            "provider:openai.image.generate",
            "capability:human.confirm",
            "finance.close-playbook",
          ],
        },
      ],
      toolsCatalogResult: {
        agentId: "main",
        profiles: [],
        groups: [
          {
            id: "core",
            label: "Core",
            source: "core",
            tools: [
              {
                id: "web.fetch",
                label: "Web Fetch",
                description: "Fetch web pages",
                source: "core",
                defaultProfiles: [],
              },
            ],
          },
        ],
      },
      skillsReport: {
        workspaceDir: "/workspace",
        managedSkillsDir: "/workspace/skills",
        skills: [skill({ skillKey: "market-research" })],
      },
    });

    expect(projection.summary).toMatchObject({
      total: 7,
      local: 2,
      remoteApi: 1,
      remoteMcp: 1,
      provider: 1,
      humanGate: 1,
      unsupported: 1,
      needsConfig: 2,
      needsAuth: 1,
    });
    expect(projection.routes.map((route) => [route.catalogRef, route.kind, route.status])).toEqual([
      ["tool:web.fetch@1.0", "local_tool", "available"],
      ["skill:market-research", "local_skill", "available"],
      ["api:replicate.image.generate", "remote_api", "needs_config"],
      ["mcp:zapier.gmail.send", "remote_mcp", "needs_auth"],
      ["provider:openai.image.generate", "provider_capability", "needs_config"],
      ["capability:human.confirm", "human_gate", "available"],
      ["finance.close-playbook", "unsupported", "unsupported"],
    ]);
  });

  it("maps local knowledge refs onto real memory and wiki tools", () => {
    const projection = buildCapabilityRoutingProjection({
      roles: [
        {
          catalogRefs: [
            "capability:knowledge.search",
            "capability:memory.get",
            "capability:knowledge.store",
          ],
        },
      ],
      toolsCatalogResult: {
        agentId: "main",
        profiles: [],
        groups: [
          {
            id: "memory",
            label: "Memory",
            source: "plugin",
            pluginId: "memory-core",
            tools: [
              {
                id: "memory_search",
                label: "Memory Search",
                description: "Search local private memory",
                source: "plugin",
                pluginId: "memory-core",
                defaultProfiles: [],
              },
              {
                id: "memory_get",
                label: "Memory Get",
                description: "Read local private memory",
                source: "plugin",
                pluginId: "memory-core",
                defaultProfiles: [],
              },
            ],
          },
        ],
      },
      skillsReport: null,
    });

    expect(projection.routes.map((route) => [route.catalogRef, route.kind, route.status])).toEqual([
      ["capability:knowledge.search", "local_tool", "available"],
      ["capability:memory.get", "local_tool", "available"],
      ["capability:knowledge.store", "local_tool", "can_install"],
    ]);
    expect(
      projection.routes.find((route) => route.catalogRef === "capability:knowledge.store")
        ?.installHint?.source,
    ).toBe("plugin_marketplace");
  });

  it("exports only safe local knowledge binding projections for real local tools", () => {
    const routing = buildCapabilityRoutingProjection({
      roles: [
        {
          categoryRef: "category:ecommerce_art_designer@1",
          categoryPackRef: "categorypack:ecommerce_art_designer@1",
          catalogRefs: [
            "capability:knowledge.search",
            "capability:memory.get",
            "capability:knowledge.store",
          ],
        },
      ],
      toolsCatalogResult: {
        agentId: "main",
        profiles: [],
        groups: [
          {
            id: "memory",
            label: "Memory",
            source: "plugin",
            pluginId: "memory-core",
            tools: [
              {
                id: "memory_search",
                label: "Memory Search",
                description: "Search local private memory",
                source: "plugin",
                pluginId: "memory-core",
                defaultProfiles: [],
              },
              {
                id: "memory_get",
                label: "Memory Get",
                description: "Read local private memory",
                source: "plugin",
                pluginId: "memory-core",
                defaultProfiles: [],
              },
            ],
          },
        ],
      },
      skillsReport: null,
    });

    const safeExport = buildLocalKnowledgeSafeBindingExport({
      routes: routing.routes,
      categoryRef: "category:ecommerce_art_designer@1",
      categoryPackRef: "categorypack:ecommerce_art_designer@1",
    });

    expect(safeExport.schemaVersion).toBe("aics.local_knowledge_binding_export.v1");
    expect(safeExport.projections.map((item) => item.catalogRef)).toEqual([
      "capability:knowledge.search",
      "capability:memory.get",
    ]);
    expect(safeExport.omittedRoutes).toEqual([
      {
        catalogRef: "capability:knowledge.store",
        status: "can_install",
        reason: "local knowledge tool is not installed or enabled",
      },
    ]);
    expect(safeExport.projections[0]).toMatchObject({
      schemaVersion: "aics.local_knowledge_binding.v1",
      knowledgeRef: "capability:knowledge.search",
      localCapabilityId: "memory_search",
      sourceType: "memory_core",
      routeStatus: "available",
      reviewRecommendation: "review_binding_projection_only",
    });
    expect(safeExport.projections[0]?.hash).toMatch(/^fnv1a:[a-f0-9]{8}$/u);

    const serialized = JSON.stringify(safeExport.projections);
    expect(serialized).not.toContain("localPath");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("providerKey");
    expect(serialized).not.toContain("oauthToken");
    expect(serialized).not.toContain("rawPrompt");
    expect(serialized).not.toContain("rawApiPayload");
    expect(serialized).not.toContain("Search local private memory");
  });

  it("keeps common local capabilities installable but routes generation to remote APIs", () => {
    const projection = buildCapabilityRoutingProjection({
      roles: [{ catalogRefs: ["capability:workspace.read", "capability:image.generate"] }],
      toolsCatalogResult: null,
      skillsReport: null,
    });

    expect(projection.routes.map((route) => [route.kind, route.status])).toEqual([
      ["local_tool", "can_install"],
      ["remote_api", "needs_config"],
    ]);
  });

  it("projects a category pack as the parent of its real skill and tool requirements", () => {
    const projection = buildCapabilityRoutingProjection({
      roles: [
        {
          categoryRef: "category:ecommerce_art_designer@1",
          categoryName: "电商美工",
          categoryPackRef: "categorypack:ecommerce_art_designer@1",
          skillPackRef: "skillpack:ecommerce_art_designer@1",
          toolPackRef: "toolpack:ecommerce_art_designer@1",
          inheritedCatalogRefs: [
            "categorypack:ecommerce_art_designer@1",
            "skillpack:ecommerce_art_designer@1",
            "toolpack:ecommerce_art_designer@1",
            "capability:workspace.read",
            "capability:image.generate",
            "capability:human.confirm@1.0.0",
          ],
          inheritedCapabilityRefs: ["workspace.read", "image.generate", "human.confirm"],
        },
      ],
      toolsCatalogResult: {
        agentId: "main",
        profiles: [],
        groups: [
          {
            id: "core",
            label: "Core",
            source: "core",
            tools: [
              {
                id: "workspace.read",
                label: "Workspace Read",
                description: "Read workspace files",
                source: "core",
                defaultProfiles: [],
              },
            ],
          },
        ],
      },
      skillsReport: null,
    });

    const packs = buildCapabilityCategoryPackProjection({
      roles: [
        {
          categoryRef: "category:ecommerce_art_designer@1",
          categoryName: "电商美工",
          categoryPackRef: "categorypack:ecommerce_art_designer@1",
          skillPackRef: "skillpack:ecommerce_art_designer@1",
          toolPackRef: "toolpack:ecommerce_art_designer@1",
          inheritedCatalogRefs: [
            "categorypack:ecommerce_art_designer@1",
            "skillpack:ecommerce_art_designer@1",
            "toolpack:ecommerce_art_designer@1",
            "capability:workspace.read",
            "capability:image.generate",
            "capability:human.confirm@1.0.0",
          ],
          inheritedCapabilityRefs: ["workspace.read", "image.generate", "human.confirm"],
        },
      ],
      routes: projection.routes,
      selectedCategoryRef: "category:ecommerce_art_designer@1",
    });

    expect(packs.selectedPack).toMatchObject({
      categoryRef: "category:ecommerce_art_designer@1",
      categoryName: "电商美工",
      categoryPackRef: "categorypack:ecommerce_art_designer@1",
      skillPackRef: "skillpack:ecommerce_art_designer@1",
      toolPackRef: "toolpack:ecommerce_art_designer@1",
    });
    expect(
      packs.selectedPack?.routes.map((route) => [route.catalogRef, route.kind, route.status]),
    ).toEqual([
      ["categorypack:ecommerce_art_designer@1", "category_pack", "can_install"],
      ["skillpack:ecommerce_art_designer@1", "skill_pack", "can_install"],
      ["toolpack:ecommerce_art_designer@1", "tool_pack", "can_install"],
      ["capability:workspace.read", "local_tool", "available"],
      ["capability:image.generate", "remote_api", "needs_config"],
      ["capability:human.confirm@1.0.0", "human_gate", "available"],
    ]);
    expect(packs.selectedPack?.preflight.status).toBe("needs_setup");
    expect(
      packs.selectedPack?.routes.find((route) => route.catalogRef === "capability:image.generate")
        ?.installHint?.source,
    ).toBe("provider_config");
  });

  it("keeps cloud-blocked catalog bindings blocked even when a local route exists", () => {
    const projection = buildCapabilityRoutingProjection({
      roles: [
        {
          catalogRefs: ["tool:web.fetch@1.0", "api:unapproved.generator@1.0"],
          blockedCatalogRefs: ["tool:web.fetch@1.0", "api:unapproved.generator@1.0"],
        },
      ],
      toolsCatalogResult: {
        agentId: "main",
        profiles: [],
        groups: [
          {
            id: "core",
            label: "Core",
            source: "core",
            tools: [
              {
                id: "web.fetch",
                label: "Web Fetch",
                description: "Fetch web pages",
                source: "core",
                defaultProfiles: [],
              },
            ],
          },
        ],
      },
      skillsReport: null,
    });

    expect(projection.routes.map((route) => [route.catalogRef, route.kind, route.status])).toEqual([
      ["tool:web.fetch@1.0", "local_tool", "blocked"],
      ["api:unapproved.generator@1.0", "remote_api", "blocked"],
    ]);
    expect(buildCapabilityPreflight(projection.routes).status).toBe("blocked");
  });

  it("treats a cloud role with blocked bindings as blocked when explicit refs are absent", () => {
    const projection = buildCapabilityRoutingProjection({
      roles: [
        {
          callable: false,
          unavailableReasons: ["blocked_catalog_bindings"],
          catalogRefs: ["provider:openai.image.generate"],
        },
      ],
      toolsCatalogResult: null,
      skillsReport: null,
    });

    expect(projection.routes).toHaveLength(1);
    expect(projection.routes[0]).toMatchObject({
      catalogRef: "provider:openai.image.generate",
      kind: "provider_capability",
      status: "blocked",
    });
  });

  it("summarizes project capability preflight without requiring every capability locally", () => {
    const projection = buildCapabilityRoutingProjection({
      roles: [],
      catalogRefs: [
        "tool:web.fetch@1.0",
        "mcp:remote.toolhub.registry",
        "provider:openai.text.reasoning",
        "capability:human.confirm",
      ],
      toolsCatalogResult: {
        agentId: "main",
        profiles: [],
        groups: [
          {
            id: "core",
            label: "Core",
            source: "core",
            tools: [
              {
                id: "web.fetch",
                label: "Web Fetch",
                description: "Fetch web pages",
                source: "core",
                defaultProfiles: [],
              },
            ],
          },
        ],
      },
      skillsReport: null,
    });

    const preflight = buildCapabilityPreflight(projection.routes);

    expect(preflight.status).toBe("needs_auth");
    expect(preflight.label).toBe("等待授权");
    expect(preflight.routes.map((route) => [route.catalogRef, route.kind, route.status])).toEqual([
      ["tool:web.fetch@1.0", "local_tool", "available"],
      ["mcp:remote.toolhub.registry", "remote_mcp", "needs_auth"],
      ["provider:openai.text.reasoning", "provider_capability", "needs_config"],
      ["capability:human.confirm", "human_gate", "available"],
    ]);
    expect(preflight.reviewRoutes.map((route) => route.catalogRef)).toContain(
      "capability:human.confirm",
    );
  });

  it("normalizes version suffixes but keeps namespaced refs intact", () => {
    expect(normalizeCatalogLookupRef(" tool:web.fetch@1.0 ")).toBe("tool:web.fetch");
    expect(normalizeCatalogLookupRef("plugin:image-plugin:image.inspect@2")).toBe(
      "plugin:image-plugin:image.inspect",
    );
  });
});
