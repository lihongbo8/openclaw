import fs from "node:fs/promises";
import path from "node:path";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { canExecRequestNode } from "../../agents/exec-defaults.js";
import { createCloudMarketplaceProjection } from "../../aics-main-flow/cloud-marketplace-projection.js";
import {
  listCategoryCapabilityReviews,
  startToolSkillReview,
  syncCategoryCapabilityReviewToCloud,
} from "../../aics-main-flow/role-pre-listing-review.js";
import {
  AicsMainFlowStore,
  setUniqueCapabilityApprovalForDispatch,
} from "../../aics-main-flow/store.js";
import {
  createToolSkillDevelopmentEngine,
  type ToolSkillDevelopmentRequest,
} from "../../aics-main-flow/tool-skill-development-engine.js";
import { createApiConnectionsReadModel } from "../../api-connections/model.js";
import {
  readConfigFileSnapshotForWrite,
  validateConfigObjectWithPlugins,
} from "../../config/config.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type {
  ToolSupplyBinding,
  ToolSupplyBindingTargetKind,
  ToolSupplyCategory,
  ToolSupplyGrant,
  ToolSupplyGrantStatus,
  ToolSupplyUniqueCapabilityRequest,
} from "../../config/types.tool-supply.js";
import {
  applyPluginUninstallDirectoryRemoval,
  planPluginUninstall,
} from "../../plugins/uninstall.js";
import { updateSkillConfigEntry } from "../../skills/config/mutations.js";
import { buildWorkspaceSkillStatus } from "../../skills/discovery/status.js";
import { getRemoteSkillEligibility } from "../../skills/runtime/remote.js";
import { createToolSupplyControlReadModel } from "../../tool-supply-control/model.js";
import { aicsCloudConfig } from "./aics-role-pre-listing-review.js";
import { commitGatewayConfigWrite } from "./config-write-flow.js";
import { buildToolsCatalogResult } from "./tools-catalog.js";
import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";

const GRANT_STATUSES = new Set<ToolSupplyGrantStatus>(["approved", "blocked", "pending_review"]);

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayParam(params: Record<string, unknown>, key: string): string[] | undefined {
  const value = params[key];
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = stringParam(params, key);
  if (!value) {
    throw new Error(`missing required string param: ${key}`);
  }
  return value;
}

function normalizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function validateNextConfig(config: OpenClawConfig): OpenClawConfig {
  const validated = validateConfigObjectWithPlugins(config);
  if (!validated.ok) {
    const message = validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(message || "invalid config");
  }
  return validated.config;
}

function buildSkillsReport(config: OpenClawConfig, agentId: string) {
  const workspaceDir = resolveAgentWorkspaceDir(config, agentId);
  return buildWorkspaceSkillStatus(workspaceDir, {
    config,
    agentId,
    eligibility: {
      remote: getRemoteSkillEligibility({
        advertiseExecNode: canExecRequestNode({ cfg: config, agentId }),
      }),
    },
  });
}

function buildToolSkillDevelopmentEvidence(
  config: OpenClawConfig,
  params: Record<string, unknown>,
) {
  const agentId = stringParam(params, "agentId") ?? resolveDefaultAgentId(config);
  return {
    skillsReport: buildSkillsReport(config, agentId),
    apiConnections: createApiConnectionsReadModel(config),
  };
}

function toolSkillDevelopmentRequestFromParams(
  params: Record<string, unknown>,
  config?: OpenClawConfig,
): ToolSkillDevelopmentRequest {
  const assetType = requireString(params, "assetType");
  if (assetType !== "tool" && assetType !== "skill") {
    throw new Error("assetType must be tool or skill");
  }
  const source = stringParam(params, "source");
  const version = stringParam(params, "version");
  const taskId = stringParam(params, "taskId");
  const selectedSource = stringParam(params, "selectedSource");
  const declaredCapabilities = stringArrayParam(params, "declaredCapabilities");
  return {
    assetType,
    assetId: requireString(params, "assetId"),
    ...(taskId ? { taskId } : {}),
    ...(source ? { source } : {}),
    ...(version ? { version } : {}),
    ...(selectedSource ? { selectedSource } : {}),
    ...(declaredCapabilities ? { declaredCapabilities } : {}),
    ...(config ? { evidence: buildToolSkillDevelopmentEvidence(config, params) } : {}),
  };
}

function splitCapabilityProductionRequirements(requirements: string[]) {
  return {
    toolRequirements: requirements.filter(
      (item) => item.startsWith("tool.") || item.startsWith("adapter."),
    ),
    skillRequirements: requirements.filter((item) => item.startsWith("skill.")),
    providerRequirements: requirements.filter((item) => item.startsWith("provider.")),
  };
}

function humanConfirmationRulesForCategory(params: {
  requiredCapabilities: string[];
  riskBoundaries: string[];
}): string[] {
  const rules = new Set<string>();
  if (params.requiredCapabilities.some((capability) => capability === "human.confirm")) {
    rules.add("包含 human.confirm 能力，执行前必须有人审确认。");
  }
  for (const boundary of params.riskBoundaries) {
    if (/人工|确认|审核|红线|不得|禁止|风险/u.test(boundary)) {
      rules.add(boundary);
    }
  }
  if (rules.size === 0) {
    rules.add("普通执行可自动预检；高风险动作仍需按岗位风险边界人工确认。");
  }
  return [...rules];
}

function acceptanceCriteriaForCategory(params: {
  assetId: string;
  categoryName?: string;
  requiredCapabilities: string[];
}): string[] {
  return [
    `${params.assetId} 已创建、安装或接入，并能被本地 OpenClaw 读取。`,
    `覆盖品类能力：${params.requiredCapabilities.join("、") || params.categoryName || "当前品类能力"}`,
    "检查通过后由系统开发者在工具与 Skill 模块确认，正式品类激活时可被引用。",
  ];
}

function buildReadModel(config: OpenClawConfig, params: Record<string, unknown> = {}) {
  const agentId = stringParam(params, "agentId") ?? resolveDefaultAgentId(config);
  const toolsCatalogResult = buildToolsCatalogResult({
    cfg: config,
    agentId,
    // Local role-marketplace production must not block the Tool & Skill page on
    // plugin tool registry loading. Plugin tooling can be refreshed through the
    // dedicated tools catalog path; category production todos remain available here.
    includePlugins: false,
  });
  const skillsReport = buildSkillsReport(config, agentId);
  const apiConnections = createApiConnectionsReadModel(config);
  const developmentEngine = createToolSkillDevelopmentEngine();
  const mainFlow = new AicsMainFlowStore().readModel();
  const categoryCapabilityReviews = listCategoryCapabilityReviews();
  return createToolSupplyControlReadModel({
    config,
    toolsCatalogResult,
    skillsReport,
    apiConnections,
    cloudMarketplace: createCloudMarketplaceProjection(mainFlow),
    systemDevelopmentTodos: developmentEngine.listTasks().map((task) => {
      const development = developmentEngine.getStatus({
        taskId: task.id,
        assetType: task.assetType,
        assetId: task.assetId,
        declaredCapabilities: task.requiredCapabilities,
        evidence: { skillsReport, apiConnections },
      });
      const review = development.review;
      const categoryReview = categoryCapabilityReviews.find(
        (candidate) => candidate.id === task.categoryCapabilityReviewId,
      );
      const requirements = splitCapabilityProductionRequirements(
        categoryReview?.toolSkillRequirements ?? [task.assetId],
      );
      const requiredCapabilities =
        categoryReview?.requiredCapabilities ?? task.requiredCapabilities;
      const riskBoundaries = categoryReview?.riskBoundaries ?? task.riskBoundaries;
      const nextAction = development.nextActions[0] ?? {
        label: development.userStatusLabel,
        reason: development.runtime.summary,
      };
      return {
        id: task.id,
        assetType: task.assetType,
        assetId: task.assetId,
        source: review?.source ?? task.selectedSource ?? task.sourceRoute,
        development,
        linkedReviewId: review?.id ?? task.linkedReviewId,
        sourceRolePackageId: categoryReview?.rolePackageId,
        sourceListingDraftId: categoryReview?.listingDraftId,
        sourceRequestId: categoryReview?.requestId,
        categoryCapabilityReviewId: task.categoryCapabilityReviewId,
        targetCategoryRef: task.targetCategoryRef || categoryReview?.categoryRef,
        targetCategoryName: task.targetCategoryName || categoryReview?.categoryName,
        declaredCapabilities: development.declaredCapabilities,
        requiredCapabilities,
        ...requirements,
        humanConfirmationRules: humanConfirmationRulesForCategory({
          requiredCapabilities,
          riskBoundaries,
        }),
        riskBoundaries,
        acceptanceCriteria: acceptanceCriteriaForCategory({
          assetId: task.assetId,
          categoryName: categoryReview?.categoryName,
          requiredCapabilities,
        }),
        riskLevel: review?.riskLevel ?? "unknown",
        reviewStatus: review?.reviewStatus ?? development.userStatusLabel,
        reviewDecision: review?.reviewDecision ?? task.blockedReason,
        reviewFindings: (review?.reviewFindings ?? []).map((finding) => ({
          section: finding.section,
          severity: finding.severity,
          message: finding.message,
        })),
        nextAction: {
          label: nextAction.label,
          reason: nextAction.reason,
        },
      };
    }),
  });
}

function ensureToolSupply(config: OpenClawConfig): OpenClawConfig {
  return {
    ...config,
    toolSupply: {
      categories: { ...(config.toolSupply?.categories ?? {}) },
      grants: { ...(config.toolSupply?.grants ?? {}) },
      uniqueCapabilityRequests: { ...(config.toolSupply?.uniqueCapabilityRequests ?? {}) },
      bindings: { ...(config.toolSupply?.bindings ?? {}) },
    },
  };
}

function isPathInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function removeToolSupplyBindings(
  config: OpenClawConfig,
  predicate: (binding: ToolSupplyBinding) => boolean,
): OpenClawConfig {
  const next = ensureToolSupply(config);
  for (const [id, binding] of Object.entries(next.toolSupply?.bindings ?? {})) {
    if (predicate(binding)) {
      delete next.toolSupply!.bindings![id];
    }
  }
  return next;
}

async function writeConfig(
  opts: GatewayRequestHandlerOptions,
  mutate: (config: OpenClawConfig) => { config: OpenClawConfig; changedPaths?: string[] },
  afterCommit?: () => void,
) {
  const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
  const mutated = mutate(snapshot.config);
  const nextConfig = validateNextConfig(mutated.config);
  const writeResult = await commitGatewayConfigWrite({
    snapshot,
    writeOptions,
    nextConfig,
    context: opts.context,
    disconnectSharedAuthClients: false,
  });
  afterCommit?.();
  opts.respond(true, {
    ok: true,
    changedPaths: mutated.changedPaths ?? [],
    readModel: buildReadModel(writeResult.config, paramsRecord(opts.req.params)),
  });
  writeResult.queueFollowUp();
}

function uniqueCapabilityRequestIdFromGrant(grant: ToolSupplyGrant): string | null {
  for (const value of [grant.capabilityRef, grant.targetId]) {
    if (!value?.startsWith("unique:")) continue;
    const requestId = value.slice("unique:".length).trim();
    if (requestId) return requestId;
  }
  return null;
}

function syncUniqueCapabilityGrantToMainFlow(grant: ToolSupplyGrant): void {
  const capabilityRequestId = uniqueCapabilityRequestIdFromGrant(grant);
  if (!capabilityRequestId) return;
  try {
    new AicsMainFlowStore().update((state) =>
      setUniqueCapabilityApprovalForDispatch(state, {
        capabilityRequestId,
        status: grant.status,
      }),
    );
  } catch {
    /* Tool supply grants remain valid even if no local main-flow dispatch exists yet. */
  }
}

function startToolSkillReviewFromGrant(grant: ToolSupplyGrant): void {
  if (grant.targetKind !== "tool" && grant.targetKind !== "skill") return;
  startToolSkillReview({
    assetType: grant.targetKind,
    assetId: grant.targetId || grant.capabilityRef,
    source: "platform",
    declaredCapabilities: [grant.capabilityRef],
  });
}

function categoryFromParams(params: Record<string, unknown>): ToolSupplyCategory {
  const name = requireString(params, "name");
  const now = new Date().toISOString();
  const id = stringParam(params, "id") ?? `cloud:category:${normalizeId(name)}`;
  return {
    id,
    name,
    source: "cloud",
    status: "active",
    createdAt: stringParam(params, "createdAt") ?? now,
    updatedAt: now,
  };
}

function grantFromParams(params: Record<string, unknown>): ToolSupplyGrant {
  const capabilityRef = requireString(params, "capabilityRef");
  const status = stringParam(params, "status");
  if (!status || !GRANT_STATUSES.has(status as ToolSupplyGrantStatus)) {
    throw new Error("missing or invalid grant status");
  }
  const targetKind = stringParam(params, "targetKind");
  const now = new Date().toISOString();
  return {
    id: stringParam(params, "id") ?? `grant:${normalizeId(capabilityRef)}`,
    capabilityRef,
    ...(targetKind === "tool" ||
    targetKind === "skill" ||
    targetKind === "api" ||
    targetKind === "cloud_capability"
      ? { targetKind }
      : {}),
    ...(stringParam(params, "targetId") ? { targetId: stringParam(params, "targetId") } : {}),
    status: status as ToolSupplyGrantStatus,
    ...(stringParam(params, "reason") ? { reason: stringParam(params, "reason") } : {}),
    updatedAt: now,
  };
}

function uniqueRequestFromParams(
  params: Record<string, unknown>,
): ToolSupplyUniqueCapabilityRequest {
  const title = requireString(params, "title");
  const capabilityRef = requireString(params, "capabilityRef");
  const now = new Date().toISOString();
  return {
    id: stringParam(params, "id") ?? `unique:${normalizeId(capabilityRef)}:${Date.now()}`,
    title,
    capabilityRef,
    ...(stringParam(params, "category") ? { category: stringParam(params, "category") } : {}),
    ...(stringParam(params, "reason") ? { reason: stringParam(params, "reason") } : {}),
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

function bindingFromParams(params: Record<string, unknown>): ToolSupplyBinding {
  const sourceItemId = requireString(params, "sourceItemId");
  const sourceKind = stringParam(params, "sourceKind");
  if (sourceKind !== "tool" && sourceKind !== "skill") {
    throw new Error("missing or invalid sourceKind");
  }
  const targetKind = stringParam(params, "targetKind");
  if (targetKind !== "category_capability" && targetKind !== "role_dispatch") {
    throw new Error("missing or invalid targetKind");
  }
  const targetId = requireString(params, "targetId");
  const status = stringParam(params, "status") ?? "active";
  if (status !== "active" && status !== "paused") {
    throw new Error("missing or invalid binding status");
  }
  const syncStatus = stringParam(params, "syncStatus");
  if (
    syncStatus &&
    syncStatus !== "local" &&
    syncStatus !== "syncing" &&
    syncStatus !== "synced" &&
    syncStatus !== "sync_failed"
  ) {
    throw new Error("missing or invalid syncStatus");
  }
  const now = new Date().toISOString();
  return {
    id:
      stringParam(params, "id") ??
      `binding:${normalizeId(sourceItemId)}:${normalizeId(targetKind)}:${normalizeId(targetId)}`,
    sourceItemId,
    sourceKind,
    targetKind: targetKind as ToolSupplyBindingTargetKind,
    targetId,
    ...(stringParam(params, "targetTitle")
      ? { targetTitle: stringParam(params, "targetTitle") }
      : {}),
    status,
    syncStatus: (syncStatus as ToolSupplyBinding["syncStatus"]) ?? "local",
    ...(stringParam(params, "note") ? { note: stringParam(params, "note") } : {}),
    createdAt: stringParam(params, "createdAt") ?? now,
    updatedAt: now,
  };
}

export const aicsToolSupplyHandlers: GatewayRequestHandlers = {
  "aics.toolSupply.categories.sync": async (opts) => {
    try {
      await writeConfig(opts, (config) => {
        const next = ensureToolSupply(config);
        const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
        const now = new Date().toISOString();
        for (const capability of projection.capabilities.categoryCommon) {
          const id = `cloud:${capability.id}`;
          next.toolSupply!.categories![id] = {
            id,
            name: capability.category || capability.label,
            source: "cloud",
            status: capability.approvalStatus === "approved" ? "active" : "pending",
            updatedAt: now,
          };
        }
        for (const category of projection.marketplace.categories) {
          const id = category.id.startsWith("cloud:") ? category.id : `cloud:${category.id}`;
          next.toolSupply!.categories![id] = {
            id,
            name: category.label,
            source: "cloud",
            status: "active",
            listingCount: category.listingCount,
            updatedAt: now,
          };
        }
        return { config: next, changedPaths: ["toolSupply.categories"] };
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "category sync failed",
        ),
      );
    }
  },

  "aics.toolSupply.category.create": async (opts) => {
    try {
      const category = categoryFromParams(paramsRecord(opts.req.params));
      await writeConfig(opts, (config) => {
        const next = ensureToolSupply(config);
        next.toolSupply!.categories![category.id] = category;
        return { config: next, changedPaths: [`toolSupply.categories.${category.id}`] };
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "category create failed",
        ),
      );
    }
  },

  "aics.toolSupply.readModel.get": async ({ params, context, respond }) => {
    try {
      respond(true, buildReadModel(context.getRuntimeConfig(), paramsRecord(params)));
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : "read failed"),
      );
    }
  },

  "aics.toolSkillDevelopment.status.get": async ({ params, context, respond }) => {
    try {
      const request = toolSkillDevelopmentRequestFromParams(
        paramsRecord(params),
        context.getRuntimeConfig(),
      );
      respond(true, {
        development: createToolSkillDevelopmentEngine().getStatus(request),
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "tool skill development status failed",
        ),
      );
    }
  },

  "aics.toolSkillDevelopment.prepareReview": async ({ params, context, respond }) => {
    try {
      const request = toolSkillDevelopmentRequestFromParams(
        paramsRecord(params),
        context.getRuntimeConfig(),
      );
      respond(true, {
        development: createToolSkillDevelopmentEngine().prepareReview(request),
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "tool skill development prepare failed",
        ),
      );
    }
  },

  "aics.toolSkillDevelopment.source.plan": async ({ params, context, respond }) => {
    try {
      const request = toolSkillDevelopmentRequestFromParams(
        paramsRecord(params),
        context.getRuntimeConfig(),
      );
      respond(true, {
        development: createToolSkillDevelopmentEngine().planSource(request),
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "tool skill development source plan failed",
        ),
      );
    }
  },

  "aics.toolSkillDevelopment.source.select": async ({ params, context, respond }) => {
    try {
      const request = toolSkillDevelopmentRequestFromParams(
        paramsRecord(params),
        context.getRuntimeConfig(),
      );
      respond(true, {
        development: createToolSkillDevelopmentEngine().selectSource(request),
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "tool skill development source select failed",
        ),
      );
    }
  },

  "aics.toolSkillDevelopment.runtime.markReady": async ({ params, context, respond }) => {
    try {
      const request = toolSkillDevelopmentRequestFromParams(
        paramsRecord(params),
        context.getRuntimeConfig(),
      );
      respond(true, {
        development: createToolSkillDevelopmentEngine().markRuntimeReady(request),
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "tool skill development runtime ready failed",
        ),
      );
    }
  },

  "aics.toolSkillDevelopment.runValidation": async ({ params, context, respond }) => {
    try {
      const request = toolSkillDevelopmentRequestFromParams(
        paramsRecord(params),
        context.getRuntimeConfig(),
      );
      respond(true, {
        development: createToolSkillDevelopmentEngine().runValidation(request),
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "tool skill development validation failed",
        ),
      );
    }
  },

  "aics.toolSupply.grant.set": async (opts) => {
    try {
      const grant = grantFromParams(paramsRecord(opts.req.params));
      await writeConfig(
        opts,
        (config) => {
          const next = ensureToolSupply(config);
          next.toolSupply!.grants![grant.id] = grant;
          return { config: next, changedPaths: [`toolSupply.grants.${grant.id}`] };
        },
        () => {
          syncUniqueCapabilityGrantToMainFlow(grant);
          startToolSkillReviewFromGrant(grant);
        },
      );
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : "grant failed"),
      );
    }
  },

  "aics.toolSupply.skill.setEnabled": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const skillKey = requireString(params, "skillKey");
      const enabled = booleanParam(params, "enabled");
      if (typeof enabled !== "boolean") {
        throw new Error("missing required boolean param: enabled");
      }
      await updateSkillConfigEntry({ skillKey, enabled });
      if (enabled) {
        startToolSkillReview({
          assetType: "skill",
          assetId: skillKey,
          source: "platform",
          declaredCapabilities: [skillKey],
        });
      }
      opts.respond(true, { ok: true });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "skill update failed",
        ),
      );
    }
  },

  "aics.toolSupply.skill.uninstall": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const skillKey = requireString(params, "skillKey");
      const agentId =
        stringParam(params, "agentId") ?? resolveDefaultAgentId(opts.context.getRuntimeConfig());
      const report = buildSkillsReport(opts.context.getRuntimeConfig(), agentId);
      const skill = report.skills.find((entry) => entry.skillKey === skillKey);
      if (!skill) {
        throw new Error(`skill not found: ${skillKey}`);
      }
      if (skill.bundled) {
        throw new Error("bundled skill cannot be uninstalled");
      }
      const skillDir = path.resolve(skill.baseDir);
      const managedDir = path.resolve(report.managedSkillsDir);
      if (skillDir === managedDir || !isPathInsideOrEqual(managedDir, skillDir)) {
        throw new Error("skill is not in the managed skills directory");
      }
      await fs.rm(skillDir, { recursive: true, force: true });
      await writeConfig(opts, (config) => {
        const next = removeToolSupplyBindings(
          config,
          (binding) =>
            binding.sourceKind === "skill" && binding.sourceItemId === `skill:${skillKey}`,
        );
        return { config: next, changedPaths: ["toolSupply.bindings"] };
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "skill uninstall failed",
        ),
      );
    }
  },

  "aics.toolSupply.plugin.setEnabled": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const pluginId = requireString(params, "pluginId");
      const enabled = booleanParam(params, "enabled");
      if (typeof enabled !== "boolean") {
        throw new Error("missing required boolean param: enabled");
      }
      await writeConfig(
        opts,
        (config) => {
          const next: OpenClawConfig = {
            ...config,
            plugins: {
              ...config.plugins,
              entries: {
                ...(config.plugins?.entries ?? {}),
                [pluginId]: {
                  ...(config.plugins?.entries?.[pluginId] ?? {}),
                  enabled,
                },
              },
            },
          };
          return { config: next, changedPaths: [`plugins.entries.${pluginId}.enabled`] };
        },
        () => {
          if (enabled) {
            startToolSkillReview({
              assetType: "tool",
              assetId: pluginId,
              source: "platform",
              declaredCapabilities: [pluginId],
            });
          }
        },
      );
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "plugin update failed",
        ),
      );
    }
  },

  "aics.toolSupply.plugin.uninstall": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const pluginId = requireString(params, "pluginId");
      const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
      const plan = planPluginUninstall({
        config: snapshot.config,
        pluginId,
        deleteFiles: true,
      });
      if (!plan.ok) {
        throw new Error(plan.error);
      }
      const nextConfig = validateNextConfig(
        removeToolSupplyBindings(
          plan.config,
          (binding) =>
            binding.sourceKind === "tool" && binding.sourceItemId.startsWith(`plugin:${pluginId}:`),
        ),
      );
      const writeResult = await commitGatewayConfigWrite({
        snapshot,
        writeOptions,
        nextConfig,
        context: opts.context,
        disconnectSharedAuthClients: false,
      });
      const removal = await applyPluginUninstallDirectoryRemoval(plan.directoryRemoval);
      opts.respond(true, {
        ok: true,
        pluginId,
        actions: { ...plan.actions, directory: removal.directoryRemoved },
        warnings: removal.warnings,
        readModel: buildReadModel(writeResult.config, paramsRecord(opts.req.params)),
      });
      writeResult.queueFollowUp();
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "plugin uninstall failed",
        ),
      );
    }
  },

  "aics.toolSupply.uniqueCapabilityRequest.prepare": async (opts) => {
    try {
      const request = uniqueRequestFromParams(paramsRecord(opts.req.params));
      await writeConfig(opts, (config) => {
        const next = ensureToolSupply(config);
        next.toolSupply!.uniqueCapabilityRequests![request.id] = request;
        return {
          config: next,
          changedPaths: [`toolSupply.uniqueCapabilityRequests.${request.id}`],
        };
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "unique capability request failed",
        ),
      );
    }
  },

  "aics.toolSupply.binding.set": async (opts) => {
    try {
      const binding = bindingFromParams(paramsRecord(opts.req.params));
      await writeConfig(opts, (config) => {
        const next = ensureToolSupply(config);
        next.toolSupply!.bindings![binding.id] = binding;
        return { config: next, changedPaths: [`toolSupply.bindings.${binding.id}`] };
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "binding failed",
        ),
      );
    }
  },

  "aics.toolSupply.binding.remove": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const id = requireString(params, "id");
      await writeConfig(opts, (config) => {
        const next = ensureToolSupply(config);
        delete next.toolSupply!.bindings![id];
        return { config: next, changedPaths: [`toolSupply.bindings.${id}`] };
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "binding remove failed",
        ),
      );
    }
  },

  "aics.toolSupply.binding.sync": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const id = requireString(params, "id");
      const syncStatus = stringParam(params, "syncStatus") ?? "synced";
      if (syncStatus !== "synced" && syncStatus !== "syncing" && syncStatus !== "sync_failed") {
        throw new Error("missing or invalid syncStatus");
      }
      await writeConfig(opts, (config) => {
        const next = ensureToolSupply(config);
        const current = next.toolSupply!.bindings![id];
        if (!current) throw new Error("binding not found");
        next.toolSupply!.bindings![id] = {
          ...current,
          syncStatus,
          updatedAt: new Date().toISOString(),
        };
        return { config: next, changedPaths: [`toolSupply.bindings.${id}.syncStatus`] };
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "binding sync failed",
        ),
      );
    }
  },

  "aics.toolSupply.categoryCapability.activateReadyPackage": async ({
    params,
    context,
    respond,
  }) => {
    try {
      const reviewId = requireString(paramsRecord(params), "categoryCapabilityReviewId");
      const cloud = await aicsCloudConfig(context.getRuntimeConfig());
      const result = await syncCategoryCapabilityReviewToCloud(reviewId, cloud);
      respond(true, result);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "category capability activation failed",
        ),
      );
    }
  },
};
