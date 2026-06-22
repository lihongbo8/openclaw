import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closePipelineDb, getPipelineDb } from "../../aics-main-flow/db.js";
import {
  approveCategoryCapabilityReview,
  approveRolePreListingReview,
  approveToolSkillReview,
  createCategoryCapabilityRequest,
  bindRolePreListingReviewCategory,
  getRolePreListingReview,
  runRolePreListingValidation,
  runToolSkillValidation,
  startRolePreListingReview,
  startToolSkillReview,
  syncCategoryCapabilityReviewToCloud,
} from "../../aics-main-flow/role-pre-listing-review.js";
import { ToolRegistry, type ToolRegistration } from "../../aics-main-flow/tool-registry.js";
import { listToolSkillDevelopmentTasks } from "../../aics-main-flow/tool-skill-development-store.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

const { coreGatewayHandlers } = await import("../server-methods.js");

const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;

let currentConfig: OpenClawConfig;

function makeTool(): ToolRegistration {
  return {
    toolId: "image-tool",
    name: "image-tool",
    label: "Image Tool",
    description: "Test tool",
    capabilities: ["image.generation"],
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

function writePackage(dir: string) {
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        rolePackageId: "pkg-image-review",
        version: "1.0.0",
        name: "图片审核岗位",
        requiredCapabilities: ["image.generation"],
        workPatterns: ["analyze"],
        outputContracts: ["document", "json"],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(dir, "listing.md"), "# 图片审核岗位\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# README\n");
  fs.writeFileSync(path.join(dir, "validation.md"), "# smoke\n- [ ] pass\n");
}

async function approveAndSyncImageCategory(rolePackageId = "pkg-image-review") {
  const request = createCategoryCapabilityRequest({
    title: "图片审核品类能力",
    categoryName: "图片审核",
    categoryRef: "category:image-review@1",
    rolePackageId,
    requiredCapabilities: ["image.generation"],
    toolSkillRequirements: ["image.generation"],
    reason: "测试岗位需要正式图片审核品类能力包。",
  });
  approveCategoryCapabilityReview(request.id);
  await syncCategoryCapabilityReviewToCloud(request.id, {
    cloudBaseUrl: "https://cloud.test",
    cloudAccessToken: "admin-token",
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          categoryRef: "category:image-review@1",
          category: { category_ref: "category:image-review@1" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  return request;
}

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
  if (!ok) {
    throw new Error(JSON.stringify(error ?? payload));
  }
  return payload as Record<string, unknown>;
}

describe("aics role pre-listing review gateway", () => {
  let stateDir: string;
  let packageDir: string;

  beforeEach(() => {
    closePipelineDb();
    ToolRegistry._clear();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-review-gateway-state-"));
    packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-review-gateway-package-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    ToolRegistry.register(makeTool());
    currentConfig = {
      plugins: {
        entries: {
          aics: {
            config: {
              cloudBaseUrl: "https://cloud.test",
              cloudAccessToken: "vendor-token",
            },
          },
        },
      },
    } as OpenClawConfig;
  });

  afterEach(() => {
    closePipelineDb();
    ToolRegistry._clear();
    if (ORIGINAL_STATE_DIR === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
    }
    vi.unstubAllGlobals();
  });

  it("returns configured public support contact", async () => {
    currentConfig = {
      plugins: {
        entries: {
          aics: {
            config: {
              cloudAccessToken: "secret-token",
              supportContact: {
                displayName: "系统开发者",
                wechatId: "openclaw-helper",
                audience: "all",
                purpose: "岗位闭环卡住时联系。",
                serviceHours: "工作日",
              },
            },
          },
        },
      },
    } as OpenClawConfig;

    const payload = await callGateway("aics.supportContact.get", {});

    expect(payload).toEqual({
      supportContact: {
        displayName: "系统开发者",
        wechatId: "openclaw-helper",
        audience: "all",
        purpose: "岗位闭环卡住时联系。",
        serviceHours: "工作日",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("secret-token");
  });

  it("returns a visible local support-contact placeholder when not configured", async () => {
    currentConfig = {} as OpenClawConfig;

    const payload = await callGateway("aics.supportContact.get", {});

    expect(payload).toEqual({
      supportContact: expect.objectContaining({
        displayName: "系统开发者",
        wechatId: "待配置",
        audience: "all",
        purpose: expect.stringContaining("岗位开发"),
        note: expect.stringContaining("supportContact"),
      }),
    });
  });

  it("creates role capability analysis and system developer todos from role material", async () => {
    const payload = await callGateway("aics.roleCapabilityAnalysis.create", {
      roleTitle: "商城运营",
      roleDescription: "观察岗位供给、授权转化、执行成功率、审计和账本。",
      targetUser: "岗位商城运营者",
      sopFlow: "读取商城经营数据并输出诊断。",
      dailyPlan: "每天查看执行失败和授权转化。",
      weeklyPlan: "每周复盘品类能力缺口。",
      monthlyPlan: "每月输出经营报告。",
      inputOutput: "输入商城数据，输出诊断报告和待办。",
      riskBoundaries: ["不自动上架", "不绕过审计账本"],
    });

    const analysis = payload.analysis as {
      categoryName?: string;
      requiredCapabilities?: string[];
      neededTools?: string[];
      neededSkills?: string[];
      neededProviders?: string[];
      categoryCapabilityReview?: {
        id?: string;
        requestId?: string;
        rolePackageId?: string;
        listingDraftId?: string | null;
        developerId?: string;
        title?: string;
        categoryName?: string;
        categoryRef?: string;
        roleDescription?: string;
        targetUser?: string;
        workflowStatus?: string;
        toolSkillRequirements?: string[];
        requiredCapabilities?: string[];
        inputOutput?: string;
        riskBoundaries?: string[];
        roleMaterials?: {
          sopFlow?: string;
          dailyPlan?: string;
          weeklyPlan?: string;
          monthlyPlan?: string;
          inputOutput?: string;
        };
      };
      toolSkillReviews?: Array<{ assetId?: string }>;
    };

    expect(analysis.categoryName).toBe("商城运营");
    expect(analysis.requiredCapabilities).toEqual(
      expect.arrayContaining(["marketplace.read", "audit.record"]),
    );
    expect(analysis.neededTools).toContain("tool.platform.marketplace_read_model");
    expect(analysis.neededSkills).toContain("skill.platform.marketplace_ops_diagnosis");
    expect(analysis.neededProviders).toContain("provider.platform.model_chat_analysis");
    expect(analysis.categoryCapabilityReview?.workflowStatus).toBe("waiting_category_review");
    expect(analysis.categoryCapabilityReview?.roleMaterials).toMatchObject({
      sopFlow: "读取商城经营数据并输出诊断。",
      dailyPlan: "每天查看执行失败和授权转化。",
      weeklyPlan: "每周复盘品类能力缺口。",
      monthlyPlan: "每月输出经营报告。",
      inputOutput: "输入商城数据，输出诊断报告和待办。",
    });
    expect(analysis.categoryCapabilityReview?.toolSkillRequirements).toEqual(
      expect.arrayContaining([
        "tool.platform.marketplace_read_model",
        "skill.platform.marketplace_ops_diagnosis",
      ]),
    );
    expect(analysis.categoryCapabilityReview?.id).toBe("");
    expect(analysis.toolSkillReviews).toEqual([]);
    expect((await callGateway("aics.categoryCapabilityReview.list", {})).reviews).toEqual([]);
    expect((await callGateway("aics.toolSkillReview.list", {})).reviews).toEqual([]);

    const draft = analysis.categoryCapabilityReview!;
    await callGateway("aics.categoryCapabilityRequest.create", {
      requestId: draft.requestId,
      rolePackageId: draft.rolePackageId,
      listingDraftId: draft.listingDraftId,
      developerId: draft.developerId,
      title: draft.title,
      categoryName: draft.categoryName,
      categoryRef: draft.categoryRef,
      roleDescription: draft.roleDescription,
      targetUser: draft.targetUser,
      roleMaterials: draft.roleMaterials,
      requiredCapabilities: draft.requiredCapabilities,
      inputOutput: draft.inputOutput,
      toolSkillRequirements: draft.toolSkillRequirements,
      riskBoundaries: draft.riskBoundaries,
      reason: "开发者确认没有合适品类，提交品类能力申请。",
    });
    expect((await callGateway("aics.categoryCapabilityReview.list", {})).reviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: draft.requestId,
          workflowStatus: "waiting_category_review",
        }),
      ]),
    );
    const toolSkillReviewsBeforeApproval = (await callGateway("aics.toolSkillReview.list", {})) as {
      reviews: Array<{ assetId?: string }>;
    };
    expect(toolSkillReviewsBeforeApproval.reviews).toEqual([]);

    await callGateway("aics.categoryCapabilityReview.approve", {
      reviewId:
        draft.id ||
        (
          (await callGateway("aics.categoryCapabilityReview.list", {})).reviews as Array<{
            id: string;
          }>
        )[0]?.id,
    });
    expect(listToolSkillDevelopmentTasks().map((task) => task.assetId)).toEqual(
      expect.arrayContaining([
        "tool.platform.marketplace_read_model",
        "skill.platform.marketplace_ops_diagnosis",
      ]),
    );
  });

  it("keeps a submitted category request attached to refreshed role capability analysis", async () => {
    const firstPayload = await callGateway("aics.roleCapabilityAnalysis.create", {
      roleTitle: "商城运营",
      roleDescription: "观察岗位供给、授权转化、执行成功率、审计和账本。",
      targetUser: "岗位商城运营者",
      dailyPlan: "每天查看执行失败和授权转化。",
      weeklyPlan: "每周复盘品类能力缺口。",
      monthlyPlan: "每月输出经营报告。",
      inputOutput: "输入商城数据，输出诊断报告和待办。",
    });
    const firstAnalysis = (
      firstPayload as { analysis: { categoryCapabilityReview: Record<string, unknown> } }
    ).analysis;
    const draft = firstAnalysis.categoryCapabilityReview;
    const submitted = (await callGateway("aics.categoryCapabilityRequest.create", {
      requestId: draft.requestId,
      rolePackageId: draft.rolePackageId,
      listingDraftId: draft.listingDraftId,
      developerId: draft.developerId,
      title: draft.title,
      categoryName: draft.categoryName,
      categoryRef: draft.categoryRef,
      roleDescription: draft.roleDescription,
      targetUser: draft.targetUser,
      roleMaterials: draft.roleMaterials,
      requiredCapabilities: draft.requiredCapabilities,
      inputOutput: draft.inputOutput,
      toolSkillRequirements: draft.toolSkillRequirements,
      riskBoundaries: draft.riskBoundaries,
    })) as { review: { id: string; requestId: string } };

    const refreshedPayload = await callGateway("aics.roleCapabilityAnalysis.create", {
      roleTitle: "商城运营",
      roleDescription: "观察岗位供给、授权转化、执行成功率、审计和账本。",
      targetUser: "岗位商城运营者",
      dailyPlan: "每天查看执行失败和授权转化。",
      weeklyPlan: "每周复盘品类能力缺口。",
      monthlyPlan: "每月输出经营报告。",
      inputOutput: "输入商城数据，输出诊断报告和待办。",
    });
    const refreshedAnalysis = (
      refreshedPayload as {
        analysis: {
          categoryCapabilityReview: { id?: string; requestId?: string; reviewStatus?: string };
        };
      }
    ).analysis;

    expect(refreshedAnalysis.categoryCapabilityReview).toMatchObject({
      id: submitted.review.id,
      requestId: submitted.review.requestId,
      reviewStatus: "待审核",
    });
  });

  it("returns paged role review queue results through the gateway", async () => {
    writePackage(packageDir);
    for (let index = 0; index < 25; index++) {
      startRolePreListingReview({
        packageDir,
        rolePackageId: `pkg-review-page-${String(index + 1).padStart(2, "0")}`,
        developerId: `developer-${index + 1}`,
      });
    }

    const payload = await callGateway("aics.rolePreListingReview.list", {
      page: 2,
      pageSize: 10,
      search: "pkg-review-page",
      sort: "updated_desc",
    });

    expect(payload.reviews as unknown[]).toHaveLength(10);
    expect(payload.pageInfo).toEqual({
      page: 2,
      pageSize: 10,
      total: 25,
      totalPages: 3,
      hasPreviousPage: true,
      hasNextPage: true,
    });
  });

  it("caps 1000 category capability requests to one bounded page through the gateway", async () => {
    for (let index = 0; index < 1000; index++) {
      createCategoryCapabilityRequest({
        title: `商城运营品类能力 ${String(index + 1).padStart(4, "0")}`,
        categoryName: `商城运营 ${String(index + 1).padStart(4, "0")}`,
        categoryRef: `category:marketplace-ops-${String(index + 1).padStart(4, "0")}@1`,
        rolePackageId: `pkg-marketplace-ops-${String(index + 1).padStart(4, "0")}`,
        developerId: `developer-${String(index + 1).padStart(4, "0")}`,
        requiredCapabilities: ["marketplace.read"],
        toolSkillRequirements: ["tool.platform.marketplace_read_model"],
        reason: "大队列分页测试。",
      });
    }

    const payload = await callGateway("aics.categoryCapabilityReview.list", {
      page: 1,
      pageSize: 1000,
      search: "商城运营",
      sort: "updated_desc",
    });

    expect(payload.reviews as unknown[]).toHaveLength(100);
    expect(payload.pageInfo).toEqual({
      page: 1,
      pageSize: 100,
      total: 1000,
      totalPages: 10,
      hasPreviousPage: false,
      hasNextPage: true,
    });
  });

  it("submits an approved local review through the cloud bridge config", async () => {
    writePackage(packageDir);
    const calls: Array<{ path: string; authorization: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({
          path: url.pathname,
          authorization: String((init?.headers as Record<string, string>).authorization ?? ""),
        });
        if (url.pathname === "/vendor/dijie/role-packages") {
          return new Response(
            JSON.stringify({
              ok: true,
              rolePackageId: "cloud-role-package-1",
              package: { packageId: "pkg-image-review", packageVersion: "1.0.0" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname === "/vendor/dijie/role-listings") {
          return new Response(JSON.stringify({ ok: true, roleListingId: "role-listing-1" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.pathname === "/vendor/dijie/role-listings/role-listing-1/submit-review") {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.pathname === "/admin/dijie/reviews/role-listing-1/evaluations") {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.pathname === "/admin/dijie/reviews/role-listing-1/finalize") {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.pathname === "/vendor/dijie/role-listings/role-listing-1/publish") {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: false, error: "unexpected path" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);
    const categoryRequest = await approveAndSyncImageCategory();
    const roleReview = startRolePreListingReview({ packageDir });
    bindRolePreListingReviewCategory(roleReview.id, categoryRequest.id);
    runRolePreListingValidation(roleReview.id);
    approveRolePreListingReview(roleReview.id);

    const result = await callGateway("aics.roleDeveloper.submitForListing", {
      reviewId: roleReview.id,
    });

    expect((result.review as { reviewStatus?: string }).reviewStatus).toBe("已提交上架");
    expect((result.cloud as { roleListingId?: string }).roleListingId).toBe("role-listing-1");
    expect(calls).toEqual([
      { path: "/vendor/dijie/role-packages", authorization: "Bearer vendor-token" },
      { path: "/vendor/dijie/role-listings", authorization: "Bearer vendor-token" },
      {
        path: "/vendor/dijie/role-listings/role-listing-1/submit-review",
        authorization: "Bearer vendor-token",
      },
      {
        path: "/admin/dijie/reviews/role-listing-1/evaluations",
        authorization: "Bearer vendor-token",
      },
      {
        path: "/admin/dijie/reviews/role-listing-1/finalize",
        authorization: "Bearer vendor-token",
      },
      {
        path: "/vendor/dijie/role-listings/role-listing-1/publish",
        authorization: "Bearer vendor-token",
      },
    ]);
  });

  it("publishes an approved review as a local zero-yuan role listing when cloud is not configured", async () => {
    currentConfig = {} as OpenClawConfig;
    writePackage(packageDir);
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);
    const categoryRequest = await approveAndSyncImageCategory();
    const roleReview = startRolePreListingReview({ packageDir });
    bindRolePreListingReviewCategory(roleReview.id, categoryRequest.id);
    runRolePreListingValidation(roleReview.id);
    approveRolePreListingReview(roleReview.id);

    const result = await callGateway("aics.roleDeveloper.submitForListing", {
      reviewId: roleReview.id,
    });

    expect((result.review as { reviewStatus?: string }).reviewStatus).toBe("已提交上架");
    expect((result.review as { cloudSubmitStatus?: string }).cloudSubmitStatus).toBe("已提交");
    expect((result.cloud as { mode?: string }).mode).toBe("local");
    expect((result.cloud as { roleListingId?: string }).roleListingId).toMatch(
      /^local_rolelisting_/u,
    );
  });

  it("blocks developer listing submission until a formal category is bound", async () => {
    currentConfig = {} as OpenClawConfig;
    writePackage(packageDir);
    const roleReview = startRolePreListingReview({ packageDir });
    getPipelineDb()
      .prepare(
        "UPDATE role_pre_listing_reviews SET review_status=?, validation_status=?, review_findings=?, review_decision=?, approved_at=?, updated_at=? WHERE id=?",
      )
      .run(
        "已通过",
        "已通过",
        "[]",
        "模拟旧数据：已通过但未绑定正式品类。",
        Date.now(),
        Date.now(),
        roleReview.id,
      );

    await expect(
      callGateway("aics.roleDeveloper.submitForListing", {
        reviewId: roleReview.id,
      }),
    ).rejects.toThrow("岗位必须先绑定正式品类，才能上架。");

    const afterSubmit = getRolePreListingReview(roleReview.id);
    expect(afterSubmit).toMatchObject({
      reviewStatus: "已通过",
      cloudSubmitStatus: "提交失败",
      submitError: "岗位必须先绑定正式品类，才能上架。",
      reviewDecision: "岗位必须先绑定正式品类，才能上架。",
    });
  });

  it("uses local listing wording after manual role approval", async () => {
    currentConfig = {} as OpenClawConfig;
    writePackage(packageDir);
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);
    const categoryRequest = await approveAndSyncImageCategory();
    const roleReview = startRolePreListingReview({ packageDir });
    bindRolePreListingReviewCategory(roleReview.id, categoryRequest.id);
    runRolePreListingValidation(roleReview.id);

    const approved = approveRolePreListingReview(roleReview.id);

    expect(approved.reviewDecision).toContain("允许岗位开发者确认上架");
    expect(approved.reviewDecision).not.toContain("云端商城上架");
  });

  it("uses local category activation and zero-yuan listing when only localhost cloud placeholder is configured", async () => {
    currentConfig = {
      plugins: {
        entries: {
          aics: {
            config: {
              cloudBaseUrl: "http://127.0.0.1:9000",
            },
          },
        },
      },
    } as OpenClawConfig;
    writePackage(packageDir);
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);
    const categoryRequest = createCategoryCapabilityRequest({
      title: "图片审核品类能力",
      categoryName: "图片审核",
      categoryRef: "category:image-review@1",
      rolePackageId: "pkg-image-review",
      requiredCapabilities: ["image.generation"],
      toolSkillRequirements: ["image.generation"],
      reason: "测试岗位需要正式图片审核品类能力包。",
    });
    approveCategoryCapabilityReview(categoryRequest.id);

    const syncPayload = await callGateway("aics.categoryCapabilityReview.activateLocal", {
      reviewId: categoryRequest.id,
    });
    const roleReview = startRolePreListingReview({ packageDir });
    bindRolePreListingReviewCategory(roleReview.id, categoryRequest.id);
    runRolePreListingValidation(roleReview.id);
    approveRolePreListingReview(roleReview.id);

    const result = await callGateway("aics.roleDeveloper.submitForListing", {
      reviewId: roleReview.id,
    });

    expect((syncPayload.review as { cloudSyncStatus?: string }).cloudSyncStatus).toBe("已同步");
    expect((syncPayload.cloud as { category?: { sync_mode?: string } }).category?.sync_mode).toBe(
      "local",
    );
    expect((result.cloud as { mode?: string }).mode).toBe("local");
    expect((result.cloud as { roleListingId?: string }).roleListingId).toMatch(
      /^local_rolelisting_/u,
    );
  });

  it("keeps the legacy category sync method compatible while local activation is preferred", async () => {
    currentConfig = {} as OpenClawConfig;
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);
    const categoryRequest = createCategoryCapabilityRequest({
      title: "图片审核品类能力",
      categoryName: "图片审核",
      categoryRef: "category:image-review@1",
      rolePackageId: "pkg-image-review",
      requiredCapabilities: ["image.generation"],
      toolSkillRequirements: ["image-tool"],
      reason: "测试岗位需要正式图片审核品类能力包。",
    });
    approveCategoryCapabilityReview(categoryRequest.id);

    const syncPayload = await callGateway("aics.categoryCapabilityReview.syncToCloud", {
      reviewId: categoryRequest.id,
    });

    expect((syncPayload.review as { cloudSyncStatus?: string }).cloudSyncStatus).toBe("已同步");
    expect((syncPayload.cloud as { category?: { sync_mode?: string } }).category?.sync_mode).toBe(
      "local",
    );
  });

  it("lets Tool and Skill activate a ready category capability package", async () => {
    currentConfig = {
      plugins: {
        entries: {
          aics: {
            config: {
              cloudBaseUrl: "http://127.0.0.1:9000",
            },
          },
        },
      },
    } as OpenClawConfig;
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);
    const categoryRequest = createCategoryCapabilityRequest({
      title: "图片审核品类能力",
      categoryName: "图片审核",
      categoryRef: "category:image-review@1",
      rolePackageId: "pkg-image-review",
      requiredCapabilities: ["image.generation"],
      toolSkillRequirements: ["image.generation"],
      reason: "测试岗位需要正式图片审核品类能力包。",
    });
    approveCategoryCapabilityReview(categoryRequest.id);

    const syncPayload = await callGateway(
      "aics.toolSupply.categoryCapability.activateReadyPackage",
      {
        categoryCapabilityReviewId: categoryRequest.id,
      },
    );

    expect((syncPayload.review as { cloudSyncStatus?: string }).cloudSyncStatus).toBe("已同步");
    expect((syncPayload.cloud as { category?: { sync_mode?: string } }).category?.sync_mode).toBe(
      "local",
    );
  });
});
