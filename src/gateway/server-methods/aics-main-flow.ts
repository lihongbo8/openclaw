import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { canExecRequestNode } from "../../agents/exec-defaults.js";
import {
  collectObservations,
  createExternalInfoAdapter,
  createGatewayAdapter,
  createLocalReadModelAdapter,
  createMarketplaceAdapter,
  observationEvidenceToSignal,
  runObservationToolPlan,
  toObservationPackageInput,
  type ExternalInfoSource,
  type ObservationAdapter,
} from "../../aics-main-flow/adapters/index.js";
import {
  compareObservationsToGoal,
  toAttributionInput as comparatorToAttributionInput,
  type RankedCause,
} from "../../aics-main-flow/attribution-comparator.js";
import {
  createCloudMarketplaceProjection,
  validateActorContext,
} from "../../aics-main-flow/cloud-marketplace-projection.js";
import {
  getLocalRoleExecutionAuditByExecutionId,
  getLocalRoleLedgerEntryByExecutionId,
  listLocalMarketplaceRoles,
} from "../../aics-main-flow/local-role-marketplace.js";
import { createObservationAdapterCollector } from "../../aics-main-flow/observation-adapter-collector.js";
import {
  generateGoalCandidate,
  generatePlanningPackage,
  generateDispatchProposal,
  materializeTaskPackage as materializeFromDispatch,
} from "../../aics-main-flow/pipeline-generators.js";
import {
  listCategoryCapabilityReviews,
  listRolePreListingReviews,
  type CategoryCapabilityReview,
  type RolePreListingReview,
} from "../../aics-main-flow/role-pre-listing-review.js";
import {
  AicsMainFlowStore,
  cancelRolePlanItem,
  confirmDispatch,
  confirmGoal,
  confirmObservation,
  confirmPlanning,
  confirmAttribution,
  createAicsMainFlowReadModel,
  createEmptyAicsMainFlowState,
  confirmRoleExecution,
  confirmRoleExecutionCost,
  createDispatchProposal,
  createGoalCandidate,
  createInteraction,
  createWorkBlocks,
  materializeTaskPackage,
  markObservationDataMissing,
  prepareAttribution,
  prepareObservation,
  recordObservationEvidenceRun,
  preparePlanning,
  regeneratePlanning,
  rejectAttribution,
  rejectObservation,
  requestAttributionMoreData,
  runApprovedTask,
  updateRolePlanItem,
  type CancelRolePlanItemInput,
  type CreateDispatchProposalInput,
  type CreateGoalCandidateInput,
  type CreateInteractionInput,
  type MaterializeTaskPackageInput,
  type PrepareAttributionInput,
  type PrepareObservationInput,
  type PreparePlanningInput,
  type RunApprovedTaskInput,
  type UpdateRolePlanItemInput,
} from "../../aics-main-flow/store.js";
import { AicsMainFlowGateError } from "../../aics-main-flow/types.js";
import type { AicsMainFlowReadModel, AicsMainFlowStage } from "../../aics-main-flow/types.js";
import { createApiConnectionsReadModel } from "../../api-connections/model.js";
import {
  resolveApiModelRuntimeForConsumer,
  toOpenAICompatibleChatCompletionsUrl,
} from "../../api-connections/runtime.js";
import type { ApiConnectionEntry } from "../../config/types.api-connections.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { SecretInput } from "../../config/types.secrets.js";
import { buildWorkspaceSkillStatus } from "../../skills/discovery/status.js";
import { getRemoteSkillEligibility } from "../../skills/runtime/remote.js";
import {
  createToolSupplyControlReadModel,
  findToolSupplyResolutionForRolePlanItem,
} from "../../tool-supply-control/model.js";
import { resolveAicsCloudConnectionFromApiConnections } from "./aics-api-connections.js";
import { recordModelUsageToApiMetering } from "./aics-api-metering.js";
import { aicsExecutionHandlers } from "./aics-execution.js";
import { buildToolsCatalogResult } from "./tools-catalog.js";
import type {
  GatewayRequestContext,
  GatewayRequestHandlerOptions,
  GatewayRequestHandlers,
  RespondFn,
} from "./types.js";

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === "boolean" ? value : undefined;
}

function isSuccessfulRoleOutcome(outcome: unknown): boolean {
  return outcome === "succeeded" || outcome === "completed";
}

function objectParam(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = params[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayParam(params: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = params[key];
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      )
    : [];
}

function stringArrayParam(params: Record<string, unknown>, key: string): string[] | undefined {
  const value = params[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return items.length > 0 ? items.map((item) => item.trim()) : undefined;
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = stringParam(params, key);
  if (!value) {
    throw new Error(`missing required string param: ${key}`);
  }
  return value;
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function modelUsageFromOpenAICompatibleBody(body: Record<string, unknown>) {
  const usage = readRecord(body.usage);
  const inputTokens = finiteNumber(usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens);
  const outputTokens = finiteNumber(
    usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens,
  );
  const totalTokens =
    finiteNumber(usage.total_tokens ?? usage.totalTokens) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

async function runOperationsBackendModel(params: {
  context: GatewayRequestContext;
  prompt: string;
  systemPrompt?: string;
  executionId?: string;
}) {
  const modelRuntime = await resolveApiModelRuntimeForConsumer(params.context.getRuntimeConfig(), {
    consumer: "operations_backend",
  });
  if (!modelRuntime) {
    throw new Error(
      "API 管理未给经营后台绑定可用模型 Provider。请在 API 管理里选择模型供应商，并勾选经营后台。",
    );
  }
  const response = await fetch(toOpenAICompatibleChatCompletionsUrl(modelRuntime.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${modelRuntime.apiKey}`,
    },
    body: JSON.stringify({
      model: modelRuntime.model,
      messages: [
        {
          role: "system",
          content:
            params.systemPrompt ??
            "你是迭界AI岗位商城经营后台助手，只输出和岗位商城运营、分析、规划相关的简洁建议。",
        },
        { role: "user", content: params.prompt },
      ],
      temperature: 0.2,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      `经营后台模型调用失败：${response.status} ${String(body.error ?? response.statusText)}`,
    );
  }
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const first = readRecord(choices[0]);
  const message = readRecord(first.message);
  const content = String(message.content ?? first.text ?? "").trim();
  const modelUsage = {
    provider: modelRuntime.provider,
    model: modelRuntime.model,
    ...modelUsageFromOpenAICompatibleBody(body),
  };
  const executionId =
    params.executionId ??
    `operations_backend:${modelRuntime.provider}:${modelRuntime.model}:${Date.now()}`;
  const apiMetering = await recordModelUsageToApiMetering({
    context: params.context,
    consumer: "operations_backend",
    executionId,
    modelUsage,
  });
  return {
    content,
    executionId,
    selectedModelRef: {
      entryId: modelRuntime.entryId,
      provider: modelRuntime.provider,
      model: modelRuntime.model,
      modelRef: modelRuntime.modelRef,
    },
    modelUsage,
    apiMetering,
  };
}

function toInteractionInput(params: Record<string, unknown>): CreateInteractionInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    stage: (stringParam(params, "stage") ?? "observation") as AicsMainFlowStage,
    message: requireString(params, "message"),
    ...(stringParam(params, "proposedNextAction")
      ? { proposedNextAction: stringParam(params, "proposedNextAction") }
      : {}),
  };
}

function toObservationInput(params: Record<string, unknown>): PrepareObservationInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    title: requireString(params, "title"),
    summary: requireString(params, "summary"),
    signals: arrayParam(params, "signals").map((signal, index) => ({
      id: stringParam(signal, "id") ?? `signal_${index + 1}`,
      title: stringParam(signal, "title") ?? "未命名观察信号",
      summary: stringParam(signal, "summary") ?? "",
      evidenceRefs: Array.isArray(signal.evidenceRefs)
        ? signal.evidenceRefs.filter((item): item is string => typeof item === "string")
        : [],
    })),
  };
}

function toAttributionInput(params: Record<string, unknown>): PrepareAttributionInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "observationPackageId")
      ? { observationPackageId: stringParam(params, "observationPackageId") }
      : {}),
    title: requireString(params, "title"),
    summary: requireString(params, "summary"),
    findings: arrayParam(params, "findings").map((finding, index) => ({
      id: stringParam(finding, "id") ?? `finding_${index + 1}`,
      title: stringParam(finding, "title") ?? "未命名归因发现",
      summary: stringParam(finding, "summary") ?? "",
      confidence:
        stringParam(finding, "confidence") === "low" ||
        stringParam(finding, "confidence") === "high"
          ? (stringParam(finding, "confidence") as "low" | "high")
          : "medium",
      observationSignalIds: Array.isArray(finding.observationSignalIds)
        ? finding.observationSignalIds.filter((item): item is string => typeof item === "string")
        : [],
    })),
  };
}

function toExternalInfoSources(params: Record<string, unknown>): ExternalInfoSource[] {
  return arrayParam(params, "externalSources").flatMap((source, index) => {
    const url = stringParam(source, "url");
    if (!url) return [];
    const kind = stringParam(source, "kind");
    return [
      {
        id: stringParam(source, "id") ?? `external_${index + 1}`,
        label: stringParam(source, "label") ?? url,
        url,
        kind:
          kind === "technology_tool_model" ||
          kind === "risk_policy" ||
          kind === "capability_library"
            ? kind
            : "product_competitor",
      },
    ];
  });
}

function buildObservationAdapters(
  params: Record<string, unknown>,
  config?: OpenClawConfig,
): ObservationAdapter[] {
  const adapters: ObservationAdapter[] = [];
  const seen = new Set<string>();
  if (params.includeLocalReadModel !== false) {
    pushUniqueAdapter(
      adapters,
      seen,
      "local:aics-main-flow-read-model",
      createLocalReadModelAdapter({
        readModel: () => new AicsMainFlowStore().readModel(),
      }),
    );
  }
  const marketplaceBaseUrl = stringParam(params, "marketplaceBaseUrl");
  if (marketplaceBaseUrl) {
    pushUniqueAdapter(
      adapters,
      seen,
      `marketplace:${marketplaceBaseUrl}`,
      createMarketplaceAdapter({
        baseUrl: marketplaceBaseUrl,
        accessToken: stringParam(params, "marketplaceAccessToken"),
      }),
    );
  }

  const gatewayBaseUrl = stringParam(params, "gatewayBaseUrl");
  if (gatewayBaseUrl) {
    pushUniqueAdapter(
      adapters,
      seen,
      `gateway:${gatewayBaseUrl}`,
      createGatewayAdapter({
        baseUrl: gatewayBaseUrl,
        accessToken: stringParam(params, "gatewayAccessToken"),
      }),
    );
  }

  const externalSources = toExternalInfoSources(params);
  if (externalSources.length > 0) {
    pushUniqueAdapter(
      adapters,
      seen,
      `external:${externalSources.map((source) => source.url).join("|")}`,
      createExternalInfoAdapter({ sources: externalSources }),
    );
  }

  if (config && params.includeSavedConnections !== false) {
    for (const entry of Object.values(config.apiConnections?.entries ?? {})) {
      if (entry.enabled === false) continue;
      const baseUrl = entry.baseUrl || entry.endpoint;
      if (!baseUrl) continue;
      const accessToken = resolveConnectionSecret(entry.secret);
      if (isMarketplaceObservationEntry(entry)) {
        pushUniqueAdapter(
          adapters,
          seen,
          `marketplace:${baseUrl}`,
          createMarketplaceAdapter({
            baseUrl,
            accessToken,
          }),
        );
      }
      if (isGatewayObservationEntry(entry)) {
        pushUniqueAdapter(
          adapters,
          seen,
          `gateway:${baseUrl}`,
          createGatewayAdapter({
            baseUrl,
            accessToken,
          }),
        );
      }
    }

    const savedExternalSources = Object.values(config.apiConnections?.entries ?? {}).flatMap(
      externalSourceFromConnection,
    );
    if (savedExternalSources.length > 0) {
      pushUniqueAdapter(
        adapters,
        seen,
        `external:${savedExternalSources.map((source) => source.url).join("|")}`,
        createExternalInfoAdapter({ sources: savedExternalSources }),
      );
    }
  }

  return adapters;
}

function pushUniqueAdapter(
  adapters: ObservationAdapter[],
  seen: Set<string>,
  key: string,
  adapter: ObservationAdapter,
): void {
  if (seen.has(key)) return;
  seen.add(key);
  adapters.push(adapter);
}

function resolveConnectionSecret(secret: SecretInput | undefined): string | undefined {
  if (!secret) return undefined;
  if (typeof secret === "string") return secret.trim() || undefined;
  if (secret.source === "env") return process.env[secret.id];
  return undefined;
}

function isMarketplaceObservationEntry(entry: ApiConnectionEntry): boolean {
  const consumers = entry.consumers ?? [];
  return (
    entry.kind === "marketplace" ||
    consumers.includes("marketplace") ||
    entry.provider === "dijie-cloud-bridge" ||
    entry.provider === "cloud-marketplace"
  );
}

function isGatewayObservationEntry(entry: ApiConnectionEntry): boolean {
  const consumers = entry.consumers ?? [];
  return (
    consumers.includes("dispatch") ||
    entry.provider === "openclaw-local" ||
    entry.provider === "openclaw-gateway" ||
    entry.metadata?.observationSource === "local_gateway"
  );
}

function externalSourceFromConnection(entry: ApiConnectionEntry): ExternalInfoSource[] {
  if (entry.enabled === false) return [];
  const metadata = entry.metadata ?? {};
  const kindValue = metadata.externalObservationKind ?? metadata.observationKind;
  const isExternal =
    metadata.observationSource === "external_info" ||
    entry.provider === "external-info" ||
    entry.provider === "competitor-watch" ||
    entry.provider === "technology-watch" ||
    entry.provider === "risk-feed" ||
    entry.provider === "capability-library";
  if (!isExternal) return [];
  const url = entry.baseUrl || entry.endpoint;
  if (!url) return [];
  const kind =
    kindValue === "technology_tool_model" ||
    kindValue === "risk_policy" ||
    kindValue === "capability_library" ||
    kindValue === "product_competitor"
      ? kindValue
      : entry.provider === "technology-watch"
        ? "technology_tool_model"
        : entry.provider === "risk-feed"
          ? "risk_policy"
          : entry.provider === "capability-library"
            ? "capability_library"
            : "product_competitor";
  return [
    {
      id: entry.id,
      label: entry.name,
      url,
      kind,
    },
  ];
}

function toGoalInput(params: Record<string, unknown>): CreateGoalCandidateInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "attributionReportId")
      ? { attributionReportId: stringParam(params, "attributionReportId") }
      : {}),
    ...(stringParam(params, "observationPackageId")
      ? { observationPackageId: stringParam(params, "observationPackageId") }
      : {}),
    title: requireString(params, "title"),
    owner: requireString(params, "owner"),
    metric: requireString(params, "metric"),
    ...(stringParam(params, "currentValue")
      ? { currentValue: stringParam(params, "currentValue") }
      : {}),
    target: requireString(params, "target"),
    ...(stringParam(params, "cycle") ? { cycle: stringParam(params, "cycle") } : {}),
    rationale: requireString(params, "rationale"),
    ...(stringParam(params, "whyNow") ? { whyNow: stringParam(params, "whyNow") } : {}),
    ...(stringArrayParam(params, "sourceObservationSignalIds")
      ? { sourceObservationSignalIds: stringArrayParam(params, "sourceObservationSignalIds") }
      : {}),
    ...(stringArrayParam(params, "sourceAttributionFindingIds")
      ? { sourceAttributionFindingIds: stringArrayParam(params, "sourceAttributionFindingIds") }
      : {}),
    ...(stringArrayParam(params, "blockedReasons")
      ? { blockedReasons: stringArrayParam(params, "blockedReasons") }
      : {}),
    ...(booleanParam(params, "readyForPlanning") !== undefined
      ? { readyForPlanning: booleanParam(params, "readyForPlanning") }
      : {}),
  };
}

function toPlanningInput(params: Record<string, unknown>): PreparePlanningInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "goalId") ? { goalId: stringParam(params, "goalId") } : {}),
    title: requireString(params, "title"),
    summary: requireString(params, "summary"),
    rolePlanItems: arrayParam(params, "rolePlanItems").map((item) => ({
      ...(stringParam(item, "id") ? { id: stringParam(item, "id") } : {}),
      title: stringParam(item, "title") ?? "未命名岗位规划项",
      ...(stringParam(item, "category") ? { category: stringParam(item, "category") } : {}),
      roleCapabilityRef: stringParam(item, "roleCapabilityRef") ?? "unassigned",
      taskIntent: stringParam(item, "taskIntent") ?? "",
      expectedOutput: stringParam(item, "expectedOutput") ?? "",
      humanConfirmationRequired: booleanParam(item, "humanConfirmationRequired") ?? true,
      ...(stringArrayParam(item, "sourceSignalIds")
        ? { sourceSignalIds: stringArrayParam(item, "sourceSignalIds") }
        : {}),
      ...(stringArrayParam(item, "sourceFindingIds")
        ? { sourceFindingIds: stringArrayParam(item, "sourceFindingIds") }
        : {}),
      ...(stringParam(item, "capabilityMatchSummary")
        ? { capabilityMatchSummary: stringParam(item, "capabilityMatchSummary") }
        : {}),
      ...(stringArrayParam(item, "blockedReasons")
        ? { blockedReasons: stringArrayParam(item, "blockedReasons") }
        : {}),
      ...(stringArrayParam(item, "acceptanceCriteria")
        ? { acceptanceCriteria: stringArrayParam(item, "acceptanceCriteria") }
        : {}),
    })),
  };
}

function toRolePlanItemUpdateInput(params: Record<string, unknown>): UpdateRolePlanItemInput {
  return {
    rolePlanItemId: requireString(params, "rolePlanItemId"),
    ...(stringParam(params, "title") ? { title: stringParam(params, "title") } : {}),
    ...(stringParam(params, "category") ? { category: stringParam(params, "category") } : {}),
    ...(stringParam(params, "roleCapabilityRef")
      ? { roleCapabilityRef: stringParam(params, "roleCapabilityRef") }
      : {}),
    ...(stringParam(params, "taskIntent") ? { taskIntent: stringParam(params, "taskIntent") } : {}),
    ...(stringParam(params, "expectedOutput")
      ? { expectedOutput: stringParam(params, "expectedOutput") }
      : {}),
    ...(typeof booleanParam(params, "humanConfirmationRequired") === "boolean"
      ? { humanConfirmationRequired: booleanParam(params, "humanConfirmationRequired") }
      : {}),
    ...(stringParam(params, "capabilityMatchSummary")
      ? { capabilityMatchSummary: stringParam(params, "capabilityMatchSummary") }
      : {}),
    ...(stringArrayParam(params, "blockedReasons")
      ? { blockedReasons: stringArrayParam(params, "blockedReasons") }
      : {}),
    ...(stringArrayParam(params, "acceptanceCriteria")
      ? { acceptanceCriteria: stringArrayParam(params, "acceptanceCriteria") }
      : {}),
  };
}

function toRolePlanItemCancelInput(params: Record<string, unknown>): CancelRolePlanItemInput {
  return {
    rolePlanItemId: requireString(params, "rolePlanItemId"),
    reason: stringParam(params, "reason") ?? "人工取消该规划项",
  };
}

function toDispatchProposalInput(params: Record<string, unknown>): CreateDispatchProposalInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "planningPackageId")
      ? { planningPackageId: stringParam(params, "planningPackageId") }
      : {}),
    ...(stringParam(params, "rolePlanItemId")
      ? { rolePlanItemId: stringParam(params, "rolePlanItemId") }
      : {}),
    title: requireString(params, "title"),
    riskSummary: requireString(params, "riskSummary"),
    confirmationSummary: requireString(params, "confirmationSummary"),
  };
}

function toTaskPackageInput(params: Record<string, unknown>): MaterializeTaskPackageInput {
  const request = objectParam(params, "request");
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "dispatchProposalReviewId")
      ? { dispatchProposalReviewId: stringParam(params, "dispatchProposalReviewId") }
      : {}),
    title: requireString(params, "title"),
    taskText: requireString(params, "taskText"),
    request: {
      ...(stringParam(request, "id") ? { id: stringParam(request, "id") } : {}),
      ...(stringParam(request, "roleListingId")
        ? { roleListingId: stringParam(request, "roleListingId") }
        : {}),
      ...(stringParam(request, "roleTitle")
        ? { roleTitle: stringParam(request, "roleTitle") }
        : {}),
      ...(stringParam(request, "entitlementId")
        ? { entitlementId: stringParam(request, "entitlementId") }
        : {}),
      ...(stringParam(request, "workspaceDir")
        ? { workspaceDir: stringParam(request, "workspaceDir") }
        : {}),
    },
  };
}

function buildToolSupplyReadModel(
  config: OpenClawConfig,
  mainFlowReadModel: ReturnType<AicsMainFlowStore["readModel"]>,
) {
  const agentId = resolveDefaultAgentId(config);
  const workspaceDir = resolveAgentWorkspaceDir(config, agentId);
  const skillsReport = buildWorkspaceSkillStatus(workspaceDir, {
    config,
    agentId,
    eligibility: {
      remote: getRemoteSkillEligibility({
        advertiseExecNode: canExecRequestNode({ cfg: config, agentId }),
      }),
    },
  });
  return createToolSupplyControlReadModel({
    config,
    toolsCatalogResult: buildToolsCatalogResult({ cfg: config, agentId, includePlugins: true }),
    skillsReport,
    apiConnections: createApiConnectionsReadModel(config),
    cloudMarketplace: createCloudMarketplaceProjection(mainFlowReadModel),
  });
}

function resolveMaterializeCapabilityResolution(params: {
  config: OpenClawConfig;
  store: AicsMainFlowStore;
  input: MaterializeTaskPackageInput;
}): MaterializeTaskPackageInput["capabilityResolution"] {
  const readModel = params.store.readModel();
  const dispatchProposalReviewId =
    params.input.dispatchProposalReviewId ?? readModel.latest.dispatchProposalReview?.id;
  const proposal = readModel.objects.dispatchProposalReviews.find(
    (item) => item.id === dispatchProposalReviewId,
  );
  const rolePlanItem = proposal
    ? readModel.objects.rolePlanItems.find((item) => item.id === proposal.rolePlanItemId)
    : null;
  const category = rolePlanItem?.category ?? "通用品类";
  const toolSupply = buildToolSupplyReadModel(params.config, readModel);
  const resolution = findToolSupplyResolutionForRolePlanItem(toolSupply.resolutions, {
    category,
    roleCapabilityRef: rolePlanItem?.roleCapabilityRef,
  });
  return (
    resolution ?? {
      categoryCapabilityId: `missing:${category}`,
      category,
      allowedTools: [],
      allowedSkills: [],
      dispatchReady: false,
      blockedReasons: ["missing_category_binding", "missing_tool_binding", "missing_skill_binding"],
    }
  );
}

function toRunApprovedTaskInput(
  params: Record<string, unknown>,
  defaults: {
    roleListingId?: string;
    entitlementId?: string;
  } = {},
): RunApprovedTaskInput {
  const result = objectParam(params, "result");
  const outcome = stringParam(result, "outcome");
  const roleListingId = stringParam(params, "roleListingId") ?? defaults.roleListingId;
  const entitlementId = stringParam(params, "entitlementId") ?? defaults.entitlementId;
  return {
    ...(stringParam(params, "taskPackageId")
      ? { taskPackageId: stringParam(params, "taskPackageId") }
      : {}),
    ...(stringParam(params, "dispatchToRoleRequestId")
      ? { dispatchToRoleRequestId: stringParam(params, "dispatchToRoleRequestId") }
      : {}),
    ...(roleListingId ? { roleListingId } : {}),
    ...(stringParam(params, "roleTitle") ? { roleTitle: stringParam(params, "roleTitle") } : {}),
    ...(entitlementId ? { entitlementId } : {}),
    ...(booleanParam(params, "confirmExecution") !== undefined
      ? { confirmExecution: booleanParam(params, "confirmExecution") }
      : {}),
    ...(booleanParam(params, "costConfirmed") !== undefined
      ? { costConfirmed: booleanParam(params, "costConfirmed") }
      : {}),
    ...(stringParam(params, "ledgerRef") ? { ledgerRef: stringParam(params, "ledgerRef") } : {}),
    ...(stringParam(params, "memoryCandidateRef")
      ? { memoryCandidateRef: stringParam(params, "memoryCandidateRef") }
      : {}),
    ...(outcome === "succeeded" || outcome === "failed" || outcome === "blocked"
      ? {
          result: {
            ...(stringParam(result, "id") ? { id: stringParam(result, "id") } : {}),
            outcome,
            summary: stringParam(result, "summary") ?? "",
            artifactRefs: Array.isArray(result.artifactRefs)
              ? result.artifactRefs.filter((item): item is string => typeof item === "string")
              : [],
          },
        }
      : {}),
  };
}

function respondError(respond: RespondFn, error: unknown): void {
  if (error instanceof AicsMainFlowGateError) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, error.message, {
        details: {
          code: error.code,
          stage: error.stage,
        },
      }),
    );
    return;
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)),
  );
}

function requireActorContext(params: Record<string, unknown>): void {
  const reason = validateActorContext(params.actor_context);
  if (reason) {
    throw new Error(reason);
  }
}

async function invokeExecutionHandler(
  method: string,
  params: Record<string, unknown>,
  context: GatewayRequestContext,
): Promise<Record<string, unknown>> {
  const handler = aicsExecutionHandlers[method];
  if (!handler) throw new Error(`missing execution handler: ${method}`);
  let settled = false;
  let ok = false;
  let payload: unknown;
  let errorMessage = "";
  await handler({
    req: {
      type: "request",
      id: `internal_${method}`,
      method,
      params,
    } as GatewayRequestHandlerOptions["req"],
    params,
    client: null,
    isWebchatConnect: () => false,
    context,
    respond: (success, value, error) => {
      settled = true;
      ok = success;
      payload = value;
      errorMessage = error?.message ?? "";
    },
  });
  if (!settled) throw new Error(`${method} did not respond`);
  if (!ok) throw new Error(errorMessage || `${method} 调用失败`);
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  if (record.ok === false) {
    const reasons = Array.isArray(record.blockedReasons)
      ? record.blockedReasons
          .map((item) =>
            typeof item === "string"
              ? item
              : item && typeof item === "object" && "message" in item
                ? String((item as { message?: unknown }).message ?? "")
                : "",
          )
          .filter(Boolean)
      : [];
    throw new Error(
      reasons.join("；") ||
        (typeof record.message === "string" ? record.message : "") ||
        `${method} 被阻塞`,
    );
  }
  return record;
}

type ClosedLoopCheckStatus = "pass" | "blocked" | "skipped";

type ClosedLoopReadinessCheck = {
  id: string;
  label: string;
  status: ClosedLoopCheckStatus;
  message: string;
  httpStatus?: number;
};

type ClosedLoopNextAction = {
  id: string;
  label: string;
  message: string;
  action: string;
};

type AicsBridgeConfig = {
  cloudBaseUrl?: string;
  cloudAccessToken?: string;
  cloudAccessTokenConfiguredButUnresolved?: boolean;
  defaultRoleListingId?: string;
  defaultEntitlementId?: string;
  defaultDeviceId?: string;
  defaultWorkspaceRef?: string;
  defaultLocalGatewayId?: string;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function trimString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isSecretRefLike(value: unknown): boolean {
  const record = recordValue(value);
  return (
    (record.source === "env" || record.source === "file" || record.source === "exec") &&
    typeof record.id === "string"
  );
}

function resolveAicsBridgeConfig(config: OpenClawConfig): AicsBridgeConfig {
  const pluginConfig = recordValue(config.plugins?.entries?.aics?.config);
  const cloudAccessTokenValue = pluginConfig.cloudAccessToken;
  return {
    cloudBaseUrl: trimString(pluginConfig.cloudBaseUrl),
    cloudAccessToken: trimString(cloudAccessTokenValue),
    cloudAccessTokenConfiguredButUnresolved:
      !trimString(cloudAccessTokenValue) && isSecretRefLike(cloudAccessTokenValue),
    defaultRoleListingId: trimString(pluginConfig.defaultRoleListingId),
    defaultEntitlementId: trimString(pluginConfig.defaultEntitlementId),
    defaultDeviceId: trimString(pluginConfig.defaultDeviceId),
    defaultWorkspaceRef: trimString(pluginConfig.defaultWorkspaceRef),
    defaultLocalGatewayId: trimString(pluginConfig.defaultLocalGatewayId),
  };
}

function closedLoopCheck(
  id: string,
  label: string,
  status: ClosedLoopCheckStatus,
  message: string,
  httpStatus?: number,
): ClosedLoopReadinessCheck {
  return { id, label, status, message, ...(httpStatus ? { httpStatus } : {}) };
}

function localClosedLoopActionForCheck(check: ClosedLoopReadinessCheck): ClosedLoopNextAction {
  switch (check.id) {
    case "roleExecutionModel":
      return {
        id: check.id,
        label: check.label,
        message: check.message,
        action: "到 API 管理填写模型 API Key，并保留“岗位执行”用途。",
      };
    case "localRolePreparation":
      return {
        id: check.id,
        label: check.label,
        message: check.message,
        action: check.message.includes("开发者确认上架")
          ? "通知岗位开发者在开发者中心确认上架，生成本地正式 0 元岗位商品。"
          : check.message.includes("品类")
            ? "到审核中心处理品类能力申请；具体 Tool / Skill 制作请到「工具与 Skill」。"
            : "到开发者中心创建商城运营岗位并提交本地审核。",
      };
    case "localAuthorizedRole":
      return {
        id: check.id,
        label: check.label,
        message: check.message,
        action: "到费用与授权创建 0 元正式授权，拿到 entitlementId 后再继续。",
      };
    case "localExecutionQueue":
      return {
        id: check.id,
        label: check.label,
        message: check.message,
        action: "到任务调度点击“检查并派发”，生成派发单后再进入岗位执行。",
      };
    case "localEvidenceReadback":
      return {
        id: check.id,
        label: check.label,
        message: check.message,
        action: "到岗位执行页点击“确认并运行”；完成后检查执行结果、审计和账本读回。",
      };
    default:
      return {
        id: check.id,
        label: check.label,
        message: check.message,
        action: "按页面提示修复该阻塞项后重新检查。",
      };
  }
}

function isSqliteMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no such table");
}

function readMainFlowReadModelForReadiness(): AicsMainFlowReadModel {
  try {
    return new AicsMainFlowStore(undefined, { initializeSchema: false }).readModel();
  } catch (error) {
    if (isSqliteMissingTableError(error)) {
      return createAicsMainFlowReadModel(createEmptyAicsMainFlowState());
    }
    throw error;
  }
}

function latestRolePreListingReview(): RolePreListingReview | null {
  return listRolePreListingReviews()[0] ?? null;
}

function categoryReviewsForRoleReview(
  review: RolePreListingReview | null,
): CategoryCapabilityReview[] {
  if (!review) return [];
  return listCategoryCapabilityReviews().filter((category) => {
    const sameDraft =
      Boolean(review.listingDraftId) && review.listingDraftId === category.listingDraftId;
    const samePackage =
      Boolean(review.rolePackageId) && review.rolePackageId === category.rolePackageId;
    const sameCategory =
      Boolean(review.category) &&
      (review.category === category.categoryRef || review.category === category.categoryName);
    const sameDeveloper =
      Boolean(review.developerId) && review.developerId === category.developerId;
    return sameDraft || samePackage || (sameDeveloper && sameCategory);
  });
}

function activatedCategoryForRoleReview(review: RolePreListingReview | null): boolean {
  if (!review?.category) return false;
  return listCategoryCapabilityReviews().some((category) => {
    if (category.categoryRef !== review.category) return false;
    if (category.reviewStatus !== "已通过" || category.cloudSyncStatus !== "已同步") return false;
    const categoryCapabilities = category.capabilityRefs.length
      ? category.capabilityRefs
      : category.requiredCapabilities;
    return review.requiredCapabilities.every((capability) =>
      categoryCapabilities.includes(capability),
    );
  });
}

function rolePreparationCheckForLocalMode(input: {
  rolesCount: number;
  selectedRoleTitle?: string;
}): ClosedLoopReadinessCheck {
  if (input.selectedRoleTitle) {
    return closedLoopCheck(
      "localRolePreparation",
      "岗位创建/审核/上架",
      "pass",
      `本地正式岗位商品已生成：${input.selectedRoleTitle}。`,
    );
  }
  if (input.rolesCount > 0) {
    return closedLoopCheck(
      "localRolePreparation",
      "岗位创建/审核/上架",
      "pass",
      "本地已有正式岗位商品，下一步创建 0 元授权。",
    );
  }

  const latestReview = latestRolePreListingReview();
  if (!latestReview) {
    return closedLoopCheck(
      "localRolePreparation",
      "岗位创建/审核/上架",
      "blocked",
      "还没有岗位审核单。请先在开发者中心创建商城运营岗位，并提交本地审核。",
    );
  }

  const relatedCategories = categoryReviewsForRoleReview(latestReview);
  const pendingCategory = relatedCategories.find(
    (category) => category.reviewStatus !== "已通过" || category.cloudSyncStatus !== "已同步",
  );
  if (!latestReview.category || pendingCategory || !activatedCategoryForRoleReview(latestReview)) {
    const categoryName =
      pendingCategory?.categoryName ||
      pendingCategory?.title ||
      latestReview.category ||
      "目标品类";
    const categoryStatus = pendingCategory
      ? `${pendingCategory.reviewStatus}/${pendingCategory.cloudSyncStatus}`
      : latestReview.category
        ? "未激活"
        : "未绑定";
    return closedLoopCheck(
      "localRolePreparation",
      "岗位创建/审核/上架",
      "blocked",
      `岗位 ${latestReview.rolePackageId} 还没有可绑定的正式品类能力：${categoryName}（${categoryStatus}）。`,
    );
  }

  if (latestReview.reviewStatus === "已通过") {
    return closedLoopCheck(
      "localRolePreparation",
      "岗位创建/审核/上架",
      "blocked",
      `岗位 ${latestReview.rolePackageId} 已通过本地审核，等待岗位开发者确认上架。`,
    );
  }
  if (latestReview.reviewStatus === "已提交上架") {
    return closedLoopCheck(
      "localRolePreparation",
      "岗位创建/审核/上架",
      "blocked",
      `岗位 ${latestReview.rolePackageId} 已提交上架，但本地正式岗位商品尚未读到，请刷新后重试。`,
    );
  }
  return closedLoopCheck(
    "localRolePreparation",
    "岗位创建/审核/上架",
    "blocked",
    `岗位 ${latestReview.rolePackageId} 当前状态：${latestReview.reviewStatus}。请在审核中心完成岗位审核。`,
  );
}

function roleListingIdFromInstalledRole(value: unknown): string | undefined {
  const record = recordValue(value);
  const role = recordValue(record.role);
  return (
    trimString(record.roleListingId) ??
    trimString(record.role_listing_id) ??
    trimString(role.roleListingId) ??
    trimString(role.id)
  );
}

function entitlementIdFromInstalledRole(value: unknown): string | undefined {
  const record = recordValue(value);
  return (
    trimString(record.entitlementId) ??
    trimString(record.entitlement_id) ??
    trimString(record.orderId) ??
    trimString(record.order_id)
  );
}

function isMarketplaceOpsDiagnosisRole(value: unknown): boolean {
  const text = JSON.stringify(value ?? {}).toLowerCase();
  return text.includes("商城运营诊断官") || text.includes("marketplace-ops-diagnosis");
}

const REQUIRED_MARKETPLACE_OPS_DELIVERABLE_LABELS = [
  "商城运营诊断报告",
  "岗位供给分析",
  "授权转化分析",
  "执行成功率分析",
  "阻塞原因分析",
  "日/周/月运营建议",
  "下一步调度建议",
  "审计摘要",
  "账本摘要",
] as const;

function businessDeliverableLabels(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => trimString(recordValue(item).label))
        .filter((item): item is string => Boolean(item))
    : [];
}

function hasRequiredMarketplaceOpsDeliverables(value: unknown): boolean {
  const labels = new Set(businessDeliverableLabels(value));
  return REQUIRED_MARKETPLACE_OPS_DELIVERABLE_LABELS.every((label) => labels.has(label));
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; payload: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let payload: Record<string, unknown> = {};
    try {
      payload = recordValue(await response.json());
    } catch {
      payload = {};
    }
    return { status: response.status, ok: response.ok, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function createClosedLoopReadiness(config: OpenClawConfig, params: Record<string, unknown>) {
  const requestedMode = stringParam(params, "mode");
  const mode =
    requestedMode === "local" || requestedMode === "cloud" || requestedMode === "auto"
      ? requestedMode
      : "auto";
  const live = params.live !== false;
  if (mode === "local") {
    return createLocalClosedLoopReadiness(config, params, { live });
  }
  const bridge = resolveAicsBridgeConfig(config);
  const apiConnectionBridge = await resolveAicsCloudConnectionFromApiConnections(config);
  const resolvedBridge: AicsBridgeConfig = {
    ...bridge,
    cloudBaseUrl: apiConnectionBridge.cloudBaseUrl ?? bridge.cloudBaseUrl,
    cloudAccessToken: apiConnectionBridge.cloudAccessToken ?? bridge.cloudAccessToken,
    cloudAccessTokenConfiguredButUnresolved:
      apiConnectionBridge.cloudAccessToken || bridge.cloudAccessToken
        ? false
        : bridge.cloudAccessTokenConfiguredButUnresolved,
  };
  const timeoutMs = Math.max(500, Math.min(15_000, Number(params.timeoutMs ?? 5_000) || 5_000));
  if (mode === "auto" && !resolvedBridge.cloudBaseUrl && !resolvedBridge.cloudAccessToken) {
    return createLocalClosedLoopReadiness(config, params, { live });
  }
  const checks: ClosedLoopReadinessCheck[] = [];

  checks.push(
    resolvedBridge.cloudBaseUrl
      ? closedLoopCheck("cloudBaseUrl", "迭界AI云端地址", "pass", "cloudBaseUrl 已配置。")
      : closedLoopCheck(
          "cloudBaseUrl",
          "迭界AI云端地址",
          "blocked",
          "请先在 API 管理同步迭界AI云端连接的 Base URL。",
        ),
  );
  checks.push(
    resolvedBridge.cloudAccessToken
      ? closedLoopCheck(
          "cloudAccessToken",
          "迭界AI云端服务 Token",
          "pass",
          "cloudAccessToken 已解析。",
        )
      : resolvedBridge.cloudAccessTokenConfiguredButUnresolved
        ? closedLoopCheck(
            "cloudAccessToken",
            "迭界AI云端服务 Token",
            "blocked",
            "cloudAccessToken 是 SecretRef，但当前运行时还没有解析到真实值。",
          )
        : closedLoopCheck(
            "cloudAccessToken",
            "迭界AI云端服务 Token",
            "blocked",
            "请先在 API 管理填写并同步迭界AI云端连接 Token。",
          ),
  );
  checks.push(
    resolvedBridge.defaultDeviceId &&
      resolvedBridge.defaultWorkspaceRef &&
      resolvedBridge.defaultLocalGatewayId
      ? closedLoopCheck(
          "localExecutionContext",
          "本地执行上下文",
          "pass",
          "device/workspace/localGateway 已配置。",
        )
      : closedLoopCheck(
          "localExecutionContext",
          "本地执行上下文",
          "blocked",
          "缺少 defaultDeviceId、defaultWorkspaceRef 或 defaultLocalGatewayId。",
        ),
  );

  const hasBlockingConfig = checks.some((item) => item.status === "blocked");
  if (
    !live ||
    hasBlockingConfig ||
    !resolvedBridge.cloudBaseUrl ||
    !resolvedBridge.cloudAccessToken
  ) {
    if (!live)
      checks.push(
        closedLoopCheck("liveProbe", "云端探测", "skipped", "live=false，已跳过云端探测。"),
      );
    return {
      ok: checks.every((item) => item.status !== "blocked"),
      status: checks.some((item) => item.status === "blocked") ? "blocked" : "ready",
      live,
      checks,
      context: {
        cloudBaseUrl: resolvedBridge.cloudBaseUrl ?? null,
        deviceId: resolvedBridge.defaultDeviceId ?? null,
        workspaceRef: resolvedBridge.defaultWorkspaceRef ?? null,
        localGatewayId: resolvedBridge.defaultLocalGatewayId ?? null,
      },
    };
  }

  const myRolesUrl = new URL("/dijie/my-roles", resolvedBridge.cloudBaseUrl);
  if (resolvedBridge.defaultWorkspaceRef)
    myRolesUrl.searchParams.set("workspaceRef", resolvedBridge.defaultWorkspaceRef);
  if (resolvedBridge.defaultDeviceId)
    myRolesUrl.searchParams.set("deviceId", resolvedBridge.defaultDeviceId);

  let selectedRoleListingId =
    trimString(params.roleListingId) ?? resolvedBridge.defaultRoleListingId;
  let selectedEntitlementId =
    trimString(params.entitlementId) ?? resolvedBridge.defaultEntitlementId;
  let rolesCount = 0;
  try {
    const myRoles = await fetchJsonWithTimeout(
      myRolesUrl.toString(),
      { headers: { authorization: `Bearer ${resolvedBridge.cloudAccessToken}` } },
      timeoutMs,
    );
    const roles = Array.isArray(myRoles.payload.roles) ? myRoles.payload.roles : [];
    rolesCount = roles.length;
    if (!myRoles.ok || myRoles.payload.ok === false) {
      checks.push(
        closedLoopCheck(
          "myRoles",
          "我的岗位",
          "blocked",
          "GET /dijie/my-roles 未通过。",
          myRoles.status,
        ),
      );
    } else if (roles.length === 0) {
      checks.push(
        closedLoopCheck(
          "myRoles",
          "我的岗位",
          "blocked",
          "当前账号没有已授权岗位，请先发布并授权商城运营诊断官。",
          myRoles.status,
        ),
      );
    } else {
      const selectedRole = selectedRoleListingId
        ? roles.find((role) => roleListingIdFromInstalledRole(role) === selectedRoleListingId)
        : (roles.find(isMarketplaceOpsDiagnosisRole) ?? roles[0]);
      selectedRoleListingId = roleListingIdFromInstalledRole(selectedRole);
      selectedEntitlementId = selectedEntitlementId ?? entitlementIdFromInstalledRole(selectedRole);
      checks.push(
        closedLoopCheck(
          "myRoles",
          "我的岗位",
          "pass",
          `GET /dijie/my-roles 返回 ${roles.length} 个已授权岗位。`,
          myRoles.status,
        ),
      );
    }
  } catch (error) {
    checks.push(
      closedLoopCheck(
        "myRoles",
        "我的岗位",
        "blocked",
        error instanceof Error ? error.message : "GET /dijie/my-roles 请求失败。",
      ),
    );
  }

  if (
    selectedRoleListingId &&
    selectedEntitlementId &&
    resolvedBridge.defaultDeviceId &&
    resolvedBridge.defaultWorkspaceRef &&
    resolvedBridge.defaultLocalGatewayId
  ) {
    try {
      const executionToken = await fetchJsonWithTimeout(
        new URL("/dijie/execution-token", resolvedBridge.cloudBaseUrl).toString(),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${resolvedBridge.cloudAccessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            roleListingId: selectedRoleListingId,
            entitlementId: selectedEntitlementId,
            deviceId: resolvedBridge.defaultDeviceId,
            workspaceRef: resolvedBridge.defaultWorkspaceRef,
            localGatewayId: resolvedBridge.defaultLocalGatewayId,
          }),
        },
        timeoutMs,
      );
      checks.push(
        executionToken.ok && executionToken.payload.ok !== false
          ? closedLoopCheck(
              "executionToken",
              "执行令牌",
              "pass",
              "POST /dijie/execution-token 已通过。",
              executionToken.status,
            )
          : closedLoopCheck(
              "executionToken",
              "执行令牌",
              "blocked",
              "POST /dijie/execution-token 未通过。",
              executionToken.status,
            ),
      );
    } catch (error) {
      checks.push(
        closedLoopCheck(
          "executionToken",
          "执行令牌",
          "blocked",
          error instanceof Error ? error.message : "POST /dijie/execution-token 请求失败。",
        ),
      );
    }
  } else {
    checks.push(
      closedLoopCheck(
        "executionToken",
        "执行令牌",
        "blocked",
        "缺少 roleListingId、entitlementId 或本地执行上下文，无法申请 execution token。",
      ),
    );
  }

  return {
    ok: checks.every((item) => item.status !== "blocked"),
    status: checks.some((item) => item.status === "blocked") ? "blocked" : "ready",
    live,
    checks,
    context: {
      cloudBaseUrl: resolvedBridge.cloudBaseUrl,
      deviceId: resolvedBridge.defaultDeviceId ?? null,
      workspaceRef: resolvedBridge.defaultWorkspaceRef ?? null,
      localGatewayId: resolvedBridge.defaultLocalGatewayId ?? null,
      roleListingId: selectedRoleListingId ?? null,
      entitlementId: selectedEntitlementId ?? null,
      rolesCount,
    },
  };
}

async function createLocalClosedLoopReadiness(
  config: OpenClawConfig,
  params: Record<string, unknown>,
  options: { live: boolean },
) {
  const localRehearsal = booleanParam(params, "localRehearsal") === true;
  const checks: ClosedLoopReadinessCheck[] = [
    closedLoopCheck(
      "localMode",
      "本地闭环模式",
      "pass",
      "未配置云端 SaaS，当前按本地岗位商城闭环检查。",
    ),
  ];

  if (localRehearsal) {
    checks.push(
      closedLoopCheck(
        "roleExecutionModel",
        "岗位执行模型",
        "pass",
        "本地演练模式已启用：将使用内置图片占位工具验收岗位执行链路，不调用外部模型 API。",
      ),
    );
  } else {
    try {
      const runtime = await resolveApiModelRuntimeForConsumer(config, {
        consumer: "role_execution",
      });
      checks.push(
        runtime
          ? closedLoopCheck(
              "roleExecutionModel",
              "岗位执行模型",
              "pass",
              `API 管理已绑定岗位执行模型：${runtime.provider}/${runtime.model}。`,
            )
          : closedLoopCheck(
              "roleExecutionModel",
              "岗位执行模型",
              "blocked",
              "请先在 API 管理填写模型 API Key，并保留“岗位执行”用途。",
            ),
      );
    } catch (error) {
      checks.push(
        closedLoopCheck(
          "roleExecutionModel",
          "岗位执行模型",
          "blocked",
          error instanceof Error ? error.message : "岗位执行模型不可用。",
        ),
      );
    }
  }

  const roles = listLocalMarketplaceRoles({
    accountId: "local-admin",
    includeUnauthorized: true,
  });
  const authorizedRoles = roles.filter((role) => Boolean(role.entitlementId));
  const selectedRole =
    (trimString(params.roleListingId)
      ? authorizedRoles.find((role) => role.roleListingId === trimString(params.roleListingId))
      : undefined) ??
    authorizedRoles.find((role) => role.title.includes("商城运营")) ??
    authorizedRoles[0];
  const selectedRoleListingId = selectedRole?.roleListingId;
  const selectedEntitlementId = selectedRole?.entitlementId;
  const roleReviews = listRolePreListingReviews();
  const categoryCapabilityReviews = listCategoryCapabilityReviews();
  checks.push(
    rolePreparationCheckForLocalMode({
      rolesCount: roles.length,
      selectedRoleTitle: selectedRole?.title,
    }),
  );
  checks.push(
    selectedRole
      ? closedLoopCheck(
          "localAuthorizedRole",
          "本地已授权岗位",
          "pass",
          `已找到本地 0 元授权岗位：${selectedRole.title}。`,
        )
      : roles.length
        ? closedLoopCheck(
            "localAuthorizedRole",
            "本地已授权岗位",
            "blocked",
            "本地已有上架岗位，但还没有完成 0 元授权。",
          )
        : closedLoopCheck(
            "localAuthorizedRole",
            "本地已授权岗位",
            "blocked",
            "本地还没有已上架并授权的商城运营岗位。",
          ),
  );

  const readModel = readMainFlowReadModelForReadiness();
  const request = selectedRoleListingId
    ? readModel.objects.dispatchToRoleRequests.find(
        (item) => item.roleListingId === selectedRoleListingId,
      )
    : readModel.latest.dispatchToRoleRequest;
  const taskPackage = request
    ? readModel.objects.taskPackages.find((item) => item.id === request.taskPackageId)
    : null;
  const result = request
    ? readModel.objects.roleResults
        .filter((item) => item.dispatchToRoleRequestId === request.id)
        .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))[0]
    : null;
  if (!request || !taskPackage) {
    checks.push(
      closedLoopCheck(
        "localExecutionQueue",
        "本地执行队列",
        "blocked",
        "还没有待执行派发单，请先到任务调度生成并确认执行。",
      ),
    );
  } else if (isSuccessfulRoleOutcome(result?.outcome)) {
    checks.push(
      closedLoopCheck("localExecutionQueue", "本地执行队列", "pass", "本地岗位任务已执行完成。"),
    );
  } else if (result?.outcome === "blocked") {
    checks.push(
      closedLoopCheck(
        "localExecutionQueue",
        "本地执行队列",
        "pass",
        `本地岗位任务已执行，但结果需要补齐证据：${result.summary}`,
      ),
    );
  } else if (result) {
    checks.push(
      closedLoopCheck(
        "localExecutionQueue",
        "本地执行队列",
        "blocked",
        `本地岗位任务执行失败：${result.summary}`,
      ),
    );
  } else {
    const preflight = new AicsMainFlowStore(undefined, {
      initializeSchema: false,
    }).executionPreflight({
      taskPackageId: taskPackage.id,
      dispatchToRoleRequestId: request.id,
    });
    checks.push(
      preflight.canRun
        ? closedLoopCheck(
            "localExecutionQueue",
            "本地执行队列",
            "pass",
            "本地派发单已授权、已确认执行、已确认费用，可以执行岗位。",
          )
        : closedLoopCheck(
            "localExecutionQueue",
            "本地执行队列",
            "blocked",
            `本地派发单尚不能执行：${JSON.stringify(preflight.blockedReasons)}`,
          ),
    );
  }

  const hasSuccessfulResult = isSuccessfulRoleOutcome(result?.outcome);
  const localEvidenceAudit = result ? getLocalRoleExecutionAuditByExecutionId(result.id) : null;
  const localEvidenceLedger = result ? getLocalRoleLedgerEntryByExecutionId(result.id) : null;
  const localBusinessArtifactRefs = result
    ? (result.artifactRefs ?? []).filter(
        (ref) => !ref.startsWith("audit:") && !ref.startsWith("ledger:"),
      )
    : [];
  const localModelUsage = result?.executionEvidence?.modelUsage;
  const hasLocalModelUsage =
    typeof localModelUsage === "object" &&
    localModelUsage !== null &&
    (typeof localModelUsage.totalTokens === "number" ||
      typeof localModelUsage.inputTokens === "number" ||
      typeof localModelUsage.outputTokens === "number" ||
      typeof localModelUsage.costCents === "number");
  const localModelUsageNotApplicableReason =
    result?.executionEvidence?.modelUsageNotApplicable === true
      ? typeof result.executionEvidence.modelUsageNotApplicableReason === "string" &&
        result.executionEvidence.modelUsageNotApplicableReason.trim()
        ? result.executionEvidence.modelUsageNotApplicableReason.trim()
        : "本次执行未调用模型，因此无模型费用证据。"
      : null;
  const hasLocalModelEvidence = hasLocalModelUsage || Boolean(localModelUsageNotApplicableReason);
  const localCostSummary = result?.executionEvidence?.costSummary;
  const hasLocalCostSummary = Boolean(
    localCostSummary &&
    typeof localCostSummary === "object" &&
    (typeof localCostSummary.totalCostCents === "number" ||
      typeof localCostSummary.authorizationFeeCents === "number" ||
      typeof localCostSummary.executionFeeCents === "number" ||
      typeof localCostSummary.modelUsageCostCents === "number" ||
      typeof localCostSummary.ledgerRef === "string"),
  );
  const localHumanConfirmationRef =
    typeof result?.executionEvidence?.humanConfirmationRef === "string" &&
    result.executionEvidence.humanConfirmationRef.trim()
      ? result.executionEvidence.humanConfirmationRef.trim()
      : null;
  const requiresLocalHumanConfirmation = request?.confirmExecution === true;
  const hasLocalHumanConfirmation =
    !requiresLocalHumanConfirmation || Boolean(localHumanConfirmationRef);
  const localBusinessDeliverables = result?.executionEvidence?.businessDeliverables ?? [];
  const requiresMarketplaceOpsDeliverables = isMarketplaceOpsDiagnosisRole({
    role: selectedRole,
    request,
    taskPackage,
    result,
  });
  const hasLocalBusinessDeliverables =
    !requiresMarketplaceOpsDeliverables ||
    hasRequiredMarketplaceOpsDeliverables(localBusinessDeliverables);
  if (result) {
    const hasFullEvidence =
      hasSuccessfulResult &&
      Boolean(localEvidenceAudit && localEvidenceLedger) &&
      localBusinessArtifactRefs.length > 0 &&
      hasLocalModelEvidence &&
      hasLocalCostSummary &&
      hasLocalHumanConfirmation &&
      hasLocalBusinessDeliverables;
    checks.push(
      hasFullEvidence
        ? closedLoopCheck(
            "localEvidenceReadback",
            "本地审计账本读回",
            "pass",
            "本地执行结果、业务产物、商城运营业务明细、审计记录、账本记录、费用摘要、人工确认，以及模型费用证据或未调用模型说明均可读回。",
          )
        : closedLoopCheck(
            "localEvidenceReadback",
            "本地审计账本读回",
            "blocked",
            "岗位已执行，但本地业务产物、商城运营业务明细、审计、账本、费用摘要、人工确认、模型费用证据或未调用模型说明缺失。",
          ),
    );
  } else {
    checks.push(
      closedLoopCheck(
        "localEvidenceReadback",
        "本地审计账本读回",
        "skipped",
        "岗位尚未执行；执行后会检查结果、业务产物、商城运营业务明细、审计、账本、费用摘要、人工确认，以及模型费用证据或未调用模型说明读回。",
      ),
    );
  }

  const blockedChecks = checks.filter((item) => item.status === "blocked");
  const nextActions: ClosedLoopNextAction[] = blockedChecks.length
    ? blockedChecks.map(localClosedLoopActionForCheck)
    : hasSuccessfulResult
      ? []
      : [
          {
            id: "localEvidenceReadback",
            label: "本地审计账本读回",
            message: localRehearsal
              ? "本地演练、授权和执行队列已准备好，但还没有执行结果、审计和账本读回。"
              : "本地 API、授权和执行队列已准备好，但还没有真实执行结果、审计和账本读回。",
            action: localRehearsal
              ? "运行 npm run aics:local-demo:run -- --local-rehearsal；完成后检查执行结果、审计和账本读回。"
              : "到岗位执行页点击“确认并运行”；完成后检查执行结果、审计和账本读回。",
          },
        ];

  return {
    ok: !blockedChecks.length,
    status: blockedChecks.length ? "blocked" : "ready",
    mode: "local",
    live: options.live,
    checks,
    nextActions,
    context: {
      cloudBaseUrl: null,
      localRehearsal,
      roleListingId: selectedRoleListingId ?? null,
      entitlementId: selectedEntitlementId ?? null,
      categoryCapabilityId: request?.categoryCapabilityId ?? null,
      requiredCapabilityRefs:
        request?.requiredCapabilityRefs ?? taskPackage?.requiredCapabilityRefs ?? [],
      rolesCount: roles.length,
      authorizedRolesCount: authorizedRoles.length,
      roleReviewsCount: roleReviews.length,
      categoryCapabilityRequestsCount: categoryCapabilityReviews.length,
      dispatchToRoleRequestId: request?.id ?? null,
      taskPackageId: taskPackage?.id ?? null,
      executionId: result?.id ?? null,
      executionSummary: result?.summary ?? null,
      artifactRefs: result?.artifactRefs ?? [],
      auditRecordId: localEvidenceAudit?.auditRecordId ?? null,
      ledgerRef: localEvidenceLedger?.ledgerRef ?? null,
      modelUsage: localModelUsage ?? null,
      modelUsageNotApplicableReason: localModelUsageNotApplicableReason,
      costSummary: localCostSummary ?? null,
      humanConfirmationRef: localHumanConfirmationRef,
      businessDeliverables: localBusinessDeliverables,
    },
  };
}

async function resolveRunApprovedTaskDefaults(
  config: OpenClawConfig,
  params: Record<string, unknown>,
): Promise<{ roleListingId?: string; entitlementId?: string }> {
  const explicitRoleListingId = stringParam(params, "roleListingId");
  const explicitEntitlementId = stringParam(params, "entitlementId");
  if (explicitRoleListingId && explicitEntitlementId) return {};

  const bridge = resolveAicsBridgeConfig(config);
  if (bridge.defaultRoleListingId && bridge.defaultEntitlementId) {
    return {
      roleListingId: bridge.defaultRoleListingId,
      entitlementId: bridge.defaultEntitlementId,
    };
  }

  const readiness = await createClosedLoopReadiness(config, {
    ...(explicitRoleListingId ? { roleListingId: explicitRoleListingId } : {}),
    ...(explicitEntitlementId ? { entitlementId: explicitEntitlementId } : {}),
    timeoutMs: 5_000,
  });
  const context = recordValue(readiness.context);
  return {
    roleListingId: trimString(context.roleListingId),
    entitlementId: trimString(context.entitlementId),
  };
}

export const aicsMainFlowHandlers: GatewayRequestHandlers = {
  "aics.cloudMarketplace.auditQueue.get": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      respond(true, projection.audit);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.capabilities.get": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      respond(true, projection.capabilities);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.uniqueCapabilityRequests.get": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      respond(true, projection.capabilities.uniqueRequests);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.businessSummary.get": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      respond(true, projection.businessSummary);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.dispatcherRoleReadModel.get": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      respond(true, projection.dispatcherRoleReadModel);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.dispatcherRoleSelection.create": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const roleListingId = requireString(params, "roleListingId");
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      const role = projection.dispatcherRoleReadModel.callableRoles.find(
        (candidate) => candidate.roleListingId === roleListingId,
      );
      if (!role) {
        throw new Error("dispatcher_role_not_authorized");
      }
      respond(true, {
        selectionId: `dispatcher_role_selection:${role.roleListingId}`,
        role,
        priceSnapshot: "cloud_marketplace_summary_only",
        entitlementStatus: "approved",
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.apiHealth.get": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      respond(true, projection.apiHealth);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.roleReview.approve": async ({ params, context, respond }) => {
    try {
      requireActorContext(params);
      void context;
      throw new Error("需要先通过本地审核中心");
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.closedLoop.readiness.get": async ({ params, context, respond }) => {
    try {
      const readiness = await createClosedLoopReadiness(context.getRuntimeConfig(), params);
      respond(true, readiness);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.readModel.get": ({ respond }) => {
    try {
      respond(true, new AicsMainFlowStore().readModel());
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.operationsModel.run": async ({ params, context, respond }) => {
    try {
      const result = await runOperationsBackendModel({
        context,
        prompt: requireString(params, "prompt"),
        systemPrompt: stringParam(params, "systemPrompt"),
        executionId: stringParam(params, "executionId"),
      });
      respond(true, {
        ok: true,
        ...result,
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.interaction.create": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        createInteraction(state, toInteractionInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.observation.prepare": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        prepareObservation(state, toObservationInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.observation.collect": async ({ params, context, respond }) => {
    try {
      const adapters = buildObservationAdapters(params, context.getRuntimeConfig());
      if (adapters.length === 0) {
        throw new Error(
          "missing observation source: marketplaceBaseUrl, gatewayBaseUrl or externalSources is required",
        );
      }
      const collector = await collectObservations(adapters);
      const input = toObservationPackageInput(
        collector,
        stringParam(params, "title") ?? "岗位商城真实观察包",
      );
      const store = new AicsMainFlowStore();
      const observationPackage = store.update((state) => prepareObservation(state, input));
      respond(true, {
        observationPackage,
        collector,
        readModel: store.readModel(),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.observation.toolPlan.run": async ({ params, context, respond }) => {
    try {
      const store = new AicsMainFlowStore();
      const readModel = store.readModel();
      const workspace = readModel.observationWorkspace;
      const config = context.getRuntimeConfig();
      const requestedPlanId = stringParam(params, "toolPlanId");
      const plan =
        (requestedPlanId
          ? workspace.toolPlans.find((item) => item.id === requestedPlanId)
          : workspace.toolPlans.find((item) => item.status === "ready")) ?? workspace.toolPlans[0];
      if (!plan) {
        throw new Error("missing observation tool plan: generate observation workspace first");
      }
      const externalSources = [
        ...toExternalInfoSources(params),
        ...Object.values(config.apiConnections?.entries ?? {}).flatMap(
          externalSourceFromConnection,
        ),
      ];
      const externalInfoCollector = externalSources.length
        ? createObservationAdapterCollector({
            adapter: createExternalInfoAdapter({ sources: externalSources }),
            toolPlanId: plan.id,
          })
        : undefined;
      const gatewayBaseUrl = stringParam(params, "gatewayBaseUrl");
      const gatewayAccessToken = stringParam(params, "gatewayAccessToken");
      const gatewayCollector = gatewayBaseUrl
        ? createObservationAdapterCollector({
            adapter: createGatewayAdapter({
              baseUrl: gatewayBaseUrl,
              accessToken: gatewayAccessToken,
            }),
            toolPlanId: plan.id,
          })
        : undefined;
      const runResult = await runObservationToolPlan({
        businessContext: workspace.businessContext,
        objects: workspace.objects,
        questions: workspace.questions,
        plan,
        collectors: {
          internalReadModel: async (step) => {
            const now = new Date().toISOString();
            const latest = store.readModel();
            return {
              id: `raw:${step.id}:internal-read-model:${Date.now()}`,
              toolPlanId: plan.id,
              toolStepId: step.id,
              toolType: step.toolType,
              ...(step.toolName ? { toolName: step.toolName } : {}),
              rawOutputRef: `read-model:aics-main-flow:${latest.updatedAt}`,
              rawSummary: `主流程当前在「${latest.stageGuidance.title}」，下一步是「${latest.stageGuidance.primaryActionLabel}」。阻塞项 ${latest.blockedReasons.length} 个，观察证据 ${latest.observationWorkspace.evidence.length} 条。`,
              collectedAt: now,
              success: true,
            };
          },
          toolRun: async (step) => {
            const now = new Date().toISOString();
            const latest = store.readModel();
            const toolSkillCheck = latest.operationChecks.find(
              (item) => item.routeTab === "skills",
            );
            return {
              id: `raw:${step.id}:tool-skill-status:${Date.now()}`,
              toolPlanId: plan.id,
              toolStepId: step.id,
              toolType: step.toolType,
              ...(step.toolName ? { toolName: step.toolName } : {}),
              rawOutputRef: `read-model:tool-skill-status:${latest.updatedAt}`,
              rawSummary: toolSkillCheck
                ? `工具与 Skill 状态：${toolSkillCheck.title}，${toolSkillCheck.summary}。下一步：${toolSkillCheck.nextAction}${toolSkillCheck.blockedReason ? `。阻塞：${toolSkillCheck.blockedReason}` : ""}`
                : `工具与 Skill 状态：${latest.executionPreflight.hasToolSkillReadiness ? "满足当前执行队列" : "等待工具或 Skill 能力确认"}`,
              collectedAt: now,
              success: true,
            };
          },
          skillRun: async (step) => {
            const now = new Date().toISOString();
            const latest = store.readModel();
            const capabilityMatches = latest.capabilities.matches.length;
            return {
              id: `raw:${step.id}:skill-status:${Date.now()}`,
              toolPlanId: plan.id,
              toolStepId: step.id,
              toolType: step.toolType,
              ...(step.toolName ? { toolName: step.toolName } : {}),
              rawOutputRef: `read-model:skill-status:${latest.updatedAt}`,
              rawSummary: `Skill 与能力匹配状态：当前账号有 ${capabilityMatches} 条能力匹配记录；${latest.executionPreflight.hasToolSkillReadiness ? "当前执行队列工具与 Skill 条件满足。" : "当前执行队列仍需确认工具或 Skill 条件。"}`,
              collectedAt: now,
              success: true,
            };
          },
          ...(gatewayCollector ? { gatewayApi: gatewayCollector } : {}),
          ...(externalInfoCollector
            ? {
                externalWebSearch: externalInfoCollector,
                externalWebFetch: externalInfoCollector,
                externalApi: externalInfoCollector,
              }
            : {}),
        },
      });
      const acceptedEvidenceIds = new Set(
        runResult.qualityResults
          .filter((item) => item.status === "accepted")
          .map((item) => item.evidenceId),
      );
      const acceptedSignals = runResult.evidence
        .filter((item) => acceptedEvidenceIds.has(item.id))
        .map(observationEvidenceToSignal);
      const auditCreatedAt = Date.now();
      const observationPackage = acceptedSignals.length
        ? store.update((state) =>
            prepareObservation(state, {
              title: runResult.candidate.title,
              summary: [
                runResult.candidate.summary,
                `本次采集：可信证据 ${runResult.candidate.qualitySummary.accepted} 条，待复核 ${runResult.candidate.qualitySummary.needsReview} 条，不可归因 ${runResult.candidate.qualitySummary.rejected} 条，缺失 ${runResult.candidate.qualitySummary.missing} 项。`,
                ...(runResult.blockedReasons.length
                  ? [`阻塞：${runResult.blockedReasons.join("；")}`]
                  : []),
              ].join("\n"),
              signals: acceptedSignals,
              auditRefs: [
                {
                  id: `observation_tool_plan:${runResult.planId}`,
                  kind: "system",
                  label: "观察采集计划运行",
                  createdAt: auditCreatedAt,
                },
              ],
            }),
          )
        : null;
      const evidenceRun = store.update((state) =>
        recordObservationEvidenceRun(state, {
          planId: runResult.planId,
          status: runResult.status,
          ...(observationPackage ? { observationPackageId: observationPackage.id } : {}),
          acceptedCount: runResult.candidate.qualitySummary.accepted,
          needsReviewCount: runResult.candidate.qualitySummary.needsReview,
          rejectedCount: runResult.candidate.qualitySummary.rejected,
          missingCount: runResult.candidate.qualitySummary.missing,
          blockedReasons: runResult.blockedReasons,
          runResultJson: JSON.stringify(runResult),
        }),
      );
      respond(true, {
        runResult,
        evidenceRun,
        observationPackage,
        readModel: store.readModel(),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.observation.confirm": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        confirmObservation(state, requireString(params, "observationPackageId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.observation.reject": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        rejectObservation(state, requireString(params, "observationPackageId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.observation.markDataMissing": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        markObservationDataMissing(
          state,
          requireString(params, "observationPackageId"),
          stringParam(params, "summary") ?? undefined,
        ),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.attribution.prepare": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        prepareAttribution(state, toAttributionInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.attribution.generateFromLatest": ({ params, respond }) => {
    try {
      const store = new AicsMainFlowStore();
      let compareResult: ReturnType<typeof compareObservationsToGoal> | null = null;
      const attribution = store.update((state) => {
        const observationPackageId = stringParam(params, "observationPackageId");
        const goalId = stringParam(params, "goalId");
        const observation = observationPackageId
          ? state.observations.find((item) => item.id === observationPackageId)
          : state.observations
              .filter(
                (item) =>
                  item.status !== "rejected" &&
                  item.status !== "cancelled" &&
                  item.signals.length > 0,
              )
              .sort((a, b) => b.createdAt - a.createdAt)[0];
        const previousGoal = goalId
          ? state.goals.find((item) => item.id === goalId)
          : state.goals
              .filter((item) => item.status === "confirmed")
              .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (!observation) {
          throw new Error(
            "missing ObservationPackage with observation signals for attribution generation",
          );
        }
        compareResult = compareObservationsToGoal({
          observation,
          ...(previousGoal ? { previousGoal } : {}),
        });
        const input = comparatorToAttributionInput(compareResult, observation.id);
        return prepareAttribution(state, input);
      });
      respond(true, {
        attribution,
        compareResult,
        readModel: store.readModel(),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.attribution.confirm": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        confirmAttribution(state, requireString(params, "attributionReportId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.attribution.reject": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        rejectAttribution(state, requireString(params, "attributionReportId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.attribution.requestMoreData": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        requestAttributionMoreData(
          state,
          requireString(params, "attributionReportId"),
          stringParam(params, "summary") ?? undefined,
        ),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.goal.candidate.create": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        createGoalCandidate(state, toGoalInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.goal.generateFromLatest": ({ params, respond }) => {
    try {
      const store = new AicsMainFlowStore();
      const goal = store.update((state) => {
        const attributionReportId = stringParam(params, "attributionReportId");
        const attribution = attributionReportId
          ? state.attributions.find((item) => item.id === attributionReportId)
          : state.attributions
              .filter((item) => item.status === "confirmed" && item.findings.length > 0)
              .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (
          !attribution ||
          attribution.status !== "confirmed" ||
          attribution.findings.length === 0
        ) {
          throw new Error("missing confirmed AttributionReport with findings for goal generation");
        }
        const observation = state.observations.find(
          (item) => item.id === attribution.observationPackageId && item.status === "confirmed",
        );
        if (!observation || observation.signals.length === 0) {
          throw new Error("missing confirmed ObservationPackage for goal generation");
        }
        const goalCandidate = generateGoalCandidate({
          attributionReportId: attribution.id,
          observationPackageId: observation.id,
          owner: stringParam(params, "owner") ?? "迭界AI",
          attributionResult: {
            completionStatus: "unknown",
            gapSummary: attribution.summary,
            dataInsufficient: false,
            rankedCauses: attribution.findings.map((finding, index) => ({
              rank: index + 1,
              title: finding.title as RankedCause["title"],
              summary: finding.summary,
              confidence: finding.confidence,
              impactLevel: finding.confidence === "high" ? "high" : "medium",
              evidenceRefs: finding.observationSignalIds,
            })),
          },
        });
        return createGoalCandidate(state, {
          ...goalCandidate,
          sourceObservationSignalIds: [
            ...new Set(attribution.findings.flatMap((finding) => finding.observationSignalIds)),
          ],
          sourceAttributionFindingIds: attribution.findings.map((finding) => finding.id),
        });
      });
      respond(true, {
        goal,
        readModel: store.readModel(),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.goal.confirm": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        confirmGoal(state, requireString(params, "goalId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.planning.prepare": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        preparePlanning(state, toPlanningInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.planning.regenerate": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        regeneratePlanning(state, toPlanningInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.planning.generateFromLatest": ({ params, respond }) => {
    try {
      const store = new AicsMainFlowStore();
      const planning = store.update((state) => {
        const goalId = stringParam(params, "goalId");
        const goal = goalId
          ? state.goals.find((item) => item.id === goalId && item.status === "confirmed")
          : state.goals
              .filter((item) => item.status === "confirmed")
              .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (!goal) {
          throw new Error("missing confirmed CompanyGoal for planning generation");
        }
        const attributionReport = state.attributions.find(
          (item) => item.id === goal.attributionReportId,
        );
        const observationPackage = goal.observationPackageId
          ? state.observations.find((item) => item.id === goal.observationPackageId)
          : undefined;
        const generated = generatePlanningPackage({
          goal,
          ...(attributionReport ? { attributionReport } : {}),
          ...(observationPackage ? { observationPackage } : {}),
        });
        return stringParam(params, "mode") === "regenerate"
          ? regeneratePlanning(state, generated.planning)
          : preparePlanning(state, generated.planning);
      });
      respond(true, {
        planning,
        readModel: store.readModel(),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.planning.confirm": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        confirmPlanning(state, requireString(params, "planningPackageId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.planning.item.update": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        updateRolePlanItem(state, toRolePlanItemUpdateInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.planning.item.cancel": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        cancelRolePlanItem(state, toRolePlanItemCancelInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.management.workBlocks.create": ({ params, respond }) => {
    try {
      const goalId = requireString(params, "goalId");
      const blocks = arrayParam(params, "blocks").map((block) => ({
        name: stringParam(block, "name") ?? "未命名工作块",
        purpose: stringParam(block, "purpose") ?? "承接已确认 CompanyGoal 的经营拆解。",
        progressGauge: stringParam(block, "progressGauge") ?? "待定义完成口径",
        roles: arrayParam(block, "roles").map((role) => ({
          roleListingId: stringParam(role, "roleListingId") ?? "unassigned",
          roleTitle: stringParam(role, "roleTitle") ?? "待授权岗位",
        })),
        tasks: arrayParam(block, "tasks").map((task) => ({
          title: stringParam(task, "title") ?? "未命名任务候选",
          targetDeliverable: stringParam(task, "targetDeliverable") ?? "待定义交付物",
        })),
      }));
      if (!blocks.length) {
        throw new Error("missing required blocks");
      }
      const result = new AicsMainFlowStore().update((state) =>
        createWorkBlocks(state, goalId, blocks),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.proposal.create": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        createDispatchProposal(state, toDispatchProposalInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.confirm": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        confirmDispatch(state, requireString(params, "dispatchProposalReviewId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.materializeTaskPackage": ({ params, context, respond }) => {
    try {
      const store = new AicsMainFlowStore();
      const input = toTaskPackageInput(params);
      const capabilityResolution = resolveMaterializeCapabilityResolution({
        config: context.getRuntimeConfig(),
        store,
        input,
      });
      const result = store.update((state) =>
        materializeTaskPackage(state, { ...input, capabilityResolution }),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.checkAndCreateQueue": ({ params, context, respond }) => {
    try {
      const store = new AicsMainFlowStore();
      const result = store.update((state) => {
        const planningPackageId = stringParam(params, "planningPackageId");
        const targetRolePlanItemId = stringParam(params, "rolePlanItemId");
        const planning = planningPackageId
          ? state.planningPackages.find(
              (item) => item.id === planningPackageId && item.status === "confirmed",
            )
          : state.planningPackages
              .filter((item) => item.status === "confirmed")
              .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (!planning) {
          throw new Error("missing confirmed PlanningPackage for dispatch");
        }
        const rolePlanItems = state.rolePlanItems.filter(
          (item) =>
            planning.rolePlanItemIds.includes(item.id) &&
            item.status === "confirmed" &&
            item.dispatchStatus !== "dispatched" &&
            item.dispatchStatus !== "blocked" &&
            (!targetRolePlanItemId || item.id === targetRolePlanItemId),
        );
        if (!rolePlanItems.length) {
          throw new Error("missing confirmed RolePlanItem for dispatch");
        }
        const generated = generateDispatchProposal({
          planningPackage: planning,
          rolePlanItems,
          ...(targetRolePlanItemId ? { targetRolePlanItemId } : {}),
        });
        const materialized = [];
        for (const item of generated) {
          const proposal = createDispatchProposal(state, item.proposal);
          confirmDispatch(state, proposal.id);
          const input = materializeFromDispatch({
            dispatchProposal: proposal,
            rolePlanItem: item.rolePlanItem,
          });
          const capabilityResolution = resolveMaterializeCapabilityResolution({
            config: context.getRuntimeConfig(),
            store,
            input,
          });
          materialized.push(
            materializeTaskPackage(state, {
              ...input,
              capabilityResolution,
            }),
          );
        }
        return {
          planning,
          proposals: generated.map((item) => item.proposal),
          materialized,
        };
      });
      respond(true, {
        ...result,
        readModel: store.readModel(),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.execution.preflight.get": ({ params, respond }) => {
    try {
      respond(
        true,
        new AicsMainFlowStore().executionPreflight({
          ...(stringParam(params, "taskPackageId")
            ? { taskPackageId: stringParam(params, "taskPackageId") }
            : {}),
          ...(stringParam(params, "dispatchToRoleRequestId")
            ? { dispatchToRoleRequestId: stringParam(params, "dispatchToRoleRequestId") }
            : {}),
        }),
      );
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.execution.confirm": async ({ params, context, respond }) => {
    try {
      const config = context.getRuntimeConfig();
      const defaults = await resolveRunApprovedTaskDefaults(config, params);
      const result = new AicsMainFlowStore().update((state) =>
        confirmRoleExecution(state, toRunApprovedTaskInput(params, defaults)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.execution.cost.confirm": async ({ params, context, respond }) => {
    try {
      const config = context.getRuntimeConfig();
      const defaults = await resolveRunApprovedTaskDefaults(config, params);
      const result = new AicsMainFlowStore().update((state) =>
        confirmRoleExecutionCost(state, toRunApprovedTaskInput(params, defaults)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.runApprovedTask": async ({ params, context, respond }) => {
    try {
      const config = context.getRuntimeConfig();
      const defaults = await resolveRunApprovedTaskDefaults(config, params);
      const result = new AicsMainFlowStore().update((state) =>
        runApprovedTask(state, toRunApprovedTaskInput(params, defaults)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.execution.confirmAndRun": async ({ params, context, respond }) => {
    try {
      const config = context.getRuntimeConfig();
      const defaults = await resolveRunApprovedTaskDefaults(config, params);
      const store = new AicsMainFlowStore();
      const input = toRunApprovedTaskInput(params, defaults);
      const confirmedRequest = store.update((state) => confirmRoleExecution(state, input));
      const entitlementId = input.entitlementId ?? confirmedRequest.entitlementId;
      if (!entitlementId) {
        throw new Error("岗位执行需要先完成岗位授权。请到「费用与授权」选择已授权岗位。");
      }
      const ledgerRef =
        input.ledgerRef ?? confirmedRequest.ledgerRef ?? `ledger:pending:${entitlementId}`;
      const costConfirmedRequest = store.update((state) =>
        confirmRoleExecutionCost(state, {
          ...input,
          dispatchToRoleRequestId: confirmedRequest.id,
          entitlementId,
          ledgerRef,
        }),
      );
      const readModel = store.readModel();
      const taskPackage = readModel.objects.taskPackages.find(
        (item) => item.id === costConfirmedRequest.taskPackageId,
      );
      if (!taskPackage) {
        throw new Error("岗位执行需要任务调度先生成派发任务。请回到「任务调度」检查并派发。");
      }
      const roleListingId = costConfirmedRequest.roleListingId ?? input.roleListingId;
      if (!roleListingId) {
        throw new Error("岗位执行需要 roleListingId。请到「费用与授权」完成岗位授权。");
      }
      const runResult = await invokeExecutionHandler(
        "dijie.roleTask.run",
        {
          role_listing_id: roleListingId,
          entitlement_id: entitlementId,
          taskPackageId: taskPackage.id,
          dispatchToRoleRequestId: costConfirmedRequest.id,
          ...(costConfirmedRequest.roleTitle ? { role_title: costConfirmedRequest.roleTitle } : {}),
          task_text:
            taskPackage.taskText ||
            taskPackage.title ||
            "执行已授权岗位任务，并输出可审计的业务结果。",
          confirmExecution: true,
          costConfirmed: true,
          confirm_execution: true,
          cost_confirmed: true,
          ...(costConfirmedRequest.workspaceDir
            ? { workspace_dir: costConfirmedRequest.workspaceDir }
            : {}),
        },
        context,
      );
      const roleResult = objectParam(runResult, "roleResult");
      const auditUpload = objectParam(runResult, "auditUpload");
      const billingSummary = objectParam(runResult, "billingSummary");
      const executionEvidence = objectParam(roleResult, "executionEvidence");
      const artifactRefs = Array.isArray(roleResult.artifactRefs)
        ? roleResult.artifactRefs.filter((item): item is string => typeof item === "string")
        : [];
      const ledgerFromEvidence = stringParam(executionEvidence, "ledgerRef");
      const ledgerFromBilling = stringParam(billingSummary, "ledgerRef");
      const auditRecordId = stringParam(auditUpload, "auditRecordId");
      const executionId = stringParam(runResult, "executionId");
      const recordResult = await invokeExecutionHandler(
        "aics.execution.result.record",
        {
          taskPackageId: taskPackage.id,
          dispatchToRoleRequestId: costConfirmedRequest.id,
          roleListingId,
          ...(costConfirmedRequest.roleTitle ? { roleTitle: costConfirmedRequest.roleTitle } : {}),
          entitlementId,
          ...(executionId ? { executionId } : {}),
          ok: runResult.ok === true,
          status: stringParam(runResult, "status"),
          summary: stringParam(runResult, "summary"),
          ...(auditRecordId ? { auditRecordId } : {}),
          ledgerRef: ledgerFromBilling ?? ledgerFromEvidence ?? ledgerRef,
          artifactRefs,
          ...(Object.keys(executionEvidence).length ? { executionEvidence } : {}),
          source_surface: "aics_main_flow_role_execution",
          purpose: "confirm_and_run_dispatched_role_task",
        },
        context,
      );
      const readbackResult = await invokeExecutionHandler(
        "aics.executionEvidence.readback.get",
        {
          executionId: executionId ?? stringParam(recordResult, "executionId"),
          ...(auditRecordId ? { auditRecordId } : {}),
          ledgerRef:
            stringParam(recordResult, "ledgerRef") ??
            ledgerFromBilling ??
            ledgerFromEvidence ??
            ledgerRef,
        },
        context,
      );
      respond(true, {
        ok: true,
        status: "completed",
        taskPackageId: taskPackage.id,
        dispatchToRoleRequestId: costConfirmedRequest.id,
        executionId: executionId ?? stringParam(recordResult, "executionId"),
        summary: stringParam(runResult, "summary") ?? "岗位任务已完成，执行结果和证据已读回。",
        recordResult,
        evidenceReadback: readbackResult,
        readModel: new AicsMainFlowStore().readModel(),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },

  // ====================================================================
  // Auto-pipeline: 一键推进五层流程
  // ====================================================================

  /**
   * 自动执行归因→目标→规划→调度管道。
   *
   * 输入：owner（目标负责人名称）
   * 流程：
   *   1. 取最新的 ObservationPackage 和 CompanyGoal
   *   2. 归因对比：compareObservationsToGoal()
   *   3. 生成目标候选：generateGoalCandidate()
   *   4. 目标确认后生成规划：generatePlanningPackage()
   *   5. 规划确认后生成调度建议：generateDispatchProposal()
   *   6. 调度确认后物化 TaskPackage：materializeTaskPackage()
   *
   * 每层都在 HumanConfirm 门禁处等待确认。
   */
  "aics.mainFlow.auto.generatePipeline": ({ params, respond }) => {
    try {
      const owner = stringParam(params, "owner") ?? "迭界AI系统";
      const store = new AicsMainFlowStore();
      const readModel = store.readModel();
      const steps: string[] = [];
      const result: Record<string, unknown> = {};

      const latestObs = readModel.latest.observationPackage;
      const latestGoal = readModel.latest.companyGoal;

      if (!latestObs || !latestGoal) {
        result.ok = false;
        result.error = [
          !latestObs ? "缺少 ObservationPackage" : null,
          !latestGoal ? "缺少已确认的 CompanyGoal" : null,
        ]
          .filter(Boolean)
          .join("；");
        respond(true, result);
        return;
      }

      const compareResult = compareObservationsToGoal({
        observation: latestObs,
        previousGoal: latestGoal,
      });

      if (compareResult.dataInsufficient) {
        // 数据不足：只创建归因报告
        const attrInput = comparatorToAttributionInput(compareResult, latestObs.id);
        store.update((state) => {
          prepareAttribution(state, attrInput);
          return state;
        });
        steps.push(`归因(数据不足): ${compareResult.dataInsufficientReason}`);
      } else {
        // 在一个 update 中完成完整的五层管道
        store.update((state) => {
          // 1. 归因
          const attrInput = comparatorToAttributionInput(compareResult, latestObs.id);
          prepareAttribution(state, attrInput);
          const attrReport = state.attributions.at(-1);
          steps.push(`归因: ${attrInput.title}`);

          if (!attrReport) return state;

          // 2. 目标候选（观察+归因 → CompanyGoal）
          const goalCandidate = generateGoalCandidate({
            attributionResult: compareResult,
            attributionReportId: attrReport.id,
            observationPackageId: latestObs.id,
            owner,
          });
          createGoalCandidate(state, goalCandidate);
          const newGoal = state.goals.at(-1);
          steps.push(`目标候选: ${newGoal?.title ?? "(无)"}`);

          if (!newGoal) return state;

          // 3. 确认目标
          confirmGoal(state, newGoal.id);
          const confirmedGoal = state.goals.find((g) => g.id === newGoal.id);
          if (!confirmedGoal || confirmedGoal.status !== "confirmed") return state;

          // 4. 规划
          const planningResult = generatePlanningPackage({
            goal: confirmedGoal,
            attributionReport: attrReport,
            observationPackage: latestObs,
          });
          preparePlanning(state, planningResult.planning);
          const planning = state.planningPackages.at(-1);
          steps.push(
            `规划: ${planning?.title ?? "(无)"} (${planningResult.rolePlanItems.length} 项)`,
          );

          if (!planning) return state;

          // 5. 确认规划
          confirmPlanning(state, planning.id);
          const confirmedPlanning = state.planningPackages.find(
            (p) => p.id === planning.id && p.status === "confirmed",
          );
          if (!confirmedPlanning) return state;

          // 6. 调度建议 + 确认 + 物化
          const dispatchResults = generateDispatchProposal({
            planningPackage: confirmedPlanning,
            rolePlanItems: planningResult.rolePlanItems,
          });

          for (const { proposal } of dispatchResults) {
            createDispatchProposal(state, proposal);
            const dispatch = state.dispatchProposalReviews.at(-1);
            if (dispatch) {
              confirmDispatch(state, dispatch.id);
              const confirmedDispatch = state.dispatchProposalReviews.find(
                (d) => d.id === dispatch.id && d.status === "confirmed",
              );
              if (confirmedDispatch) {
                const materialized = materializeFromDispatch({
                  dispatchProposal: confirmedDispatch,
                  rolePlanItem:
                    planningResult.rolePlanItems.find(
                      (item) => item.id === proposal.rolePlanItemId,
                    ) ?? planningResult.rolePlanItems[0],
                });
                materializeTaskPackage(state, materialized);
              }
            }
          }
          steps.push(`调度: ${dispatchResults.length} 个 TaskPackage 已物化`);

          return state;
        });
      }

      result.steps = steps;
      result.readModel = store.readModel();
      result.ok = true;
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
};
