import { describe, expect, it } from "vitest";
import { resolveRoleCategoryCapabilityGrant } from "./role-category-capability-resolver.js";

describe("RoleCategoryCapabilityResolver", () => {
  it("turns a dispatch-ready category capability into execution grants", () => {
    const grant = resolveRoleCategoryCapabilityGrant({
      categoryCapabilityId: "cloud:cap-ecommerce",
      category: "电商视觉",
      allowedTools: ["tool:image-provider"],
      allowedSkills: ["skill:image-edit"],
      dispatchReady: true,
      blockedReasons: [],
    });

    expect(grant).toMatchObject({
      categoryCapabilityId: "cloud:cap-ecommerce",
      category: "电商视觉",
      toolSkillReady: true,
      apiBindingReady: true,
      capabilityBlockedReasons: [],
    });
    expect(grant.allowedTools).toEqual(
      expect.arrayContaining([
        "tool:image-provider",
        "core.openai.image.generate",
        "core.workspace.detail.write",
        "core.artifact.quality.check",
        "core.artifact.package.bundle",
      ]),
    );
    expect(grant.allowedSkills).toEqual(
      expect.arrayContaining([
        "skill:image-edit",
        "img:gen",
        "ws:write",
        "quality:check",
        "file:pack",
      ]),
    );
  });

  it("blocks when a role has no bound category capability", () => {
    const grant = resolveRoleCategoryCapabilityGrant(undefined);

    expect(grant).toMatchObject({
      allowedTools: [],
      allowedSkills: [],
      toolSkillReady: false,
      apiBindingReady: true,
    });
    expect(grant.capabilityBlockedReasons).toEqual([
      "missing_category_binding",
      "missing_tool_binding",
      "missing_skill_binding",
    ]);
  });

  it("keeps API and high-risk blocks visible for role execution preflight", () => {
    const grant = resolveRoleCategoryCapabilityGrant({
      categoryCapabilityId: "cloud:cap-risk",
      category: "高风险运营",
      allowedTools: ["tool:publish"],
      allowedSkills: ["skill:publish"],
      dispatchReady: false,
      blockedReasons: ["api_binding_required", "high_risk_needs_human_approval"],
    });

    expect(grant.allowedTools).toEqual(["tool:publish"]);
    expect(grant.allowedSkills).toEqual(["skill:publish"]);
    expect(grant.apiBindingReady).toBe(false);
    expect(grant.toolSkillReady).toBe(false);
    expect(grant.capabilityBlockedReasons).toEqual([
      "missing_api_binding",
      "high_risk_needs_human_approval",
    ]);
  });
});
