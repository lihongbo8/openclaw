import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiModelRuntimeBinding } from "../api-connections/runtime.js";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { createRoleExecutionEngine } from "./role-execution-engine.js";
import type { RoleExecutionContext } from "./role-execution-types.js";
import {
  createRoleProductExecutionExecutor,
  resolveOpenAIImageModel,
  toOpenAIImagesGenerationsUrl,
} from "./role-product-execution-workflow.js";
import { ToolExecutionDb } from "./tool-execution-db.js";
import { ToolRegistry } from "./tool-registry.js";
import { createToolSkillExecutionEngine } from "./tool-skill-execution-engine.js";
import type { TaskPackage } from "./types.js";

const VALID_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const PRODUCT_WORKFLOW_ALLOWED_TOOLS = [
  "core.openai.image.generate",
  "core.workspace.detail.write",
  "core.artifact.quality.check",
  "core.artifact.package.bundle",
];
const PRODUCT_WORKFLOW_ALLOWED_SKILLS = ["img:gen", "ws:write", "quality:check", "file:pack"];

function makeTask(): TaskPackage {
  return {
    id: "task-product-page",
    kind: "TaskPackage",
    goalId: "goal-1",
    planningPackageId: "planning-1",
    rolePlanItemId: "role-plan-1",
    dispatchProposalReviewId: "dispatch-1",
    title: "智能水杯详情页",
    taskText: "为一款智能水杯生成首屏图片和商品详情页。",
    category: "电商详情页",
    status: "ready",
    auditRefs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeRuntime(overrides: Partial<ApiModelRuntimeBinding> = {}): ApiModelRuntimeBinding {
  return {
    entryId: "model-openai",
    provider: "openai",
    model: "auto",
    modelRef: "openai/auto",
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test",
    authMode: "secret_ref",
    secretSource: "plaintext",
    ...overrides,
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

function productWorkflowAuthOptions(): { availableTools: string[]; allowedSkills: string[] } {
  return {
    availableTools: PRODUCT_WORKFLOW_ALLOWED_TOOLS,
    allowedSkills: PRODUCT_WORKFLOW_ALLOWED_SKILLS,
  };
}

describe("Role product execution workflow", () => {
  beforeEach(() => {
    ToolRegistry._clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps auto model and writes image, detail page, manifest, and zip artifacts", async () => {
    await withStateDirEnv("aics-role-product-workflow-", async ({ tempRoot }) => {
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          model: "gpt-image-1",
          size: "1024x1024",
          n: 1,
        });
        return new Response(JSON.stringify({ data: [{ b64_json: VALID_PNG_BASE64 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const context = markPreflightReady(
        createRoleExecutionEngine().prepare(makeTask(), {
          workspaceRoot: path.join(tempRoot, "executions"),
          modelRef: "openai/auto",
          ...productWorkflowAuthOptions(),
        }),
      );
      const result = await createRoleExecutionEngine().execute(
        context,
        createRoleProductExecutionExecutor({
          imageRuntime: makeRuntime(),
          roleTitle: "电商美工",
          roleListingId: "role-ecommerce-designer",
          categoryCapabilityId: "cloud:ecommerce-product-page",
        }),
      );

      expect(result.outcome).toBe("succeeded");
      expect(result.toolUsage).toMatchObject({
        totalToolCalls: 4,
        successfulCalls: 4,
        failedCalls: 0,
      });
      expect(result.executionEvidence).toMatchObject({
        workPatterns: ["generate", "composite"],
        outputContracts: ["image", "html", "package"],
        categoryCapabilityId: "cloud:ecommerce-product-page",
        businessCategory: "电商详情页",
        validation: {
          passed: true,
          checkedContracts: ["image", "html", "package"],
          failures: [],
        },
      });
      expect(result.executionEvidence.executionPlan).toMatchObject({
        executionId: context.executionId,
        categoryCapabilityId: "cloud:ecommerce-product-page",
        executionChoice: expect.stringContaining("不按品类创建专用执行器"),
        steps: [
          expect.objectContaining({ stepName: "role_execution_analysis" }),
          expect.objectContaining({ stepName: "image_generation", workPattern: "generate" }),
          expect.objectContaining({ stepName: "detail_page_write", workPattern: "generate" }),
          expect.objectContaining({ stepName: "artifact_quality_check" }),
          expect.objectContaining({ stepName: "artifact_package_manifest" }),
        ],
      });
      expect(result.artifactRefs).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/hero\.png$/u),
          expect.stringMatching(/detail\.html$/u),
          expect.stringMatching(/execution-summary\.json$/u),
          expect.stringMatching(/artifact-manifest\.json$/u),
          expect.stringMatching(/artifacts\.zip$/u),
        ]),
      );
      for (const ref of result.artifactRefs) {
        expect(existsSync(ref)).toBe(true);
      }
      const detailPath = result.artifactRefs.find((ref) => ref.endsWith("detail.html"));
      expect(detailPath ? readFileSync(detailPath, "utf-8") : "").toContain("智能水杯详情页");
      const summaryPath = result.artifactRefs.find((ref) => ref.endsWith("execution-summary.json"));
      const summary = JSON.parse(summaryPath ? readFileSync(summaryPath, "utf-8") : "{}") as Record<
        string,
        unknown
      >;
      expect(summary).toMatchObject({
        title: "智能水杯详情页",
        roleTitle: "电商美工",
        category: "电商详情页",
        imageRef: expect.stringMatching(/hero\.png$/u),
        detailPage: expect.stringMatching(/detail\.html$/u),
      });
      const zipPath = result.artifactRefs.find((ref) => ref.endsWith("artifacts.zip"));
      expect(zipPath).toBeTruthy();
      const zip = await JSZip.loadAsync(readFileSync(zipPath!));
      expect(Object.keys(zip.files).sort()).toEqual([
        "artifact-manifest.json",
        "detail.html",
        "execution-summary.json",
        "hero.png",
      ]);
      const manifest = JSON.parse(
        await zip.file("artifact-manifest.json")!.async("string"),
      ) as Record<string, unknown>;
      expect(manifest.artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "hero.png",
            sizeBytes: expect.any(Number),
            sha256: expect.any(String),
          }),
          expect.objectContaining({
            name: "detail.html",
            sizeBytes: expect.any(Number),
            sha256: expect.any(String),
          }),
          expect.objectContaining({
            name: "execution-summary.json",
            sizeBytes: expect.any(Number),
            sha256: expect.any(String),
          }),
        ]),
      );
      expect(ToolExecutionDb.findByRun(context.executionId)).toHaveLength(4);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "https://api.openai.com/v1/images/generations",
      );
    });
  });

  it("records marketplace-ops diagnosis deliverables in execution evidence and summary artifact", async () => {
    await withStateDirEnv("aics-role-product-workflow-marketplace-ops-", async ({ tempRoot }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ data: [{ b64_json: VALID_PNG_BASE64 }] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        ),
      );

      const task = {
        ...makeTask(),
        title: "任务：商城运营诊断",
        taskText: "输出本地岗位商城运营诊断，覆盖岗位商品、授权、执行、费用和审计。",
        category: "商城运营诊断",
        requiredCapabilityRefs: ["marketplace-ops-local"],
      };
      const context = markPreflightReady(
        createRoleExecutionEngine().prepare(task, {
          workspaceRoot: path.join(tempRoot, "executions"),
          modelRef: "openai/auto",
          ...productWorkflowAuthOptions(),
        }),
      );
      const result = await createRoleExecutionEngine().execute(
        context,
        createRoleProductExecutionExecutor({
          imageRuntime: makeRuntime(),
          roleTitle: "商城运营诊断官",
          roleListingId: "local_rolelisting_marketplace_ops",
        }),
      );

      expect(result.outcome).toBe("succeeded");
      expect(result.executionEvidence.businessDeliverables).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "商城运营诊断报告" }),
          expect.objectContaining({ label: "岗位供给分析" }),
          expect.objectContaining({ label: "授权转化分析" }),
          expect.objectContaining({ label: "执行成功率分析" }),
          expect.objectContaining({ label: "阻塞原因分析" }),
          expect.objectContaining({ label: "日/周/月运营建议" }),
          expect.objectContaining({ label: "下一步调度建议" }),
          expect.objectContaining({ label: "审计摘要" }),
          expect.objectContaining({ label: "账本摘要" }),
        ]),
      );
      const summaryPath = result.artifactRefs.find((ref) => ref.endsWith("execution-summary.json"));
      const summary = JSON.parse(summaryPath ? readFileSync(summaryPath, "utf-8") : "{}") as Record<
        string,
        unknown
      >;
      expect(summary.businessDeliverables).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "商城运营诊断报告" }),
          expect.objectContaining({ label: "账本摘要" }),
        ]),
      );
    });
  });

  it("runs the product workflow in local rehearsal mode without calling an external image API", async () => {
    await withStateDirEnv("aics-role-product-workflow-local-rehearsal-", async ({ tempRoot }) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const context = markPreflightReady(
        createRoleExecutionEngine().prepare(makeTask(), {
          workspaceRoot: path.join(tempRoot, "executions"),
          modelRef: "local-rehearsal/local-image",
          ...productWorkflowAuthOptions(),
        }),
      );
      const result = await createRoleExecutionEngine().execute(
        context,
        createRoleProductExecutionExecutor({
          imageRuntime: makeRuntime({
            entryId: "local-rehearsal-image",
            provider: "local-rehearsal",
            model: "local-rehearsal-image",
            modelRef: "local-rehearsal/local-image",
            baseUrl: "local://rehearsal",
            apiKey: "",
            authMode: "none",
            secretSource: "plaintext",
          }),
          roleTitle: "电商美工",
          roleListingId: "role-ecommerce-designer",
          categoryCapabilityId: "cloud:ecommerce-product-page",
        }),
      );

      expect(result.outcome).toBe("succeeded");
      expect(result.executionEvidence).toMatchObject({
        categoryCapabilityId: "cloud:ecommerce-product-page",
        modelUsageNotApplicable: true,
        modelUsageNotApplicableReason: expect.stringContaining("未调用外部模型 API"),
      });
      expect(result.artifactRefs).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/hero\.png$/u),
          expect.stringMatching(/detail\.html$/u),
          expect.stringMatching(/artifact-manifest\.json$/u),
          expect.stringMatching(/artifacts\.zip$/u),
        ]),
      );
      expect(ToolExecutionDb.findByRun(context.executionId)).toHaveLength(4);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("blocks the product workflow when dispatch context has no authorized skills or tools", async () => {
    await withStateDirEnv("aics-role-product-workflow-no-dispatch-auth-", async ({ tempRoot }) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const context = markPreflightReady(
        createRoleExecutionEngine().prepare(makeTask(), {
          workspaceRoot: path.join(tempRoot, "executions"),
        }),
      );
      const result = await createRoleExecutionEngine().execute(
        context,
        createRoleProductExecutionExecutor({
          imageRuntime: makeRuntime(),
          roleTitle: "电商美工",
        }),
      );

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain('Skill "img:gen" 未在本次调度允许列表');
      expect(ToolExecutionDb.findByRun(context.executionId)).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("blocks when dispatch explicitly allows only part of the required skill chain", async () => {
    await withStateDirEnv("aics-role-product-workflow-block-", async ({ tempRoot }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ data: [{ b64_json: VALID_PNG_BASE64 }] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        ),
      );
      const context = markPreflightReady(
        createRoleExecutionEngine().prepare(makeTask(), {
          workspaceRoot: path.join(tempRoot, "executions"),
          ...productWorkflowAuthOptions(),
        }),
      );
      const result = await createRoleExecutionEngine().execute(
        context,
        createRoleProductExecutionExecutor({
          imageRuntime: makeRuntime(),
          roleTitle: "电商美工",
          allowedSkillIds: ["img:gen"],
        }),
      );

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain('Skill "ws:write" 未在本次调度允许列表');
      expect(result.executionEvidence).toMatchObject({
        workPatterns: ["generate", "composite"],
        outputContracts: ["image", "html", "package"],
        validation: {
          passed: false,
          checkedContracts: ["image", "html", "package"],
          failures: [expect.stringContaining('Skill "ws:write" 未在本次调度允许列表')],
        },
      });
      expect(ToolExecutionDb.findByRun(context.executionId)).toHaveLength(1);
    });
  });

  it("blocks when dispatch allowed skills do not include the product workflow skills", async () => {
    await withStateDirEnv(
      "aics-role-product-workflow-unknown-skill-block-",
      async ({ tempRoot }) => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const context = markPreflightReady(
          createRoleExecutionEngine().prepare(makeTask(), {
            workspaceRoot: path.join(tempRoot, "executions"),
            ...productWorkflowAuthOptions(),
          }),
        );
        const result = await createRoleExecutionEngine().execute(
          context,
          createRoleProductExecutionExecutor({
            imageRuntime: makeRuntime(),
            roleTitle: "电商美工",
            allowedSkillIds: ["skill:listing_optimization"],
          }),
        );

        expect(result.outcome).toBe("blocked");
        expect(result.blockedReason).toContain('Skill "img:gen" 未在本次调度允许列表');
        expect(ToolExecutionDb.findByRun(context.executionId)).toHaveLength(0);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });

  it("blocks when dispatch allowed tools do not include the product workflow tools", async () => {
    await withStateDirEnv(
      "aics-role-product-workflow-unknown-tool-block-",
      async ({ tempRoot }) => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const context = markPreflightReady(
          createRoleExecutionEngine().prepare(makeTask(), {
            workspaceRoot: path.join(tempRoot, "executions"),
            ...productWorkflowAuthOptions(),
          }),
        );
        const result = await createRoleExecutionEngine().execute(
          context,
          createRoleProductExecutionExecutor({
            imageRuntime: makeRuntime(),
            roleTitle: "电商美工",
            allowedToolRefs: ["tool:model_prompt"],
          }),
        );

        expect(result.outcome).toBe("blocked");
        expect(result.blockedReason).toContain(
          'capability "image.generation" 没有匹配本次调度允许的工具',
        );
        expect(ToolExecutionDb.findByRun(context.executionId)).toHaveLength(0);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });

  it("returns a human-readable blocked reason when OpenAI image generation is rate limited", async () => {
    await withStateDirEnv("aics-role-product-workflow-openai-429-", async ({ tempRoot }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                error: {
                  message: "Rate limit reached for image generation. Please check quota.",
                },
              }),
              { status: 429, headers: { "content-type": "application/json" } },
            ),
        ),
      );
      const context = markPreflightReady(
        createRoleExecutionEngine().prepare(makeTask(), {
          workspaceRoot: path.join(tempRoot, "executions"),
          ...productWorkflowAuthOptions(),
        }),
      );
      const result = await createRoleExecutionEngine().execute(
        context,
        createRoleProductExecutionExecutor({
          imageRuntime: makeRuntime(),
          roleTitle: "电商美工",
        }),
      );

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("OpenAI 图片 API 429");
      expect(result.blockedReason).toContain("Rate limit reached");
      expect(result.artifactRefs).toEqual([]);
      expect(ToolExecutionDb.findByRun(context.executionId)).toHaveLength(1);
    });
  });

  it("returns a human-readable blocked reason when OpenAI image quota is insufficient", async () => {
    await withStateDirEnv("aics-role-product-workflow-openai-quota-", async ({ tempRoot }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                error: {
                  code: "insufficient_quota",
                  message:
                    "You exceeded your current quota, please check your plan and billing details.",
                },
              }),
              { status: 402, headers: { "content-type": "application/json" } },
            ),
        ),
      );
      const context = markPreflightReady(
        createRoleExecutionEngine().prepare(makeTask(), {
          workspaceRoot: path.join(tempRoot, "executions"),
          ...productWorkflowAuthOptions(),
        }),
      );
      const result = await createRoleExecutionEngine().execute(
        context,
        createRoleProductExecutionExecutor({
          imageRuntime: makeRuntime(),
          roleTitle: "电商美工",
        }),
      );

      expect(result.outcome).toBe("blocked");
      expect(result.blockedReason).toContain("OpenAI 图片 API 402");
      expect(result.blockedReason).toContain("quota");
      expect(result.blockedReason).toContain("billing");
      expect(result.artifactRefs).toEqual([]);
      expect(ToolExecutionDb.findByRun(context.executionId)).toHaveLength(1);
    });
  });

  it("blocks quality check when a detail page references a missing local image", async () => {
    await withStateDirEnv("aics-role-product-workflow-broken-html-image-", async ({ tempRoot }) => {
      createRoleProductExecutionExecutor({
        imageRuntime: makeRuntime(),
        roleTitle: "电商美工",
      });
      const workspaceDir = path.join(tempRoot, "workspace");
      mkdirSync(workspaceDir, { recursive: true });
      const imagePath = path.join(workspaceDir, "hero.png");
      const htmlPath = path.join(workspaceDir, "detail.html");
      writeFileSync(imagePath, Buffer.from("fake-png"));
      writeFileSync(
        htmlPath,
        [
          "<!doctype html>",
          "<html>",
          "<body>",
          '<img src="./missing.png" alt="missing image" />',
          "</body>",
          "</html>",
        ].join("\n"),
        "utf-8",
      );

      const result = await createToolSkillExecutionEngine().execute({
        roleRunRef: "run-broken-html-image",
        workflowStepRef: "quality-check",
        skillId: "quality:check",
        allowedSkillIds: ["quality:check"],
        allowedToolRefs: ["core.artifact.quality.check"],
        input: {
          artifactRefs: [imagePath, htmlPath],
        },
        expectedOutput: "检查详情页图片引用是否可打开",
      });

      expect(result.ok).toBe(false);
      expect(result.response.blockedReason).toContain("详情页图片引用不可打开");
      expect(result.response.structuredOutput).toMatchObject({
        passed: false,
        hasImage: true,
        hasHtml: true,
        hasExecutionSummary: false,
        brokenHtmlImageLinks: [
          expect.objectContaining({
            src: "./missing.png",
            exists: false,
          }),
        ],
      });
    });
  });

  it("blocks quality check when execution summary JSON is missing", async () => {
    await withStateDirEnv("aics-role-product-workflow-missing-summary-", async ({ tempRoot }) => {
      createRoleProductExecutionExecutor({
        imageRuntime: makeRuntime(),
        roleTitle: "电商美工",
      });
      const workspaceDir = path.join(tempRoot, "workspace");
      mkdirSync(workspaceDir, { recursive: true });
      const imagePath = path.join(workspaceDir, "hero.png");
      const htmlPath = path.join(workspaceDir, "detail.html");
      writeFileSync(imagePath, Buffer.from("fake-png"));
      writeFileSync(
        htmlPath,
        [
          "<!doctype html>",
          "<html>",
          "<body>",
          '<img src="./hero.png" alt="hero" />',
          "</body>",
          "</html>",
        ].join("\n"),
        "utf-8",
      );

      const result = await createToolSkillExecutionEngine().execute({
        roleRunRef: "run-missing-summary",
        workflowStepRef: "quality-check",
        skillId: "quality:check",
        allowedSkillIds: ["quality:check"],
        allowedToolRefs: ["core.artifact.quality.check"],
        input: {
          artifactRefs: [imagePath, htmlPath],
        },
        expectedOutput: "检查执行摘要 JSON 是否存在",
      });

      expect(result.ok).toBe(false);
      expect(result.response.blockedReason).toContain("执行摘要 JSON");
      expect(result.response.structuredOutput).toMatchObject({
        passed: false,
        hasImage: true,
        hasHtml: true,
        hasExecutionSummary: false,
      });
    });
  });

  it("blocks quality check when execution summary JSON cannot be parsed", async () => {
    await withStateDirEnv("aics-role-product-workflow-invalid-summary-", async ({ tempRoot }) => {
      createRoleProductExecutionExecutor({
        imageRuntime: makeRuntime(),
        roleTitle: "电商美工",
      });
      const workspaceDir = path.join(tempRoot, "workspace");
      mkdirSync(workspaceDir, { recursive: true });
      const imagePath = path.join(workspaceDir, "hero.png");
      const htmlPath = path.join(workspaceDir, "detail.html");
      const summaryPath = path.join(workspaceDir, "execution-summary.json");
      writeFileSync(imagePath, Buffer.from("fake-png"));
      writeFileSync(
        htmlPath,
        [
          "<!doctype html>",
          "<html>",
          "<body>",
          '<img src="./hero.png" alt="hero" />',
          "</body>",
          "</html>",
        ].join("\n"),
        "utf-8",
      );
      writeFileSync(summaryPath, "{not-json", "utf-8");

      const result = await createToolSkillExecutionEngine().execute({
        roleRunRef: "run-invalid-summary",
        workflowStepRef: "quality-check",
        skillId: "quality:check",
        allowedSkillIds: ["quality:check"],
        allowedToolRefs: ["core.artifact.quality.check"],
        input: {
          artifactRefs: [imagePath, htmlPath, summaryPath],
        },
        expectedOutput: "检查执行摘要 JSON 是否可解析",
      });

      expect(result.ok).toBe(false);
      expect(result.response.blockedReason).toContain("执行摘要 JSON 无法解析");
      expect(result.response.structuredOutput).toMatchObject({
        passed: false,
        hasImage: true,
        hasHtml: true,
        hasExecutionSummary: true,
        invalidJsonArtifacts: [expect.objectContaining({ ref: summaryPath })],
      });
    });
  });

  it("normalizes image API model and URL", () => {
    expect(resolveOpenAIImageModel("auto")).toBe("gpt-image-1");
    expect(resolveOpenAIImageModel("gpt-image-1")).toBe("gpt-image-1");
    expect(resolveOpenAIImageModel("gpt-4.1-mini")).toBe("gpt-image-1");
    expect(toOpenAIImagesGenerationsUrl("https://api.openai.com")).toBe(
      "https://api.openai.com/v1/images/generations",
    );
    expect(toOpenAIImagesGenerationsUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/images/generations",
    );
  });
});
