import { describe, expect, it } from "vitest";
import {
  buildObservationPackageCandidate,
  buildObservationCollectionReadiness,
  buildObservationToolPlan,
  buildObservationWorkspaceReadModel,
  discoverObservationSources,
  evaluateObservationEvidenceQuality,
  generateObservationObjectsFromBusinessContext,
  generateObservationQuestionsForObjects,
  normalizeRawToolEvidenceToObservationEvidence,
  observationEvidenceToSignal,
  validateObservationToolPlan,
  type BusinessContext,
  type ObservationEvidence,
  type ObservationObject,
  type ObservationQuestion,
  type ObservationToolPlan,
} from "./generic-observation-engine.js";
import { runObservationToolPlan } from "./observation-tool-runner.js";

function evidence(overrides: Partial<ObservationEvidence> = {}): ObservationEvidence {
  return {
    id: "evidence-1",
    businessContextId: "business-1",
    objectId: "object-1",
    questionId: "question-1",
    statement: "系统发现授权链路已有执行队列。",
    sourceKind: "internal",
    sourceLabel: "本地 OpenClaw 主流程",
    sourceRef: "read-model:aics-main-flow",
    observedAt: "2026-06-20T00:00:00.000Z",
    confidence: "high",
    freshness: "fresh",
    qualityFlags: [],
    ...overrides,
  };
}

describe("generic observation engine", () => {
  const businessContext: BusinessContext = {
    id: "business-1",
    accountId: "account-1",
    businessName: "OpenClaw 岗位商城",
    businessDescription: "自营岗位商城，经营岗位商品、能力授权、本地 OpenClaw 使用和岗位执行。",
    productsOrServices: ["岗位商品", "能力授权"],
    customers: ["本地端用户"],
    channels: ["云端商城", "本地 OpenClaw"],
    revenueModel: "岗位授权",
    currentConcern: "用户购买岗位后，授权、API、工具和 Skill 是否能支撑调度执行。",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };

  const observationObject: ObservationObject = {
    id: "object-authorization",
    businessContextId: "business-1",
    name: "授权转化",
    objectType: "process",
    description: "用户购买岗位后能否在本地端成功使用。",
    whyObserve: "授权链路卡住会阻断岗位执行。",
    relatedDataHints: ["云端授权", "本地执行队列", "费用确认"],
    priority: "high",
    generatedBy: "system",
    status: "active",
  };

  const question: ObservationQuestion = {
    id: "question-authorization",
    objectId: "object-authorization",
    question: "用户购买岗位后是否能成功进入本地执行？",
    expectedEvidence: ["授权记录", "执行队列", "失败原因"],
    priority: "high",
    sourceHints: ["云端商城", "本地 OpenClaw"],
  };

  it("generates dynamic observation objects from OpenClaw role marketplace context", () => {
    const objects = generateObservationObjectsFromBusinessContext(businessContext);

    expect(objects.map((object) => object.name)).toEqual(
      expect.arrayContaining([
        "业务健康状态",
        "用户关键动作",
        "岗位供给",
        "调度执行链路",
        "API、工具与 Skill 可用性",
        "外部机会与风险",
      ]),
    );
    expect(objects.find((object) => object.name === "岗位供给")).toMatchObject({
      objectType: "business_entity",
      priority: "high",
      generatedBy: "system",
      status: "candidate",
    });
  });

  it("generates commerce observation objects from business context without selecting a template", () => {
    const objects = generateObservationObjectsFromBusinessContext({
      ...businessContext,
      id: "commerce-business",
      businessName: "自营生活用品商城",
      businessDescription: "客户是自营商城，重点关注商品、订单、库存、GMV、转化、退款和复购。",
      currentConcern: "最近访客不少，但订单转化和复购下降。",
    });

    expect(objects.map((object) => object.name)).toEqual(
      expect.arrayContaining(["商品与订单", "流量与转化", "外部机会与风险"]),
    );
    expect(objects.map((object) => object.name)).not.toContain("岗位供给");
  });

  it("turns observation objects into evidence collection questions", () => {
    const objects = generateObservationObjectsFromBusinessContext(businessContext);
    const questions = generateObservationQuestionsForObjects(objects);

    expect(questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          question: "当前岗位供给的真实状态是什么？",
          expectedEvidence: expect.arrayContaining(["岗位商品", "审核状态", "能力标签"]),
        }),
        expect.objectContaining({
          question: "当前外部机会与风险的真实状态是什么？",
          expectedEvidence: expect.arrayContaining(["竞品", "模型公告", "工具产品"]),
        }),
      ]),
    );
  });

  it("builds an observation workspace read model that asks users to connect sources first", () => {
    const readModel = buildObservationWorkspaceReadModel({
      businessContext,
      availableSources: [],
    });

    expect(readModel.objects.map((object) => object.name)).toContain("岗位供给");
    expect(readModel.questions.length).toBeGreaterThan(0);
    expect(readModel.sources).toEqual([]);
    expect(readModel.candidate.canConfirm).toBe(false);
    expect(readModel.collectionReadiness).toMatchObject({
      sourceCount: 0,
      accessibleSourceCount: 0,
      blockedSourceCount: 0,
      readyToolPlanCount: 0,
      canCollect: false,
    });
    expect(readModel.guidance).toMatchObject({
      status: "needs_sources",
      headline: "还没有可用观察来源",
      nextAction: "连接内部数据源、授权外部工具或补充手工输入",
    });
  });

  it("keeps the observation workspace unconfirmed until required objects are covered", () => {
    const readModel = buildObservationWorkspaceReadModel({
      businessContext,
      availableSources: [
        {
          id: "local-main-flow",
          label: "本地主流程状态",
          sourceKind: "internal_read_model",
          observedObjects: ["business-1:role-supply", "business-1:execution-chain"],
        },
      ],
      evidence: [
        evidence({
          id: "accepted-role-supply",
          objectId: "business-1:role-supply",
          statement: "系统发现岗位供给已有授权状态可读。",
          sourceLabel: "本地主流程状态",
          sourceRef: "read-model:aics-main-flow",
        }),
      ],
    });

    expect(readModel.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "local-main-flow",
          canAccess: true,
        }),
      ]),
    );
    expect(readModel.toolPlans.some((plan) => plan.status === "ready")).toBe(true);
    expect(readModel.collectionReadiness).toMatchObject({
      sourceCount: 1,
      accessibleSourceCount: 1,
      blockedSourceCount: 0,
      readyToolPlanCount: expect.any(Number),
      canCollect: true,
    });
    expect(readModel.candidate).toMatchObject({
      acceptedEvidenceIds: ["accepted-role-supply"],
      canConfirm: false,
    });
    expect(readModel.guidance).toMatchObject({
      status: "needs_review",
      headline: "观察证据还不足",
    });
  });

  it("discovers accessible sources while surfacing missing secrets, scopes, and approvals", () => {
    const sources = discoverObservationSources({
      observationObjects: [observationObject],
      availableSecrets: ["LOCAL_GATEWAY_URL"],
      availableScopes: ["aics:read"],
      availableSources: [
        {
          id: "local-main-flow",
          label: "本地主流程状态",
          sourceKind: "internal_read_model",
          observedObjects: ["object-authorization"],
          requiredSecrets: ["LOCAL_GATEWAY_URL"],
          requiredScopes: ["aics:read"],
        },
        {
          id: "cloud-marketplace",
          label: "云端商城授权",
          sourceKind: "gateway_api",
          observedObjects: ["object-authorization"],
          requiredSecrets: ["DIJIE_CLOUD_BASE_URL"],
          requiredScopes: ["cloud_marketplace:read"],
        },
        {
          id: "external-search",
          label: "外部工具生态搜索",
          sourceKind: "external_web_search",
          observedObjects: ["object-authorization"],
          requiredUserApproval: true,
        },
      ],
    });

    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "local-main-flow",
          canAccess: true,
        }),
        expect.objectContaining({
          id: "cloud-marketplace",
          canAccess: false,
          missingRequirement: "缺少 Secret：DIJIE_CLOUD_BASE_URL；缺少权限：cloud_marketplace:read",
        }),
        expect.objectContaining({
          id: "external-search",
          canAccess: false,
          missingRequirement: "需要用户授权",
        }),
      ]),
    );
  });

  it("summarizes collection readiness for non-technical users", () => {
    const sources = discoverObservationSources({
      observationObjects: [observationObject],
      availableSecrets: ["LOCAL_GATEWAY_URL"],
      availableScopes: ["aics:read"],
      availableSources: [
        {
          id: "local-main-flow",
          label: "本地主流程状态",
          sourceKind: "internal_read_model",
          observedObjects: ["object-authorization"],
          requiredSecrets: ["LOCAL_GATEWAY_URL"],
          requiredScopes: ["aics:read"],
        },
        {
          id: "cloud-marketplace",
          label: "云端商城授权",
          sourceKind: "gateway_api",
          observedObjects: ["object-authorization"],
          requiredSecrets: ["DIJIE_CLOUD_BASE_URL"],
          requiredScopes: ["cloud_marketplace:read"],
        },
        {
          id: "external-search",
          label: "外部工具生态搜索",
          sourceKind: "external_web_search",
          observedObjects: ["object-authorization"],
          requiredUserApproval: true,
        },
      ],
    });
    const toolPlans = [
      buildObservationToolPlan({
        id: "plan-authorization",
        businessContextId: "business-1",
        question,
        sources,
      }),
    ];

    expect(buildObservationCollectionReadiness({ sources, toolPlans })).toMatchObject({
      sourceCount: 3,
      accessibleSourceCount: 1,
      blockedSourceCount: 2,
      approvalRequiredCount: 1,
      missingSecretCount: 1,
      missingScopeCount: 1,
      readyToolPlanCount: 1,
      canCollect: true,
      blockedDetails: expect.arrayContaining([
        expect.objectContaining({
          label: "云端商城授权",
          repairAction: "去 API 管理补齐连接或 SecretRef",
        }),
        expect.objectContaining({
          label: "外部工具生态搜索",
          repairAction: "确认只读外部采集授权后再运行观察",
        }),
      ]),
    });
  });

  it("builds and validates read-only observation tool plans from accessible sources", () => {
    const sources = discoverObservationSources({
      observationObjects: [observationObject],
      availableSources: [
        {
          id: "local-main-flow",
          label: "本地主流程状态",
          sourceKind: "internal_read_model",
          observedObjects: ["object-authorization"],
        },
        {
          id: "tool-quality",
          label: "质量检查工具",
          sourceKind: "tool",
          observedObjects: ["object-authorization"],
          riskLevel: "medium",
        },
      ],
    });

    const plan = buildObservationToolPlan({
      id: "plan-authorization",
      businessContextId: "business-1",
      question,
      sources,
    });

    expect(plan).toMatchObject({
      status: "ready",
      requiresUserApproval: true,
      steps: [
        expect.objectContaining({
          toolType: "internal_read_model",
          allowedSideEffects: "none",
        }),
        expect.objectContaining({
          toolType: "tool_run",
          toolName: "质量检查工具",
          allowedSideEffects: "none",
        }),
      ],
    });
    expect(validateObservationToolPlan(plan)).toMatchObject({
      ok: true,
      userMessage: "观察采集计划只包含只读步骤，可以进入采集确认。",
    });
  });

  it("blocks observation tool plans that are empty or not read-only", () => {
    const emptyPlan = buildObservationToolPlan({
      id: "empty-plan",
      businessContextId: "business-1",
      question,
      sources: [],
    });
    expect(validateObservationToolPlan(emptyPlan)).toMatchObject({
      ok: false,
      blockedReasons: ["没有可用采集步骤。"],
    });

    const unsafePlan: ObservationToolPlan = {
      id: "unsafe-plan",
      businessContextId: "business-1",
      questionId: question.id,
      requiresUserApproval: false,
      status: "ready",
      steps: [
        {
          id: "unsafe-step",
          toolType: "gateway_api",
          purpose: "尝试写入业务系统",
          input: {},
          expectedOutput: "写入结果",
          riskLevel: "high",
          allowedSideEffects: "write" as never,
          status: "pending",
        },
      ],
    };
    expect(validateObservationToolPlan(unsafePlan)).toMatchObject({
      ok: false,
      blockedReasons: expect.arrayContaining(["步骤 unsafe-step 不是只读采集。"]),
    });
  });

  it("rejects evidence without traceable source or failed tool collection", () => {
    expect(
      evaluateObservationEvidenceQuality(
        evidence({
          sourceRef: "",
        }),
      ),
    ).toMatchObject({
      status: "rejected",
      userMessage: "这条观察不能进入正式归因，需要重新采集或补充来源。",
    });

    expect(
      evaluateObservationEvidenceQuality(
        evidence({
          id: "tool-failed",
          sourceKind: "tool",
          rawRef: "tool-output:quality-check-1",
          qualityFlags: ["tool_failed"],
        }),
      ),
    ).toMatchObject({
      status: "rejected",
      reasons: expect.arrayContaining(["工具采集失败。"]),
    });

    expect(
      evaluateObservationEvidenceQuality(
        evidence({
          id: "tool-without-raw-output",
          sourceKind: "tool",
          sourceRef: "tool:quality-check",
        }),
      ),
    ).toMatchObject({
      status: "rejected",
      reasons: expect.arrayContaining(["工具或 Skill 证据缺少原始输出引用。"]),
    });

    expect(
      evaluateObservationEvidenceQuality(
        evidence({
          id: "skill-without-raw-output",
          sourceKind: "skill",
          sourceRef: "skill:marketplace-observation",
        }),
      ),
    ).toMatchObject({
      status: "rejected",
      reasons: expect.arrayContaining(["工具或 Skill 证据缺少原始输出引用。"]),
    });
  });

  it("marks stale, low-confidence, conflicting, or unconfirmed manual evidence as review-only", () => {
    expect(
      evaluateObservationEvidenceQuality(
        evidence({
          freshness: "expired",
          confidence: "low",
          qualityFlags: ["conflict"],
        }),
      ),
    ).toMatchObject({
      status: "needs_review",
      userMessage: "这条观察需要先复核，不能作为强证据进入归因。",
    });

    expect(
      evaluateObservationEvidenceQuality(
        evidence({
          sourceKind: "manual",
          qualityFlags: [],
        }),
      ),
    ).toMatchObject({
      status: "needs_review",
      reasons: expect.arrayContaining(["用户手工输入尚未确认。"]),
    });

    expect(
      evaluateObservationEvidenceQuality(
        evidence({
          id: "execution-readback-incomplete",
          objectId: "business-1:execution-chain",
          sourceLabel: "岗位执行结果回读",
          sourceRef: "上一轮岗位执行结果 1",
          rawRef: "role_result_1",
          confidence: "medium",
          qualityFlags: ["missing_audit_readback", "missing_ledger_readback"],
        }),
      ),
    ).toMatchObject({
      status: "needs_review",
      reasons: expect.arrayContaining([
        "执行审计记录还没有完整读回。",
        "执行账本记录还没有完整读回。",
      ]),
    });
  });

  it("builds a confirmable package candidate from accepted evidence and covered required objects", () => {
    const accepted = evidence({ id: "accepted-1" });
    const pending = evidence({
      id: "pending-1",
      freshness: "stale",
    });
    const rejected = evidence({
      id: "rejected-1",
      sourceRef: "",
    });

    const candidate = buildObservationPackageCandidate({
      id: "candidate-1",
      businessContextId: "business-1",
      title: "经营观察包候选",
      summary: "系统采集到内部和外部观察证据。",
      evidence: [accepted, pending, rejected],
      missingData: [
        {
          objectId: "object-2",
          question: "外部工具生态是否有可吸收能力？",
          reason: "外部搜索尚未授权。",
          repairAction: "授权外部搜索工具后重新采集。",
        },
      ],
      requiredObjectIds: ["object-1", "object-2"],
    });

    expect(candidate).toMatchObject({
      acceptedEvidenceIds: ["accepted-1"],
      pendingEvidenceIds: ["pending-1"],
      rejectedEvidenceIds: ["rejected-1"],
      uncoveredRequiredObjectIds: [],
      qualitySummary: {
        accepted: 1,
        needsReview: 1,
        rejected: 1,
        stale: 1,
        missing: 1,
      },
      canConfirm: true,
    });
  });

  it("does not confirm when required observation objects lack evidence or explicit missing data", () => {
    const candidate = buildObservationPackageCandidate({
      id: "candidate-missing-required",
      businessContextId: "business-1",
      title: "经营观察包候选",
      summary: "系统只采集到一个观察对象。",
      evidence: [evidence({ id: "accepted-1", objectId: "object-1" })],
      requiredObjectIds: ["object-1", "object-2"],
    });

    expect(candidate).toMatchObject({
      acceptedEvidenceIds: ["accepted-1"],
      uncoveredRequiredObjectIds: ["object-2"],
      canConfirm: false,
    });
  });

  it("converts accepted observation evidence to the existing ObservationSignal bridge", () => {
    expect(observationEvidenceToSignal(evidence())).toEqual({
      id: "evidence-1",
      title: "系统发现授权链路已有执行队列。",
      summary: "本地 OpenClaw 主流程 · high · fresh",
      evidenceRefs: ["read-model:aics-main-flow"],
    });
  });

  it("normalizes raw tool and skill output into traceable observation evidence", () => {
    const toolEvidence = normalizeRawToolEvidenceToObservationEvidence({
      raw: {
        id: "raw-tool-1",
        toolPlanId: "plan-1",
        toolStepId: "step-quality-check",
        toolType: "tool_run",
        toolName: "质量检查工具",
        rawOutputRef: "tool-output:quality-check-1",
        rawSummary: "质量检查发现 2 个字段缺失。",
        collectedAt: "2026-06-20T01:00:00.000Z",
        success: true,
      },
      businessContextId: "business-1",
      objectId: "object-authorization",
      questionId: "question-authorization",
    });

    expect(toolEvidence).toMatchObject({
      id: "evidence:raw-tool-1",
      sourceKind: "tool",
      sourceLabel: "质量检查工具",
      sourceRef: "tool:step-quality-check",
      rawRef: "tool-output:quality-check-1",
      statement: "质量检查发现 2 个字段缺失。",
      qualityFlags: [],
    });
    expect(evaluateObservationEvidenceQuality(toolEvidence)).toMatchObject({
      status: "accepted",
    });

    const skillEvidence = normalizeRawToolEvidenceToObservationEvidence({
      raw: {
        id: "raw-skill-1",
        toolPlanId: "plan-1",
        toolStepId: "step-marketplace-skill",
        toolType: "skill_run",
        toolName: "商城观察 Skill",
        rawOutputRef: "skill-output:marketplace-1",
        rawSummary: "Skill 发现授权同步状态可读取。",
        collectedAt: "2026-06-20T01:01:00.000Z",
        success: true,
      },
      businessContextId: "business-1",
      objectId: "object-authorization",
    });

    expect(skillEvidence).toMatchObject({
      sourceKind: "skill",
      sourceRef: "skill:step-marketplace-skill",
      rawRef: "skill-output:marketplace-1",
    });
    expect(evaluateObservationEvidenceQuality(skillEvidence)).toMatchObject({
      status: "accepted",
    });

    const failedEvidence = normalizeRawToolEvidenceToObservationEvidence({
      raw: {
        id: "raw-tool-failed",
        toolPlanId: "plan-1",
        toolStepId: "step-quality-check",
        toolType: "tool_run",
        toolName: "质量检查工具",
        rawOutputRef: "tool-output:quality-check-failed",
        collectedAt: "2026-06-20T01:02:00.000Z",
        success: false,
        error: "缺少 API 连接",
      },
      businessContextId: "business-1",
      objectId: "object-authorization",
    });

    expect(failedEvidence).toMatchObject({
      confidence: "low",
      qualityFlags: ["tool_failed"],
      statement: "质量检查工具 采集失败：缺少 API 连接",
    });
    expect(evaluateObservationEvidenceQuality(failedEvidence)).toMatchObject({
      status: "rejected",
      reasons: expect.arrayContaining(["工具采集失败。"]),
    });
  });

  it("runs accessible internal observation steps into accepted evidence", async () => {
    const sources = discoverObservationSources({
      observationObjects: [observationObject],
      availableSources: [
        {
          id: "local-main-flow",
          label: "本地主流程状态",
          sourceKind: "internal_read_model",
          observedObjects: ["object-authorization"],
        },
      ],
    });
    const plan = buildObservationToolPlan({
      id: "plan-internal",
      businessContextId: "business-1",
      question,
      sources,
    });

    const result = await runObservationToolPlan({
      businessContext,
      objects: [observationObject],
      questions: [question],
      plan,
      observedAt: "2026-06-20T02:00:00.000Z",
      collectors: {
        internalReadModel: async (step) => ({
          id: "raw-internal-main-flow",
          toolPlanId: plan.id,
          toolStepId: step.id,
          toolType: step.toolType,
          ...(step.toolName ? { toolName: step.toolName } : {}),
          rawOutputRef: "read-model:aics-main-flow:snapshot-1",
          rawSummary: "本地主流程显示授权链路已有执行队列。",
          collectedAt: "2026-06-20T02:00:00.000Z",
          success: true,
        }),
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      blockedReasons: [],
      userMessage: "观察采集已完成，可信证据可以复核后进入归因。",
    });
    expect(result.evidence[0]).toMatchObject({
      sourceKind: "internal",
      sourceLabel: "本地主流程状态",
      rawRef: "read-model:aics-main-flow:snapshot-1",
      statement: "本地主流程显示授权链路已有执行队列。",
    });
    expect(result.qualityResults[0]).toMatchObject({
      status: "accepted",
    });
    expect(result.candidate).toMatchObject({
      acceptedEvidenceIds: ["evidence:raw-internal-main-flow"],
      canConfirm: true,
    });
  });

  it("does not fake external, tool, or skill collection when no real collector exists", async () => {
    const sources = discoverObservationSources({
      observationObjects: [observationObject],
      availableSources: [
        {
          id: "external-search",
          label: "外部工具生态搜索",
          sourceKind: "external_web_search",
          observedObjects: ["object-authorization"],
        },
      ],
    });
    const plan = buildObservationToolPlan({
      id: "plan-external",
      businessContextId: "business-1",
      question,
      sources,
    });

    const result = await runObservationToolPlan({
      businessContext,
      objects: [observationObject],
      questions: [question],
      plan,
      observedAt: "2026-06-20T02:10:00.000Z",
    });

    expect(result.status).toBe("blocked");
    expect(result.blockedReasons).toEqual(["外部工具生态搜索 缺少真实只读采集执行器。"]);
    expect(result.rawEvidence[0]).toMatchObject({
      success: false,
      error: "missing_observation_collector",
      rawOutputRef: "blocked:plan-external:step-1:missing-runner",
    });
    expect(result.qualityResults[0]).toMatchObject({
      status: "rejected",
      reasons: expect.arrayContaining(["工具采集失败。"]),
    });
    expect(result.candidate.canConfirm).toBe(false);
  });

  it("accepts read-only tool and skill status collectors as observation evidence", async () => {
    const sources = discoverObservationSources({
      observationObjects: [observationObject],
      availableSources: [
        {
          id: "tool-skill-status",
          label: "工具与 Skill 状态",
          sourceKind: "tool",
          observedObjects: ["object-authorization"],
        },
      ],
    });
    const plan = buildObservationToolPlan({
      id: "plan-tool-skill",
      businessContextId: "business-1",
      question,
      sources,
    });

    const result = await runObservationToolPlan({
      businessContext,
      objects: [observationObject],
      questions: [question],
      plan,
      observedAt: "2026-06-20T02:20:00.000Z",
      collectors: {
        toolRun: async (step) => ({
          id: "raw-tool-skill-status",
          toolPlanId: plan.id,
          toolStepId: step.id,
          toolType: step.toolType,
          ...(step.toolName ? { toolName: step.toolName } : {}),
          rawOutputRef: "read-model:tool-skill-status:1",
          rawSummary: "工具与 Skill 状态显示当前执行队列能力满足。",
          collectedAt: "2026-06-20T02:20:00.000Z",
          success: true,
        }),
      },
    });

    expect(result.status).toBe("completed");
    expect(result.evidence[0]).toMatchObject({
      sourceKind: "tool",
      sourceLabel: "工具与 Skill 状态",
      rawRef: "read-model:tool-skill-status:1",
    });
    expect(result.qualityResults[0]).toMatchObject({
      status: "accepted",
    });
  });
});
