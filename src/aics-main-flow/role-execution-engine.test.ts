import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, it, expect } from "vitest";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { closeMemoryDb, closePipelineDb, closeRoleInstancesDb } from "./db.js";
import { dispatchAndExecute } from "./dispatcher.js";
import { MemoryCandidateStore, MemoryConfirmService } from "./memory-system.js";
import { createRoleExecutionEngine } from "./role-execution-engine.js";
import type { RoleExecutionContext, RoleExecutor } from "./role-execution-types.js";
import {
  AicsMainFlowStore,
  confirmAttribution,
  confirmDispatch,
  confirmGoal,
  confirmObservation,
  confirmPlanning,
  confirmRoleExecution,
  confirmRoleExecutionCost,
  createDispatchProposal,
  createGoalCandidate,
  materializeTaskPackage,
  prepareAttribution,
  prepareObservation,
  preparePlanning,
} from "./store.js";
import { ToolExecutionDb } from "./tool-execution-db.js";
import { ToolRegistry, type ToolRegistration } from "./tool-registry.js";
import type { TaskPackage } from "./types.js";

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function makeImageTool(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
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

function taskPackage(suffix: string): TaskPackage {
  const now = Date.now();
  return {
    id: `tp_memory_${suffix}`,
    kind: "TaskPackage",
    status: "materialized",
    createdAt: now,
    updatedAt: now,
    auditRefs: [],
    goalId: `goal_${suffix}`,
    planningPackageId: `plan_${suffix}`,
    rolePlanItemId: `rpi_${suffix}`,
    dispatchProposalReviewId: `dispatch_${suffix}`,
    title: "美工海报优化",
    taskText: "生成适合商城首屏的美工海报",
    category: "visual-design",
    requiredCapabilityRefs: ["visual-design"],
  };
}

function markPreflightReady(context: RoleExecutionContext): RoleExecutionContext {
  context.preflightSnapshot = {
    checkedAt: Date.now(),
    taskDispatched: true,
    roleAuthorized: true,
    humanConfirmed: true,
    costConfirmed: true,
    toolSkillReady: true,
    apiBindingReady: true,
    ledgerRefPresent: true,
    allowedTools: context.availableTools,
    allowedSkills: context.allowedSkills,
    taskPackageId: context.taskPackage.id,
    dispatchToRoleRequestId: `dispatch:${context.taskPackage.id}`,
    roleListingId:
      context.taskPackage.requiredCapabilityRefs?.[0] ?? context.taskPackage.rolePlanItemId,
    entitlementId: `entitlement:${context.taskPackage.id}`,
  };
  return context;
}

async function withHomeEnv<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    return await fn();
  } finally {
    if (typeof previousHome === "undefined") {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
}

describe("RoleExecutionEngine memory context", () => {
  it("builds a work-pattern execution plan before running an executor", async () => {
    await withStateDirEnv("aics-role-execution-plan-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = engine.prepare(taskPackage("plan"), { workspaceRoot: tempRoot });

      expect(context.executionPlan).toMatchObject({
        workPatterns: ["generate"],
        outputContracts: ["image"],
        businessCategory: "visual-design",
        inferredWorkPattern: true,
        inferredOutputContract: true,
      });
      expect(context.executionPlan.executionChoice).toContain("不按品类分支执行");
      expect(context.executionPlan.validationRules).toEqual(
        expect.arrayContaining(["image: 文件存在、非空、格式正确"]),
      );
      expect(context.preflightSnapshot).toMatchObject({
        taskDispatched: true,
        roleAuthorized: false,
        humanConfirmed: false,
        costConfirmed: false,
        apiBindingReady: false,
        allowedTools: [],
        allowedSkills: [],
        taskPackageId: "tp_memory_plan",
      });
      closeMemoryDb();
    });
  });

  it("includes business context quality rules and forbidden actions in the execution plan", async () => {
    await withStateDirEnv("aics-role-business-context-plan-", async ({ tempRoot }) => {
      closeMemoryDb();
      await withHomeEnv(tempRoot, async () => {
        const rolePackageDir = path.join(tempRoot, "dijie-role-packages", "rpi_business_context");
        mkdirSync(rolePackageDir, { recursive: true });
        writeFileSync(
          path.join(rolePackageDir, "manifest.json"),
          JSON.stringify({
            roleId: "rpi_business_context",
            title: "招聘页面执行岗位",
            description: "生成招聘岗位页面",
            version: "1",
            requiredCapabilities: [],
            workflows: [],
            skills: [],
            knowledgeFiles: [],
            templateFiles: [],
            sopFiles: [],
            workPatterns: ["generate"],
            outputContracts: ["html"],
            businessCategory: "招聘",
            businessContext: {
              businessCategory: "招聘",
              qualityStandards: ["必须说明岗位职责、薪资范围和投递方式"],
              styleRules: ["语气专业，不使用夸张营销词"],
              metricRules: ["必须包含不少于 3 个候选人筛选指标"],
              forbiddenActions: ["不得承诺录用结果", "不得收集身份证号"],
            },
          }),
          "utf-8",
        );

        const engine = createRoleExecutionEngine();
        const context = engine.prepare(
          {
            ...taskPackage("business-context"),
            id: "tp_business_context",
            rolePlanItemId: "rpi_business_context",
            title: "生成招聘岗位页",
            taskText: "为门店店长岗位生成招聘页面。",
            category: "招聘",
          },
          { workspaceRoot: path.join(tempRoot, "executions") },
        );

        expect(context.executionPlan).toMatchObject({
          workPatterns: ["generate"],
          outputContracts: ["html"],
          businessCategory: "招聘",
          businessContext: expect.objectContaining({
            qualityStandards: ["必须说明岗位职责、薪资范围和投递方式"],
            forbiddenActions: ["不得承诺录用结果", "不得收集身份证号"],
          }),
        });
        expect(context.executionPlan.validationRules).toEqual(
          expect.arrayContaining([
            "html: 可打开、引用资源存在",
            "业务质量: 必须说明岗位职责、薪资范围和投递方式",
            "业务风格: 语气专业，不使用夸张营销词",
            "业务指标: 必须包含不少于 3 个候选人筛选指标",
          ]),
        );
        expect(context.executionPlan.riskCheckpoints).toEqual(
          expect.arrayContaining(["禁止动作: 不得承诺录用结果", "禁止动作: 不得收集身份证号"]),
        );
      });
      closeMemoryDb();
    });
  });

  it("downgrades a succeeded executor result when output contracts are missing artifacts", async () => {
    await withStateDirEnv("aics-role-output-validation-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("missing-package"),
            title: "详情页打包任务",
            taskText: "生成详情页并打包交付。",
            category: "通用页面",
          },
          { workspaceRoot: tempRoot },
        ),
      );
      expect(context.executionPlan.outputContracts).toEqual(
        expect.arrayContaining(["html", "package"]),
      );

      const result = await engine.execute(context, {
        async execute(runContext) {
          writeFileSync(
            `${runContext.workspaceDir}/detail.html`,
            "<!doctype html><html><body>ok</body></html>",
            "utf-8",
          );
          const stepStartedAt = Date.now();
          return {
            output: "详情页已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-html-only",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入 HTML",
                outputSummary: "只写入 detail.html",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("package");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: false,
        checkedContracts: expect.arrayContaining(["html", "package"]),
        failures: expect.arrayContaining([expect.stringContaining("缺少 package 产物")]),
      });
      expect(result.executionEvidence).toMatchObject({
        inferredWorkPattern: true,
        inferredOutputContract: true,
      });
      expect(result.executionEvidence.recoverySuggestion).toContain("产物验收未通过");
      closeMemoryDb();
    });
  });

  it("blocks html output contracts when local referenced assets are missing", async () => {
    await withStateDirEnv("aics-role-html-missing-asset-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("html-missing-asset"),
            title: "详情页任务",
            taskText: "生成详情页 HTML。",
            category: "通用页面",
          },
          { workspaceRoot: tempRoot },
        ),
      );
      expect(context.executionPlan.outputContracts).toEqual(["html"]);

      const result = await engine.execute(context, {
        async execute(runContext) {
          writeFileSync(
            `${runContext.workspaceDir}/detail.html`,
            '<!doctype html><html><body><img src="./missing.png" alt="missing" /></body></html>',
            "utf-8",
          );
          const stepStartedAt = Date.now();
          return {
            output: "详情页已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-html-with-missing-asset",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入 HTML",
                outputSummary: "写入缺失图片引用",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("html 产物引用资源缺失");
      expect(result.blockedReason).toContain("missing.png");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: false,
        checkedContracts: ["html"],
        failures: [expect.stringContaining("detail.html -> ./missing.png")],
      });
      closeMemoryDb();
    });
  });

  it("blocks image output contracts when the file extension is png but bytes are not an image", async () => {
    await withStateDirEnv("aics-role-invalid-image-format-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(taskPackage("invalid-image"), {
          workspaceRoot: tempRoot,
        }),
      );
      expect(context.executionPlan.outputContracts).toEqual(["image"]);

      const result = await engine.execute(context, {
        async execute(runContext) {
          writeFileSync(`${runContext.workspaceDir}/hero.png`, "not actually a png", "utf-8");
          const stepStartedAt = Date.now();
          return {
            output: "图片已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-invalid-image",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入伪图片",
                outputSummary: "写入 hero.png",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("image 产物格式无效");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: false,
        checkedContracts: ["image"],
        failures: [expect.stringContaining("hero.png")],
      });
      closeMemoryDb();
    });
  });

  it("blocks spreadsheet output contracts when CSV has no table structure", async () => {
    await withStateDirEnv("aics-role-invalid-spreadsheet-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("invalid-spreadsheet"),
            title: "运营数据表格分析",
            taskText: "输出运营数据表格 csv。",
            category: "运营分析",
          },
          { workspaceRoot: tempRoot },
        ),
      );
      expect(context.executionPlan.outputContracts).toEqual(
        expect.arrayContaining(["spreadsheet"]),
      );

      const result = await engine.execute(context, {
        async execute(runContext) {
          writeFileSync(`${runContext.workspaceDir}/metrics.csv`, "only-one-cell", "utf-8");
          const stepStartedAt = Date.now();
          return {
            output: "表格已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-invalid-csv",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入 CSV",
                outputSummary: "CSV 缺少表头和数据行",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("spreadsheet 表结构无效");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: false,
        checkedContracts: expect.arrayContaining(["spreadsheet"]),
        failures: [expect.stringContaining("至少 2 个表头字段和 1 行数据")],
      });
      closeMemoryDb();
    });
  });

  it("accepts spreadsheet output contracts when CSV has headers and data rows", async () => {
    await withStateDirEnv("aics-role-valid-spreadsheet-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("valid-spreadsheet"),
            title: "运营数据表格分析",
            taskText: "输出运营数据表格 csv。",
            category: "运营分析",
          },
          { workspaceRoot: tempRoot },
        ),
      );

      const result = await engine.execute(context, {
        async execute(runContext) {
          writeFileSync(
            `${runContext.workspaceDir}/metrics.csv`,
            "metric,value\norders,42\n",
            "utf-8",
          );
          const stepStartedAt = Date.now();
          return {
            output: "表格已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-valid-csv",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入 CSV",
                outputSummary: "CSV 包含表头和数据行",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("succeeded");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: true,
        checkedContracts: expect.arrayContaining(["spreadsheet"]),
        failures: [],
      });
      closeMemoryDb();
    });
  });

  it("blocks document output contracts when Markdown has no readable body", async () => {
    await withStateDirEnv("aics-role-empty-document-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("empty-document"),
            title: "生成经营报告",
            taskText: "输出一份经营报告文档。",
            category: "运营报告",
          },
          { workspaceRoot: tempRoot },
        ),
      );
      expect(context.executionPlan.outputContracts).toEqual(["document"]);

      const result = await engine.execute(context, {
        async execute(runContext) {
          writeFileSync(`${runContext.workspaceDir}/report.md`, "#   \n\n---\n\n>   \n", "utf-8");
          const stepStartedAt = Date.now();
          return {
            output: "报告已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-empty-document",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入 Markdown 报告",
                outputSummary: "报告没有可读正文",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("document 正文为空或不可验收");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: false,
        checkedContracts: ["document"],
        failures: expect.arrayContaining([expect.stringContaining("report.md")]),
      });
      closeMemoryDb();
    });
  });

  it("accepts document output contracts when Markdown includes readable body text", async () => {
    await withStateDirEnv("aics-role-valid-document-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("valid-document"),
            title: "生成经营报告",
            taskText: "输出一份经营报告文档。",
            category: "运营报告",
          },
          { workspaceRoot: tempRoot },
        ),
      );

      const result = await engine.execute(context, {
        async execute(runContext) {
          writeFileSync(
            `${runContext.workspaceDir}/report.md`,
            "# 经营报告\n\n本周订单增长明显，建议继续优化详情页转化路径。\n",
            "utf-8",
          );
          const stepStartedAt = Date.now();
          return {
            output: "报告已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-valid-document",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入 Markdown 报告",
                outputSummary: "报告包含可读正文",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("succeeded");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: true,
        checkedContracts: ["document"],
        failures: [],
      });
      closeMemoryDb();
    });
  });

  it("blocks json output contracts when JSON is only a scalar value", async () => {
    await withStateDirEnv("aics-role-invalid-json-scalar-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("invalid-json-scalar"),
            title: "生成诊断 JSON",
            taskText: "输出一份运营诊断 json 结果。",
            category: "运营诊断",
          },
          { workspaceRoot: tempRoot },
        ),
      );
      expect(context.executionPlan.outputContracts).toEqual(["json"]);

      const result = await engine.execute(context, {
        async execute(runContext) {
          writeFileSync(`${runContext.workspaceDir}/diagnosis.json`, '"done"', "utf-8");
          const stepStartedAt = Date.now();
          return {
            output: "JSON 已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-scalar-json",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入 JSON",
                outputSummary: "JSON 只有字符串标量",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("json 产物结构无效");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: false,
        checkedContracts: ["json"],
        failures: expect.arrayContaining([expect.stringContaining("diagnosis.json")]),
      });
      closeMemoryDb();
    });
  });

  it("does not count artifact-manifest.json as a business json artifact", async () => {
    await withStateDirEnv("aics-role-json-manifest-only-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("json-manifest-only"),
            title: "生成诊断 JSON",
            taskText: "输出一份运营诊断 json 结果。",
            category: "运营诊断",
          },
          { workspaceRoot: tempRoot },
        ),
      );

      const result = await engine.execute(context, {
        async execute(runContext) {
          writeFileSync(
            `${runContext.workspaceDir}/artifact-manifest.json`,
            JSON.stringify({ artifacts: [{ name: "diagnosis.json" }] }),
            "utf-8",
          );
          const stepStartedAt = Date.now();
          return {
            output: "JSON 已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-manifest-only-json",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入打包清单",
                outputSummary: "没有写入业务 JSON",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("缺少 json 产物");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: false,
        checkedContracts: ["json"],
        failures: [expect.stringContaining("缺少 json 产物")],
      });
      closeMemoryDb();
    });
  });

  it("accepts json output contracts when JSON is a non-empty object", async () => {
    await withStateDirEnv("aics-role-valid-json-object-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("valid-json-object"),
            title: "生成诊断 JSON",
            taskText: "输出一份运营诊断 json 结果。",
            category: "运营诊断",
          },
          { workspaceRoot: tempRoot },
        ),
      );

      const result = await engine.execute(context, {
        async execute(runContext) {
          writeFileSync(
            `${runContext.workspaceDir}/diagnosis.json`,
            JSON.stringify({ conclusion: "订单增长明显", nextAction: "优化详情页转化路径" }),
            "utf-8",
          );
          const stepStartedAt = Date.now();
          return {
            output: "JSON 已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-valid-json",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入 JSON",
                outputSummary: "JSON 包含可验收对象",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("succeeded");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: true,
        checkedContracts: ["json"],
        failures: [],
      });
      closeMemoryDb();
    });
  });

  it("accepts html output contracts when local referenced assets exist", async () => {
    await withStateDirEnv("aics-role-html-valid-asset-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("html-valid-asset"),
            title: "详情页任务",
            taskText: "生成详情页 HTML。",
            category: "通用页面",
          },
          { workspaceRoot: tempRoot },
        ),
      );

      const result = await engine.execute(context, {
        async execute(runContext) {
          writeFileSync(`${runContext.workspaceDir}/hero.png`, VALID_PNG);
          writeFileSync(
            `${runContext.workspaceDir}/detail.html`,
            '<!doctype html><html><body><img src="./hero.png" alt="hero" /></body></html>',
            "utf-8",
          );
          const stepStartedAt = Date.now();
          return {
            output: "详情页已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-html-with-asset",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入 HTML",
                outputSummary: "写入有效图片引用",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("succeeded");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: true,
        checkedContracts: ["html"],
        failures: [],
      });
      closeMemoryDb();
    });
  });

  it("blocks package output contracts when the zip is missing manifest-listed files", async () => {
    await withStateDirEnv("aics-role-package-incomplete-zip-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("package-incomplete"),
            title: "交付打包任务",
            taskText: "打包交付 ZIP。",
            category: "交付打包",
          },
          { workspaceRoot: tempRoot },
        ),
      );
      expect(context.executionPlan.outputContracts).toEqual(["package"]);

      const result = await engine.execute(context, {
        async execute(runContext) {
          const manifestPath = path.join(runContext.workspaceDir, "artifact-manifest.json");
          const zipPath = path.join(runContext.workspaceDir, "artifacts.zip");
          writeFileSync(
            manifestPath,
            JSON.stringify({
              generatedAt: new Date().toISOString(),
              artifacts: [
                { name: "hero.png", ref: path.join(runContext.workspaceDir, "hero.png") },
              ],
            }),
            "utf-8",
          );
          const zip = new JSZip();
          zip.file("artifact-manifest.json", "{}");
          writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
          const stepStartedAt = Date.now();
          return {
            output: "打包已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-incomplete-package",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入不完整打包文件",
                outputSummary: "zip 缺少 hero.png",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("package 压缩包不完整");
      expect(result.blockedReason).toContain("hero.png");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: false,
        checkedContracts: ["package"],
        failures: [expect.stringContaining("artifacts.zip 缺少 hero.png")],
      });
      closeMemoryDb();
    });
  });

  it("accepts package output contracts when manifest-listed files are in the zip", async () => {
    await withStateDirEnv("aics-role-package-complete-zip-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("package-complete"),
            title: "交付打包任务",
            taskText: "打包交付 ZIP。",
            category: "交付打包",
          },
          { workspaceRoot: tempRoot },
        ),
      );

      const result = await engine.execute(context, {
        async execute(runContext) {
          const heroPath = path.join(runContext.workspaceDir, "hero.png");
          const manifestPath = path.join(runContext.workspaceDir, "artifact-manifest.json");
          const zipPath = path.join(runContext.workspaceDir, "artifacts.zip");
          writeFileSync(heroPath, "png", "utf-8");
          const manifest = {
            generatedAt: new Date().toISOString(),
            artifacts: [{ name: "hero.png", ref: heroPath }],
          };
          writeFileSync(manifestPath, JSON.stringify(manifest), "utf-8");
          const zip = new JSZip();
          zip.file("hero.png", "png");
          zip.file("artifact-manifest.json", JSON.stringify(manifest));
          writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
          const stepStartedAt = Date.now();
          return {
            output: "打包已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-complete-package",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入完整打包文件",
                outputSummary: "zip 包含清单和 hero.png",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(result.outcome).toBe("succeeded");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: true,
        checkedContracts: ["package"],
        failures: [],
      });
      closeMemoryDb();
    });
  });

  it("does not count internal ROLE_TASK.md as a business document artifact", async () => {
    await withStateDirEnv("aics-role-internal-artifact-exclusion-", async ({ tempRoot }) => {
      closeMemoryDb();
      await withHomeEnv(tempRoot, async () => {
        const rolePackageDir = path.join(tempRoot, "dijie-role-packages", "rpi_internal_doc");
        mkdirSync(rolePackageDir, { recursive: true });
        writeFileSync(
          path.join(rolePackageDir, "manifest.json"),
          JSON.stringify({
            roleId: "rpi_internal_doc",
            title: "报告岗位",
            description: "生成文档报告",
            version: "1",
            requiredCapabilities: [],
            workflows: [],
            skills: [],
            knowledgeFiles: [],
            templateFiles: [],
            sopFiles: [],
            workPatterns: ["generate"],
            outputContracts: ["document"],
          }),
          "utf-8",
        );

        const engine = createRoleExecutionEngine();
        const context = markPreflightReady(
          engine.prepare(
            {
              ...taskPackage("internal-doc"),
              id: "tp_internal_doc",
              rolePlanItemId: "rpi_internal_doc",
              title: "生成经营报告",
              taskText: "生成一份经营报告文档。",
              category: "运营报告",
            },
            { workspaceRoot: path.join(tempRoot, "executions") },
          ),
        );

        const result = await engine.execute(context, {
          async execute() {
            const stepStartedAt = Date.now();
            return {
              output: "执行器声称报告已完成，但没有写入业务文档。",
              outcome: "succeeded",
              steps: [
                {
                  stepIndex: 1,
                  stepName: "missing-document-write",
                  status: "completed",
                  startedAt: stepStartedAt,
                  completedAt: stepStartedAt,
                  inputSummary: "生成经营报告",
                  outputSummary: "未写入业务文档",
                  toolCalls: [],
                },
              ],
              modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
              toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
            };
          },
        });

        expect(result.outcome).toBe("blocked");
        expect(result.blockedReason).toContain("缺少 document 产物");
        expect(result.artifactRefs).not.toEqual(
          expect.arrayContaining([expect.stringMatching(/ROLE_TASK\.md$/u)]),
        );
        expect(result.executionEvidence.validation).toMatchObject({
          passed: false,
          checkedContracts: ["document"],
          failures: [expect.stringContaining("缺少 document 产物")],
        });
      });
      closeMemoryDb();
    });
  });

  it("blocks direct execution before calling an executor when preflight is not confirmed", async () => {
    await withStateDirEnv("aics-role-preflight-block-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = engine.prepare(taskPackage("preflight-block"), {
        workspaceRoot: tempRoot,
      });

      let executeCount = 0;
      const result = await engine.execute(context, {
        async execute() {
          executeCount += 1;
          throw new Error("executor must not run before preflight passes");
        },
      });

      expect(executeCount).toBe(0);
      expect(result.outcome).toBe("blocked");
      expect(result.toolUsage.totalToolCalls).toBe(0);
      expect(result.blockedReason).toContain("执行前检查未通过");
      expect(result.blockedReason).toContain("岗位尚未授权");
      expect(result.blockedReason).toContain("本次执行尚未人工确认");
      expect(result.blockedReason).toContain("本次费用尚未确认");
      expect(result.executionEvidence.preflightSnapshot).toMatchObject({
        roleAuthorized: false,
        humanConfirmed: false,
        costConfirmed: false,
        apiBindingReady: false,
        ledgerRefPresent: false,
      });
      expect(result.executionEvidence.recoverySuggestion).toContain("补齐岗位授权");
      closeMemoryDb();
    });
  });

  it("returns a failed RoleResult with evidence when the executor throws", async () => {
    await withStateDirEnv("aics-role-executor-throws-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(taskPackage("executor-throws"), {
          workspaceRoot: tempRoot,
        }),
      );

      const result = await engine.execute(context, {
        async execute(runContext) {
          writeFileSync(`${runContext.workspaceDir}/partial-note.txt`, "partial evidence", "utf-8");
          throw new Error("模型返回不可解析内容");
        },
      });

      expect(result.outcome).toBe("failed");
      expect(result.summary).toContain("岗位执行器异常");
      expect(result.summary).toContain("模型返回不可解析内容");
      expect(result.artifactRefs).toEqual([`${context.workspaceDir}/partial-note.txt`]);
      expect(result.steps).toEqual([
        expect.objectContaining({
          stepName: "workflow_runner",
          status: "failed",
          error: expect.stringContaining("模型返回不可解析内容"),
        }),
      ]);
      expect(result.executionEvidence).toMatchObject({
        executionId: context.executionId,
        preflightSnapshot: expect.objectContaining({
          roleAuthorized: true,
          humanConfirmed: true,
          costConfirmed: true,
        }),
        validation: {
          passed: false,
          checkedContracts: ["image"],
          failures: [expect.stringContaining("岗位执行器异常")],
        },
        recoverySuggestion: expect.stringContaining("本次执行失败"),
      });
      closeMemoryDb();
    });
  });

  it("isolates artifacts for multiple executions under the same workspace root", async () => {
    await withStateDirEnv("aics-role-artifact-isolation-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const firstContext = markPreflightReady(
        engine.prepare(taskPackage("artifact-first"), {
          workspaceRoot: tempRoot,
        }),
      );
      const secondContext = markPreflightReady(
        engine.prepare(taskPackage("artifact-second"), {
          workspaceRoot: tempRoot,
        }),
      );
      expect(firstContext.workspaceDir).not.toBe(secondContext.workspaceDir);

      writeFileSync(`${secondContext.workspaceDir}/hero.png`, VALID_PNG);

      const firstResult = await engine.execute(firstContext, {
        async execute(runContext) {
          writeFileSync(`${runContext.workspaceDir}/hero.png`, VALID_PNG);
          const stepStartedAt = Date.now();
          return {
            output: "第一轮图片已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-first-image",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入第一轮 hero.png",
                outputSummary: "已写入第一轮图片",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      const secondResult = await engine.execute(secondContext, {
        async execute(runContext) {
          writeFileSync(`${runContext.workspaceDir}/hero.png`, VALID_PNG);
          const stepStartedAt = Date.now();
          return {
            output: "第二轮图片已完成。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "write-second-image",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "写入第二轮 hero.png",
                outputSummary: "已写入第二轮图片",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
          };
        },
      });

      expect(firstResult.outcome).toBe("succeeded");
      expect(secondResult.outcome).toBe("succeeded");
      expect(firstResult.artifactRefs).toEqual([`${firstContext.workspaceDir}/hero.png`]);
      expect(secondResult.artifactRefs).toEqual([`${secondContext.workspaceDir}/hero.png`]);
      expect(firstResult.artifactRefs).not.toContain(`${secondContext.workspaceDir}/hero.png`);
      expect(secondResult.artifactRefs).not.toContain(`${firstContext.workspaceDir}/hero.png`);
      expect(firstResult.executionId).not.toBe(secondResult.executionId);

      closeMemoryDb();
    });
  });

  it("accepts external_record output contracts when an external record ref is read back", async () => {
    await withStateDirEnv("aics-role-external-record-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("external-record"),
            title: "创建外部工单记录",
            taskText: "创建外部工单并回读外部记录 id。",
            category: "客服运营",
          },
          { workspaceRoot: tempRoot },
        ),
      );
      expect(context.executionPlan.outputContracts).toEqual(
        expect.arrayContaining(["external_record"]),
      );

      const result = await engine.execute(context, {
        async execute() {
          const stepStartedAt = Date.now();
          return {
            output: "外部工单已创建并回读。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "readback-external-ticket",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "创建外部工单",
                outputSummary: "回读 external_record:ticket:T-100",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
            executionEvidence: {
              outputContracts: ["external_record"],
              externalRecordRefs: ["external_record:ticket:T-100"],
            },
          };
        },
      });

      expect(result.outcome).toBe("succeeded");
      expect(result.artifactRefs).toEqual(["external_record:ticket:T-100"]);
      expect(result.executionEvidence.validation).toMatchObject({
        passed: true,
        checkedContracts: ["external_record"],
        failures: [],
      });
      closeMemoryDb();
    });
  });

  it("blocks external_record output contracts without a readback record ref", async () => {
    await withStateDirEnv("aics-role-external-record-missing-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("external-record-missing"),
            title: "创建外部工单记录",
            taskText: "创建外部工单并回读外部记录 id。",
            category: "客服运营",
          },
          { workspaceRoot: tempRoot },
        ),
      );

      const result = await engine.execute(context, {
        async execute() {
          const stepStartedAt = Date.now();
          return {
            output: "外部工单已创建。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 1,
                stepName: "missing-external-readback",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "创建外部工单",
                outputSummary: "未回读外部记录 id",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
            executionEvidence: {
              outputContracts: ["external_record"],
            },
          };
        },
      });

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("external_record");
      expect(result.artifactRefs).toEqual([]);
      expect(result.executionEvidence.validation).toMatchObject({
        passed: false,
        checkedContracts: ["external_record"],
        failures: [expect.stringContaining("缺少 external_record 产物")],
      });
      closeMemoryDb();
    });
  });

  it("exposes ToolSkillExecutionEngine as the only authorized capability gateway", async () => {
    await withStateDirEnv("aics-role-tool-skill-gateway-", async ({ tempRoot }) => {
      closeMemoryDb();
      ToolRegistry._clear();
      ToolRegistry.register(makeImageTool({ toolId: "img-tool" }));

      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(taskPackage("tool-skill"), {
          workspaceRoot: tempRoot,
          availableTools: ["img-tool"],
          allowedSkills: ["img:gen"],
        }),
      );

      const result = await engine.execute(context, {
        async execute(runContext) {
          const toolResult = await runContext.toolSkillEngine.execute({
            roleRunRef: runContext.executionId,
            workflowStepRef: "generate-image",
            skillId: "img:gen",
            allowedSkillIds: runContext.allowedSkills,
            allowedToolRefs: runContext.availableTools,
            input: { prompt: "生成商城首屏海报" },
            expectedOutput: "商城首屏海报图片",
          });
          writeFileSync(`${runContext.workspaceDir}/hero.png`, VALID_PNG);
          const stepStartedAt = Date.now();
          return {
            output: toolResult.response.executionSummary || "图片已生成。",
            outcome: toolResult.ok ? "succeeded" : "blocked",
            steps: [
              {
                stepIndex: 1,
                stepName: "generate-image",
                status: toolResult.ok ? "completed" : "failed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "通过 ToolSkillExecutionEngine 调用 img:gen",
                outputSummary: toolResult.response.executionSummary,
                toolCalls: [
                  {
                    toolName: toolResult.response.selectedToolRef,
                    toolCallId: toolResult.requestId,
                    inputSummary: "生成商城首屏海报",
                    outputSummary: toolResult.response.executionSummary,
                    durationMs: toolResult.record?.durationMs ?? 0,
                    status: toolResult.ok ? "ok" : "error",
                    ...(toolResult.response.blockedReason
                      ? { error: toolResult.response.blockedReason }
                      : {}),
                  },
                ],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: {
              totalToolCalls: 1,
              successfulCalls: toolResult.ok ? 1 : 0,
              failedCalls: toolResult.ok ? 0 : 1,
            },
          };
        },
      });

      expect(result.outcome).toBe("succeeded");
      expect(result.executionEvidence.steps?.[0]?.toolCalls[0]).toMatchObject({
        toolName: "img-tool",
        status: "ok",
      });
      expect(ToolExecutionDb.findByRun(context.executionId)).toHaveLength(1);

      ToolRegistry._clear();
      closeMemoryDb();
    });
  });

  it("blocks unapproved skills inside the ToolSkillExecutionEngine gateway", async () => {
    await withStateDirEnv("aics-role-tool-skill-gateway-block-", async ({ tempRoot }) => {
      closeMemoryDb();
      ToolRegistry._clear();
      ToolRegistry.register(makeImageTool({ toolId: "img-tool" }));

      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(taskPackage("tool-skill-block"), {
          workspaceRoot: tempRoot,
          availableTools: ["img-tool"],
          allowedSkills: ["ws:read"],
        }),
      );

      const result = await engine.execute(context, {
        async execute(runContext) {
          const toolResult = await runContext.toolSkillEngine.execute({
            roleRunRef: runContext.executionId,
            workflowStepRef: "generate-image",
            skillId: "img:gen",
            allowedSkillIds: runContext.allowedSkills,
            allowedToolRefs: runContext.availableTools,
            input: { prompt: "生成商城首屏海报" },
            expectedOutput: "商城首屏海报图片",
          });
          const stepStartedAt = Date.now();
          return {
            output: toolResult.response.blockedReason ?? "工具调用被阻塞。",
            outcome: "blocked",
            error: toolResult.response.blockedReason,
            steps: [
              {
                stepIndex: 1,
                stepName: "generate-image",
                status: "failed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "尝试调用未授权 Skill",
                outputSummary: toolResult.response.blockedReason,
                toolCalls: [
                  {
                    toolName: toolResult.response.selectedToolRef,
                    toolCallId: toolResult.requestId,
                    inputSummary: "生成商城首屏海报",
                    outputSummary: toolResult.response.blockedReason,
                    durationMs: 0,
                    status: "error",
                    error: toolResult.response.blockedReason,
                  },
                ],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 1, successfulCalls: 0, failedCalls: 1 },
          };
        },
      });

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("未在本次调度允许列表");
      expect(result.executionEvidence.recoverySuggestion).toContain("缺授权");
      expect(ToolExecutionDb.findByRun(context.executionId)).toHaveLength(0);

      ToolRegistry._clear();
      closeMemoryDb();
    });
  });

  it("blocks operate work patterns before calling an executor in the first release", async () => {
    await withStateDirEnv("aics-role-operate-block-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const context = markPreflightReady(
        engine.prepare(
          {
            ...taskPackage("operate"),
            title: "发布外部文章",
            taskText: "把已生成文章发布到外部系统并回读发布记录。",
            category: "内容运营",
          },
          { workspaceRoot: tempRoot },
        ),
      );
      expect(context.executionPlan.workPatterns).toEqual(expect.arrayContaining(["operate"]));

      let executeCount = 0;
      const result = await engine.execute(context, {
        async execute() {
          executeCount += 1;
          throw new Error("operate executor must not be called in v1");
        },
      });

      expect(executeCount).toBe(0);
      expect(result.outcome).toBe("blocked");
      expect(result.toolUsage.totalToolCalls).toBe(0);
      expect(result.blockedReason).toContain("operate 执行方式首版只支持门禁");
      expect(result.executionEvidence.recoverySuggestion).toContain("必须人工确认");
      expect(result.executionEvidence.validation).toMatchObject({
        passed: false,
        failures: [expect.stringContaining("暂不自动执行外部写入")],
      });
      closeMemoryDb();
    });
  });

  it("injects only confirmed formal memories into execution context", async () => {
    await withStateDirEnv("aics-role-memory-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const task = taskPackage("confirmed");

      const candidate = MemoryCandidateStore.propose({
        type: "role_experience",
        title: "美工海报优化执行经验",
        content: "首屏海报要优先保留商品主体和明确转化按钮。",
        source: { layer: "role", entityId: "role_visual", entityType: "role_listing" },
        confidence: "high",
        tags: ["visual-design", "poster"],
        requiresHumanConfirm: true,
        proposedBy: "test",
      });

      const beforeConfirm = engine.prepare(task, { workspaceRoot: tempRoot });
      expect(beforeConfirm.memoryContext.formal).toHaveLength(0);

      const promoted = MemoryConfirmService.confirmAndPromote(candidate.candidateId, "test");
      expect("memory" in promoted).toBe(true);

      const afterConfirm = engine.prepare(task, { workspaceRoot: tempRoot });
      expect(afterConfirm.memoryContext.formal).toEqual([
        expect.objectContaining({
          title: "美工海报优化执行经验",
          type: "role_experience",
          confidence: "high",
        }),
      ]);
      closeMemoryDb();
    });
  });

  it("records executor memory candidates as pending without promoting formal memory", async () => {
    await withStateDirEnv("aics-role-memory-candidate-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const task = taskPackage("candidate");
      const context = markPreflightReady(engine.prepare(task, { workspaceRoot: tempRoot }));

      const result = await engine.execute(context, {
        async execute(executionContext) {
          writeFileSync(`${executionContext.workspaceDir}/hero.png`, VALID_PNG);
          const stepStartedAt = Date.now();
          return {
            output: "已生成海报，并沉淀一条待确认执行经验。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 0,
                stepName: "generate-poster",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "生成商城首屏海报",
                outputSummary: "生成 hero.png",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
            executionEvidence: {
              memoryCandidates: [
                {
                  type: "role_experience",
                  title: "首屏海报经验",
                  content: "商品主体、主利益点和行动按钮必须同时可见。",
                  source: {
                    layer: "role",
                    entityId: "role_visual",
                    entityType: "role_listing",
                  },
                  confidence: "high",
                  tags: ["visual-design", "poster", "poster"],
                  requiresHumanConfirm: false,
                  proposedBy: "executor-test",
                },
              ],
            },
          };
        },
      });

      expect(result.outcome).toBe("succeeded");
      const candidate = result.executionEvidence.memoryCandidates?.[0];
      expect(candidate).toMatchObject({
        type: "role_experience",
        title: "首屏海报经验",
        status: "pending",
        requiresHumanConfirm: true,
        proposedBy: "executor-test",
        tags: ["visual-design", "poster"],
      });
      expect(candidate?.candidateId).toEqual(expect.any(String));
      expect(MemoryCandidateStore.getById(candidate!.candidateId!)).toMatchObject({
        title: "首屏海报经验",
        status: "pending",
      });

      const afterExecute = engine.prepare(task, { workspaceRoot: tempRoot });
      expect(afterExecute.memoryContext.formal).toHaveLength(0);
      closeMemoryDb();
    });
  });

  it("blocks a successful executor result when memory candidate evidence is malformed", async () => {
    await withStateDirEnv("aics-role-memory-candidate-invalid-", async ({ tempRoot }) => {
      closeMemoryDb();
      const engine = createRoleExecutionEngine();
      const task = taskPackage("invalid-candidate");
      const context = markPreflightReady(engine.prepare(task, { workspaceRoot: tempRoot }));

      const result = await engine.execute(context, {
        async execute(executionContext) {
          writeFileSync(`${executionContext.workspaceDir}/hero.png`, VALID_PNG);
          const stepStartedAt = Date.now();
          return {
            output: "执行器声称成功。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 0,
                stepName: "generate-poster",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "生成商城首屏海报",
                outputSummary: "生成 hero.png",
                toolCalls: [],
              },
            ],
            modelUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
            toolUsage: { totalToolCalls: 0, successfulCalls: 0, failedCalls: 0 },
            executionEvidence: {
              memoryCandidates: [
                {
                  type: "role_experience",
                  title: "",
                  content: "缺少标题的候选记忆不能进入人工确认池。",
                  source: {
                    layer: "role",
                    entityId: "role_visual",
                    entityType: "role_listing",
                  },
                  confidence: "high",
                  tags: ["visual-design"],
                },
              ],
            },
          };
        },
      });

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("候选记忆");
      expect(result.executionEvidence.validation?.failures).toEqual([
        expect.stringContaining("候选记忆 #1 无效"),
      ]);
      expect(MemoryCandidateStore.listPending()).toHaveLength(0);
      closeMemoryDb();
    });
  });
});

describe("RoleExecutionEngine dispatch context", () => {
  it("receives tool permissions from the DispatchToRoleRequest", async () => {
    await withStateDirEnv("aics-role-dispatch-tools-", async ({ tempRoot }) => {
      closePipelineDb();
      closeRoleInstancesDb();
      closeMemoryDb();

      const store = new AicsMainFlowStore();
      const obs = store.update((state) =>
        prepareObservation(state, {
          title: "工具授权观察",
          summary: "岗位需要使用调度层授权工具。",
          signals: [
            {
              id: "signal-dispatch-tools",
              title: "工具授权",
              summary: "调度请求包含允许工具列表。",
              evidenceRefs: ["evidence:role-execution:dispatch-tools"],
            },
          ],
        }),
      );
      store.update((state) => confirmObservation(state, obs.id));
      const attr = store.update((state) =>
        prepareAttribution(state, {
          title: "工具授权归因",
          summary: "执行器必须拿到调度层工具和 Skill 授权。",
          findings: [
            {
              id: "finding-dispatch-tools",
              title: "工具与 Skill 列表需要传递",
              summary: "执行上下文依赖 allowedTools 和 allowedSkills。",
              confidence: "high",
              observationSignalIds: ["signal-dispatch-tools"],
            },
          ],
        }),
      );
      store.update((state) => confirmAttribution(state, attr.id));
      const goal = store.update((state) =>
        createGoalCandidate(state, {
          title: "验证岗位执行工具授权",
          owner: "AICS",
          metric: "执行上下文工具列表",
          target: "executor 收到调度授权工具",
          rationale: "调度层是工具授权入口。",
        }),
      );
      store.update((state) => confirmGoal(state, goal.id));
      const plan = store.update((state) =>
        preparePlanning(state, {
          title: "工具授权执行计划",
          summary: "创建一个岗位执行任务。",
          rolePlanItems: [
            {
              title: "执行授权工具任务",
              roleCapabilityRef: "marketplace-readback",
              taskIntent: "使用调度层授权的工具生成执行结果。",
              expectedOutput: "执行结果",
            },
          ],
        }),
      );
      store.update((state) => confirmPlanning(state, plan.id));
      const proposal = store.update((state) =>
        createDispatchProposal(state, {
          title: "授权工具调度",
          riskSummary: "低风险",
          confirmationSummary: "确认派发给授权岗位。",
        }),
      );
      store.update((state) => confirmDispatch(state, proposal.id));
      const materialized = store.update((state) =>
        materializeTaskPackage(state, {
          title: "执行授权工具任务",
          taskText: "使用调度层授权的工具生成执行结果。",
          capabilityResolution: {
            categoryCapabilityId: "cloud:dispatch-tools",
            category: "marketplace-readback",
            allowedTools: ["tool.platform.marketplace_read_model", "tool.platform.audit_record"],
            allowedSkills: ["skill.execution_readback"],
            dispatchReady: true,
            blockedReasons: [],
          },
          request: {
            id: "dispatch-request-tools",
            roleListingId: "role-listing-tools",
            roleTitle: "工具授权岗位",
            entitlementId: "entitlement-tools",
            workspaceDir: tempRoot,
          },
        }),
      );
      store.update((state) =>
        confirmRoleExecution(state, {
          dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
          roleListingId: "role-listing-tools",
          roleTitle: "工具授权岗位",
          entitlementId: "entitlement-tools",
        }),
      );
      store.update((state) =>
        confirmRoleExecutionCost(state, {
          dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
          entitlementId: "entitlement-tools",
          ledgerRef: "ledger:entitlement-tools",
        }),
      );

      let observedTools: string[] = [];
      let observedSkills: string[] = [];
      let observedPreflight: Record<string, unknown> | null = null;
      let executeCount = 0;
      const executor: RoleExecutor = {
        async execute(context) {
          executeCount += 1;
          observedTools = context.availableTools;
          observedSkills = context.allowedSkills;
          observedPreflight = context.preflightSnapshot;
          writeFileSync(
            `${context.workspaceDir}/authorized-tool-result.json`,
            JSON.stringify({ ok: true }),
            "utf-8",
          );
          writeFileSync(
            `${context.workspaceDir}/authorized-tool-result.txt`,
            "已使用授权工具完成岗位执行。",
            "utf-8",
          );
          const stepStartedAt = Date.now();
          return {
            output: "已使用授权工具完成岗位执行。",
            outcome: "succeeded",
            steps: [
              {
                stepIndex: 0,
                stepName: "authorized-tool-check",
                status: "completed",
                startedAt: stepStartedAt,
                completedAt: stepStartedAt,
                inputSummary: "检查调度授权工具",
                outputSummary: context.availableTools.join(","),
                toolCalls: [],
              },
            ],
            modelUsage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              costCents: 0,
            },
            toolUsage: {
              totalToolCalls: 0,
              successfulCalls: 0,
              failedCalls: 0,
            },
            executionEvidence: {
              auditReadback: { auditRecordId: "audit-dispatch-tools" },
              ledgerRef: "ledger:entitlement-tools",
              costSummary: {
                authorizationFeeCents: 0,
                executionFeeCents: 0,
                modelUsageCostCents: 0,
                totalCostCents: 0,
                currency: "CNY",
                source: "local_ledger",
                ledgerRef: "ledger:entitlement-tools",
              },
              humanConfirmationRef: "human:confirm:dispatch-request-tools:authorized-tools",
              modelUsageNotApplicable: true,
              modelUsageNotApplicableReason: "本测试执行器未调用模型。",
            },
          };
        },
      };

      const result = await dispatchAndExecute(executor, { workspaceRoot: tempRoot });

      expect(result.ok).toBe(true);
      expect(executeCount).toBe(1);
      expect(observedTools).toEqual(
        expect.arrayContaining([
          "tool.platform.marketplace_read_model",
          "tool.platform.audit_record",
        ]),
      );
      expect(observedTools).toEqual(
        expect.arrayContaining([
          "core.openai.image.generate",
          "core.workspace.detail.write",
          "core.artifact.quality.check",
          "core.artifact.package.bundle",
        ]),
      );
      expect(observedSkills).toEqual(
        expect.arrayContaining([
          "skill.execution_readback",
          "img:gen",
          "ws:write",
          "quality:check",
          "file:pack",
        ]),
      );
      expect(observedPreflight).toMatchObject({
        taskDispatched: true,
        roleAuthorized: true,
        humanConfirmed: true,
        costConfirmed: true,
        toolSkillReady: true,
        apiBindingReady: true,
        ledgerRefPresent: true,
        taskPackageId: materialized.taskPackage.id,
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        roleListingId: "role-listing-tools",
        entitlementId: "entitlement-tools",
      });
      const storedResult = store
        .readModel()
        .objects.roleResults.find(
          (item) => item.dispatchToRoleRequestId === materialized.dispatchToRoleRequest.id,
        );
      expect(storedResult?.executionEvidence?.preflightSnapshot).toMatchObject({
        roleAuthorized: true,
        humanConfirmed: true,
        costConfirmed: true,
        ledgerRefPresent: true,
      });
      const duplicateResult = await dispatchAndExecute(executor, { workspaceRoot: tempRoot });
      expect(duplicateResult).toMatchObject({
        ok: false,
        status: "blocked",
        error: expect.stringContaining("不能重复运行"),
      });
      expect(executeCount).toBe(1);

      closePipelineDb();
      closeRoleInstancesDb();
      closeMemoryDb();
    });
  });
});
