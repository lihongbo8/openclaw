import { describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../app-view-state.ts";
import {
  createSession,
  createDefaultBuildSessionState,
  generatePackage,
  refreshBindableCategoryReviews,
  reduceRoleDevelopmentScopeToBasic,
  startBriefing,
  submitCategoryCapabilityRequest,
  submitBrief,
  submitDeveloperRoleForListing,
} from "./build-session.ts";

describe("build session controller", () => {
  it("refreshes sessions before creating and ignores completed sessions in the active role limit", async () => {
    const bs = createDefaultBuildSessionState();
    bs.requirements = "创建第四个岗位。";
    const request = vi.fn(async (method: string) => {
      if (method === "aics.buildSession.list") {
        return [
          {
            sessionId: "session-1",
            state: "created",
            createdAt: 1,
            updatedAt: 1,
            userRequirements: "岗位一",
            userConfirmations: [],
            validationErrors: [],
          },
          {
            sessionId: "session-2",
            state: "confirming",
            createdAt: 2,
            updatedAt: 2,
            userRequirements: "岗位二",
            userConfirmations: [],
            validationErrors: [],
          },
          {
            sessionId: "session-3",
            state: "completed",
            createdAt: 3,
            updatedAt: 3,
            userRequirements: "岗位三",
            userConfirmations: [],
            validationErrors: [],
          },
        ];
      }
      if (method === "aics.buildSession.create") {
        return {
          sessionId: "session-4",
          state: "created",
          createdAt: 4,
          updatedAt: 4,
          userRequirements: "创建第四个岗位。",
          userConfirmations: [],
          validationErrors: [],
          availableTemplates: [],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = { client: { request } } as unknown as AppViewState;

    await createSession(state, bs);

    expect(request).toHaveBeenCalledWith("aics.buildSession.list", {});
    expect(request).toHaveBeenCalledWith("aics.buildSession.create", {
      requirements: "创建第四个岗位。",
    });
    expect(bs.error).toBeNull();
    expect(bs.sessionId).toBe("session-4");
    expect(bs.step).toBe("briefing");
    expect(bs.sessions).toHaveLength(3);
  });

  it("blocks creation when three developer role sessions are still active", async () => {
    const bs = createDefaultBuildSessionState();
    bs.requirements = "创建第四个岗位。";
    const request = vi.fn(async (method: string) => {
      if (method === "aics.buildSession.list") {
        return ["created", "confirming", "validating"].map((state, index) => ({
          sessionId: `session-${index + 1}`,
          state,
          createdAt: index + 1,
          updatedAt: index + 1,
          userRequirements: `岗位${index + 1}`,
          userConfirmations: [],
          validationErrors: [],
        }));
      }
      if (method === "aics.buildSession.create") {
        throw new Error("create should not run after the refreshed limit check");
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = { client: { request } } as unknown as AppViewState;

    await createSession(state, bs);

    expect(request).toHaveBeenCalledWith("aics.buildSession.list", {});
    expect(request).not.toHaveBeenCalledWith("aics.buildSession.create", expect.anything());
    expect(bs.error).toBe(
      "开发者中心暂定最多开发 3 个岗位。请先取消或清理已有岗位后再创建新岗位。",
    );
    expect(bs.step).toBe("idle");
  });

  it("refreshes role development status after saving the role brief", async () => {
    const bs = createDefaultBuildSessionState();
    bs.sessionId = "session-1";
    bs.briefForm = {
      roleTitle: "商城运营",
      roleDescription: "观察授权转化、执行成功率、审计和账本。",
      targetUser: "岗位商城运营者",
      requiredCapabilities: [],
      dailySop: ["查看授权转化"],
      weeklySop: ["复盘能力缺口"],
      monthlySop: ["输出月度经营报告"],
      inputTypes: ["商城经营数据"],
      outputTypes: ["诊断报告"],
      forbiddenActions: ["不自动上架"],
      qualityStandards: ["必须有审计记录"],
    };
    const request = vi.fn(async (method: string) => {
      if (method === "aics.buildSession.submitBrief") {
        return { sessionId: "session-1", state: "confirming", validationErrors: [] };
      }
      if (method === "aics.roleDevelopment.status.get") {
        return {
          development: {
            sessionId: "session-1",
            status: "need_capability_decision",
            userStatusLabel: "发现缺失能力，等待开发决策",
            roleTitle: "商城运营",
            categoryName: "商城运营",
            categoryRef: "category:marketplace-ops@1",
            briefReady: true,
            canGenerateRolePackage: false,
            capability: {
              required: ["marketplace.read"],
              existing: [],
              missing: ["marketplace.read"],
              neededTools: ["tool.platform.marketplace_read_model"],
              neededSkills: [],
              neededProviders: [],
              humanConfirmationCapabilities: [],
              nonAutomaticCapabilities: [],
            },
            categoryCapabilityReview: null,
            nextActions: [
              {
                kind: "submit_capability_request",
                label: "提交能力开发申请",
                reason: "缺失能力：marketplace.read。",
                enabled: true,
              },
            ],
            analysis: {
              roleTitle: "商城运营",
              categoryName: "商城运营",
              neededTools: ["tool.platform.marketplace_read_model"],
            },
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = { client: { request } } as unknown as AppViewState;

    await submitBrief(state, bs);

    expect(request).toHaveBeenCalledWith("aics.buildSession.submitBrief", {
      sessionId: "session-1",
      brief: bs.briefForm,
    });
    expect(request).toHaveBeenCalledWith("aics.roleDevelopment.status.get", {
      sessionId: "session-1",
    });
    expect(bs.roleDevelopment).toMatchObject({
      status: "need_capability_decision",
      userStatusLabel: "发现缺失能力，等待开发决策",
      capability: {
        missing: ["marketplace.read"],
      },
    });
    expect(bs.capabilityAnalysis).toMatchObject({
      analysis: {
        categoryName: "商城运营",
      },
    });
  });

  it("asks the role development engine to prepare missing capability review", async () => {
    const bs = createDefaultBuildSessionState();
    bs.sessionId = "session-1";
    bs.session = {
      sessionId: "session-1",
      state: "confirming",
      createdAt: 1,
      updatedAt: 1,
      userRequirements: "创建商城运营岗位。",
      userConfirmations: [],
      validationErrors: [],
    };
    bs.briefForm = {
      roleTitle: "商城运营诊断官",
      roleDescription: "观察岗位供给、授权转化、执行成功率、审计和账本。",
      targetUser: "岗位商城运营者",
      targetCategory: "商城运营",
      coreResponsibilities: ["观察岗位供给", "分析授权转化"],
      taskExamples: ["输出商城运营诊断报告"],
      dailySop: ["查看授权转化"],
      weeklySop: ["复盘能力缺口"],
      monthlySop: ["输出月度经营报告"],
      inputTypes: ["岗位商品", "授权摘要"],
      outputTypes: ["运营诊断报告", "审计摘要"],
      forbiddenActions: ["不自动上架"],
      qualityStandards: ["必须有审计记录"],
    };
    const request = vi.fn(async (method: string) => {
      if (method === "aics.roleDevelopment.prepareMissingCapability") {
        return {
          development: {
            sessionId: "session-1",
            status: "waiting_capability_review",
            userStatusLabel: "能力申请已进入审核中心",
            roleTitle: "商城运营诊断官",
            categoryName: "商城运营",
            categoryRef: "category:marketplace-ops@1",
            briefReady: true,
            canGenerateRolePackage: false,
            capability: {
              required: ["marketplace.read", "audit.record"],
              existing: [],
              missing: ["marketplace.read", "audit.record"],
              neededTools: ["tool.platform.marketplace_read_model"],
              neededSkills: ["skill.platform.marketplace_ops_diagnosis"],
              neededProviders: ["provider.platform.model_chat_analysis"],
              humanConfirmationCapabilities: [],
              nonAutomaticCapabilities: ["audit.record"],
            },
            categoryCapabilityReview: {
              id: "category-review-1",
              requestId: "role-capability:marketplace-ops",
              workflowStatus: "waiting_category_review",
              reviewStatus: "待审核",
            },
            nextActions: [
              {
                kind: "open_review_center",
                label: "去审核中心处理能力",
                reason: "能力申请通过后，会进入现有 Tool/Skill 制作待办链路。",
                enabled: true,
              },
            ],
            analysis: {
              roleTitle: "商城运营诊断官",
              categoryName: "商城运营",
              categoryRef: "category:marketplace-ops@1",
              requiredCapabilities: ["marketplace.read", "audit.record"],
              neededTools: ["tool.platform.marketplace_read_model"],
              neededSkills: ["skill.platform.marketplace_ops_diagnosis"],
              neededProviders: ["provider.platform.model_chat_analysis"],
              categoryCapabilityReview: {
                id: "category-review-1",
                requestId: "role-capability:marketplace-ops",
                workflowStatus: "waiting_category_review",
                reviewStatus: "待审核",
              },
            },
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const refreshReviewCenter = vi.fn(async () => {});
    const state = { client: { request }, refreshReviewCenter } as unknown as AppViewState;

    await submitCategoryCapabilityRequest(state, bs);

    expect(request).toHaveBeenCalledWith("aics.roleDevelopment.prepareMissingCapability", {
      sessionId: "session-1",
    });
    expect(refreshReviewCenter).toHaveBeenCalledOnce();
    expect(bs.roleDevelopment).toMatchObject({
      status: "waiting_capability_review",
      categoryCapabilityReview: {
        id: "category-review-1",
        reviewStatus: "待审核",
      },
    });
    expect(bs.capabilityAnalysis).toMatchObject({
      analysis: {
        categoryCapabilityReview: {
          id: "category-review-1",
          reviewStatus: "待审核",
        },
      },
    });
  });

  it("reduces a role development session to a basic version", async () => {
    const bs = createDefaultBuildSessionState();
    bs.sessionId = "session-basic";
    const request = vi.fn(async (method: string) => {
      if (method === "aics.roleDevelopment.reduceScopeToBasic") {
        return {
          session: {
            sessionId: "session-basic",
            state: "confirming",
            createdAt: 1,
            updatedAt: 2,
            userRequirements: "创建运营报告岗位。",
            userConfirmations: ["基础版已关闭暂不可用能力：external.publish。"],
            validationErrors: [],
            brief: {
              roleTitle: "运营报告岗位",
              requiredCapabilities: ["document.write"],
              forbiddenActions: ["基础版已关闭暂不可用能力：external.publish。"],
            },
          },
          development: {
            sessionId: "session-basic",
            status: "ready_to_generate",
            userStatusLabel: "能力可用，可以生成岗位包",
            roleTitle: "运营报告岗位",
            categoryName: "运营",
            categoryRef: "运营",
            briefReady: true,
            canGenerateRolePackage: true,
            capability: {
              required: ["document.write"],
              existing: ["document.write"],
              missing: [],
              disabled: ["external.publish"],
              neededTools: [],
              neededSkills: [],
              neededProviders: [],
              humanConfirmationCapabilities: [],
              nonAutomaticCapabilities: [],
            },
            categoryCapabilityReview: null,
            toolSkillDevelopment: {
              required: [],
              todos: [],
              total: 0,
              approved: 0,
              pending: 0,
              ready: true,
            },
            nextActions: [
              {
                kind: "confirm_and_generate",
                label: "确认并生成岗位包",
                reason: "当前岗位能力已可满足，可以进入岗位包生成。",
                enabled: true,
              },
            ],
            analysis: {
              roleTitle: "运营报告岗位",
              categoryName: "运营",
            },
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = { client: { request } } as unknown as AppViewState;

    await reduceRoleDevelopmentScopeToBasic(state, bs);

    expect(request).toHaveBeenCalledWith("aics.roleDevelopment.reduceScopeToBasic", {
      sessionId: "session-basic",
    });
    expect(bs.session?.brief?.requiredCapabilities).toEqual(["document.write"]);
    expect(bs.roleDevelopment).toMatchObject({
      status: "ready_to_generate",
      canGenerateRolePackage: true,
      capability: {
        disabled: ["external.publish"],
      },
    });
  });

  it("loads bindable activated categories by role context instead of using the current review-center page", async () => {
    const bs = createDefaultBuildSessionState();
    bs.briefForm = {
      roleTitle: "商城运营诊断官",
      targetCategory: "商城运营",
    };
    bs.generateResult = {
      packageDir: "/tmp/商城运营",
      files: [],
      validationErrors: [],
      review: {
        id: "role-review-1",
      },
    };
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "aics.rolePreListingReview.get") {
        expect(params).toEqual({ reviewId: "role-review-1" });
        return {
          review: {
            id: "role-review-1",
            rolePackageId: "pkg-marketplace-ops",
            listingDraftId: "draft-marketplace-ops",
            developerId: "local-developer",
            category: "",
            requiredCapabilities: ["marketplace.read"],
          },
        };
      }
      if (method === "aics.categoryCapabilityReview.list") {
        expect(params).toMatchObject({
          filter: "activated",
          page: 1,
          pageSize: 100,
        });
        if (params.search === "pkg-marketplace-ops") {
          return {
            reviews: [
              {
                id: "category-review-target",
                requestId: "request-target",
                rolePackageId: "pkg-marketplace-ops",
                listingDraftId: "draft-marketplace-ops",
                developerId: "local-developer",
                title: "商城运营",
                categoryRef: "category:marketplace-ops@1",
                categoryName: "商城运营",
                roleDescription: "",
                targetUser: "",
                roleMaterials: {},
                requiredCapabilities: ["marketplace.read"],
                inputOutput: "",
                toolSkillRequirements: [],
                riskBoundaries: [],
                capabilityRefs: ["marketplace.read"],
                skillPackRef: "",
                toolPackRef: "",
                categoryPackRef: "",
                catalogRefs: [],
                workflowStatus: "category_review_approved",
                reviewStatus: "已通过",
                reviewFindings: [],
                reviewDecision: null,
                reviewedBy: "local-admin",
                reviewedAt: 2,
                cloudSyncStatus: "已同步",
                cloudSyncError: null,
                cloudSyncedAt: 3,
                createdAt: 1,
                updatedAt: 4,
              },
            ],
          };
        }
        return { reviews: [] };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = { client: { request } } as unknown as AppViewState;

    await refreshBindableCategoryReviews(state, bs, "role-review-1");

    expect(bs.generateResult.review).toMatchObject({
      rolePackageId: "pkg-marketplace-ops",
      requiredCapabilities: ["marketplace.read"],
    });
    expect(bs.bindableCategoryReviews).toHaveLength(1);
    expect(bs.bindableCategoryReviews[0]).toMatchObject({
      id: "category-review-target",
      categoryRef: "category:marketplace-ops@1",
      reviewStatus: "已通过",
      cloudSyncStatus: "已同步",
    });
    expect(request).toHaveBeenCalledWith("aics.categoryCapabilityReview.list", {
      filter: "activated",
      search: "pkg-marketplace-ops",
      page: 1,
      pageSize: 100,
      sort: "updated_desc",
    });
  });

  it("prefills the marketplace ops brief when no existing category template should be used", async () => {
    const bs = createDefaultBuildSessionState();
    bs.sessionId = "session-1";
    const request = vi.fn(async (method: string) => {
      if (method === "aics.buildSession.startBriefing") {
        return {
          sessionId: "session-1",
          state: "briefing",
          userRequirements: "创建岗位商城商城运营岗位，观察授权转化、执行成功率、审计和账本。",
          matchedTemplate: null,
          validationErrors: [],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = { client: { request } } as unknown as AppViewState;

    await startBriefing(state, bs);

    expect(bs.briefForm).toMatchObject({
      roleTitle: "商城运营诊断官",
      targetUser: "岗位商城运营者",
      targetCategory: "商城运营",
      monthlySop: expect.arrayContaining(["汇总岗位商城经营表现和下一轮能力建设建议"]),
      inputTypes: expect.arrayContaining(["岗位商品、授权、执行、审计和账本摘要"]),
      outputTypes: expect.arrayContaining(["运营诊断报告", "审计摘要"]),
      forbiddenActions: expect.arrayContaining(["不绕过审核", "不读取原始账本明细"]),
    });
    expect(bs.briefForm.requiredCapabilities).toBeUndefined();
  });

  it("refreshes review center and tool supply after a role package creates a listing review", async () => {
    const bs = createDefaultBuildSessionState();
    bs.sessionId = "session-1";
    const request = vi.fn(async (method: string) => {
      if (method === "aics.buildSession.generate") {
        return {
          session: {
            sessionId: "session-1",
            state: "completed",
            validationErrors: [],
          },
          packageDir: "/tmp/商城运营",
          files: ["manifest.json", "listing.md", "SOP.md"],
          validationErrors: [],
          review: {
            id: "role-review-1",
            rolePackageId: "商城运营",
            reviewStatus: "待审核",
          },
          capabilityAnalysis: {
            categoryName: "商城运营",
            neededTools: ["tool.platform.marketplace_read_model"],
            neededSkills: ["skill.platform.marketplace_ops_diagnosis"],
            neededProviders: ["provider.platform.model_chat_analysis"],
            categoryCapabilityReview: {
              workflowStatus: "waiting_category_review",
            },
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const refreshReviewCenter = vi.fn(async () => {});
    const refreshToolSupplyControlReadModel = vi.fn(async () => {});
    const setTab = vi.fn();
    const state = {
      client: { request },
      refreshReviewCenter,
      refreshToolSupplyControlReadModel,
      setTab,
    } as unknown as AppViewState;

    await generatePackage(state, bs);

    expect(request).toHaveBeenCalledWith("aics.buildSession.generate", {
      sessionId: "session-1",
    });
    expect(bs.step).toBe("completed");
    expect(bs.generateResult?.review).toMatchObject({
      id: "role-review-1",
      reviewStatus: "待审核",
    });
    expect(bs.capabilityAnalysis).toMatchObject({
      analysis: {
        categoryName: "商城运营",
        neededTools: ["tool.platform.marketplace_read_model"],
        neededSkills: ["skill.platform.marketplace_ops_diagnosis"],
        neededProviders: ["provider.platform.model_chat_analysis"],
        categoryCapabilityReview: {
          workflowStatus: "waiting_category_review",
        },
      },
    });
    expect(refreshReviewCenter).toHaveBeenCalledOnce();
    expect(refreshToolSupplyControlReadModel).toHaveBeenCalledOnce();
    expect(setTab).toHaveBeenCalledWith("reviewCenter");
  });

  it("shows build-session generation blockers returned by the gateway", async () => {
    const bs = createDefaultBuildSessionState();
    bs.sessionId = "session-1";
    const request = vi.fn(async (method: string) => {
      if (method === "aics.buildSession.generate") {
        return {
          session: {
            sessionId: "session-1",
            state: "failed",
            validationErrors: [],
          },
          error: "API 管理未给 BuildSession 绑定可用模型 Provider。",
          validationErrors: [],
          review: null,
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const refreshReviewCenter = vi.fn(async () => {});
    const state = {
      client: { request },
      refreshReviewCenter,
      refreshToolSupplyControlReadModel: vi.fn(async () => {}),
      setTab: vi.fn(),
    } as unknown as AppViewState;

    await generatePackage(state, bs);

    expect(bs.step).toBe("failed");
    expect(bs.error).toBe("API 管理未给 BuildSession 绑定可用模型 Provider。");
    expect(bs.generateResult?.review).toBeNull();
    expect(refreshReviewCenter).not.toHaveBeenCalled();
  });

  it("lets the role developer submit an approved review for listing", async () => {
    const bs = createDefaultBuildSessionState();
    bs.step = "completed";
    bs.generateResult = {
      packageDir: "/tmp/商城运营",
      files: ["manifest.json"],
      validationErrors: [],
      review: {
        id: "role-review-1",
        rolePackageId: "商城运营",
        reviewStatus: "已通过",
      },
    };
    const request = vi.fn(async (method: string) => {
      if (method === "aics.roleDeveloper.submitForListing") {
        return {
          review: {
            id: "role-review-1",
            reviewStatus: "已提交上架",
            cloudRoleListingId: "local_rolelisting_marketplace_ops",
          },
          cloud: {
            mode: "local",
            roleListingId: "local_rolelisting_marketplace_ops",
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = { client: { request } } as unknown as AppViewState;

    const result = await submitDeveloperRoleForListing(state, bs, "role-review-1");

    expect(request).toHaveBeenCalledWith("aics.roleDeveloper.submitForListing", {
      reviewId: "role-review-1",
    });
    expect(result).toMatchObject({
      cloud: { roleListingId: "local_rolelisting_marketplace_ops" },
    });
    expect(bs.generateResult?.review).toMatchObject({
      reviewStatus: "已提交上架",
      cloudRoleListingId: "local_rolelisting_marketplace_ops",
    });
    expect(bs.generateResult?.listingResult).toMatchObject({
      cloud: { roleListingId: "local_rolelisting_marketplace_ops" },
    });
  });
});
