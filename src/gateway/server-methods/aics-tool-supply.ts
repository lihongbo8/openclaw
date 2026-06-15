import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { canExecRequestNode } from "../../agents/exec-defaults.js";
import { createCloudMarketplaceProjection } from "../../aics-main-flow/cloud-marketplace-projection.js";
import { AicsMainFlowStore } from "../../aics-main-flow/store.js";
import { createApiConnectionsReadModel } from "../../api-connections/model.js";
import {
  readConfigFileSnapshotForWrite,
  validateConfigObjectWithPlugins,
} from "../../config/config.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type {
  ToolSupplyGrant,
  ToolSupplyGrantStatus,
  ToolSupplyUniqueCapabilityRequest,
} from "../../config/types.tool-supply.js";
import { updateSkillConfigEntry } from "../../skills/config/mutations.js";
import { buildWorkspaceSkillStatus } from "../../skills/discovery/status.js";
import { getRemoteSkillEligibility } from "../../skills/runtime/remote.js";
import { createToolSupplyControlReadModel } from "../../tool-supply-control/model.js";
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

function buildReadModel(config: OpenClawConfig, params: Record<string, unknown> = {}) {
  const agentId = stringParam(params, "agentId") ?? resolveDefaultAgentId(config);
  const toolsCatalogResult = buildToolsCatalogResult({
    cfg: config,
    agentId,
    includePlugins: true,
  });
  const skillsReport = buildSkillsReport(config, agentId);
  const mainFlow = new AicsMainFlowStore().readModel();
  return createToolSupplyControlReadModel({
    config,
    toolsCatalogResult,
    skillsReport,
    apiConnections: createApiConnectionsReadModel(config),
    cloudMarketplace: createCloudMarketplaceProjection(mainFlow),
  });
}

function ensureToolSupply(config: OpenClawConfig): OpenClawConfig {
  return {
    ...config,
    toolSupply: {
      grants: { ...(config.toolSupply?.grants ?? {}) },
      uniqueCapabilityRequests: { ...(config.toolSupply?.uniqueCapabilityRequests ?? {}) },
    },
  };
}

async function writeConfig(
  opts: GatewayRequestHandlerOptions,
  mutate: (config: OpenClawConfig) => { config: OpenClawConfig; changedPaths?: string[] },
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
  opts.respond(true, {
    ok: true,
    changedPaths: mutated.changedPaths ?? [],
    readModel: buildReadModel(writeResult.config, paramsRecord(opts.req.params)),
  });
  writeResult.queueFollowUp();
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

export const aicsToolSupplyHandlers: GatewayRequestHandlers = {
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

  "aics.toolSupply.grant.set": async (opts) => {
    try {
      const grant = grantFromParams(paramsRecord(opts.req.params));
      await writeConfig(opts, (config) => {
        const next = ensureToolSupply(config);
        next.toolSupply!.grants![grant.id] = grant;
        return { config: next, changedPaths: [`toolSupply.grants.${grant.id}`] };
      });
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

  "aics.toolSupply.plugin.setEnabled": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const pluginId = requireString(params, "pluginId");
      const enabled = booleanParam(params, "enabled");
      if (typeof enabled !== "boolean") {
        throw new Error("missing required boolean param: enabled");
      }
      await writeConfig(opts, (config) => {
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
      });
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
};
