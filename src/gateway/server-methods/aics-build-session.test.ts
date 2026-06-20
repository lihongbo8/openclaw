import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closePipelineDb } from "../../aics-main-flow/db.js";
import { approveToolSkillReview } from "../../aics-main-flow/role-pre-listing-review.js";
import {
  ToolRegistry,
  type ToolCapabilityGroup,
  type ToolRegistration,
} from "../../aics-main-flow/tool-registry.js";
import { createToolSkillDevelopmentEngine } from "../../aics-main-flow/tool-skill-development-engine.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";

const { coreGatewayHandlers } = await import("../server-methods.js");

let currentConfig: OpenClawConfig = {};

afterEach(() => {
  closePipelineDb();
  ToolRegistry._clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  currentConfig = {};
});

async function callGateway(method: string, params: Record<string, unknown>) {
  const respond = vi.fn();
  const handler = coreGatewayHandlers[method];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: { type: "req", id: `req-${method}`, method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {
      getRuntimeConfig: () => currentConfig,
    },
  } as never);
  expect(respond).toHaveBeenCalled();
  const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
  if (!ok) throw new Error(JSON.stringify(error ?? payload));
  return payload as Record<string, unknown>;
}

function marketplaceOpsValidationEvidence() {
  const emptyRequirements = { bins: [], anyBins: [], env: [], config: [], os: [] };
  return {
    apiConnections: {
      entries: [
        {
          id: "model-deepseek",
          kind: "model",
          provider: "deepseek",
          enabled: true,
          status: "available",
          consumers: ["model", "role_execution", "ai_review", "build_session"],
          risks: [],
        },
      ],
    },
    skillsReport: {
      workspaceDir: "/tmp/workspace",
      managedSkillsDir: "/tmp/skills",
      skills: [
        {
          name: "Marketplace Ops Diagnosis",
          description: "商城运营诊断 Skill",
          source: "openclaw-managed",
          bundled: false,
          filePath: "/tmp/skills/marketplace-ops/SKILL.md",
          baseDir: "/tmp/skills/marketplace-ops",
          skillKey: "marketplace_ops_diagnosis",
          always: false,
          disabled: false,
          blockedByAllowlist: false,
          eligible: true,
          modelVisible: true,
          userInvocable: true,
          commandVisible: true,
          requirements: emptyRequirements,
          missing: emptyRequirements,
          configChecks: [],
          install: [],
        },
      ],
    },
  } as never;
}

function makeTool(toolId: string, capabilities: string[]): ToolRegistration {
  return {
    toolId,
    name: toolId,
    label: toolId,
    description: "Test platform capability tool",
    capabilities: capabilities as ToolCapabilityGroup[],
    inputSchema: {},
    outputSchema: {},
    riskLevel: "low",
    requiresHumanConfirm: false,
    qualityCheckRules: [],
    enabled: true,
    source: "core",
    handler: async () => ({
      ok: true,
      output: {},
      artifactRefs: [],
      durationMs: 1,
      qualityCheckPassed: true,
    }),
  };
}

function registerMarketplaceOpsTools(): void {
  ToolRegistry.register(
    makeTool("tool.platform.marketplace_read_model", [
      "marketplace.read",
      "gateway.role_read_model",
      "ledger.summary.read",
      "audit.record",
      "document.write",
      "human.confirm",
      "model.chat.analysis",
    ]),
  );
  ToolRegistry.register(
    makeTool("tool.platform.gateway_role_read_model", ["gateway.role_read_model"]),
  );
  ToolRegistry.register(makeTool("tool.platform.ledger_summary_read", ["ledger.summary.read"]));
  ToolRegistry.register(makeTool("tool.platform.audit_record", ["audit.record"]));
  ToolRegistry.register(makeTool("tool.platform.template_renderer", ["document.write"]));
  ToolRegistry.register(makeTool("tool.platform.human_confirmation", ["human.confirm"]));
  ToolRegistry.register(makeTool("provider.platform.model_chat_analysis", ["model.chat.analysis"]));
}

async function activateMarketplaceOpsCapabilityForSession(sessionId: string): Promise<void> {
  const prepared = await callGateway("aics.roleDevelopment.prepareMissingCapability", {
    sessionId,
  });
  const review = prepared.development as {
    categoryCapabilityReview?: { id?: string };
  };
  const reviewId = review.categoryCapabilityReview?.id;
  if (!reviewId) throw new Error("expected category capability review id");
  await callGateway("aics.categoryCapabilityReview.approve", { reviewId });
  registerMarketplaceOpsTools();
  const engine = createToolSkillDevelopmentEngine();
  for (const task of engine.listTasksForCategory(reviewId)) {
    const checked = engine.runValidation({
      taskId: task.id,
      assetType: task.assetType,
      assetId: task.assetId,
      declaredCapabilities: task.requiredCapabilities,
      evidence: marketplaceOpsValidationEvidence(),
    });
    const reviewId = checked.review?.id ?? checked.task?.linkedReviewId;
    if (!reviewId) throw new Error(`expected ToolSkillReview for ${task.assetId}`);
    approveToolSkillReview(reviewId);
  }
  await callGateway("aics.toolSupply.categoryCapability.activateReadyPackage", {
    categoryCapabilityReviewId: reviewId,
  });
}

describe("aics build session gateway", () => {
  it("limits developer center to three active role build sessions", async () => {
    await withStateDirEnv("aics-build-session-limit-", async () => {
      const createdSessionIds: string[] = [];
      for (const label of ["岗位一", "岗位二", "岗位三"]) {
        const created = await callGateway("aics.buildSession.create", {
          requirements: `创建${label}。`,
        });
        createdSessionIds.push(String(created.sessionId));
      }

      await expect(
        callGateway("aics.buildSession.create", {
          requirements: "创建第四个岗位。",
        }),
      ).rejects.toThrow("开发者中心暂定最多开发 3 个岗位");

      await callGateway("aics.buildSession.cancel", {
        sessionId: createdSessionIds[0],
        reason: "不再开发该岗位",
      });
      const replacement = await callGateway("aics.buildSession.create", {
        requirements: "创建替代岗位。",
      });

      expect(replacement.sessionId).toBeTypeOf("string");
    });
  });

  it("creates a local pre-listing review tied to the same draft after package generation", async () => {
    await withStateDirEnv("aics-build-session-review-", async ({ tempRoot }) => {
      vi.stubEnv("DEEPSEEK_API_KEY", "sk-build-session-test");
      currentConfig = {
        apiConnections: {
          entries: {
            "model-deepseek": {
              id: "model-deepseek",
              name: "DeepSeek",
              kind: "model",
              provider: "deepseek",
              baseUrl: "https://api.deepseek.com",
              authMode: "secret_ref",
              secret: { source: "env", provider: "default", id: "DEEPSEEK_API_KEY" },
              consumers: ["model", "build_session"],
              metadata: {
                defaultModel: "deepseek-chat",
              },
            },
          },
        },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
          expect(String(url)).toBe("https://api.deepseek.com/v1/chat/completions");
          expect((init?.headers as Record<string, string>).Authorization).toBe(
            "Bearer sk-build-session-test",
          );
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: [
                      "### FILE: manifest.json",
                      JSON.stringify({
                        rolePackageId: "商城运营诊断官",
                        version: "1.0.0",
                        name: "商城运营诊断官",
                        requiredCapabilities: ["marketplace.read", "audit.record"],
                        workPatterns: ["analyze"],
                        outputContracts: ["document", "json"],
                        workflows: [
                          {
                            id: "marketplace_ops_diagnosis",
                            title: "商城运营诊断",
                          },
                        ],
                      }),
                      "### FILE: listing.md",
                      "# 商城运营诊断官",
                      "### FILE: README.md",
                      "# README",
                      "### FILE: SOP.md",
                      "# SOP\n- 每天查看授权转化和执行失败。",
                      "### FILE: validation.md",
                      "# 验证\n- [ ] pass",
                    ].join("\n"),
                  },
                },
              ],
              usage: { prompt_tokens: 800, completion_tokens: 300, total_tokens: 1100 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }),
      );

      const created = await callGateway("aics.buildSession.create", {
        requirements: "创建商城运营诊断官，用于本地岗位商城运营。",
      });
      const sessionId = String(created.sessionId);
      await callGateway("aics.buildSession.startBriefing", { sessionId });
      await callGateway("aics.buildSession.submitBrief", {
        sessionId,
        brief: {
          roleTitle: "商城运营诊断官",
          roleDescription: "观察授权转化、执行成功率、审计和账本。",
          targetUser: "岗位商城运营者",
          targetCategory: "category:marketplace-ops@1",
          coreResponsibilities: ["观察岗位供给", "输出运营诊断"],
          taskExamples: ["检查授权转化"],
          dailySop: ["每天查看执行失败"],
          weeklySop: ["每周复盘品类能力缺口"],
          monthlySop: ["每月输出经营报告"],
          requiredCapabilities: ["marketplace.read", "audit.record"],
          inputTypes: ["商城经营数据"],
          outputTypes: ["诊断报告"],
          forbiddenActions: ["不自动上架"],
          qualityStandards: ["必须有审计记录"],
        },
      });
      await activateMarketplaceOpsCapabilityForSession(sessionId);
      const generated = await callGateway("aics.buildSession.generate", {
        sessionId,
        outputRoot: path.join(tempRoot, "role-packages"),
      });

      expect(generated.review).toMatchObject({
        rolePackageId: "商城运营诊断官",
        listingDraftId: sessionId,
        developerId: "local-developer",
        category: "category:marketplace-ops@1",
        requiredCapabilities: expect.arrayContaining(["marketplace.read", "audit.record"]),
      });
      expect(generated.capabilityAnalysis).toMatchObject({
        roleTitle: "商城运营诊断官",
        categoryName: "商城运营",
        categoryRef: "category:marketplace-ops@1",
        neededTools: [],
        neededSkills: [],
        neededProviders: [],
        humanConfirmationCapabilities: expect.arrayContaining(["human.confirm"]),
        nonAutomaticCapabilities: expect.arrayContaining(["audit.record"]),
        categoryCapabilityReview: expect.objectContaining({
          workflowStatus: "category_review_approved",
          listingDraftId: sessionId,
          rolePackageId: "商城运营诊断官",
          cloudSyncStatus: "已同步",
        }),
      });

      const roleReviews = await callGateway("aics.rolePreListingReview.list", {});
      expect(roleReviews.reviews).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: (generated.review as Record<string, unknown>).id,
            rolePackageId: "商城运营诊断官",
            listingDraftId: sessionId,
            reviewStatus: "待审核",
            category: "category:marketplace-ops@1",
            requiredCapabilities: expect.arrayContaining(["marketplace.read", "audit.record"]),
          }),
        ]),
      );
      const categoryReviews = await callGateway("aics.categoryCapabilityReview.list", {});
      expect(categoryReviews.reviews).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            listingDraftId: sessionId,
            rolePackageId: "商城运营诊断官",
            reviewStatus: "已通过",
            cloudSyncStatus: "已同步",
            workflowStatus: "category_bound",
          }),
        ]),
      );
    });
  });

  it("uses system-inferred capabilities when the role developer leaves required capabilities empty", async () => {
    await withStateDirEnv("aics-build-session-inferred-capabilities-", async ({ tempRoot }) => {
      vi.stubEnv("DEEPSEEK_API_KEY", "sk-build-session-test");
      currentConfig = {
        apiConnections: {
          entries: {
            "model-deepseek": {
              id: "model-deepseek",
              name: "DeepSeek",
              kind: "model",
              provider: "deepseek",
              baseUrl: "https://api.deepseek.com",
              authMode: "secret_ref",
              secret: { source: "env", provider: "default", id: "DEEPSEEK_API_KEY" },
              consumers: ["model", "build_session"],
              metadata: {
                defaultModel: "deepseek-chat",
              },
            },
          },
        },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            messages?: Array<{ content?: string }>;
          };
          const prompt = body.messages?.[0]?.content ?? "";
          expect(prompt).toContain("marketplace.read");
          expect(prompt).toContain("gateway.role_read_model");
          expect(prompt).toContain("ledger.summary.read");
          expect(prompt).toContain("model.chat.analysis");
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: [
                      "### FILE: manifest.json",
                      JSON.stringify({
                        rolePackageId: "商城运营诊断官",
                        version: "1.0.0",
                        name: "商城运营诊断官",
                        requiredCapabilities: [
                          "marketplace.read",
                          "gateway.role_read_model",
                          "ledger.summary.read",
                          "audit.record",
                          "document.write",
                          "human.confirm",
                          "model.chat.analysis",
                        ],
                        workPatterns: ["analyze", "generate", "composite"],
                        outputContracts: ["document", "json"],
                        workflows: [{ id: "marketplace_ops_diagnosis" }],
                      }),
                      "### FILE: listing.md",
                      "# 商城运营诊断官",
                      "### FILE: README.md",
                      "# README",
                      "### FILE: SOP.md",
                      "# SOP\n- 每天查看授权转化和执行失败。",
                      "### FILE: validation.md",
                      "# 验证\n- [ ] pass",
                    ].join("\n"),
                  },
                },
              ],
              usage: { prompt_tokens: 900, completion_tokens: 320, total_tokens: 1220 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }),
      );

      const created = await callGateway("aics.buildSession.create", {
        requirements: "创建商城运营诊断官，用于本地岗位商城运营。",
      });
      const sessionId = String(created.sessionId);
      await callGateway("aics.buildSession.startBriefing", { sessionId });
      await callGateway("aics.buildSession.submitBrief", {
        sessionId,
        brief: {
          roleTitle: "商城运营诊断官",
          roleDescription: "观察授权转化、执行成功率、审计和账本。",
          targetUser: "岗位商城运营者",
          targetCategory: "商城运营",
          coreResponsibilities: ["观察岗位供给", "输出运营诊断"],
          taskExamples: ["检查授权转化"],
          dailySop: ["每天查看执行失败"],
          weeklySop: ["每周复盘品类能力缺口"],
          monthlySop: ["每月输出经营报告"],
          requiredCapabilities: [],
          inputTypes: ["商城经营数据"],
          outputTypes: ["诊断报告", "审计摘要"],
          forbiddenActions: ["不自动上架"],
          qualityStandards: ["必须有审计记录"],
        },
      });
      await activateMarketplaceOpsCapabilityForSession(sessionId);

      const generated = await callGateway("aics.buildSession.generate", {
        sessionId,
        outputRoot: path.join(tempRoot, "role-packages"),
      });

      expect(generated.review).toMatchObject({
        rolePackageId: "商城运营诊断官",
        listingDraftId: sessionId,
        requiredCapabilities: expect.arrayContaining([
          "marketplace.read",
          "gateway.role_read_model",
          "ledger.summary.read",
          "audit.record",
          "document.write",
          "human.confirm",
          "model.chat.analysis",
        ]),
      });
      expect(generated.capabilityAnalysis).toMatchObject({
        roleTitle: "商城运营诊断官",
        requiredCapabilities: expect.arrayContaining([
          "marketplace.read",
          "gateway.role_read_model",
          "ledger.summary.read",
          "audit.record",
          "document.write",
          "human.confirm",
          "model.chat.analysis",
        ]),
        categoryCapabilityReview: expect.objectContaining({
          roleMaterials: expect.objectContaining({
            roleTitle: "商城运营诊断官",
            roleDescription: "观察授权转化、执行成功率、审计和账本。",
            targetUser: "岗位商城运营者",
            dailyPlan: "每天查看执行失败",
            weeklyPlan: "每周复盘品类能力缺口",
            monthlyPlan: "每月输出经营报告",
            inputOutput: expect.stringContaining("诊断报告"),
            riskBoundaries: expect.arrayContaining(["不自动上架", "必须有审计记录"]),
          }),
        }),
      });
    });
  });

  it("does not misclassify marketplace operations as the ecommerce visual category", async () => {
    await withStateDirEnv("aics-build-session-marketplace-match-", async () => {
      const created = await callGateway("aics.buildSession.create", {
        requirements: "创建岗位商城商城运营岗位，观察授权转化、执行成功率、审计和账本。",
      });
      const sessionId = String(created.sessionId);

      const briefing = await callGateway("aics.buildSession.startBriefing", { sessionId });

      expect(briefing.matchedTemplate).toBeNull();
      expect(briefing.capabilityReport).toBeUndefined();
    });
  });

  it("exposes a role development engine status and prepares missing capability review", async () => {
    await withStateDirEnv("aics-role-development-engine-", async () => {
      const created = await callGateway("aics.buildSession.create", {
        requirements: "创建商城运营诊断官，用于本地岗位商城运营。",
      });
      const sessionId = String(created.sessionId);
      await callGateway("aics.buildSession.startBriefing", { sessionId });
      await callGateway("aics.buildSession.submitBrief", {
        sessionId,
        brief: {
          roleTitle: "商城运营诊断官",
          roleDescription: "观察授权转化、执行成功率、审计和账本。",
          targetUser: "岗位商城运营者",
          targetCategory: "商城运营",
          coreResponsibilities: ["观察岗位供给", "输出运营诊断"],
          taskExamples: ["检查授权转化"],
          dailySop: ["每天查看执行失败"],
          weeklySop: ["每周复盘品类能力缺口"],
          monthlySop: ["每月输出经营报告"],
          requiredCapabilities: [],
          inputTypes: ["商城经营数据"],
          outputTypes: ["诊断报告"],
          forbiddenActions: ["不自动上架"],
          qualityStandards: ["必须有审计记录"],
        },
      });

      await expect(callGateway("aics.buildSession.generate", { sessionId })).rejects.toThrow(
        "岗位能力尚未就绪，不能生成岗位包",
      );

      const status = await callGateway("aics.roleDevelopment.status.get", { sessionId });
      expect(status.development).toMatchObject({
        sessionId,
        status: "need_capability_decision",
        userStatusLabel: "发现缺失能力，等待开发决策",
        capability: {
          missing: expect.arrayContaining(["marketplace.read", "audit.record"]),
          neededTools: expect.arrayContaining(["tool.platform.marketplace_read_model"]),
          neededSkills: expect.arrayContaining(["skill.platform.marketplace_ops_diagnosis"]),
          neededProviders: expect.arrayContaining(["provider.platform.model_chat_analysis"]),
        },
        nextActions: expect.arrayContaining([
          expect.objectContaining({
            kind: "submit_capability_request",
            enabled: true,
          }),
        ]),
      });

      const prepared = await callGateway("aics.roleDevelopment.prepareMissingCapability", {
        sessionId,
      });
      const preparedDevelopment = prepared.development as Record<string, unknown>;
      const preparedCategoryReview = preparedDevelopment.categoryCapabilityReview as Record<
        string,
        unknown
      >;
      const reviewId = String(preparedCategoryReview.id);
      expect(preparedDevelopment).toMatchObject({
        status: "waiting_capability_review",
        userStatusLabel: "能力申请已进入审核中心",
        categoryCapabilityReview: expect.objectContaining({
          listingDraftId: sessionId,
          rolePackageId: "商城运营诊断官",
          workflowStatus: "waiting_category_review",
          reviewStatus: "待审核",
        }),
        nextActions: expect.arrayContaining([
          expect.objectContaining({
            kind: "open_review_center",
            enabled: true,
          }),
        ]),
      });

      await callGateway("aics.categoryCapabilityReview.approve", { reviewId });
      const producing = await callGateway("aics.roleDevelopment.status.get", { sessionId });
      const producingDevelopment = producing.development as {
        toolSkillDevelopment: {
          total: number;
          pending: number;
        };
      };
      expect(producingDevelopment).toMatchObject({
        status: "waiting_tool_skill_development",
        userStatusLabel: "工具与 Skill 制作中",
        toolSkillDevelopment: {
          approved: 0,
          ready: false,
          required: expect.arrayContaining([
            "tool.platform.marketplace_read_model",
            "skill.platform.marketplace_ops_diagnosis",
            "provider.platform.model_chat_analysis",
          ]),
          todos: expect.arrayContaining([
            expect.objectContaining({
              assetId: "tool.platform.marketplace_read_model",
              reviewStatus: "待创建审核单",
              nextAction: expect.objectContaining({
                kind: "open_tool_supply",
                label: "检查并通过",
              }),
            }),
          ]),
        },
        nextActions: expect.arrayContaining([
          expect.objectContaining({
            kind: "open_tool_supply",
            label: "去工具与 Skill处理",
            enabled: true,
          }),
        ]),
      });
      expect(producingDevelopment.toolSkillDevelopment.total).toBeGreaterThanOrEqual(3);
      expect(producingDevelopment.toolSkillDevelopment.pending).toBe(
        producingDevelopment.toolSkillDevelopment.total,
      );

      registerMarketplaceOpsTools();
      const engine = createToolSkillDevelopmentEngine();
      for (const task of engine.listTasksForCategory(reviewId)) {
        const checked = engine.runValidation({
          taskId: task.id,
          assetType: task.assetType,
          assetId: task.assetId,
          declaredCapabilities: task.requiredCapabilities,
          evidence: marketplaceOpsValidationEvidence(),
        });
        const toolSkillReviewId = checked.review?.id ?? checked.task?.linkedReviewId;
        if (!toolSkillReviewId) throw new Error(`expected ToolSkillReview for ${task.assetId}`);
        approveToolSkillReview(toolSkillReviewId);
      }
      const activated = await callGateway(
        "aics.toolSupply.categoryCapability.activateReadyPackage",
        {
          categoryCapabilityReviewId: reviewId,
        },
      );
      expect(activated.review).toMatchObject({
        id: reviewId,
        reviewStatus: "已通过",
        cloudSyncStatus: "已同步",
      });

      const ready = await callGateway("aics.roleDevelopment.status.get", { sessionId });
      expect(ready.development).toMatchObject({
        status: "ready_to_generate",
        userStatusLabel: "能力可用，可以生成岗位包",
        canGenerateRolePackage: true,
        capability: {
          missing: [],
          neededTools: [],
          neededSkills: [],
          neededProviders: [],
        },
        nextActions: expect.arrayContaining([
          expect.objectContaining({
            kind: "confirm_and_generate",
            enabled: true,
          }),
        ]),
      });

      const generatedAttempt = await callGateway("aics.buildSession.generate", { sessionId });
      expect(generatedAttempt).toMatchObject({
        error: "missing BuildSession model provider",
        session: expect.objectContaining({
          state: "failed",
        }),
      });

      const categoryReviews = await callGateway("aics.categoryCapabilityReview.list", {});
      expect(categoryReviews.reviews).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            listingDraftId: sessionId,
            rolePackageId: "商城运营诊断官",
            reviewStatus: "已通过",
            cloudSyncStatus: "已同步",
          }),
        ]),
      );
    });
  });

  it("lets non-programmer users continue with a basic version by disabling missing capabilities", async () => {
    await withStateDirEnv("aics-role-development-basic-scope-", async () => {
      registerMarketplaceOpsTools();
      const created = await callGateway("aics.buildSession.create", {
        requirements: "创建运营报告岗位，能写报告，未来最好还能自动发布。",
      });
      const sessionId = String(created.sessionId);
      await callGateway("aics.buildSession.startBriefing", { sessionId });
      await callGateway("aics.buildSession.submitBrief", {
        sessionId,
        brief: {
          roleTitle: "运营报告岗位",
          roleDescription: "生成运营报告，自动发布是增强能力。",
          targetUser: "运营人员",
          targetCategory: "运营",
          coreResponsibilities: ["生成运营报告", "可选自动发布"],
          taskExamples: ["根据输入生成一份报告"],
          dailySop: ["读取输入", "生成报告"],
          weeklySop: ["汇总报告"],
          monthlySop: [],
          requiredCapabilities: ["document.write", "external.publish"],
          inputTypes: ["自然语言需求"],
          outputTypes: ["报告"],
          forbiddenActions: ["不绕过审核发布"],
          qualityStandards: ["输出必须可审核"],
        },
      });

      const status = await callGateway("aics.roleDevelopment.status.get", { sessionId });
      expect(status.development).toMatchObject({
        status: "need_capability_decision",
        capability: {
          existing: expect.arrayContaining(["document.write"]),
          missing: expect.arrayContaining(["external.publish"]),
        },
        nextActions: expect.arrayContaining([
          expect.objectContaining({
            kind: "use_basic_version",
            enabled: true,
          }),
        ]),
      });

      const reduced = await callGateway("aics.roleDevelopment.reduceScopeToBasic", { sessionId });
      expect(reduced.session).toMatchObject({
        brief: {
          requiredCapabilities: ["document.write"],
          forbiddenActions: expect.arrayContaining([
            "基础版已关闭暂不可用能力：external.publish。",
          ]),
        },
      });
      expect(reduced.development).toMatchObject({
        status: "ready_to_generate",
        canGenerateRolePackage: true,
        capability: {
          missing: [],
          disabled: ["external.publish"],
        },
        nextActions: expect.arrayContaining([
          expect.objectContaining({
            kind: "confirm_and_generate",
            enabled: true,
          }),
        ]),
      });
    });
  });

  it("generates a role package through OpenAI OAuth auto without requiring an API key", async () => {
    await withStateDirEnv("aics-build-session-oauth-", async ({ tempRoot }) => {
      const agentDir = path.join(process.env.OPENCLAW_STATE_DIR ?? tempRoot, "agents/main/agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        path.join(agentDir, "auth-profiles.json"),
        JSON.stringify({
          version: 1,
          profiles: {
            "openai:default": {
              type: "oauth",
              provider: "openai",
              access: "oauth-build-session-token",
              refresh: "refresh-build-session-token",
              expires: Date.now() + 30 * 60 * 1000,
              accountId: "acct-build-session",
            },
          },
        }),
      );
      registerMarketplaceOpsTools();
      currentConfig = {
        apiConnections: {
          entries: {
            "model-openai": {
              id: "model-openai",
              name: "OpenAI",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com/v1",
              authMode: "oauth",
              consumers: ["model", "build_session"],
              metadata: {
                defaultModel: "auto",
              },
            },
          },
        },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
          expect(String(url)).toBe("https://chatgpt.com/backend-api/codex/responses");
          expect((init?.headers as Record<string, string>).Authorization).toBe(
            "Bearer oauth-build-session-token",
          );
          const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          expect(body).toMatchObject({
            model: "gpt-5.5",
            store: false,
          });
          return new Response(
            JSON.stringify({
              output_text: [
                "### FILE: manifest.json",
                JSON.stringify({
                  rolePackageId: "真人可用运营岗位",
                  version: "1.0.0",
                  name: "真人可用运营岗位",
                  requiredCapabilities: ["document.write"],
                  workPatterns: ["generate"],
                  outputContracts: ["document"],
                  workflows: [{ id: "write_report", title: "生成运营报告" }],
                }),
                "### FILE: listing.md",
                "# 真人可用运营岗位",
                "能生成运营报告并打包结果。",
                "### FILE: README.md",
                "# 真人可用运营岗位",
                "本地岗位包说明。",
                "### FILE: SOP.md",
                "# SOP",
                "1. 读取需求。\\n2. 生成报告。\\n3. 验证产物。",
                "### FILE: validation.md",
                "# 验证材料",
                "- [ ] manifest.json 包含 requiredCapabilities",
              ].join("\n"),
              usage: { input_tokens: 11, output_tokens: 22 },
            }),
          );
        }),
      );

      const created = await callGateway("aics.buildSession.create", {
        requirements: "创建一个真人可用运营岗位。",
      });
      const sessionId = String(created.sessionId);
      await callGateway("aics.buildSession.startBriefing", { sessionId });
      await callGateway("aics.buildSession.submitBrief", {
        sessionId,
        brief: {
          roleTitle: "真人可用运营岗位",
          roleDescription: "面向非程序员生成运营报告。",
          targetUser: "运营人员",
          targetCategory: "运营",
          coreResponsibilities: ["生成运营报告"],
          taskExamples: ["根据输入生成报告"],
          dailySop: ["读取输入", "输出报告"],
          weeklySop: ["汇总报告"],
          requiredCapabilities: ["document.write"],
          inputTypes: ["自然语言需求"],
          outputTypes: ["报告"],
          forbiddenActions: ["不自动发布"],
          qualityStandards: ["必须可审核"],
        },
      });

      const generated = await callGateway("aics.buildSession.generate", {
        sessionId,
        outputRoot: tempRoot,
      });

      expect(generated).toMatchObject({
        transport: "codex_responses",
        modelRef: "openai/gpt-5.5",
        apiConnectionEntryId: "model-openai",
        session: expect.objectContaining({
          state: "completed",
          validationErrors: [],
        }),
        review: expect.objectContaining({
          rolePackageId: "真人可用运营岗位",
          listingDraftId: sessionId,
          reviewStatus: "待审核",
        }),
      });
      expect(generated.files).toEqual(
        expect.arrayContaining([
          "manifest.json",
          "listing.md",
          "README.md",
          "SOP.md",
          "validation.md",
        ]),
      );
    });
  });
});
