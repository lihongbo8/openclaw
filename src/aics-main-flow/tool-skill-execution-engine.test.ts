import { describe, expect, beforeEach, it } from "vitest";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { ToolExecutionDb } from "./tool-execution-db.js";
import { ToolRegistry, type ToolRegistration } from "./tool-registry.js";
import { createToolSkillExecutionEngine } from "./tool-skill-execution-engine.js";

function makeTool(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    toolId: overrides.toolId ?? "img-tool",
    name: overrides.name ?? "image-generator",
    label: overrides.label ?? "Image Generator",
    description: overrides.description ?? "Generates an image artifact",
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
        output: {
          prompt: typeof input.prompt === "string" ? input.prompt : "",
        },
        artifactRefs: ["artifact:image:hero.png"],
        durationMs: 3,
        qualityCheckPassed: true,
      })),
    enabled: overrides.enabled ?? true,
    source: overrides.source ?? "core",
  };
}

describe("ToolSkillExecutionEngine", () => {
  beforeEach(() => ToolRegistry._clear());

  it("executes an allowed skill through a matching tool and records the call", async () => {
    await withStateDirEnv("aics-tool-skill-engine-", async () => {
      ToolRegistry.register(makeTool({ toolId: "img-tool", name: "image-generator" }));

      const engine = createToolSkillExecutionEngine();
      const result = await engine.execute({
        roleRunRef: "run-1",
        workflowStepRef: "step-1",
        skillId: "img:gen",
        allowedSkillIds: ["img:gen"],
        allowedToolRefs: ["img-tool"],
        input: { prompt: "生成一张电商商品主图" },
        expectedOutput: "商品主图",
      });

      expect(result.ok).toBe(true);
      expect(result.skill).toMatchObject({
        skillId: "img:gen",
        capability: "image.generation",
      });
      expect(result.response.selectedToolRef).toBe("img-tool");
      expect(result.response.artifactRefs).toEqual(["artifact:image:hero.png"]);

      const records = ToolExecutionDb.findByRun("run-1");
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        requestId: result.requestId,
        roleRunRef: "run-1",
        workflowStepRef: "step-1",
        toolRef: "img-tool",
        toolCapability: "image.generation",
        status: "ok",
        artifactRefs: ["artifact:image:hero.png"],
      });
    });
  });

  it("blocks a skill that is not allowed by the dispatch request", async () => {
    await withStateDirEnv("aics-tool-skill-engine-block-skill-", async () => {
      ToolRegistry.register(makeTool({ toolId: "img-tool" }));

      const result = await createToolSkillExecutionEngine().execute({
        roleRunRef: "run-2",
        workflowStepRef: "step-1",
        skillId: "img:gen",
        allowedSkillIds: ["ws:read"],
        allowedToolRefs: ["img-tool"],
        input: { prompt: "生成主图" },
        expectedOutput: "商品主图",
      });

      expect(result.ok).toBe(false);
      expect(result.response.blockedReason).toContain("未在本次调度允许列表");
      expect(ToolExecutionDb.findByRun("run-2")).toHaveLength(0);
    });
  });

  it("blocks a tool outside the allowed tool refs", async () => {
    await withStateDirEnv("aics-tool-skill-engine-block-tool-", async () => {
      ToolRegistry.register(makeTool({ toolId: "img-tool" }));

      const result = await createToolSkillExecutionEngine().execute({
        roleRunRef: "run-3",
        workflowStepRef: "step-1",
        skillId: "img:gen",
        allowedSkillIds: ["img:gen"],
        allowedToolRefs: ["other-tool"],
        input: { prompt: "生成主图" },
        expectedOutput: "商品主图",
      });

      expect(result.ok).toBe(false);
      expect(result.response.blockedReason).toContain("没有匹配本次调度允许的工具");
      expect(ToolExecutionDb.findByRun("run-3")).toHaveLength(0);
    });
  });

  it("requires human confirmation for high-risk tools before running the handler", async () => {
    await withStateDirEnv("aics-tool-skill-engine-high-risk-confirm-", async () => {
      let handlerCalled = false;
      ToolRegistry.register(
        makeTool({
          toolId: "workspace-shell",
          name: "workspace-shell",
          label: "Workspace Shell",
          capabilities: ["workspace.shell"],
          riskLevel: "high",
          handler: async () => {
            handlerCalled = true;
            return {
              ok: true,
              output: { published: true },
              artifactRefs: ["external_record:publish:unsafe"],
              durationMs: 3,
              qualityCheckPassed: true,
            };
          },
        }),
      );

      const result = await createToolSkillExecutionEngine().execute({
        roleRunRef: "run-4",
        workflowStepRef: "step-1",
        capability: "workspace.shell",
        allowedToolRefs: ["workspace-shell"],
        input: { command: "publish external article" },
        expectedOutput: "外部发布记录",
      });

      expect(handlerCalled).toBe(false);
      expect(result.ok).toBe(false);
      expect(result.response.needHumanConfirm).toBe(true);
      expect(result.response.humanConfirmRequest).toContain("Workspace Shell");

      const records = ToolExecutionDb.findByRun("run-4");
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        roleRunRef: "run-4",
        workflowStepRef: "step-1",
        toolRef: "workspace-shell",
        toolCapability: "workspace.shell",
        status: "needs_human_confirm",
        artifactRefs: [],
      });
    });
  });
});
