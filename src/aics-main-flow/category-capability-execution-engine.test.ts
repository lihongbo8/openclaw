import { beforeEach, describe, expect, it } from "vitest";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import {
  composeCategoryCapability,
  createCategoryCapabilityExecutionEngine,
} from "./category-capability-execution-engine.js";
import { ToolExecutionDb } from "./tool-execution-db.js";
import { ToolRegistry, type ToolRegistration } from "./tool-registry.js";

function makeTool(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    toolId: overrides.toolId ?? "tool-image-generation",
    name: overrides.name ?? "image-generator",
    label: overrides.label ?? "Image Generator",
    description: overrides.description ?? "Test tool",
    capabilities: overrides.capabilities ?? ["image.generation"],
    inputSchema: {},
    outputSchema: {},
    riskLevel: overrides.riskLevel ?? "low",
    requiresHumanConfirm: overrides.requiresHumanConfirm ?? false,
    qualityCheckRules: [],
    handler:
      overrides.handler ??
      (async (input) => ({
        ok: true,
        output: { input },
        artifactRefs: [`artifact:${overrides.toolId ?? "tool-image-generation"}`],
        durationMs: 1,
        qualityCheckPassed: true,
      })),
    enabled: overrides.enabled ?? true,
    source: overrides.source ?? "core",
  };
}

describe("CategoryCapabilityExecutionEngine", () => {
  beforeEach(() => ToolRegistry._clear());

  it("composes selected category skills with matching tools", () => {
    ToolRegistry.register(makeTool({ toolId: "tool-img", capabilities: ["image.generation"] }));
    ToolRegistry.register(makeTool({ toolId: "tool-pack", capabilities: ["file.packaging"] }));

    const bundle = composeCategoryCapability({
      categoryId: "ecommerce-visual",
      skillIds: ["img:gen", "file:pack"],
    });

    expect(bundle).toMatchObject({
      categoryId: "ecommerce-visual",
      readiness: "ready",
      components: [
        {
          skillId: "img:gen",
          capability: "image.generation",
          toolRefs: ["tool-img"],
          status: "ready",
        },
        {
          skillId: "file:pack",
          capability: "file.packaging",
          toolRefs: ["tool-pack"],
          status: "ready",
        },
      ],
      blockedReasons: [],
    });
  });

  it("executes a ready category capability through the Tool/Skill engine", async () => {
    await withStateDirEnv("aics-category-capability-exec-", async () => {
      ToolRegistry.register(
        makeTool({
          toolId: "tool-img",
          capabilities: ["image.generation"],
          handler: async () => ({
            ok: true,
            output: { image: "hero.png" },
            artifactRefs: ["artifact:image:hero.png"],
            durationMs: 1,
            qualityCheckPassed: true,
          }),
        }),
      );
      ToolRegistry.register(
        makeTool({
          toolId: "tool-pack",
          capabilities: ["file.packaging"],
          handler: async () => ({
            ok: true,
            output: { archive: "artifacts.zip" },
            artifactRefs: ["artifact:archive:artifacts.zip"],
            durationMs: 1,
            qualityCheckPassed: true,
          }),
        }),
      );

      const result = await createCategoryCapabilityExecutionEngine().execute({
        categoryId: "ecommerce-visual",
        skillIds: ["img:gen", "file:pack"],
        roleRunRef: "run-category-1",
        workflowStepRef: "category-ecommerce",
        input: { prompt: "生成电商主图并打包" },
        expectedOutput: "电商品类能力执行结果",
      });

      expect(result.status).toBe("succeeded");
      expect(result.artifactRefs).toEqual([
        "artifact:image:hero.png",
        "artifact:archive:artifacts.zip",
      ]);
      expect(result.structuredOutputBySkillId).toMatchObject({
        "img:gen": { image: "hero.png" },
        "file:pack": { archive: "artifacts.zip" },
      });
      expect(ToolExecutionDb.findByRun("run-category-1")).toHaveLength(2);
    });
  });

  it("blocks execution when allowed tools do not cover the category capability", async () => {
    await withStateDirEnv("aics-category-capability-block-", async () => {
      ToolRegistry.register(makeTool({ toolId: "tool-img", capabilities: ["image.generation"] }));

      const result = await createCategoryCapabilityExecutionEngine().execute({
        categoryId: "ecommerce-visual",
        skillIds: ["img:gen"],
        allowedToolRefs: ["other-tool"],
        roleRunRef: "run-category-blocked",
        workflowStepRef: "category-ecommerce",
        input: { prompt: "生成主图" },
      });

      expect(result.status).toBe("blocked");
      expect(result.blockedReason).toContain("没有匹配本次品类能力允许的工具");
      expect(result.steps).toHaveLength(0);
      expect(ToolExecutionDb.findByRun("run-category-blocked")).toHaveLength(0);
    });
  });

  it("returns a human confirmation state for high-risk category capability steps", async () => {
    await withStateDirEnv("aics-category-capability-confirm-", async () => {
      ToolRegistry.register(
        makeTool({
          toolId: "tool-shell",
          label: "Workspace Shell",
          capabilities: ["workspace.shell"],
          riskLevel: "high",
        }),
      );

      const result = await createCategoryCapabilityExecutionEngine().execute({
        categoryId: "data-analysis",
        skillIds: ["ws:shell"],
        roleRunRef: "run-category-confirm",
        workflowStepRef: "category-data",
        input: { command: "analyze data" },
        expectedOutput: "命令执行结果",
      });

      expect(result.status).toBe("needs_human_confirm");
      expect(result.blockedReason).toContain("Workspace Shell");
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].result.response.needHumanConfirm).toBe(true);
    });
  });
});
