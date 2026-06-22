#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

(globalThis as typeof globalThis & { require?: NodeRequire }).require ??= createRequire(
  import.meta.url,
);

type DbModule = typeof import("../src/aics-main-flow/db.js");
type ReviewModule = typeof import("../src/aics-main-flow/role-pre-listing-review.js");
type StoreModule = typeof import("../src/aics-main-flow/store.js");
type LocalMarketplaceModule = typeof import("../src/aics-main-flow/local-role-marketplace.js");
type PathsModule = typeof import("../src/config/paths.js");
type ToolRegistryModule = typeof import("../src/aics-main-flow/tool-registry.js");

let dbModule: DbModule;
let reviewModule: ReviewModule;
let storeModule: StoreModule;
let localMarketplaceModule: LocalMarketplaceModule;
let pathsModule: PathsModule;
let toolRegistryModule: ToolRegistryModule;

async function loadOpenClawModules(): Promise<void> {
  [dbModule, reviewModule, storeModule, localMarketplaceModule, pathsModule, toolRegistryModule] =
    await Promise.all([
      import("../src/aics-main-flow/db.js"),
      import("../src/aics-main-flow/role-pre-listing-review.js"),
      import("../src/aics-main-flow/store.js"),
      import("../src/aics-main-flow/local-role-marketplace.js"),
      import("../src/config/paths.js"),
      import("../src/aics-main-flow/tool-registry.js"),
    ]);
}

const DEMO = {
  developerId: "local-admin",
  listingDraftId: "demo-marketplace-ops-local",
  rolePackageId: "pkg-marketplace-ops-local",
  roleTitle: "商城运营诊断官",
  categoryName: "商城运营",
  categoryRef: "category:marketplace-ops-local@1",
  categoryRequestId: "category-capability:marketplace-ops-local",
  requiredCapabilities: ["marketplace.read", "audit.record"],
  toolSkillRequirements: [
    "tool.platform.marketplace_read_model",
    "tool.platform.audit_record",
    "skill.platform.marketplace_ops_diagnosis",
  ],
} as const;

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function writeRolePackage(packageDir: string): Promise<void> {
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, "manifest.json"),
    JSON.stringify(
      {
        rolePackageId: DEMO.rolePackageId,
        version: "1.0.0",
        name: DEMO.roleTitle,
        categoryRef: DEMO.categoryRef,
        requiredCapabilities: DEMO.requiredCapabilities,
        workPatterns: ["generate", "analyze", "composite"],
        outputContracts: ["image", "html", "json", "package"],
        businessCategory: DEMO.categoryName,
        businessContext: {
          qualityStandards: ["必须生成业务产物", "必须读回审计和账本", "必须给出下一步动作"],
          metricRules: ["岗位供给", "授权转化", "执行成功率", "费用与审计状态"],
          forbiddenActions: ["不自动发布付费岗位", "不绕过授权、费用确认、审计和账本"],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(packageDir, "listing.md"),
    [
      "# 商城运营诊断官",
      "",
      "面向岗位商城运营方，诊断岗位供给、授权转化、执行成功率、费用与审计回写。",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(packageDir, "README.md"),
    [
      "# 商城运营诊断官",
      "",
      "## 输入",
      "- 岗位商品、授权、执行、费用与审计读模型",
      "",
      "## 输出",
      "- 运营诊断",
      "- 阻塞归因",
      "- 下一步调度建议",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(packageDir, "validation.md"),
    [
      "# 本地上架检查",
      "- [x] 岗位包结构完整",
      "- [x] 首个正式岗位价格为 0 元",
      "- [x] 执行前要求授权、费用确认、审计和账本回写",
    ].join("\n"),
    "utf8",
  );
}

function resetDemoRows(): void {
  const { createPipelineTables, getPipelineDb } = dbModule;
  const db = getPipelineDb();
  createPipelineTables(db);
  const roleRows = db
    .prepare("SELECT id FROM role_pre_listing_reviews WHERE role_package_id = ?")
    .all(DEMO.rolePackageId) as Array<{ id: string }>;
  const categoryRows = db
    .prepare(
      "SELECT id FROM category_capability_reviews WHERE request_id = ? OR role_package_id = ?",
    )
    .all(DEMO.categoryRequestId, DEMO.rolePackageId) as Array<{ id: string }>;
  const listingRows = db
    .prepare("SELECT role_listing_id FROM local_role_listings WHERE role_package_id = ?")
    .all(DEMO.rolePackageId) as Array<{ role_listing_id: string }>;

  db.prepare(
    "DELETE FROM role_results WHERE dispatch_to_role_request_id IN (SELECT id FROM dispatch_to_role_requests WHERE role_title = '岗位详情页转化优化')",
  ).run();
  db.prepare("DELETE FROM dispatch_to_role_requests WHERE role_title = '岗位详情页转化优化'").run();
  db.prepare(
    "DELETE FROM role_results WHERE dispatch_to_role_request_id IN (SELECT id FROM dispatch_to_role_requests WHERE task_package_id IN (SELECT id FROM task_packages WHERE title = '任务：岗位详情页优化'))",
  ).run();
  db.prepare(
    "DELETE FROM dispatch_to_role_requests WHERE task_package_id IN (SELECT id FROM task_packages WHERE title = '任务：岗位详情页优化')",
  ).run();
  db.prepare(
    "DELETE FROM role_results WHERE task_package_id IN (SELECT id FROM task_packages WHERE title = '任务：岗位详情页优化')",
  ).run();
  db.prepare("DELETE FROM task_packages WHERE title = '任务：岗位详情页优化'").run();

  db.prepare(
    "DELETE FROM role_results WHERE dispatch_to_role_request_id IN (SELECT id FROM dispatch_to_role_requests WHERE role_plan_item_id IN (SELECT id FROM role_plan_items WHERE role_capability_ref = 'marketplace-ops-local'))",
  ).run();
  db.prepare(
    "DELETE FROM dispatch_to_role_requests WHERE role_plan_item_id IN (SELECT id FROM role_plan_items WHERE role_capability_ref = 'marketplace-ops-local')",
  ).run();
  db.prepare(
    "DELETE FROM task_packages WHERE role_plan_item_id IN (SELECT id FROM role_plan_items WHERE role_capability_ref = 'marketplace-ops-local')",
  ).run();
  db.prepare(
    "DELETE FROM dispatch_proposal_reviews WHERE role_plan_item_id IN (SELECT id FROM role_plan_items WHERE role_capability_ref = 'marketplace-ops-local')",
  ).run();
  db.prepare(
    "DELETE FROM role_plan_items WHERE role_capability_ref = 'marketplace-ops-local'",
  ).run();
  db.prepare("DELETE FROM planning_packages WHERE title = '商城运营本地执行规划'").run();
  db.prepare(
    "DELETE FROM work_block_task_candidates WHERE work_block_id IN (SELECT id FROM work_blocks WHERE goal_id IN (SELECT id FROM goals WHERE title = '跑通商城运营岗位本地闭环'))",
  ).run();
  db.prepare(
    "DELETE FROM work_block_roles WHERE work_block_id IN (SELECT id FROM work_blocks WHERE goal_id IN (SELECT id FROM goals WHERE title = '跑通商城运营岗位本地闭环'))",
  ).run();
  db.prepare(
    "DELETE FROM work_blocks WHERE goal_id IN (SELECT id FROM goals WHERE title = '跑通商城运营岗位本地闭环')",
  ).run();
  db.prepare("DELETE FROM goals WHERE title = '跑通商城运营岗位本地闭环'").run();
  db.prepare("DELETE FROM attribution_findings WHERE id = 'finding-marketplace-ops-local'").run();
  db.prepare("DELETE FROM attributions WHERE title = '商城运营归因'").run();
  db.prepare("DELETE FROM observation_signals WHERE id = 'signal-marketplace-ops-local'").run();
  db.prepare("DELETE FROM observations WHERE title = '商城运营观察'").run();

  for (const row of listingRows) {
    const dispatchRows = db
      .prepare("SELECT id FROM dispatch_to_role_requests WHERE role_listing_id = ?")
      .all(row.role_listing_id) as Array<{ id: string }>;
    for (const dispatch of dispatchRows) {
      db.prepare(
        "DELETE FROM local_role_execution_audits WHERE execution_id IN (SELECT id FROM role_results WHERE dispatch_to_role_request_id = ?)",
      ).run(dispatch.id);
      db.prepare(
        "DELETE FROM local_role_ledger_entries WHERE execution_id IN (SELECT id FROM role_results WHERE dispatch_to_role_request_id = ?)",
      ).run(dispatch.id);
      db.prepare("DELETE FROM role_results WHERE dispatch_to_role_request_id = ?").run(dispatch.id);
      db.prepare("DELETE FROM dispatch_to_role_requests WHERE id = ?").run(dispatch.id);
    }
    db.prepare("DELETE FROM local_role_execution_audits WHERE role_listing_id = ?").run(
      row.role_listing_id,
    );
    db.prepare("DELETE FROM local_role_ledger_entries WHERE role_listing_id = ?").run(
      row.role_listing_id,
    );
    db.prepare("DELETE FROM local_role_entitlements WHERE role_listing_id = ?").run(
      row.role_listing_id,
    );
    db.prepare("DELETE FROM local_role_listings WHERE role_listing_id = ?").run(
      row.role_listing_id,
    );
  }
  for (const row of roleRows) {
    db.prepare("DELETE FROM role_pre_listing_review_events WHERE review_id = ?").run(row.id);
    db.prepare("DELETE FROM role_pre_listing_reviews WHERE id = ?").run(row.id);
  }
  for (const row of categoryRows) {
    db.prepare("DELETE FROM category_capability_review_events WHERE review_id = ?").run(row.id);
    db.prepare("DELETE FROM category_capability_reviews WHERE id = ?").run(row.id);
  }
  for (const assetId of DEMO.toolSkillRequirements) {
    const rows = db
      .prepare("SELECT id FROM tool_skill_reviews WHERE asset_id = ?")
      .all(assetId) as Array<{ id: string }>;
    for (const row of rows) {
      db.prepare("DELETE FROM tool_skill_review_events WHERE review_id = ?").run(row.id);
      db.prepare("DELETE FROM tool_skill_reviews WHERE id = ?").run(row.id);
    }
  }
}

function ensureExecutableTask(params: { roleListingId: string; entitlementId: string }): {
  taskPackageId: string;
  dispatchToRoleRequestId: string;
  created: boolean;
} {
  const {
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
  } = storeModule;
  const store = new AicsMainFlowStore();
  const existing = store
    .readModel()
    .objects.dispatchToRoleRequests.find(
      (request) => request.roleListingId === params.roleListingId,
    );
  if (existing) {
    return {
      taskPackageId: existing.taskPackageId,
      dispatchToRoleRequestId: existing.id,
      created: false,
    };
  }

  const obs = store.update((state) =>
    prepareObservation(state, {
      title: "商城运营观察",
      summary: "需要诊断岗位供给、授权转化、执行成功率、费用和审计。",
      signals: [
        {
          id: "signal-marketplace-ops-local",
          title: "本地闭环信号",
          summary: "本地岗位商城闭环需要可授权、可执行、可回写。",
          evidenceRefs: [],
        },
      ],
    }),
  );
  store.update((state) => confirmObservation(state, obs.id));
  const attr = store.update((state) =>
    prepareAttribution(state, {
      observationPackageId: obs.id,
      title: "商城运营归因",
      summary: "岗位商品说明、授权确认和执行回写是首轮主要断点。",
      findings: [
        {
          id: "finding-marketplace-ops-local",
          title: "本地闭环需要真实授权事实",
          summary: "岗位必须经过审核、上架、0 元授权后才能执行。",
          confidence: "high",
          observationSignalIds: ["signal-marketplace-ops-local"],
        },
      ],
    }),
  );
  store.update((state) => confirmAttribution(state, attr.id));
  const goal = store.update((state) =>
    createGoalCandidate(state, {
      attributionReportId: attr.id,
      observationPackageId: obs.id,
      title: "跑通商城运营岗位本地闭环",
      owner: "OpenClaw",
      metric: "本地岗位授权和执行成功率",
      target: "本地 0 元岗位可授权、可执行、可回写审计账本",
      rationale: "小白真人使用前必须证明主链路真实可用。",
    }),
  );
  store.update((state) => confirmGoal(state, goal.id));
  const plan = store.update((state) =>
    preparePlanning(state, {
      goalId: goal.id,
      title: "商城运营本地执行规划",
      summary: "调度商城运营诊断官输出运营诊断和行动建议。",
      rolePlanItems: [
        {
          title: "商城运营诊断",
          category: DEMO.categoryName,
          roleCapabilityRef: "marketplace-ops-local",
          taskIntent: "分析岗位商品、授权、执行、费用和审计状态。",
          expectedOutput: "商城运营诊断结果、行动建议和验收摘要。",
          humanConfirmationRequired: true,
        },
      ],
    }),
  );
  store.update((state) => confirmPlanning(state, plan.id));
  const proposal = store.update((state) =>
    createDispatchProposal(state, {
      planningPackageId: plan.id,
      title: "调度商城运营诊断官",
      riskSummary: "低风险，本地读取聚合状态并生成建议。",
      confirmationSummary: "确认岗位已授权、费用已确认后执行。",
    }),
  );
  store.update((state) => confirmDispatch(state, proposal.id));
  const materialized = store.update((state) =>
    materializeTaskPackage(state, {
      title: "任务：商城运营诊断",
      taskText: "输出本地岗位商城运营诊断，覆盖岗位商品、授权、执行、费用和审计。",
      capabilityResolution: {
        categoryCapabilityId: DEMO.categoryRef,
        category: DEMO.categoryName,
        allowedTools: ["tool.platform.marketplace_read_model", "tool.platform.audit_record"],
        allowedSkills: ["skill.platform.marketplace_ops_diagnosis"],
        dispatchReady: true,
        blockedReasons: [],
      },
      request: {
        roleListingId: params.roleListingId,
        roleTitle: DEMO.roleTitle,
      },
    }),
  );
  store.update((state) =>
    confirmRoleExecution(state, {
      dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
      roleListingId: params.roleListingId,
      roleTitle: DEMO.roleTitle,
      entitlementId: params.entitlementId,
    }),
  );
  store.update((state) =>
    confirmRoleExecutionCost(state, {
      dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
      entitlementId: params.entitlementId,
      ledgerRef: `ledger:pending:${params.entitlementId}`,
    }),
  );
  return {
    taskPackageId: materialized.taskPackage.id,
    dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
    created: true,
  };
}

function registerDemoCapabilityTool(toolId: string, capabilities: string[]): void {
  const { ToolRegistry } = toolRegistryModule;
  ToolRegistry.register({
    toolId,
    name: toolId,
    label: toolId,
    description: "本地商城运营 demo 能力工具。",
    capabilities:
      capabilities as unknown as import("../src/aics-main-flow/tool-registry.js").ToolCapabilityGroup[],
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
  });
}

function registerDemoToolEvidence(): void {
  registerDemoCapabilityTool("tool.platform.marketplace_read_model", ["marketplace.read"]);
  registerDemoCapabilityTool("tool.platform.audit_record", ["audit.record"]);
}

function demoToolSkillValidationEvidence() {
  const emptyRequirements = { bins: [], anyBins: [], env: [], config: [], os: [] };
  return {
    skillsReport: {
      workspaceDir: "/tmp/openclaw-aics-demo-workspace",
      managedSkillsDir: "/tmp/openclaw-aics-demo-skills",
      skills: [
        {
          name: "Marketplace Ops Diagnosis",
          description: "商城运营诊断 Skill",
          source: "openclaw-managed",
          bundled: false,
          filePath: "/tmp/openclaw-aics-demo-skills/marketplace-ops/SKILL.md",
          baseDir: "/tmp/openclaw-aics-demo-skills/marketplace-ops",
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
  };
}

async function main(): Promise<void> {
  await loadOpenClawModules();
  const {
    approveCategoryCapabilityReview,
    approveRolePreListingReview,
    approveToolSkillReview,
    bindRolePreListingReviewCategory,
    createCategoryCapabilityRequest,
    runRolePreListingValidation,
    runToolSkillValidation,
    startRolePreListingReview,
    startToolSkillReview,
    submitRolePreListingForListing,
    syncCategoryCapabilityReviewToCloud,
  } = reviewModule;
  const { createZeroPriceLocalRoleEntitlement } = localMarketplaceModule;
  const { resolveStateDir } = pathsModule;
  const resetDemo = hasFlag("--reset-demo");
  if (resetDemo) resetDemoRows();

  const stateDir = resolveStateDir();
  const packageDir = path.join(stateDir, "aics-demo", DEMO.rolePackageId);
  await writeRolePackage(packageDir);

  const roleReview = startRolePreListingReview({
    packageDir,
    rolePackageId: DEMO.rolePackageId,
    listingDraftId: DEMO.listingDraftId,
    developerId: DEMO.developerId,
    requiredCapabilities: [...DEMO.requiredCapabilities],
  });

  const categoryReview = createCategoryCapabilityRequest({
    requestId: DEMO.categoryRequestId,
    title: "商城运营品类能力",
    categoryName: DEMO.categoryName,
    categoryRef: DEMO.categoryRef,
    rolePackageId: DEMO.rolePackageId,
    listingDraftId: DEMO.listingDraftId,
    developerId: DEMO.developerId,
    roleDescription: "面向岗位商城运营方的运营诊断能力包。",
    targetUser: "岗位商城运营管理员",
    requiredCapabilities: [...DEMO.requiredCapabilities],
    inputOutput: "输入岗位商城读模型；输出运营诊断、行动建议、审计和账本检查项。",
    toolSkillRequirements: [...DEMO.toolSkillRequirements],
    riskBoundaries: ["不自动发布付费岗位。", "不绕过授权、费用确认、审计和账本。"],
    reason: "商城运营诊断官需要正式品类能力包。",
  });

  for (const assetId of DEMO.toolSkillRequirements) {
    const review = startToolSkillReview({
      assetType: assetId.startsWith("skill.") ? "skill" : "tool",
      assetId,
      declaredCapabilities: [...DEMO.requiredCapabilities],
    });
    registerDemoToolEvidence();
    runToolSkillValidation(review.id, demoToolSkillValidationEvidence());
    approveToolSkillReview(review.id);
  }

  approveCategoryCapabilityReview(categoryReview.id);
  const localCategory = await syncCategoryCapabilityReviewToCloud(categoryReview.id);
  const binding = bindRolePreListingReviewCategory(roleReview.id, categoryReview.id);
  const checked = runRolePreListingValidation(binding.review.id);
  approveRolePreListingReview(checked.id);

  const listingResult = await submitRolePreListingForListing(checked.id);
  const roleListingId = listingResult.cloud.roleListingId;
  const entitlement = createZeroPriceLocalRoleEntitlement({ roleListingId });
  const task = ensureExecutableTask({
    roleListingId,
    entitlementId: entitlement.entitlementId,
  });

  const summary = {
    ok: true,
    resetDemo,
    mode: "local",
    stateDir,
    packageDir,
    roleReviewId: checked.id,
    categoryCapabilityReviewId: categoryReview.id,
    categoryRef: localCategory.review.categoryRef,
    categoryCapabilityId: localCategory.review.categoryRef,
    roleListingId,
    entitlementId: entitlement.entitlementId,
    taskPackageId: task.taskPackageId,
    dispatchToRoleRequestId: task.dispatchToRoleRequestId,
    taskCreated: task.created,
    nextPages: ["/api-management", "/review-center", "/usage", "/aics"],
    nextAction:
      "打开本地端页面后，先到 API 管理填写岗位执行模型 Key；再到岗位执行页运行任务，成功后必须能读回业务产物、审计和账本。",
  };
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    dbModule?.closePipelineDb();
    dbModule?.closeRoleInstancesDb();
    dbModule?.closeMemoryDb();
  });
