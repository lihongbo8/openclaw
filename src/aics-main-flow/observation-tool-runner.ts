import {
  buildObservationPackageCandidate,
  evaluateObservationEvidenceQuality,
  normalizeRawToolEvidenceToObservationEvidence,
  validateObservationToolPlan,
  type BusinessContext,
  type ObservationEvidence,
  type ObservationObject,
  type ObservationPackageCandidate,
  type ObservationQualityResult,
  type ObservationQuestion,
  type ObservationToolPlan,
  type ObservationToolStep,
  type RawToolEvidence,
} from "./generic-observation-engine.js";

export type ObservationReadOnlyCollector = (step: ObservationToolStep) => Promise<RawToolEvidence>;

export type ObservationToolRunnerCollectors = {
  internalReadModel?: ObservationReadOnlyCollector;
  gatewayApi?: ObservationReadOnlyCollector;
  externalWebSearch?: ObservationReadOnlyCollector;
  externalWebFetch?: ObservationReadOnlyCollector;
  externalApi?: ObservationReadOnlyCollector;
  fileParse?: ObservationReadOnlyCollector;
  databaseQuery?: ObservationReadOnlyCollector;
  toolRun?: ObservationReadOnlyCollector;
  skillRun?: ObservationReadOnlyCollector;
  manualInput?: ObservationReadOnlyCollector;
};

export type RunObservationToolPlanInput = {
  businessContext: BusinessContext;
  objects: ObservationObject[];
  questions: ObservationQuestion[];
  plan: ObservationToolPlan;
  collectors?: ObservationToolRunnerCollectors;
  observedAt?: string;
};

export type ObservationToolPlanRunResult = {
  planId: string;
  status: "completed" | "blocked" | "failed";
  rawEvidence: RawToolEvidence[];
  evidence: ObservationEvidence[];
  qualityResults: ObservationQualityResult[];
  candidate: ObservationPackageCandidate;
  blockedReasons: string[];
  userMessage: string;
};

function stepCollector(
  collectors: ObservationToolRunnerCollectors,
  step: ObservationToolStep,
): ObservationReadOnlyCollector | undefined {
  switch (step.toolType) {
    case "internal_read_model":
      return collectors.internalReadModel;
    case "gateway_api":
      return collectors.gatewayApi;
    case "external_web_search":
      return collectors.externalWebSearch;
    case "external_web_fetch":
      return collectors.externalWebFetch;
    case "external_api":
      return collectors.externalApi;
    case "file_parse":
      return collectors.fileParse;
    case "database_query":
      return collectors.databaseQuery;
    case "tool_run":
      return collectors.toolRun;
    case "skill_run":
      return collectors.skillRun;
    case "manual_input":
      return collectors.manualInput;
  }
}

function objectIdForStep(step: ObservationToolStep, questions: ObservationQuestion[]): string {
  const fromInput = step.input.objectId;
  if (typeof fromInput === "string" && fromInput.trim()) {
    return fromInput;
  }
  return questions[0]?.objectId ?? "unknown-observation-object";
}

function questionIdForStep(
  step: ObservationToolStep,
  questions: ObservationQuestion[],
): string | undefined {
  const expectedObjectId = objectIdForStep(step, questions);
  return questions.find((question) => question.objectId === expectedObjectId)?.id;
}

function rawFailureForMissingCollector(params: {
  plan: ObservationToolPlan;
  step: ObservationToolStep;
  collectedAt: string;
}): RawToolEvidence {
  return {
    id: `raw:${params.step.id}:missing-runner`,
    toolPlanId: params.plan.id,
    toolStepId: params.step.id,
    toolType: params.step.toolType,
    ...(params.step.toolName ? { toolName: params.step.toolName } : {}),
    rawOutputRef: `blocked:${params.step.id}:missing-runner`,
    rawSummary: `${params.step.toolName ?? params.step.toolType} 还没有可用的真实只读采集执行器。`,
    collectedAt: params.collectedAt,
    success: false,
    error: "missing_observation_collector",
  };
}

function acceptedRequiredObjectIds(
  evidence: ObservationEvidence[],
  qualityResults: ObservationQualityResult[],
): Set<string> {
  const acceptedIds = new Set(
    qualityResults
      .filter((result) => result.status === "accepted")
      .map((result) => result.evidenceId),
  );
  return new Set(evidence.filter((item) => acceptedIds.has(item.id)).map((item) => item.objectId));
}

export async function runObservationToolPlan(
  input: RunObservationToolPlanInput,
): Promise<ObservationToolPlanRunResult> {
  const validation = validateObservationToolPlan(input.plan);
  if (!validation.ok) {
    const candidate = buildObservationPackageCandidate({
      id: `${input.plan.id}:candidate`,
      businessContextId: input.businessContext.id,
      title: `${input.businessContext.businessName}观察包候选`,
      summary: "观察采集计划还不能运行。",
      evidence: [],
      requiredObjectIds: input.objects
        .filter((object) => object.priority === "high" && object.status !== "dismissed")
        .map((object) => object.id),
    });
    return {
      planId: input.plan.id,
      status: "blocked",
      rawEvidence: [],
      evidence: [],
      qualityResults: [],
      candidate,
      blockedReasons: validation.blockedReasons,
      userMessage: validation.userMessage,
    };
  }

  const collectedAt = input.observedAt ?? new Date().toISOString();
  const rawEvidence: RawToolEvidence[] = [];
  const blockedReasons: string[] = [];
  const collectors = input.collectors ?? {};

  for (const step of input.plan.steps) {
    const collector = stepCollector(collectors, step);
    if (!collector) {
      rawEvidence.push(rawFailureForMissingCollector({ plan: input.plan, step, collectedAt }));
      blockedReasons.push(`${step.toolName ?? step.toolType} 缺少真实只读采集执行器。`);
      continue;
    }
    try {
      rawEvidence.push(await collector(step));
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知采集错误";
      rawEvidence.push({
        id: `raw:${step.id}:failed`,
        toolPlanId: input.plan.id,
        toolStepId: step.id,
        toolType: step.toolType,
        ...(step.toolName ? { toolName: step.toolName } : {}),
        rawOutputRef: `failed:${step.id}`,
        rawSummary: `${step.toolName ?? step.toolType} 采集失败。`,
        collectedAt,
        success: false,
        error: message,
      });
      blockedReasons.push(`${step.toolName ?? step.toolType} 采集失败：${message}`);
    }
  }

  const stepById = new Map(input.plan.steps.map((step) => [step.id, step]));
  const evidence = rawEvidence.flatMap((raw) => {
    const step = stepById.get(raw.toolStepId);
    if (!step) return [];
    return normalizeRawToolEvidenceToObservationEvidence({
      raw,
      businessContextId: input.businessContext.id,
      objectId: objectIdForStep(step, input.questions),
      questionId: questionIdForStep(step, input.questions),
    });
  });
  const qualityResults = evidence.map(evaluateObservationEvidenceQuality);
  const requiredObjectIds = input.objects
    .filter((object) => object.priority === "high" && object.status !== "dismissed")
    .map((object) => object.id);
  const acceptedObjects = acceptedRequiredObjectIds(evidence, qualityResults);
  const candidate = buildObservationPackageCandidate({
    id: `${input.plan.id}:candidate`,
    businessContextId: input.businessContext.id,
    title: `${input.businessContext.businessName}观察包候选`,
    summary: "系统运行只读采集计划后生成观察包候选。",
    evidence,
    qualityResults,
    missingData: requiredObjectIds
      .filter((objectId) => !acceptedObjects.has(objectId))
      .map((objectId) => {
        const object = input.objects.find((item) => item.id === objectId);
        return {
          objectId,
          question:
            input.questions.find((question) => question.objectId === objectId)?.question ??
            "该观察对象缺少可信证据。",
          reason: "没有采集到可进入归因的可信证据。",
          repairAction:
            object?.objectType === "external_factor"
              ? "授权外部搜索、网页读取或相关 Skill 后重新采集。"
              : "检查数据源连接、权限、工具或 Skill 后重新采集。",
        };
      }),
    requiredObjectIds,
  });

  const hasAccepted = qualityResults.some((result) => result.status === "accepted");
  const hasRejected = qualityResults.some((result) => result.status === "rejected");
  const status: ObservationToolPlanRunResult["status"] =
    blockedReasons.length > 0 ? "blocked" : hasRejected && !hasAccepted ? "failed" : "completed";

  return {
    planId: input.plan.id,
    status,
    rawEvidence,
    evidence,
    qualityResults,
    candidate,
    blockedReasons,
    userMessage: candidate.canConfirm
      ? "观察采集已完成，可信证据可以复核后进入归因。"
      : "观察采集已运行，但关键证据还不足，需要补采或修复来源。",
  };
}
