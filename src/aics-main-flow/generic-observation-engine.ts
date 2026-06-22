import type { ObservationSignal } from "./types.js";

export type ObservationSourceKind =
  | "internal_read_model"
  | "gateway_api"
  | "external_web_search"
  | "external_web_fetch"
  | "external_api"
  | "file_parse"
  | "database_query"
  | "tool"
  | "skill"
  | "manual";

export type ObservationRiskLevel = "low" | "medium" | "high";
export type ObservationPriority = "high" | "medium" | "low";
export type ObservationConfidence = "high" | "medium" | "low";
export type ObservationFreshness = "fresh" | "stale" | "expired" | "unknown";

export type BusinessContext = {
  id: string;
  accountId: string;
  businessName: string;
  businessDescription: string;
  operatingModel?: string;
  productsOrServices?: string[];
  customers?: string[];
  channels?: string[];
  revenueModel?: string;
  currentConcern?: string;
  createdAt: string;
  updatedAt: string;
};

export type ObservationObject = {
  id: string;
  businessContextId: string;
  name: string;
  objectType: "business_entity" | "metric" | "process" | "risk" | "external_factor";
  description: string;
  whyObserve: string;
  relatedDataHints: string[];
  priority: ObservationPriority;
  generatedBy: "system" | "llm" | "user";
  status: "candidate" | "active" | "dismissed";
};

export type ObservationQuestion = {
  id: string;
  objectId: string;
  question: string;
  expectedEvidence: string[];
  priority: ObservationPriority;
  sourceHints: string[];
};

export type ObservationSourceCandidate = {
  id: string;
  label: string;
  sourceKind: ObservationSourceKind;
  canAccess: boolean;
  missingRequirement?: string;
  riskLevel: ObservationRiskLevel;
  observedObjects: string[];
  freshnessHours?: number;
};

export type ObservationToolStepType =
  | "internal_read_model"
  | "gateway_api"
  | "external_web_search"
  | "external_web_fetch"
  | "external_api"
  | "file_parse"
  | "database_query"
  | "tool_run"
  | "skill_run"
  | "manual_input";

export type ObservationToolStep = {
  id: string;
  toolType: ObservationToolStepType;
  toolName?: string;
  purpose: string;
  input: Record<string, unknown>;
  expectedOutput: string;
  riskLevel: ObservationRiskLevel;
  allowedSideEffects: "none";
  status: "pending" | "running" | "succeeded" | "failed" | "blocked";
};

export type ObservationToolPlan = {
  id: string;
  businessContextId: string;
  questionId: string;
  steps: ObservationToolStep[];
  requiresUserApproval: boolean;
  status: "draft" | "ready" | "blocked" | "running" | "completed" | "failed";
};

export type RawToolEvidence = {
  id: string;
  toolPlanId: string;
  toolStepId: string;
  toolType: string;
  toolName?: string;
  rawOutputRef: string;
  rawSummary?: string;
  collectedAt: string;
  success: boolean;
  error?: string;
};

export type NormalizeRawToolEvidenceInput = {
  raw: RawToolEvidence;
  businessContextId: string;
  objectId: string;
  questionId?: string;
  sourceLabel?: string;
  confidence?: ObservationConfidence;
  freshness?: ObservationFreshness;
};

export type ObservationEvidence = {
  id: string;
  businessContextId: string;
  objectId: string;
  questionId?: string;
  statement: string;
  value?: string | number | boolean;
  unit?: string;
  sourceKind: "internal" | "external" | "tool" | "skill" | "manual";
  sourceLabel: string;
  sourceRef: string;
  rawRef?: string;
  observedAt: string;
  confidence: ObservationConfidence;
  freshness: ObservationFreshness;
  qualityFlags: string[];
};

export type ObservationQualityStatus = "accepted" | "needs_review" | "rejected";

export type ObservationQualityResult = {
  evidenceId: string;
  status: ObservationQualityStatus;
  reasons: string[];
  userMessage: string;
};

export type ObservationPackageCandidate = {
  id: string;
  businessContextId: string;
  title: string;
  summary: string;
  acceptedEvidenceIds: string[];
  pendingEvidenceIds: string[];
  rejectedEvidenceIds: string[];
  missingData: Array<{
    objectId: string;
    question: string;
    reason: string;
    repairAction: string;
  }>;
  uncoveredRequiredObjectIds: string[];
  qualitySummary: {
    accepted: number;
    needsReview: number;
    rejected: number;
    stale: number;
    missing: number;
  };
  canConfirm: boolean;
};

export type ObservationCollectionReadiness = {
  sourceCount: number;
  accessibleSourceCount: number;
  blockedSourceCount: number;
  approvalRequiredCount: number;
  missingSecretCount: number;
  missingScopeCount: number;
  readyToolPlanCount: number;
  blockedToolPlanCount: number;
  canCollect: boolean;
  blockedDetails: Array<{
    sourceId: string;
    label: string;
    reason: string;
    repairAction: string;
  }>;
};

export type ObservationSummaryByLLM = {
  summary: string;
  evidenceRefs: string[];
  missingDataRefs: string[];
  warnings: string[];
};

export type ObservationWorkspaceReadModel = {
  businessContext: BusinessContext;
  objects: ObservationObject[];
  questions: ObservationQuestion[];
  sources: ObservationSourceCandidate[];
  toolPlans: ObservationToolPlan[];
  evidence: ObservationEvidence[];
  qualityResults: ObservationQualityResult[];
  candidate: ObservationPackageCandidate;
  collectionReadiness: ObservationCollectionReadiness;
  guidance: {
    status: "ready_to_collect" | "needs_sources" | "needs_review" | "ready_to_confirm";
    headline: string;
    nextAction: string;
    userMessage: string;
  };
};

export type ObservationSourceAvailabilityInput = {
  id: string;
  label: string;
  sourceKind: ObservationSourceKind;
  observedObjects: string[];
  riskLevel?: ObservationRiskLevel;
  freshnessHours?: number;
  requiredSecrets?: string[];
  requiredScopes?: string[];
  requiredUserApproval?: boolean;
};

export type ObservationToolPlanValidation = {
  ok: boolean;
  blockedReasons: string[];
  userMessage: string;
};

function normalizeTextParts(parts: Array<string | string[] | undefined>): string {
  return parts
    .flatMap((part) => (Array.isArray(part) ? part : part ? [part] : []))
    .join(" ")
    .toLowerCase();
}

function includesAny(source: string, keywords: string[]): boolean {
  return keywords.some((keyword) => source.includes(keyword.toLowerCase()));
}

function uniqueObjects(objects: ObservationObject[]): ObservationObject[] {
  const seen = new Set<string>();
  return objects.filter((object) => {
    const key = object.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generateObservationObjectsFromBusinessContext(
  context: BusinessContext,
): ObservationObject[] {
  const source = normalizeTextParts([
    context.businessName,
    context.businessDescription,
    context.operatingModel,
    context.productsOrServices,
    context.customers,
    context.channels,
    context.revenueModel,
    context.currentConcern,
  ]);
  const base = {
    businessContextId: context.id,
    generatedBy: "system" as const,
    status: "candidate" as const,
  };
  const objects: ObservationObject[] = [
    {
      ...base,
      id: `${context.id}:business-health`,
      name: "业务健康状态",
      objectType: "process",
      description: "观察当前业务是否能正常完成核心经营闭环。",
      whyObserve: "这是判断系统现在能不能用、哪里卡住的入口。",
      relatedDataHints: ["经营输入", "核心流程", "结果回写", "异常记录"],
      priority: "high",
    },
    {
      ...base,
      id: `${context.id}:customer-action`,
      name: "用户关键动作",
      objectType: "process",
      description: "观察用户从进入系统到完成关键动作的路径。",
      whyObserve: "用户卡点会直接影响转化、使用和执行闭环。",
      relatedDataHints: ["页面行为", "确认点", "失败提示", "放弃路径"],
      priority: "high",
    },
  ];

  if (includesAny(source, ["商城", "商品", "订单", "库存", "gmv", "转化", "复购", "退款"])) {
    objects.push(
      {
        ...base,
        id: `${context.id}:commerce-product`,
        name: "商品与订单",
        objectType: "business_entity",
        description: "观察商品、订单、成交、退款和库存等经营事实。",
        whyObserve: "商品和订单是商城业务最直接的经营结果来源。",
        relatedDataHints: ["商品", "订单", "GMV", "库存", "退款"],
        priority: "high",
      },
      {
        ...base,
        id: `${context.id}:commerce-conversion`,
        name: "流量与转化",
        objectType: "metric",
        description: "观察流量、点击、转化率、客单价和复购。",
        whyObserve: "转化变化能暴露获客、商品表达和购买链路问题。",
        relatedDataHints: ["访客", "点击", "转化率", "客单价", "复购率"],
        priority: "high",
      },
    );
  }

  if (
    includesAny(source, [
      "岗位",
      "能力",
      "授权",
      "skill",
      "tool",
      "api",
      "openclaw",
      "调度",
      "执行",
    ])
  ) {
    objects.push(
      {
        ...base,
        id: `${context.id}:role-supply`,
        name: "岗位供给",
        objectType: "business_entity",
        description: "观察岗位商品、能力标签、审核、授权和可调用状态。",
        whyObserve: "岗位供给决定用户能否购买并使用岗位能力。",
        relatedDataHints: ["岗位商品", "审核状态", "能力标签", "授权状态", "可调用状态"],
        priority: "high",
      },
      {
        ...base,
        id: `${context.id}:execution-chain`,
        name: "调度执行链路",
        objectType: "process",
        description: "观察规划、派发、执行、失败、审计和账本回读。",
        whyObserve: "执行链路卡住会让用户无法获得真实业务结果。",
        relatedDataHints: ["规划", "派发单", "执行队列", "执行结果", "审计", "账本"],
        priority: "high",
      },
      {
        ...base,
        id: `${context.id}:api-tool-skill`,
        name: "API、工具与 Skill 可用性",
        objectType: "process",
        description: "观察模型 Provider、API、工具、Skill 和 SecretRef 是否可用。",
        whyObserve: "连接和能力缺失会阻塞观察、调度和岗位执行。",
        relatedDataHints: ["模型 Provider", "API 管理", "工具", "Skill", "SecretRef"],
        priority: "high",
      },
    );
  }

  objects.push({
    ...base,
    id: `${context.id}:external-factor`,
    name: "外部机会与风险",
    objectType: "external_factor",
    description: "观察外部产品、工具、模型、竞品和可吸收能力变化。",
    whyObserve: "外部变化可能带来可吸收能力，也可能形成产品压力和风险。",
    relatedDataHints: ["竞品", "模型公告", "工具产品", "开源项目", "行业风险"],
    priority: "medium",
  });

  return uniqueObjects(objects);
}

export function generateObservationQuestionsForObjects(
  objects: ObservationObject[],
): ObservationQuestion[] {
  return objects
    .filter((object) => object.status !== "dismissed")
    .map((object): ObservationQuestion => {
      const sourceHints = object.relatedDataHints;
      return {
        id: `${object.id}:question-1`,
        objectId: object.id,
        question: `当前${object.name}的真实状态是什么？`,
        expectedEvidence: sourceHints.length ? sourceHints : ["可追溯事实", "来源", "更新时间"],
        priority: object.priority,
        sourceHints,
      };
    });
}

function observationGuidance(params: {
  sources: ObservationSourceCandidate[];
  toolPlans: ObservationToolPlan[];
  candidate: ObservationPackageCandidate;
  collectionReadiness: ObservationCollectionReadiness;
}): ObservationWorkspaceReadModel["guidance"] {
  if (!params.sources.some((source) => source.canAccess)) {
    return {
      status: "needs_sources",
      headline: "还没有可用观察来源",
      nextAction: "连接内部数据源、授权外部工具或补充手工输入",
      userMessage: "系统已经理解要观察什么，但还缺少可访问的数据源。",
    };
  }
  if (!params.collectionReadiness.canCollect) {
    return {
      status: "needs_sources",
      headline: "观察来源还没准备好",
      nextAction:
        params.collectionReadiness.blockedDetails[0]?.repairAction ??
        "补齐观察来源的连接、权限或授权",
      userMessage: "系统知道要观察什么，但部分真实采集来源还缺条件，不能把缺证据内容当成事实。",
    };
  }
  if (!params.toolPlans.some((plan) => plan.status === "ready")) {
    return {
      status: "ready_to_collect",
      headline: "需要生成可运行的采集计划",
      nextAction: "检查数据源并生成只读采集计划",
      userMessage: "观察对象已经生成，但还没有可执行的只读采集计划。",
    };
  }
  if (params.candidate.canConfirm) {
    return {
      status: "ready_to_confirm",
      headline: "观察包候选可以确认",
      nextAction: "复核证据后确认进入归因",
      userMessage: "已有可信证据可以形成观察包，待验证证据不会作为强证据进入归因。",
    };
  }
  return {
    status: "needs_review",
    headline: "观察证据还不足",
    nextAction: "补采缺失数据或复核待验证证据",
    userMessage: "当前没有足够可信的观察证据，不能进入正式归因。",
  };
}

function observationSourceRepairAction(missingRequirement: string): string {
  if (missingRequirement.includes("Secret")) {
    return "去 API 管理补齐连接或 SecretRef";
  }
  if (missingRequirement.includes("权限")) {
    return "去 API 管理检查账号权限和访问范围";
  }
  if (missingRequirement.includes("用户授权")) {
    return "确认只读外部采集授权后再运行观察";
  }
  return "补齐该观察来源的采集条件";
}

export function buildObservationCollectionReadiness(params: {
  sources: ObservationSourceCandidate[];
  toolPlans: ObservationToolPlan[];
}): ObservationCollectionReadiness {
  const blockedSources = params.sources.filter((source) => !source.canAccess);
  const readyToolPlanCount = params.toolPlans.filter((plan) => plan.status === "ready").length;
  const blockedToolPlanCount = params.toolPlans.filter((plan) => plan.status === "blocked").length;
  const blockedDetails = blockedSources.map((source) => {
    const reason = source.missingRequirement ?? "还没有可访问的真实采集条件";
    return {
      sourceId: source.id,
      label: source.label,
      reason,
      repairAction: observationSourceRepairAction(reason),
    };
  });

  return {
    sourceCount: params.sources.length,
    accessibleSourceCount: params.sources.length - blockedSources.length,
    blockedSourceCount: blockedSources.length,
    approvalRequiredCount: blockedSources.filter((source) =>
      String(source.missingRequirement ?? "").includes("用户授权"),
    ).length,
    missingSecretCount: blockedSources.filter((source) =>
      String(source.missingRequirement ?? "").includes("Secret"),
    ).length,
    missingScopeCount: blockedSources.filter((source) =>
      String(source.missingRequirement ?? "").includes("权限"),
    ).length,
    readyToolPlanCount,
    blockedToolPlanCount,
    canCollect: params.sources.some((source) => source.canAccess) && readyToolPlanCount > 0,
    blockedDetails,
  };
}

export function buildObservationWorkspaceReadModel(params: {
  businessContext: BusinessContext;
  availableSources?: ObservationSourceAvailabilityInput[];
  availableSecrets?: string[];
  availableScopes?: string[];
  evidence?: ObservationEvidence[];
  missingData?: ObservationPackageCandidate["missingData"];
}): ObservationWorkspaceReadModel {
  const objects = generateObservationObjectsFromBusinessContext(params.businessContext);
  const questions = generateObservationQuestionsForObjects(objects);
  const sources = discoverObservationSources({
    observationObjects: objects,
    availableSources: params.availableSources ?? [],
    availableSecrets: params.availableSecrets,
    availableScopes: params.availableScopes,
  });
  const toolPlans = questions.map((question, index) =>
    buildObservationToolPlan({
      id: `${params.businessContext.id}:tool-plan-${index + 1}`,
      businessContextId: params.businessContext.id,
      question,
      sources,
    }),
  );
  const evidence = params.evidence ?? [];
  const qualityResults = evidence.map(evaluateObservationEvidenceQuality);
  const candidate = buildObservationPackageCandidate({
    id: `${params.businessContext.id}:observation-candidate`,
    businessContextId: params.businessContext.id,
    title: `${params.businessContext.businessName}观察包候选`,
    summary: "系统根据业务上下文、可用来源和证据质量生成观察包候选。",
    evidence,
    qualityResults,
    missingData: params.missingData,
    requiredObjectIds: objects
      .filter((object) => object.priority === "high" && object.status !== "dismissed")
      .map((object) => object.id),
  });
  const collectionReadiness = buildObservationCollectionReadiness({ sources, toolPlans });

  return {
    businessContext: params.businessContext,
    objects,
    questions,
    sources,
    toolPlans,
    evidence,
    qualityResults,
    candidate,
    collectionReadiness,
    guidance: observationGuidance({ sources, toolPlans, candidate, collectionReadiness }),
  };
}

function missingRequirements(params: {
  availableSecrets: string[];
  availableScopes: string[];
  source: ObservationSourceAvailabilityInput;
}): string[] {
  const availableSecrets = new Set(params.availableSecrets);
  const availableScopes = new Set(params.availableScopes);
  return [
    ...(params.source.requiredSecrets ?? [])
      .filter((secret) => !availableSecrets.has(secret))
      .map((secret) => `缺少 Secret：${secret}`),
    ...(params.source.requiredScopes ?? [])
      .filter((scope) => !availableScopes.has(scope))
      .map((scope) => `缺少权限：${scope}`),
    ...(params.source.requiredUserApproval ? ["需要用户授权"] : []),
  ];
}

export function discoverObservationSources(params: {
  observationObjects: ObservationObject[];
  availableSources: ObservationSourceAvailabilityInput[];
  availableSecrets?: string[];
  availableScopes?: string[];
}): ObservationSourceCandidate[] {
  const activeObjectIds = new Set(
    params.observationObjects
      .filter((object) => object.status !== "dismissed")
      .map((object) => object.id),
  );
  return params.availableSources
    .map((source): ObservationSourceCandidate => {
      const observedObjects = source.observedObjects.filter((objectId) =>
        activeObjectIds.has(objectId),
      );
      const missing = missingRequirements({
        availableSecrets: params.availableSecrets ?? [],
        availableScopes: params.availableScopes ?? [],
        source,
      });
      return {
        id: source.id,
        label: source.label,
        sourceKind: source.sourceKind,
        canAccess: observedObjects.length > 0 && missing.length === 0,
        ...(missing.length ? { missingRequirement: missing.join("；") } : {}),
        riskLevel: source.riskLevel ?? "low",
        observedObjects,
        ...(source.freshnessHours ? { freshnessHours: source.freshnessHours } : {}),
      };
    })
    .filter((source) => source.observedObjects.length > 0);
}

function sourceKindToToolStepType(sourceKind: ObservationSourceKind): ObservationToolStepType {
  if (sourceKind === "tool") return "tool_run";
  if (sourceKind === "skill") return "skill_run";
  if (sourceKind === "manual") return "manual_input";
  return sourceKind;
}

export function buildObservationToolPlan(params: {
  id: string;
  businessContextId: string;
  question: ObservationQuestion;
  sources: ObservationSourceCandidate[];
}): ObservationToolPlan {
  const relevantSources = params.sources.filter(
    (source) => source.canAccess && source.observedObjects.includes(params.question.objectId),
  );
  const steps = relevantSources.map(
    (source, index): ObservationToolStep => ({
      id: `${params.id}:step-${index + 1}`,
      toolType: sourceKindToToolStepType(source.sourceKind),
      toolName: source.label,
      purpose: `采集观察问题证据：${params.question.question}`,
      input: {
        sourceId: source.id,
        objectId: params.question.objectId,
        expectedEvidence: params.question.expectedEvidence,
      },
      expectedOutput: params.question.expectedEvidence.join("、") || "可追溯观察证据",
      riskLevel: source.riskLevel,
      allowedSideEffects: "none",
      status: "pending",
    }),
  );
  return {
    id: params.id,
    businessContextId: params.businessContextId,
    questionId: params.question.id,
    steps,
    requiresUserApproval: steps.some((step) => step.riskLevel !== "low"),
    status: steps.length ? "ready" : "blocked",
  };
}

export function validateObservationToolPlan(
  plan: ObservationToolPlan,
): ObservationToolPlanValidation {
  const blockedReasons: string[] = [];
  if (!plan.steps.length) {
    blockedReasons.push("没有可用采集步骤。");
  }
  for (const step of plan.steps) {
    if (step.allowedSideEffects !== "none") {
      blockedReasons.push(`步骤 ${step.id} 不是只读采集。`);
    }
    if (!step.purpose.trim()) {
      blockedReasons.push(`步骤 ${step.id} 缺少采集目的。`);
    }
    if (!step.expectedOutput.trim()) {
      blockedReasons.push(`步骤 ${step.id} 缺少预期证据说明。`);
    }
  }
  return {
    ok: blockedReasons.length === 0,
    blockedReasons,
    userMessage: blockedReasons.length
      ? "观察采集计划还不能运行，需要先修复只读边界或补齐数据源。"
      : "观察采集计划只包含只读步骤，可以进入采集确认。",
  };
}

export function evaluateObservationEvidenceQuality(
  evidence: ObservationEvidence,
): ObservationQualityResult {
  const reasons: string[] = [];

  if (!evidence.sourceRef.trim()) {
    reasons.push("缺少可追溯来源。");
  }
  if (!evidence.statement.trim()) {
    reasons.push("缺少可读事实陈述。");
  }
  if (evidence.qualityFlags.includes("needs_evidence_ref")) {
    reasons.push("观察信号缺少证据引用。");
  }
  if (evidence.qualityFlags.includes("model_inference_without_evidence")) {
    reasons.push("模型推测缺少证据。");
  }
  if (evidence.qualityFlags.includes("tool_failed")) {
    reasons.push("工具采集失败。");
  }
  if (
    (evidence.sourceKind === "tool" || evidence.sourceKind === "skill") &&
    !String(evidence.rawRef ?? "").trim()
  ) {
    reasons.push("工具或 Skill 证据缺少原始输出引用。");
  }

  if (reasons.length) {
    return {
      evidenceId: evidence.id,
      status: "rejected",
      reasons,
      userMessage: "这条观察不能进入正式归因，需要重新采集或补充来源。",
    };
  }

  const reviewReasons: string[] = [];
  if (evidence.freshness === "stale" || evidence.freshness === "expired") {
    reviewReasons.push("证据已经过期或不够新。");
  }
  if (evidence.confidence === "low") {
    reviewReasons.push("证据可信度较低。");
  }
  if (evidence.qualityFlags.includes("conflict")) {
    reviewReasons.push("证据与其他来源存在冲突。");
  }
  if (evidence.qualityFlags.includes("missing_audit_readback")) {
    reviewReasons.push("执行审计记录还没有完整读回。");
  }
  if (evidence.qualityFlags.includes("missing_ledger_readback")) {
    reviewReasons.push("执行账本记录还没有完整读回。");
  }
  if (evidence.qualityFlags.includes("missing_model_usage_evidence")) {
    reviewReasons.push("模型费用证据还没有完整读回。");
  }
  if (evidence.qualityFlags.includes("missing_business_artifact")) {
    reviewReasons.push("业务产物还没有完整读回。");
  }
  if (evidence.sourceKind === "manual" && !evidence.qualityFlags.includes("user_confirmed")) {
    reviewReasons.push("用户手工输入尚未确认。");
  }

  if (reviewReasons.length) {
    return {
      evidenceId: evidence.id,
      status: "needs_review",
      reasons: reviewReasons,
      userMessage: "这条观察需要先复核，不能作为强证据进入归因。",
    };
  }

  return {
    evidenceId: evidence.id,
    status: "accepted",
    reasons: [],
    userMessage: "这条观察证据完整，可以进入观察包候选。",
  };
}

export function buildObservationPackageCandidate(params: {
  id: string;
  businessContextId: string;
  title: string;
  summary: string;
  evidence: ObservationEvidence[];
  qualityResults?: ObservationQualityResult[];
  missingData?: ObservationPackageCandidate["missingData"];
  requiredObjectIds?: string[];
}): ObservationPackageCandidate {
  const qualityResults =
    params.qualityResults ?? params.evidence.map(evaluateObservationEvidenceQuality);
  const statusByEvidenceId = new Map(qualityResults.map((item) => [item.evidenceId, item.status]));
  const acceptedEvidenceIds = params.evidence
    .filter((item) => statusByEvidenceId.get(item.id) === "accepted")
    .map((item) => item.id);
  const pendingEvidenceIds = params.evidence
    .filter((item) => statusByEvidenceId.get(item.id) === "needs_review")
    .map((item) => item.id);
  const rejectedEvidenceIds = params.evidence
    .filter((item) => statusByEvidenceId.get(item.id) === "rejected")
    .map((item) => item.id);
  const stale = params.evidence.filter(
    (item) => item.freshness === "stale" || item.freshness === "expired",
  ).length;
  const missingData = params.missingData ?? [];
  const acceptedObjectIds = new Set(
    params.evidence
      .filter((item) => statusByEvidenceId.get(item.id) === "accepted")
      .map((item) => item.objectId),
  );
  const missingObjectIds = new Set(missingData.map((item) => item.objectId));
  const uncoveredRequiredObjectIds = (params.requiredObjectIds ?? []).filter(
    (objectId) => !acceptedObjectIds.has(objectId) && !missingObjectIds.has(objectId),
  );
  const requiredObjectsCovered = uncoveredRequiredObjectIds.length === 0;

  return {
    id: params.id,
    businessContextId: params.businessContextId,
    title: params.title,
    summary: params.summary,
    acceptedEvidenceIds,
    pendingEvidenceIds,
    rejectedEvidenceIds,
    missingData,
    uncoveredRequiredObjectIds,
    qualitySummary: {
      accepted: acceptedEvidenceIds.length,
      needsReview: pendingEvidenceIds.length,
      rejected: rejectedEvidenceIds.length,
      stale,
      missing: missingData.length,
    },
    canConfirm: acceptedEvidenceIds.length > 0 && requiredObjectsCovered,
  };
}

function rawToolEvidenceSourceKind(toolType: string): ObservationEvidence["sourceKind"] {
  if (toolType === "skill_run" || toolType === "skill") return "skill";
  if (toolType === "tool_run" || toolType === "tool") return "tool";
  if (
    toolType === "external_web_search" ||
    toolType === "external_web_fetch" ||
    toolType === "external_api"
  ) {
    return "external";
  }
  if (toolType === "manual_input" || toolType === "manual") return "manual";
  return "internal";
}

export function normalizeRawToolEvidenceToObservationEvidence(
  input: NormalizeRawToolEvidenceInput,
): ObservationEvidence {
  const sourceKind = rawToolEvidenceSourceKind(input.raw.toolType);
  const sourceLabel =
    input.sourceLabel ??
    input.raw.toolName ??
    (sourceKind === "skill" ? "Skill 采集结果" : "工具采集结果");
  const statement = input.raw.success
    ? input.raw.rawSummary?.trim() || `${sourceLabel} 已采集到原始观察输出。`
    : `${sourceLabel} 采集失败：${input.raw.error?.trim() || "未知错误"}`;

  return {
    id: `evidence:${input.raw.id}`,
    businessContextId: input.businessContextId,
    objectId: input.objectId,
    ...(input.questionId ? { questionId: input.questionId } : {}),
    statement,
    sourceKind,
    sourceLabel,
    sourceRef: `${sourceKind}:${input.raw.toolStepId}`,
    rawRef: input.raw.rawOutputRef,
    observedAt: input.raw.collectedAt,
    confidence: input.confidence ?? (input.raw.success ? "medium" : "low"),
    freshness: input.freshness ?? "fresh",
    qualityFlags: input.raw.success ? [] : ["tool_failed"],
  };
}

export function observationEvidenceToSignal(evidence: ObservationEvidence): ObservationSignal {
  return {
    id: evidence.id,
    title: evidence.statement,
    summary: `${evidence.sourceLabel} · ${evidence.confidence} · ${evidence.freshness}`,
    evidenceRefs: [evidence.sourceRef],
  };
}
