import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closePipelineDb } from "./db.js";
import { getLocalRoleListing } from "./local-role-marketplace.js";
import {
  approveCategoryCapabilityReview,
  approveRolePreListingReview,
  bindRolePreListingReviewCategory,
  approveToolSkillReview,
  buildCloudRolePackageUploadPayload,
  createCategoryCapabilityRequest,
  createRoleCapabilityAnalysis,
  getRolePreListingReview,
  listCategoryCapabilityReviewPage,
  listRolePreListingReviewPage,
  listCategoryCapabilityReviews,
  listToolSkillReviews,
  requestCategoryCapabilityChanges,
  runRolePreListingValidation,
  runToolSkillValidation,
  startRolePreListingReview,
  startToolSkillReview,
  syncCategoryCapabilityReviewToCloud,
  submitRolePreListingForListing,
} from "./role-pre-listing-review.js";
import { ToolRegistry, type ToolCapabilityGroup, type ToolRegistration } from "./tool-registry.js";
import { createToolSkillDevelopmentEngine } from "./tool-skill-development-engine.js";

const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;

function makeTool(capability: ToolCapabilityGroup = "image.generation"): ToolRegistration {
  return {
    toolId: "image-tool",
    name: "image-tool",
    label: "Image Tool",
    description: "Test tool",
    capabilities: [capability],
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

function registerCapabilityTool(toolId: string, capabilities: string[]): void {
  ToolRegistry.register({
    ...makeTool(capabilities[0] as ToolCapabilityGroup),
    toolId,
    name: toolId,
    label: toolId,
    capabilities: capabilities as ToolCapabilityGroup[],
  });
}

function registerMarketplaceOpsTools(): void {
  registerCapabilityTool("tool.platform.marketplace_read_model", [
    "marketplace.read",
    "gateway.role_read_model",
    "ledger.summary.read",
    "audit.record",
    "document.write",
    "human.confirm",
    "model.chat.analysis",
  ]);
  registerCapabilityTool("tool.platform.gateway_role_read_model", ["gateway.role_read_model"]);
  registerCapabilityTool("tool.platform.ledger_summary_read", ["ledger.summary.read"]);
  registerCapabilityTool("tool.platform.audit_record", ["audit.record"]);
  registerCapabilityTool("tool.platform.template_renderer", ["document.write"]);
  registerCapabilityTool("tool.platform.human_confirmation", ["human.confirm"]);
  registerCapabilityTool("provider.platform.model_chat_analysis", ["model.chat.analysis"]);
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
    } as any,
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
          blockedByAgentFilter: false,
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
  } as any;
}

function approveAllToolSkillDevelopmentTasks(evidence = marketplaceOpsValidationEvidence()): void {
  const engine = createToolSkillDevelopmentEngine();
  for (const task of engine.listTasks()) {
    const checked = engine.runValidation({
      taskId: task.id,
      assetType: task.assetType,
      assetId: task.assetId,
      declaredCapabilities: task.requiredCapabilities,
      evidence,
    });
    expect(checked.review).not.toBeNull();
    approveToolSkillReview(checked.review!.id);
  }
}

function writePackage(dir: string, extra: Record<string, string> = {}) {
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        rolePackageId: "pkg-image-review",
        version: "1.0.0",
        name: "图片审核岗位",
        requiredCapabilities: ["image.generation"],
        workPatterns: ["generate"],
        outputContracts: ["image"],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(dir, "listing.md"), "# 图片审核岗位\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# README\n");
  fs.writeFileSync(path.join(dir, "validation.md"), "# smoke\n- [ ] pass\n");
  for (const [name, content] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
}

type CloudCall = {
  path: string;
  authorization: string;
  body: Record<string, unknown> | undefined;
};

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeCloudFetch(
  calls: CloudCall[],
  overrides: Record<string, { status?: number; payload: Record<string, unknown> }> = {},
): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({
      path: url.pathname,
      authorization: headers?.authorization ?? "",
      body,
    });
    const override = overrides[url.pathname];
    if (override) return jsonResponse(override.payload, override.status ?? 200);
    if (url.pathname === "/vendor/dijie/role-packages") {
      return jsonResponse({
        ok: true,
        rolePackageId: "cloud-role-package-1",
        package: {
          packageId: "pkg-image-review",
          packageVersion: "1.0.0",
        },
      });
    }
    if (url.pathname === "/vendor/dijie/role-listings") {
      return jsonResponse({ ok: true, roleListingId: "role-listing-1" });
    }
    if (url.pathname === "/vendor/dijie/role-listings/role-listing-1/submit-review") {
      return jsonResponse({ ok: true, roleListingId: "role-listing-1" });
    }
    if (url.pathname === "/admin/dijie/reviews/role-listing-1/evaluations") {
      return jsonResponse({
        ok: true,
        roleListingId: "role-listing-1",
        reviewId: "role-listing-1",
      });
    }
    if (url.pathname === "/admin/dijie/reviews/role-listing-1/finalize") {
      return jsonResponse({
        ok: true,
        roleListingId: "role-listing-1",
        reviewId: "role-listing-1",
      });
    }
    if (url.pathname === "/vendor/dijie/role-listings/role-listing-1/publish") {
      return jsonResponse({ ok: true, roleListingId: "role-listing-1" });
    }
    return jsonResponse({ ok: false, error: "unexpected path" }, 404);
  };
}

function submitCategoryRequestFromAnalysis(
  analysis: ReturnType<typeof createRoleCapabilityAnalysis>,
) {
  const draft = analysis.categoryCapabilityReview;
  return createCategoryCapabilityRequest({
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
    reason: draft.reviewDecision ?? undefined,
  });
}

async function approveAndBindImageCategory(roleReviewId: string) {
  const request = createCategoryCapabilityRequest({
    title: "图片审核品类能力",
    categoryName: "图片审核",
    categoryRef: "category:image-review@1",
    rolePackageId: "pkg-image-review",
    requiredCapabilities: ["image.generation"],
    toolSkillRequirements: ["image.generation"],
    reason: "岗位需要正式图片审核品类能力包。",
  });
  approveCategoryCapabilityReview(request.id);
  for (const review of listToolSkillReviews()) {
    runToolSkillValidation(review.id);
    approveToolSkillReview(review.id);
  }
  await syncCategoryCapabilityReviewToCloud(request.id, {
    cloudBaseUrl: "https://cloud.test",
    cloudAccessToken: "admin-token",
    fetchFn: async () =>
      jsonResponse({
        ok: true,
        categoryRef: "category:image-review@1",
        category: { category_ref: "category:image-review@1" },
      }),
  });
  bindRolePreListingReviewCategory(roleReviewId, request.id);
}

describe("RolePreListingReview", () => {
  let stateDir: string;
  let packageDir: string;

  beforeEach(() => {
    closePipelineDb();
    ToolRegistry._clear();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-local-listing-check-state-"));
    packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-role-package-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    ToolRegistry.register(makeTool());
  });

  afterEach(() => {
    closePipelineDb();
    ToolRegistry._clear();
    if (ORIGINAL_STATE_DIR === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
    }
  });

  it("turns marketplace operator role material into category capability and system developer todos", () => {
    const analysis = createRoleCapabilityAnalysis({
      roleTitle: "商城运营",
      roleDescription: "观察岗位供给、授权转化、执行成功率、审计和账本，输出运营诊断。",
      targetUser: "岗位商城运营者",
      sopFlow: "读取商城授权和岗位执行数据，分析阻塞原因，输出日周月运营建议。",
      dailyPlan: "每天查看授权转化和执行失败。",
      weeklyPlan: "每周复盘品类能力缺口。",
      monthlyPlan: "每月输出商城经营报告。",
      inputOutput: "输入商城经营数据，输出诊断报告和待办清单。",
      riskBoundaries: ["不自动上架", "不绕过授权、审计和账本"],
    });

    expect(analysis.categoryName).toBe("商城运营");
    expect(analysis.categoryRef).toBe("category:marketplace-ops@1");
    expect(analysis.requiredCapabilities).toEqual(
      expect.arrayContaining([
        "marketplace.read",
        "gateway.role_read_model",
        "ledger.summary.read",
        "audit.record",
        "document.write",
        "human.confirm",
        "model.chat.analysis",
      ]),
    );
    expect(analysis.missingCapabilities).toEqual(expect.arrayContaining(["marketplace.read"]));
    expect(analysis.humanConfirmationCapabilities).toContain("human.confirm");
    expect(analysis.nonAutomaticCapabilities).toEqual(
      expect.arrayContaining(["audit.record", "ledger.summary.read"]),
    );
    expect(analysis.neededTools).toContain("tool.platform.marketplace_read_model");
    expect(analysis.neededSkills).toContain("skill.platform.marketplace_ops_diagnosis");
    expect(analysis.neededProviders).toContain("provider.platform.model_chat_analysis");
    expect(analysis.categoryCapabilityReview.workflowStatus).toBe("waiting_category_review");
    expect(analysis.categoryCapabilityReview.roleMaterials).toMatchObject({
      roleTitle: "商城运营",
      roleDescription: expect.stringContaining("观察岗位供给"),
      targetUser: "岗位商城运营者",
      sopFlow: expect.stringContaining("读取商城授权"),
      dailyPlan: "每天查看授权转化和执行失败。",
      weeklyPlan: "每周复盘品类能力缺口。",
      monthlyPlan: "每月输出商城经营报告。",
      inputOutput: "输入商城经营数据，输出诊断报告和待办清单。",
      riskBoundaries: ["不自动上架", "不绕过授权、审计和账本"],
    });
    expect(analysis.categoryCapabilityReview.toolSkillRequirements).toEqual(
      expect.arrayContaining([
        "tool.platform.marketplace_read_model",
        "skill.platform.marketplace_ops_diagnosis",
        "provider.platform.model_chat_analysis",
      ]),
    );
    expect(analysis.categoryCapabilityReview.id).toBe("");
    expect(analysis.categoryCapabilityReview.reviewDecision).toContain("系统根据岗位资料分析");
    expect(listCategoryCapabilityReviews()).toHaveLength(0);
    expect(listToolSkillReviews()).toHaveLength(0);

    const submitted = submitCategoryRequestFromAnalysis(analysis);
    expect(submitted.id).not.toBe("");
    expect(listCategoryCapabilityReviews()).toHaveLength(1);
    expect(listToolSkillReviews()).toHaveLength(0);

    approveCategoryCapabilityReview(submitted.id);
    expect(
      createToolSkillDevelopmentEngine()
        .listTasks()
        .map((task) => task.assetId),
    ).toEqual(
      expect.arrayContaining([
        "tool.platform.marketplace_read_model",
        "skill.platform.marketplace_ops_diagnosis",
        "provider.platform.model_chat_analysis",
      ]),
    );
  });

  it("approves category capability request first, then blocks activation until system developer todos pass", async () => {
    const analysis = createRoleCapabilityAnalysis({
      roleTitle: "商城运营",
      roleDescription: "观察岗位供给、授权转化、执行成功率、审计和账本。",
      targetUser: "岗位商城运营者",
    });

    const submitted = submitCategoryRequestFromAnalysis(analysis);
    expect(listToolSkillReviews()).toHaveLength(0);
    const approvedBeforeProduction = approveCategoryCapabilityReview(submitted.id);
    expect(approvedBeforeProduction.reviewStatus).toBe("已通过");
    expect(approvedBeforeProduction.workflowStatus).toBe("category_review_approved");
    expect(
      createToolSkillDevelopmentEngine()
        .listTasks()
        .map((task) => task.assetId),
    ).toEqual(
      expect.arrayContaining([
        "tool.platform.marketplace_read_model",
        "skill.platform.marketplace_ops_diagnosis",
      ]),
    );
    await expect(syncCategoryCapabilityReviewToCloud(submitted.id)).rejects.toThrow(
      "品类能力包尚未完成",
    );
    const blocked = listCategoryCapabilityReviews()[0]!;
    expect(blocked.reviewStatus).toBe("已通过");
    expect(blocked.cloudSyncStatus).toBe("同步失败");
    expect(blocked.cloudSyncError).toContain("tool.platform.marketplace_read_model");

    registerMarketplaceOpsTools();
    approveAllToolSkillDevelopmentTasks();

    const activated = await syncCategoryCapabilityReviewToCloud(submitted.id);
    expect(activated.review.cloudSyncStatus).toBe("已同步");
    expect(activated.review.catalogRefs).toEqual(
      expect.arrayContaining([
        "tool.platform.marketplace_read_model",
        "skill.platform.marketplace_ops_diagnosis",
      ]),
    );
  });

  it("keeps a submitted category capability request visible when capability analysis refreshes", () => {
    const firstAnalysis = createRoleCapabilityAnalysis({
      roleTitle: "商城运营",
      roleDescription: "观察岗位供给、授权转化、执行成功率、审计和账本。",
      targetUser: "岗位商城运营者",
      dailyPlan: "每天查看授权转化。",
      weeklyPlan: "每周复盘能力缺口。",
      monthlyPlan: "每月输出经营报告。",
      inputOutput: "输入商城数据，输出诊断报告。",
    });
    const submitted = submitCategoryRequestFromAnalysis(firstAnalysis);

    const refreshedAnalysis = createRoleCapabilityAnalysis({
      roleTitle: "商城运营",
      roleDescription: "观察岗位供给、授权转化、执行成功率、审计和账本。",
      targetUser: "岗位商城运营者",
      dailyPlan: "每天查看授权转化。",
      weeklyPlan: "每周复盘能力缺口。",
      monthlyPlan: "每月输出经营报告。",
      inputOutput: "输入商城数据，输出诊断报告。",
    });

    expect(refreshedAnalysis.categoryCapabilityReview).toMatchObject({
      id: submitted.id,
      requestId: submitted.requestId,
      reviewStatus: "待审核",
      workflowStatus: "waiting_category_review",
    });
    expect(listCategoryCapabilityReviews()).toHaveLength(1);
    expect(listToolSkillReviews()).toHaveLength(0);
  });

  it("does not allow Tool or Skill production approval before validation runs", () => {
    const review = startToolSkillReview({
      assetType: "tool",
      assetId: "tool.platform.marketplace_read_model",
      source: "system-analysis",
      declaredCapabilities: ["marketplace.read"],
    });

    expect(() => approveToolSkillReview(review.id)).toThrow("请先在工具与 Skill 模块完成检查");
    expect(listToolSkillReviews()[0]?.reviewStatus).toBe("待审核");
  });

  it("blocks phantom tool production until a real enabled tool implementation exists", () => {
    const review = startToolSkillReview({
      assetType: "tool",
      assetId: "tool.platform.missing_runtime",
      source: "system-analysis",
      declaredCapabilities: ["marketplace.read"],
    });

    const checked = runToolSkillValidation(review.id);

    expect(checked.reviewStatus).toBe("待开发者修改");
    expect(checked.reviewFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "跑通性",
          severity: "blocking",
          message: expect.stringContaining("未找到可用工具实现"),
        }),
      ]),
    );
    expect(() => approveToolSkillReview(review.id)).toThrow("请先在工具与 Skill 模块完成检查");
  });

  it("blocks phantom Skill production until an installed eligible Skill exists", () => {
    const review = startToolSkillReview({
      assetType: "skill",
      assetId: "skill.platform.missing_skill",
      source: "system-analysis",
      declaredCapabilities: ["marketplace.read"],
    });

    const checked = runToolSkillValidation(review.id, marketplaceOpsValidationEvidence());

    expect(checked.reviewStatus).toBe("待开发者修改");
    expect(checked.reviewFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "跑通性",
          severity: "blocking",
          message: expect.stringContaining("未找到可用 Skill 实现"),
        }),
      ]),
    );
  });

  it("blocks provider/API production until API Management has an available model provider", () => {
    const review = startToolSkillReview({
      assetType: "tool",
      assetId: "provider.platform.model_chat_analysis",
      source: "provider-api",
      declaredCapabilities: ["model.chat.analysis"],
    });

    const checked = runToolSkillValidation(review.id, {
      ...marketplaceOpsValidationEvidence(),
      apiConnections: {
        entries: [],
      } as any,
    });

    expect(checked.reviewStatus).toBe("待开发者修改");
    expect(checked.reviewFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "跑通性",
          severity: "blocking",
          message: expect.stringContaining("未找到可用 Provider/API 绑定"),
        }),
      ]),
    );
  });

  it("reuses an activated category capability instead of creating a duplicate request", async () => {
    const requiredCapabilities = [
      "marketplace.read",
      "gateway.role_read_model",
      "ledger.summary.read",
      "audit.record",
      "document.write",
      "human.confirm",
      "model.chat.analysis",
    ];
    const request = createCategoryCapabilityRequest({
      title: "商城运营品类能力",
      categoryName: "商城运营",
      categoryRef: "category:marketplace-ops@1",
      rolePackageId: "category-pack-marketplace-ops",
      requiredCapabilities,
      reason: "系统开发者已制作正式商城运营品类能力包。",
    });
    registerMarketplaceOpsTools();
    for (const capability of requiredCapabilities) {
      const review = startToolSkillReview({
        assetType: "tool",
        assetId: capability,
        declaredCapabilities: [capability],
      });
      runToolSkillValidation(review.id);
      approveToolSkillReview(review.id);
    }
    approveCategoryCapabilityReview(request.id);
    await syncCategoryCapabilityReviewToCloud(request.id);
    const reviewCountBeforeAnalysis = listToolSkillReviews().length;

    const analysis = createRoleCapabilityAnalysis({
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

    expect(analysis.categoryCapabilityReview.id).toBe(request.id);
    expect(analysis.categoryCapabilityReview.cloudSyncStatus).toBe("已同步");
    expect(analysis.missingCapabilities).toEqual([]);
    expect(analysis.neededTools).toEqual([]);
    expect(analysis.neededSkills).toEqual([]);
    expect(analysis.neededProviders).toEqual([]);
    expect(analysis.toolSkillReviews).toEqual([]);
    expect(listCategoryCapabilityReviews()).toHaveLength(1);
    expect(listToolSkillReviews()).toHaveLength(reviewCountBeforeAnalysis);
    expect(listToolSkillReviews().map((review) => review.assetId)).not.toContain(
      "tool.platform.marketplace_read_model",
    );
  });

  it("blocks role listing when required tool or Skill capability has not passed local review", () => {
    writePackage(packageDir);
    const review = startRolePreListingReview({ packageDir });

    const checked = runRolePreListingValidation(review.id);

    expect(checked.reviewStatus).toBe("待开发者修改");
    expect(checked.validationStatus).toBe("未通过");
    expect(
      checked.reviewFindings.some((finding) => finding.message.includes("未审核通过的工具/Skill")),
    ).toBe(true);
  });

  it("blocks role listing when the package does not declare execution contract", () => {
    writePackage(packageDir, {
      "manifest.json": JSON.stringify(
        {
          rolePackageId: "pkg-image-review",
          version: "1.0.0",
          name: "图片审核岗位",
          requiredCapabilities: ["image.generation"],
        },
        null,
        2,
      ),
    });
    const review = startRolePreListingReview({ packageDir });

    const checked = runRolePreListingValidation(review.id);

    expect(checked.validationStatus).toBe("未通过");
    expect(checked.reviewFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "执行契约",
          severity: "blocking",
          message: expect.stringContaining("workPatterns"),
        }),
        expect.objectContaining({
          section: "执行契约",
          severity: "blocking",
          message: expect.stringContaining("outputContracts"),
        }),
      ]),
    );
  });

  it("limits developer center to three role drafts while allowing the same role to refresh", () => {
    const packageDirs = Array.from({ length: 4 }, () =>
      fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-role-limit-package-")),
    );

    for (let index = 0; index < 3; index++) {
      startRolePreListingReview({
        packageDir: packageDirs[index]!,
        rolePackageId: `pkg-dev-role-${index + 1}`,
      });
    }

    expect(() =>
      startRolePreListingReview({
        packageDir: packageDirs[3]!,
        rolePackageId: "pkg-dev-role-4",
      }),
    ).toThrow("开发者中心暂定最多开发 3 个岗位");
    expect(() =>
      startRolePreListingReview({
        packageDir: packageDirs[0]!,
        rolePackageId: "pkg-dev-role-1",
      }),
    ).not.toThrow();
  });

  it("pages and searches a 1000-role review queue without returning every role", () => {
    for (let index = 0; index < 1000; index++) {
      startRolePreListingReview({
        packageDir,
        rolePackageId: `pkg-marketplace-ops-${String(index + 1).padStart(4, "0")}`,
        developerId: `developer-${index + 1}`,
        category: index % 10 === 0 ? "" : "category:marketplace-ops@1",
      });
    }

    const firstPage = listRolePreListingReviewPage({ page: 1, pageSize: 50 });
    expect(firstPage.reviews).toHaveLength(50);
    expect(firstPage.pageInfo).toEqual({
      page: 1,
      pageSize: 50,
      total: 1000,
      totalPages: 20,
      hasPreviousPage: false,
      hasNextPage: true,
    });

    const secondPage = listRolePreListingReviewPage({ page: 2, pageSize: 50 });
    expect(secondPage.reviews).toHaveLength(50);
    expect(secondPage.reviews.map((review) => review.id)).not.toEqual(
      firstPage.reviews.map((review) => review.id),
    );

    const searched = listRolePreListingReviewPage({
      page: 1,
      pageSize: 20,
      search: "pkg-marketplace-ops-0999",
    });
    expect(searched.pageInfo.total).toBe(1);
    expect(searched.reviews[0]?.rolePackageId).toBe("pkg-marketplace-ops-0999");

    const missingCategory = listRolePreListingReviewPage({
      page: 1,
      pageSize: 20,
      filter: "missing_category",
    });
    expect(missingCategory.pageInfo.total).toBe(100);
    expect(missingCategory.reviews.every((review) => review.category === "")).toBe(true);
  });

  it("pages and searches a 1000-category capability request queue without returning every request", () => {
    for (let index = 0; index < 1000; index++) {
      createCategoryCapabilityRequest({
        requestId: `category-capability-page-${String(index + 1).padStart(4, "0")}`,
        title: `商城运营品类申请 ${String(index + 1).padStart(4, "0")}`,
        categoryName: "商城运营",
        categoryRef: `category:marketplace-ops-${String(index + 1).padStart(4, "0")}@1`,
        rolePackageId: `pkg-marketplace-ops-${String(index + 1).padStart(4, "0")}`,
        developerId: `developer-${index + 1}`,
        requiredCapabilities: ["marketplace.read", "audit.record"],
        toolSkillRequirements: ["tool.platform.marketplace_read_model"],
      });
    }

    const firstPage = listCategoryCapabilityReviewPage({ page: 1, pageSize: 50 });
    expect(firstPage.reviews).toHaveLength(50);
    expect(firstPage.pageInfo).toEqual({
      page: 1,
      pageSize: 50,
      total: 1000,
      totalPages: 20,
      hasPreviousPage: false,
      hasNextPage: true,
    });

    const secondPage = listCategoryCapabilityReviewPage({ page: 2, pageSize: 50 });
    expect(secondPage.reviews).toHaveLength(50);
    expect(secondPage.reviews.map((review) => review.id)).not.toEqual(
      firstPage.reviews.map((review) => review.id),
    );

    const searched = listCategoryCapabilityReviewPage({
      page: 1,
      pageSize: 20,
      search: "pkg-marketplace-ops-0999",
    });
    expect(searched.pageInfo.total).toBe(1);
    expect(searched.reviews[0]?.rolePackageId).toBe("pkg-marketplace-ops-0999");

    const pending = listCategoryCapabilityReviewPage({
      page: 1,
      pageSize: 20,
      filter: "pending_review",
    });
    expect(pending.pageInfo.total).toBe(1000);
    expect(pending.reviews.every((review) => review.reviewStatus === "待审核")).toBe(true);
  });

  it("sorts category capability requests by activation status for large review queues", async () => {
    const failed = approveCategoryCapabilityReview(
      createCategoryCapabilityRequest({
        requestId: "category-capability-sort-failed",
        title: "同步失败品类申请",
        categoryName: "同步失败品类",
        categoryRef: "category:sort-failed@1",
        rolePackageId: "pkg-sort-failed",
        requiredCapabilities: ["marketplace.read"],
        toolSkillRequirements: ["tool.platform.marketplace_read_model"],
      }).id,
    );
    await expect(syncCategoryCapabilityReviewToCloud(failed.id)).rejects.toThrow("工具与 Skill");

    const unsynced = approveCategoryCapabilityReview(
      createCategoryCapabilityRequest({
        requestId: "category-capability-sort-unsynced",
        title: "未同步品类申请",
        categoryName: "未同步品类",
        categoryRef: "category:sort-unsynced@1",
        rolePackageId: "pkg-sort-unsynced",
        requiredCapabilities: ["audit.record"],
        toolSkillRequirements: ["tool.platform.audit-record"],
      }).id,
    );

    const synced = approveCategoryCapabilityReview(
      createCategoryCapabilityRequest({
        requestId: "category-capability-sort-synced",
        title: "已激活品类申请",
        categoryName: "已激活品类",
        categoryRef: "category:sort-synced@1",
        rolePackageId: "pkg-sort-synced",
        requiredCapabilities: ["document.write"],
        toolSkillRequirements: ["tool.platform.template_renderer"],
      }).id,
    );
    registerMarketplaceOpsTools();
    approveAllToolSkillDevelopmentTasks({} as any);
    await syncCategoryCapabilityReviewToCloud(synced.id);

    const sorted = listCategoryCapabilityReviewPage({
      page: 1,
      pageSize: 10,
      sort: "activation_status_asc",
    });

    expect(sorted.reviews.map((review) => review.rolePackageId)).toEqual([
      "pkg-sort-failed",
      "pkg-sort-unsynced",
      "pkg-sort-synced",
    ]);
    expect(sorted.reviews.map((review) => review.cloudSyncStatus)).toEqual([
      "同步失败",
      "未同步",
      "已同步",
    ]);
  });

  it("returns category capability requests for more developer materials without rejecting them", () => {
    const review = createCategoryCapabilityRequest({
      title: "商城运营品类能力",
      categoryName: "商城运营",
      categoryRef: "category:marketplace-ops@1",
      rolePackageId: "pkg-marketplace-ops",
      requiredCapabilities: ["marketplace.read"],
      toolSkillRequirements: ["tool.platform.marketplace_read_model"],
      reason: "岗位资料需要平台审核。",
    });

    const returned = requestCategoryCapabilityChanges(review.id);

    expect(returned.reviewStatus).toBe("待开发者修改");
    expect(returned.workflowStatus).toBe("waiting_category_review");
    expect(returned.reviewDecision).toContain("请岗位开发者补充");
  });

  it("allows submitForListing only after tool/Skill and role reviews pass", async () => {
    writePackage(packageDir);
    const calls: CloudCall[] = [];
    const fetchFn = makeCloudFetch(calls);
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);

    const roleReview = startRolePreListingReview({ packageDir });
    await approveAndBindImageCategory(roleReview.id);
    const checked = runRolePreListingValidation(roleReview.id);
    expect(checked.validationStatus).toBe("已通过");
    await expect(
      submitRolePreListingForListing(roleReview.id, {
        cloudBaseUrl: "https://cloud.test",
        cloudAccessToken: "vendor-token",
        fetchFn,
      }),
    ).rejects.toThrow("需要先通过本地审核中心");

    approveRolePreListingReview(roleReview.id);
    const submitted = await submitRolePreListingForListing(roleReview.id, {
      cloudBaseUrl: "https://cloud.test",
      cloudAccessToken: "vendor-token",
      fetchFn,
    });

    expect(submitted.review.reviewStatus).toBe("已提交上架");
    expect(submitted.review.cloudSubmitStatus).toBe("已提交");
    expect(submitted.review.cloudRoleListingId).toBe("role-listing-1");
    expect(calls.map((call) => call.path)).toEqual([
      "/vendor/dijie/role-packages",
      "/vendor/dijie/role-listings",
      "/vendor/dijie/role-listings/role-listing-1/submit-review",
      "/admin/dijie/reviews/role-listing-1/evaluations",
      "/admin/dijie/reviews/role-listing-1/finalize",
      "/vendor/dijie/role-listings/role-listing-1/publish",
    ]);
    expect(calls.every((call) => call.authorization === "Bearer vendor-token")).toBe(true);
    expect(calls[1]?.body?.usageInstructions).toContain("role_package/README.md");
    expect(calls[1]?.body?.usageInstructions).not.toContain("/tmp/");
  });

  it("blocks listing until a missing category capability is approved and synced", async () => {
    writePackage(packageDir);
    const calls: CloudCall[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({
        path: url.pathname,
        authorization: headers?.authorization ?? "",
        body,
      });
      if (url.pathname === "/admin/dijie/role-categories") {
        return jsonResponse({
          ok: true,
          categoryRef: "category:marketplace-ops@1",
          category: { category_ref: "category:marketplace-ops@1", category_status: "approved" },
        });
      }
      return makeCloudFetch(calls)(input, init);
    };

    const roleReview = startRolePreListingReview({
      packageDir,
      category: "category:marketplace-ops@1",
    });
    const blocked = runRolePreListingValidation(roleReview.id);
    expect(blocked.validationStatus).toBe("未通过");
    expect(
      blocked.reviewFindings.some((finding) => finding.message.includes("尚未通过本地审核并激活")),
    ).toBe(true);

    const request = createCategoryCapabilityRequest({
      title: "商城运营诊断官品类能力",
      categoryName: "商城运营",
      categoryRef: "category:marketplace-ops@1",
      rolePackageId: "pkg-image-review",
      requiredCapabilities: ["image.generation"],
      toolSkillRequirements: ["image.generation"],
      reason: "岗位需要正式商城运营品类能力包。",
    });
    const categoryToolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image.generation",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(categoryToolReview.id);
    approveToolSkillReview(categoryToolReview.id);
    const approved = approveCategoryCapabilityReview(request.id);
    expect(approved.reviewStatus).toBe("已通过");

    const synced = await syncCategoryCapabilityReviewToCloud(request.id, {
      cloudBaseUrl: "https://cloud.test",
      cloudAccessToken: "admin-token",
      fetchFn,
    });
    expect(synced.review.cloudSyncStatus).toBe("已同步");

    const checked = runRolePreListingValidation(roleReview.id);
    expect(checked.validationStatus).toBe("已通过");
    approveRolePreListingReview(roleReview.id);
    const submitted = await submitRolePreListingForListing(roleReview.id, {
      cloudBaseUrl: "https://cloud.test",
      cloudAccessToken: "vendor-token",
      fetchFn,
    });

    expect(submitted.review.reviewStatus).toBe("已提交上架");
    expect(calls.map((call) => call.path)).toContain("/admin/dijie/role-categories");
  });

  it("runs the missing-category production loop through Tool/Skill production, category activation, binding, and role review", async () => {
    writePackage(packageDir, {
      "manifest.json": JSON.stringify(
        {
          rolePackageId: "pkg-marketplace-ops",
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
        },
        null,
        2,
      ),
    });
    const roleReview = startRolePreListingReview({
      packageDir,
      rolePackageId: "pkg-marketplace-ops",
      listingDraftId: "session-marketplace-ops",
      developerId: "local-developer",
      category: "",
    });
    const analysis = createRoleCapabilityAnalysis({
      rolePackageId: "pkg-marketplace-ops",
      listingDraftId: "session-marketplace-ops",
      developerId: "local-developer",
      roleTitle: "商城运营诊断官",
      roleDescription: "观察岗位供给、授权转化、执行成功率、审计和账本，输出运营诊断。",
      targetUser: "岗位商城运营者",
      sopFlow: "读取商城授权和岗位执行数据，分析阻塞原因，输出日周月运营建议。",
      dailyPlan: "每天查看授权转化和执行失败。",
      weeklyPlan: "每周复盘品类能力缺口。",
      monthlyPlan: "每月输出商城经营报告。",
      inputOutput: "输入商城经营数据，输出诊断报告和待办清单。",
      riskBoundaries: ["不自动上架", "不绕过授权、审计和账本"],
    });

    expect(analysis.categoryCapabilityReview.workflowStatus).toBe("waiting_category_review");
    expect(analysis.categoryCapabilityReview.listingDraftId).toBe("session-marketplace-ops");
    expect(analysis.categoryCapabilityReview.roleMaterials).toMatchObject({
      dailyPlan: "每天查看授权转化和执行失败。",
      weeklyPlan: "每周复盘品类能力缺口。",
      monthlyPlan: "每月输出商城经营报告。",
    });
    const submittedCategory = submitCategoryRequestFromAnalysis(analysis);
    const approvedBeforeProduction = approveCategoryCapabilityReview(submittedCategory.id);
    expect(approvedBeforeProduction.reviewStatus).toBe("已通过");
    await expect(syncCategoryCapabilityReviewToCloud(submittedCategory.id)).rejects.toThrow(
      "品类能力包尚未完成",
    );

    registerMarketplaceOpsTools();
    approveAllToolSkillDevelopmentTasks();
    const activatedCategory = await syncCategoryCapabilityReviewToCloud(
      approvedBeforeProduction.id,
    );
    expect(activatedCategory.review.cloudSyncStatus).toBe("已同步");

    const bound = bindRolePreListingReviewCategory(roleReview.id, activatedCategory.review.id);
    expect(bound.review.category).toBe("category:marketplace-ops@1");
    expect(bound.categoryCapabilityReview.workflowStatus).toBe("category_bound");

    const checked = runRolePreListingValidation(roleReview.id);
    expect(checked.validationStatus).toBe("已通过");
    expect(checked.reviewFindings.some((finding) => finding.severity === "blocking")).toBe(false);
    const approvedRole = approveRolePreListingReview(roleReview.id);
    expect(approvedRole.reviewStatus).toBe("已通过");
    expect(approvedRole.reviewDecision).toContain("允许岗位开发者确认上架");
    expect(approvedRole.cloudRoleListingId).toBeNull();
    expect(getLocalRoleListing(`local_rolelisting_${roleReview.id}`)).toBeNull();

    const submitted = await submitRolePreListingForListing(roleReview.id);
    expect(submitted.cloud.roleListingId).toMatch(/^local_rolelisting_/u);
    expect(getLocalRoleListing(String(submitted.cloud.roleListingId))).toMatchObject({
      roleListingId: submitted.cloud.roleListingId,
      authorizationFeeCents: 0,
      status: "published",
    });
  });

  it("keeps synced category capability bindable until the role developer binds the category", async () => {
    writePackage(packageDir, {
      "manifest.json": JSON.stringify(
        {
          rolePackageId: "pkg-marketplace-ops",
          version: "1.0.0",
          name: "商城运营诊断官",
          requiredCapabilities: ["marketplace.read", "audit.record"],
          workPatterns: ["analyze"],
          outputContracts: ["document", "json"],
        },
        null,
        2,
      ),
    });
    const calls: CloudCall[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({
        path: url.pathname,
        authorization: headers?.authorization ?? "",
        body,
      });
      if (url.pathname === "/admin/dijie/role-categories") {
        return jsonResponse({
          ok: true,
          categoryRef: "category:marketplace-ops@1",
          category: { category_ref: "category:marketplace-ops@1", category_status: "approved" },
        });
      }
      return jsonResponse({ ok: false, error: "unexpected path" }, 404);
    };
    const roleReview = startRolePreListingReview({ packageDir });
    const request = createCategoryCapabilityRequest({
      title: "商城运营诊断官品类能力",
      categoryName: "商城运营",
      categoryRef: "category:marketplace-ops@1",
      rolePackageId: "pkg-marketplace-ops",
      requiredCapabilities: ["marketplace.read", "audit.record"],
      toolSkillRequirements: [],
      reason: "岗位需要正式商城运营品类能力包。",
    });
    registerCapabilityTool("marketplace.read", ["marketplace.read"]);
    registerCapabilityTool("audit.record", ["audit.record"]);
    for (const capability of ["marketplace.read", "audit.record"]) {
      const toolSkillReview = startToolSkillReview({
        assetType: "tool",
        assetId: capability,
        declaredCapabilities: [capability],
      });
      runToolSkillValidation(toolSkillReview.id);
      approveToolSkillReview(toolSkillReview.id);
    }

    approveCategoryCapabilityReview(request.id);
    const synced = await syncCategoryCapabilityReviewToCloud(request.id, {
      cloudBaseUrl: "https://cloud.test",
      cloudAccessToken: "admin-token",
      fetchFn,
    });

    expect(synced.review.cloudSyncStatus).toBe("已同步");
    expect(synced.review.workflowStatus).toBe("category_review_approved");
    expect(getRolePreListingReview(roleReview.id)?.category).toBe("");

    const unboundCheck = runRolePreListingValidation(roleReview.id);
    expect(unboundCheck.validationStatus).toBe("未通过");
    expect(unboundCheck.reviewFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "能力绑定",
          severity: "blocking",
          message: "岗位尚未绑定正式品类。",
        }),
      ]),
    );
    expect(() => approveRolePreListingReview(roleReview.id)).toThrow("本地综合检查未通过");

    const bound = bindRolePreListingReviewCategory(roleReview.id, request.id);

    expect(bound.review.category).toBe("category:marketplace-ops@1");
    expect(bound.review.requiredCapabilities).toEqual(["marketplace.read", "audit.record"]);
    expect(bound.review.boundCommonCapabilities).toEqual(["marketplace.read", "audit.record"]);
    expect(bound.categoryCapabilityReview.workflowStatus).toBe("category_bound");
    expect(bound.categoryCapabilityReview.reviewDecision).toContain(
      "已将岗位 pkg-marketplace-ops 绑定到正式品类",
    );

    const checked = runRolePreListingValidation(roleReview.id);
    expect(checked.validationStatus).toBe("已通过");
    expect(checked.reviewFindings.some((finding) => finding.message.includes("能力目录缺少"))).toBe(
      false,
    );
    expect(calls.map((call) => call.path)).toEqual(["/admin/dijie/role-categories"]);
  });

  it("rejects binding a synced category capability that does not cover the role requirements", async () => {
    writePackage(packageDir);
    const roleReview = startRolePreListingReview({ packageDir });
    const request = createCategoryCapabilityRequest({
      title: "商城运营品类能力",
      categoryName: "商城运营",
      categoryRef: "category:marketplace-ops@1",
      rolePackageId: "pkg-marketplace-ops",
      requiredCapabilities: ["marketplace.read"],
      toolSkillRequirements: [],
      reason: "另一个岗位的品类能力。",
    });
    const toolSkillReview = startToolSkillReview({
      assetType: "tool",
      assetId: "marketplace.read",
      declaredCapabilities: ["marketplace.read"],
    });
    registerCapabilityTool("marketplace.read", ["marketplace.read"]);
    runToolSkillValidation(toolSkillReview.id);
    approveToolSkillReview(toolSkillReview.id);
    approveCategoryCapabilityReview(request.id);
    await syncCategoryCapabilityReviewToCloud(request.id);

    expect(() => bindRolePreListingReviewCategory(roleReview.id, request.id)).toThrow(
      "所选品类能力不覆盖当前岗位需求",
    );
  });

  it("fails closed when approving a role whose category is not activated", () => {
    writePackage(packageDir);
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);

    const roleReview = startRolePreListingReview({
      packageDir,
      category: "category:image-review@1",
      requiredCapabilities: ["image.generation"],
    });
    const checked = runRolePreListingValidation(roleReview.id);

    expect(checked.validationStatus).toBe("未通过");
    expect(checked.reviewFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "能力绑定",
          severity: "blocking",
          message: "品类 category:image-review@1 尚未通过本地审核并激活，需先提交品类能力申请。",
        }),
      ]),
    );
    expect(() => approveRolePreListingReview(roleReview.id)).toThrow("本地综合检查未通过");
  });

  it("activates an approved category capability locally when cloud is not deployed", async () => {
    writePackage(packageDir, {
      "manifest.json": JSON.stringify(
        {
          rolePackageId: "pkg-marketplace-ops",
          version: "1.0.0",
          name: "商城运营诊断官",
          requiredCapabilities: ["marketplace.read", "audit.record"],
          workPatterns: ["analyze"],
          outputContracts: ["document", "json"],
        },
        null,
        2,
      ),
    });
    const roleReview = startRolePreListingReview({ packageDir });
    const request = createCategoryCapabilityRequest({
      title: "商城运营诊断官品类能力",
      categoryName: "商城运营",
      rolePackageId: "pkg-marketplace-ops",
      requiredCapabilities: ["marketplace.read", "audit.record"],
      toolSkillRequirements: ["tool.platform.marketplace_read_model", "tool.platform.audit_record"],
      reason: "本地版先制作正式品类能力包。",
    });
    registerMarketplaceOpsTools();
    for (const assetId of ["tool.platform.marketplace_read_model", "tool.platform.audit_record"]) {
      const toolSkillReview = startToolSkillReview({
        assetType: "tool",
        assetId,
        declaredCapabilities: ["marketplace.read", "audit.record"],
      });
      runToolSkillValidation(toolSkillReview.id);
      approveToolSkillReview(toolSkillReview.id);
    }
    approveCategoryCapabilityReview(request.id);

    const synced = await syncCategoryCapabilityReviewToCloud(request.id, {
      cloudBaseUrl: "http://127.0.0.1:9000",
    });

    expect(synced.review.cloudSyncStatus).toBe("已同步");
    expect(synced.review.cloudSyncError).toBeNull();
    expect(synced.review.reviewDecision).toContain("本地版已写入正式品类能力目录");
    expect(synced.cloud).toMatchObject({
      categoryRef: "category:marketplace-ops@1",
      category: {
        sync_mode: "local",
      },
    });

    const bound = bindRolePreListingReviewCategory(roleReview.id, request.id);
    expect(bound.review.category).toBe("category:marketplace-ops@1");
    const checked = runRolePreListingValidation(roleReview.id);
    expect(checked.validationStatus).toBe("已通过");
  });

  it("publishes a local zero-yuan listing when cloud bridge config is missing", async () => {
    writePackage(packageDir);
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);
    const roleReview = startRolePreListingReview({ packageDir });
    await approveAndBindImageCategory(roleReview.id);
    runRolePreListingValidation(roleReview.id);
    approveRolePreListingReview(roleReview.id);

    const submitted = await submitRolePreListingForListing(roleReview.id);

    const current = getRolePreListingReview(roleReview.id);
    expect(submitted.cloud.mode).toBe("local");
    expect(submitted.cloud.roleListingId).toMatch(/^local_rolelisting_/u);
    expect(getLocalRoleListing(String(submitted.cloud.roleListingId))?.title).toBe("图片审核岗位");
    expect(current?.reviewStatus).toBe("已提交上架");
    expect(current?.cloudSubmitStatus).toBe("已提交");
    expect(current?.submitError).toBeNull();
  });

  it("publishes a local zero-yuan listing when only localhost cloud placeholder is configured", async () => {
    writePackage(packageDir);
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);
    const roleReview = startRolePreListingReview({ packageDir });
    await approveAndBindImageCategory(roleReview.id);
    runRolePreListingValidation(roleReview.id);
    approveRolePreListingReview(roleReview.id);

    const submitted = await submitRolePreListingForListing(roleReview.id, {
      cloudBaseUrl: "http://127.0.0.1:9000",
    });

    const current = getRolePreListingReview(roleReview.id);
    expect(submitted.cloud.mode).toBe("local");
    expect(submitted.cloud.roleListingId).toMatch(/^local_rolelisting_/u);
    expect(current?.reviewStatus).toBe("已提交上架");
    expect(current?.cloudSubmitStatus).toBe("已提交");
    expect(current?.submitError).toBeNull();
  });

  it("keeps approved status when the cloud access token is missing", async () => {
    writePackage(packageDir);
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);
    const roleReview = startRolePreListingReview({ packageDir });
    await approveAndBindImageCategory(roleReview.id);
    runRolePreListingValidation(roleReview.id);
    approveRolePreListingReview(roleReview.id);

    await expect(
      submitRolePreListingForListing(roleReview.id, {
        cloudBaseUrl: "https://cloud.test",
      }),
    ).rejects.toThrow("Token");

    const current = getRolePreListingReview(roleReview.id);
    expect(current?.reviewStatus).toBe("已通过");
    expect(current?.cloudSubmitStatus).toBe("提交失败");
    expect(current?.submitError).toContain("Token");
  });

  it.each([
    [401, "unauthorized Bearer vendor-token-secret"],
    [403, "forbidden Bearer vendor-token-secret"],
    [409, "duplicate listing for vendor-token-secret"],
    [502, "upstream failed vendor-token-secret"],
  ])("keeps safe cloud errors for HTTP %s responses", async (status, errorMessage) => {
    writePackage(packageDir);
    const calls: CloudCall[] = [];
    const fetchFn = makeCloudFetch(calls, {
      "/vendor/dijie/role-packages": {
        status,
        payload: { ok: false, error: errorMessage },
      },
    });
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);
    const roleReview = startRolePreListingReview({ packageDir });
    await approveAndBindImageCategory(roleReview.id);
    runRolePreListingValidation(roleReview.id);
    approveRolePreListingReview(roleReview.id);

    await expect(
      submitRolePreListingForListing(roleReview.id, {
        cloudBaseUrl: "https://cloud.test",
        cloudAccessToken: "vendor-token-secret",
        fetchFn,
      }),
    ).rejects.toThrow(`云端提交失败（${status}）`);

    const current = getRolePreListingReview(roleReview.id);
    expect(current?.reviewStatus).toBe("已通过");
    expect(current?.cloudSubmitStatus).toBe("提交失败");
    expect(current?.submitError).toContain(`云端提交失败（${status}）`);
    expect(current?.submitError).not.toContain("vendor-token-secret");
    expect(calls.map((call) => call.path)).toEqual(["/vendor/dijie/role-packages"]);
  });

  it("keeps package upload ids and safe error when listing creation fails", async () => {
    writePackage(packageDir);
    const calls: CloudCall[] = [];
    const fetchFn = makeCloudFetch(calls, {
      "/vendor/dijie/role-listings": {
        status: 403,
        payload: { ok: false, error: "forbidden Bearer vendor-token-secret vendor-token-secret" },
      },
    });
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);
    const roleReview = startRolePreListingReview({ packageDir });
    await approveAndBindImageCategory(roleReview.id);
    runRolePreListingValidation(roleReview.id);
    approveRolePreListingReview(roleReview.id);

    await expect(
      submitRolePreListingForListing(roleReview.id, {
        cloudBaseUrl: "https://cloud.test",
        cloudAccessToken: "vendor-token-secret",
        fetchFn,
      }),
    ).rejects.toThrow("云端提交失败");

    const current = getRolePreListingReview(roleReview.id);
    expect(current?.reviewStatus).toBe("已通过");
    expect(current?.cloudSubmitStatus).toBe("提交失败");
    expect(current?.cloudPackageId).toBe("pkg-image-review");
    expect(current?.cloudPackageVersion).toBe("1.0.0");
    expect(current?.submitError).toContain("Bearer [redacted]");
    expect(current?.submitError).not.toContain("vendor-token-secret");
    expect(calls.map((call) => call.path)).toEqual([
      "/vendor/dijie/role-packages",
      "/vendor/dijie/role-listings",
    ]);
  });

  it("builds cloud role_package payload with required files and normalized manifest", () => {
    writePackage(packageDir, {
      "manifest.json": JSON.stringify(
        {
          rolePackageId: "pkg-image-review",
          version: "1.0.0",
          name: "图片审核岗位",
          permissions: ["filesystem.write"],
          requiredCapabilities: ["image.generation"],
          workPatterns: ["generate"],
          outputContracts: ["image"],
        },
        null,
        2,
      ),
      "SOP.md": "# SOP\n\n公开服务步骤。",
      "prompts/system.md": "private prompt text",
      "workspace/evidence.md": "private workspace evidence",
      "execution-notes.md": "private execution notes",
    });
    const review = startRolePreListingReview({ packageDir, category: "image" });

    const payload = buildCloudRolePackageUploadPayload(review);
    const byPath = new Map(payload.files.map((file) => [file.path, file]));
    const manifest = JSON.parse(byPath.get("role_package/manifest.json")?.content ?? "{}");

    expect([...byPath.keys()]).toEqual(
      expect.arrayContaining([
        "role_package/manifest.json",
        "role_package/listing.md",
        "role_package/README.md",
        "role_package/standards.md",
        "role_package/cadence.md",
        "role_package/validation.md",
        "role_package/SOP.md",
      ]),
    );
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.entrypoint).toBe("role_package/README.md");
    expect(manifest.permissions).toEqual([]);
    expect(manifest.requiredCapabilities).toEqual(["image.generation"]);
    expect(manifest.files).toEqual(
      expect.arrayContaining(["role_package/standards.md", "role_package/cadence.md"]),
    );
    expect([...byPath.keys()]).not.toEqual(
      expect.arrayContaining([
        "role_package/prompts/system.md",
        "role_package/workspace/evidence.md",
        "role_package/execution-notes.md",
      ]),
    );
    expect(byPath.get("role_package/standards.md")?.content).toContain("SOP.md");
    expect(byPath.get("role_package/standards.md")?.content).not.toContain("公开服务步骤");
    expect(byPath.get("role_package/cadence.md")?.content).not.toContain("公开服务步骤");
  });

  it("rejects packages that contain tokens", () => {
    writePackage(packageDir, { "notes.md": "token: sk-testsecret1234567890" });
    const toolReview = startToolSkillReview({
      assetType: "tool",
      assetId: "image-tool",
      declaredCapabilities: ["image.generation"],
    });
    runToolSkillValidation(toolReview.id);
    approveToolSkillReview(toolReview.id);
    const review = startRolePreListingReview({ packageDir });

    const checked = runRolePreListingValidation(review.id);

    expect(checked.riskLevel).toBe("高");
    expect(
      checked.reviewFindings.some(
        (finding) => finding.section === "风险" && finding.severity === "blocking",
      ),
    ).toBe(true);
  });
});
