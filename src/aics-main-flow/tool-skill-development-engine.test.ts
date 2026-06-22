import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import {
  approveCategoryCapabilityReview,
  approveToolSkillReview,
  createCategoryCapabilityRequest,
  listToolSkillReviews,
  runToolSkillValidation,
} from "./role-pre-listing-review.js";
import { ToolRegistry, type ToolRegistration } from "./tool-registry.js";
import { createToolSkillDevelopmentEngine } from "./tool-skill-development-engine.js";

function makeTool(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    toolId: overrides.toolId ?? "image-gen-tool",
    name: overrides.name ?? "image-generator",
    label: overrides.label ?? "Image Generator",
    description: overrides.description ?? "Generates image assets",
    capabilities: overrides.capabilities ?? ["image.generation"],
    inputSchema: {},
    outputSchema: {},
    riskLevel: overrides.riskLevel ?? "low",
    requiresHumanConfirm: overrides.requiresHumanConfirm ?? false,
    qualityCheckRules: [],
    handler:
      overrides.handler ??
      (async () => ({
        ok: true,
        output: {},
        artifactRefs: [],
        durationMs: 1,
        qualityCheckPassed: true,
      })),
    enabled: overrides.enabled ?? true,
    source: overrides.source ?? "core",
  };
}

function createImageToolTask() {
  const request = createCategoryCapabilityRequest({
    requestId: `category-capability:${randomUUID()}`,
    title: "电商图片制作能力",
    categoryName: "电商",
    categoryRef: "category.ecommerce",
    toolSkillRequirements: ["image-gen-tool"],
    requiredCapabilities: ["image.generation"],
    riskBoundaries: ["不得自动发布或扣费。"],
  });
  approveCategoryCapabilityReview(request.id);
  return createToolSkillDevelopmentEngine().listTasksForCategory(request.id)[0]!;
}

describe("ToolSkillDevelopmentEngine", () => {
  beforeEach(() => ToolRegistry._clear());

  it("keeps missing runtime inside the development task and does not create final reviews early", async () => {
    await withStateDirEnv("aics-tool-skill-dev-missing-", async () => {
      const task = createImageToolTask();
      const engine = createToolSkillDevelopmentEngine();

      const state = engine.runValidation({
        taskId: task.id,
        assetType: "tool",
        assetId: "image-gen-tool",
        declaredCapabilities: ["image.generation"],
      });

      expect(state.status).toBe("candidate_found");
      expect(state.runtime.status).toBe("missing");
      expect(state.nextActions[0]).toMatchObject({
        kind: "select_source",
        enabled: true,
      });
      expect(listToolSkillReviews()).toHaveLength(0);
    });
  });

  it("reuses an available local tool and links a final review only when validation runs", async () => {
    await withStateDirEnv("aics-tool-skill-dev-ready-", async () => {
      ToolRegistry.register(makeTool({ toolId: "image-gen-tool" }));
      const task = createImageToolTask();
      const engine = createToolSkillDevelopmentEngine();

      const planned = engine.planSource({
        taskId: task.id,
        assetType: "tool",
        assetId: "image-gen-tool",
        declaredCapabilities: ["image.generation"],
      });
      const checked = engine.runValidation({
        taskId: task.id,
        assetType: "tool",
        assetId: "image-gen-tool",
        declaredCapabilities: ["image.generation"],
      });

      expect(planned.status).toBe("runtime_ready");
      expect(planned.sourceRoute).toBe("reuse_existing");
      expect(checked.status).toBe("waiting_manual_approval");
      expect(checked.review?.reviewStatus).toBe("检查中");
      expect(checked.task?.linkedReviewId).toBe(checked.review?.id);
      expect(checked.runtime).toMatchObject({
        status: "available",
        matchingRefs: ["image-gen-tool"],
      });
      expect(checked.nextActions[0]).toMatchObject({
        kind: "manual_approve",
        enabled: true,
      });
    });
  });

  it("reports approved assets as ready for capability binding", async () => {
    await withStateDirEnv("aics-tool-skill-dev-approved-", async () => {
      ToolRegistry.register(makeTool({ toolId: "image-gen-tool" }));
      const task = createImageToolTask();
      const engine = createToolSkillDevelopmentEngine();

      const checked = engine.runValidation({
        taskId: task.id,
        assetType: "tool",
        assetId: "image-gen-tool",
        declaredCapabilities: ["image.generation"],
      });
      runToolSkillValidation(checked.review!.id);
      approveToolSkillReview(checked.review!.id);

      const state = engine.getStatus({
        taskId: task.id,
        assetType: "tool",
        assetId: "image-gen-tool",
        declaredCapabilities: ["image.generation"],
      });

      expect(state.status).toBe("approved");
      expect(state.nextActions[0]).toMatchObject({
        kind: "use_asset",
        enabled: true,
      });
    });
  });
});
