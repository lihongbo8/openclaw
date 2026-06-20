import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry, resolveCapabilities, executeToolCall } from "./tool-registry.js";
import type { ToolRegistration } from "./tool-registry.js";

function makeTool(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    toolId: overrides.toolId ?? "test-tool",
    name: overrides.name ?? "test",
    label: overrides.label ?? "Test Tool",
    description: overrides.description ?? "A test tool",
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

describe("ToolRegistry", () => {
  beforeEach(() => ToolRegistry._clear());

  it("registers and retrieves tools", () => {
    ToolRegistry.register(makeTool({ toolId: "img-gen", capabilities: ["image.generation"] }));
    expect(ToolRegistry.get("img-gen")).toBeDefined();
    expect(ToolRegistry.listEnabled()).toHaveLength(1);
  });

  it("finds by capability", () => {
    ToolRegistry.register(makeTool({ toolId: "img-gen", capabilities: ["image.generation"] }));
    ToolRegistry.register(makeTool({ toolId: "vid-gen", capabilities: ["video.generation"] }));
    expect(ToolRegistry.findByCapability("image.generation")).toHaveLength(1);
    expect(ToolRegistry.findByCapability("video.generation")).toHaveLength(1);
    expect(ToolRegistry.findByCapability("web.search")).toHaveLength(0);
  });

  it("filters by risk level", () => {
    ToolRegistry.register(makeTool({ toolId: "low", riskLevel: "low" }));
    ToolRegistry.register(makeTool({ toolId: "high", riskLevel: "high" }));
    ToolRegistry.register(makeTool({ toolId: "critical", riskLevel: "critical" }));
    expect(ToolRegistry.findByRisk("low")).toHaveLength(1);
    expect(ToolRegistry.findByRisk("high")).toHaveLength(2);
  });

  it("unregisters tools", () => {
    ToolRegistry.register(makeTool({ toolId: "t1" }));
    ToolRegistry.unregister("t1");
    expect(ToolRegistry.get("t1")).toBeUndefined();
  });

  it("summary shows correct counts", () => {
    ToolRegistry.register(makeTool({ toolId: "t1", riskLevel: "low", enabled: true }));
    ToolRegistry.register(makeTool({ toolId: "t2", riskLevel: "high", enabled: true }));
    ToolRegistry.register(makeTool({ toolId: "t3", riskLevel: "low", enabled: false }));
    const s = ToolRegistry.summary();
    expect(s.total).toBe(3);
    expect(s.enabled).toBe(2);
    expect(s.byRisk.low).toBe(1);
    expect(s.byRisk.high).toBe(1);
  });
});

describe("resolveCapabilities", () => {
  beforeEach(() => ToolRegistry._clear());

  it("returns ready for matched capability", () => {
    ToolRegistry.register(makeTool({ toolId: "img-gen", capabilities: ["image.generation"] }));
    const report = resolveCapabilities(["image.generation"]);
    expect(report.summary.ready).toBe(1);
    expect(report.summary.missing).toBe(0);
  });

  it("returns missing for unknown capability", () => {
    ToolRegistry.register(makeTool({ toolId: "img-gen", capabilities: ["image.generation"] }));
    const report = resolveCapabilities(["image.generation", "unknown.cap"]);
    expect(report.summary.ready).toBe(1);
    expect(report.summary.missing).toBe(1);
  });
});

describe("executeToolCall", () => {
  beforeEach(() => ToolRegistry._clear());

  it("treats candidate tool refs as a hard execution boundary", async () => {
    ToolRegistry.register(makeTool({ toolId: "img-gen", capabilities: ["image.generation"] }));

    const response = await executeToolCall({
      requestId: "req-1",
      roleRunRef: "run-1",
      workflowStepRef: "step-1",
      toolCapability: "image.generation",
      candidateToolRefs: ["other-tool"],
      input: { prompt: "商品主图" },
      expectedOutput: "商品主图",
      riskLevel: "low",
      humanConfirmPolicy: "auto",
      qualityRequirement: "必须生成真实图片",
    });

    expect(response.blockedReason).toContain("image.generation");
    expect(response.riskFlags).toContain("no_tool_available");
    expect(response.selectedToolRef).toBe("none");
  });

  it("prefers a lower-risk non-confirming tool for automatic execution", async () => {
    ToolRegistry.register(
      makeTool({
        toolId: "high-risk-img",
        capabilities: ["image.generation"],
        riskLevel: "high",
        requiresHumanConfirm: true,
      }),
    );
    ToolRegistry.register(
      makeTool({
        toolId: "low-risk-img",
        capabilities: ["image.generation"],
        riskLevel: "low",
        handler: async () => ({
          ok: true,
          output: { selected: true },
          artifactRefs: ["artifact:image:hero.png"],
          durationMs: 1,
          qualityCheckPassed: true,
        }),
      }),
    );

    const response = await executeToolCall({
      requestId: "req-2",
      roleRunRef: "run-2",
      workflowStepRef: "step-1",
      toolCapability: "image.generation",
      input: { prompt: "商品主图" },
      expectedOutput: "商品主图",
      riskLevel: "low",
      humanConfirmPolicy: "auto",
      qualityRequirement: "必须生成真实图片",
    });

    expect(response.selectedToolRef).toBe("low-risk-img");
    expect(response.needHumanConfirm).toBe(false);
    expect(response.artifactRefs).toEqual(["artifact:image:hero.png"]);
  });

  it("blocks high-risk tools when human confirmation is forbidden", async () => {
    ToolRegistry.register(
      makeTool({
        toolId: "workspace-shell",
        capabilities: ["workspace.shell"],
        riskLevel: "high",
      }),
    );

    const response = await executeToolCall({
      requestId: "req-3",
      roleRunRef: "run-3",
      workflowStepRef: "step-1",
      toolCapability: "workspace.shell",
      input: { command: "deploy" },
      expectedOutput: "命令执行结果",
      riskLevel: "high",
      humanConfirmPolicy: "never",
      qualityRequirement: "必须可审计",
    });

    expect(response.selectedToolRef).toBe("blocked_by_risk");
    expect(response.blockedReason).toBe("risk_policy_block");
    expect(response.needHumanConfirm).toBe(true);
  });

  it("returns a human confirmation request for high-risk auto execution", async () => {
    ToolRegistry.register(
      makeTool({
        toolId: "workspace-shell",
        label: "Workspace Shell",
        capabilities: ["workspace.shell"],
        riskLevel: "high",
      }),
    );

    const response = await executeToolCall({
      requestId: "req-4",
      roleRunRef: "run-4",
      workflowStepRef: "step-1",
      toolCapability: "workspace.shell",
      input: { command: "deploy" },
      expectedOutput: "命令执行结果",
      riskLevel: "high",
      humanConfirmPolicy: "auto",
      qualityRequirement: "必须可审计",
    });

    expect(response.selectedToolRef).toBe("workspace-shell");
    expect(response.needHumanConfirm).toBe(true);
    expect(response.humanConfirmRequest).toContain("Workspace Shell");
  });
});
