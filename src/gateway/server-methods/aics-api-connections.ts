import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  bindApiConnectionConfigPath,
  materializeApiConnectionToConfig,
} from "../../api-connections/materializer.js";
import {
  createApiConnectionsReadModel,
  normalizeApiConnectionEntry,
} from "../../api-connections/model.js";
import {
  readConfigFileSnapshotForWrite,
  validateConfigObjectWithPlugins,
} from "../../config/config.js";
import type {
  ApiConnectionConsumer,
  ApiConnectionEntry,
  ApiConnectionKind,
} from "../../config/types.api-connections.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { SecretInput } from "../../config/types.secrets.js";
import { commitGatewayConfigWrite } from "./config-write-flow.js";
import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";

const API_CONNECTION_KINDS = new Set<ApiConnectionKind>([
  "model",
  "tool_skill",
  "marketplace",
  "dialog",
  "custom",
]);
const API_CONNECTION_CONSUMERS = new Set<ApiConnectionConsumer>([
  "marketplace",
  "dispatch",
  "main_chat",
  "tool",
  "skill",
  "voice",
  "image",
  "model",
]);

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = stringParam(params, key);
  if (!value) throw new Error(`missing required string param: ${key}`);
  return value;
}

function kindParam(params: Record<string, unknown>): ApiConnectionKind {
  const value = stringParam(params, "kind");
  if (!value || !API_CONNECTION_KINDS.has(value as ApiConnectionKind)) {
    throw new Error("missing or invalid API connection kind");
  }
  return value as ApiConnectionKind;
}

function consumersParam(params: Record<string, unknown>): ApiConnectionConsumer[] {
  const value = params.consumers;
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (entry): entry is ApiConnectionConsumer =>
          typeof entry === "string" && API_CONNECTION_CONSUMERS.has(entry as ApiConnectionConsumer),
      ),
    ),
  );
}

function requestedScopeParam(params: Record<string, unknown>): string[] {
  const value = params.requestedScope;
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value.filter(
            (entry): entry is string => typeof entry === "string" && Boolean(entry.trim()),
          ),
        ),
      )
    : [];
}

function secretParam(params: Record<string, unknown>): SecretInput | undefined {
  const value = params.secret;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (
      (record.source === "env" || record.source === "file" || record.source === "exec") &&
      typeof record.provider === "string" &&
      typeof record.id === "string"
    ) {
      return { source: record.source, provider: record.provider, id: record.id };
    }
  }
  const envId = stringParam(params, "secretEnvId");
  if (envId) {
    return { source: "env", provider: "default", id: envId };
  }
  return undefined;
}

function bindingsParam(params: Record<string, unknown>) {
  const bindingPath = stringParam(params, "bindingPath") ?? stringParam(params, "configPath");
  const raw = params.configBindings;
  const bindings = Array.isArray(raw)
    ? raw.flatMap((entry) => {
        if (typeof entry === "string" && entry.trim())
          return [{ path: entry.trim(), owner: "apiConnections" as const }];
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          const path = stringParam(entry as Record<string, unknown>, "path");
          return path ? [{ path, owner: "apiConnections" as const }] : [];
        }
        return [];
      })
    : [];
  return bindingPath
    ? [...bindings, { path: bindingPath, owner: "apiConnections" as const }]
    : bindings;
}

function metadataParam(params: Record<string, unknown>): Record<string, unknown> | undefined {
  const value = params.metadata;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function ensureApiConnections(config: OpenClawConfig): OpenClawConfig {
  return {
    ...config,
    apiConnections: {
      entries: { ...(config.apiConnections?.entries ?? {}) },
    },
  };
}

function validateNextConfig(config: OpenClawConfig): OpenClawConfig {
  const validated = validateConfigObjectWithPlugins(config);
  if (!validated.ok) {
    const message = validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(message || "invalid config");
  }
  return validated.config;
}

async function writeConfig(
  opts: GatewayRequestHandlerOptions,
  mutate: (config: OpenClawConfig) => { config: OpenClawConfig; changedPaths?: string[] },
  options: { allowConfigSizeDrop?: boolean } = {},
) {
  const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
  const mutated = mutate(snapshot.config);
  const nextConfig = validateNextConfig(mutated.config);
  const writeResult = await commitGatewayConfigWrite({
    snapshot,
    writeOptions: {
      ...writeOptions,
      allowConfigSizeDrop: options.allowConfigSizeDrop === true || writeOptions.allowConfigSizeDrop,
    },
    nextConfig,
    context: opts.context,
    disconnectSharedAuthClients: false,
  });
  const readModel = createApiConnectionsReadModel(writeResult.config);
  opts.respond(true, {
    ok: true,
    changedPaths: mutated.changedPaths ?? [],
    readModel,
  });
  writeResult.queueFollowUp();
}

function createEntryFromParams(params: Record<string, unknown>): ApiConnectionEntry {
  const authMode = stringParam(params, "authMode");
  return normalizeApiConnectionEntry({
    id: stringParam(params, "id"),
    name: requireString(params, "name"),
    kind: kindParam(params),
    provider: requireString(params, "provider"),
    baseUrl: stringParam(params, "baseUrl"),
    endpoint: stringParam(params, "endpoint"),
    authMode:
      authMode === "plaintext" ||
      authMode === "none" ||
      authMode === "oauth" ||
      authMode === "secret_ref"
        ? authMode
        : undefined,
    secret: secretParam(params),
    consumers: consumersParam(params),
    requestedScope: requestedScopeParam(params),
    configBindings: bindingsParam(params),
    metadata: metadataParam(params),
  });
}

export const aicsApiConnectionsHandlers: GatewayRequestHandlers = {
  "aics.apiConnections.readModel.get": async ({ context, respond }) => {
    respond(true, createApiConnectionsReadModel(context.getRuntimeConfig()));
  },

  "aics.apiConnections.riskReport.get": async ({ context, respond }) => {
    respond(true, createApiConnectionsReadModel(context.getRuntimeConfig()).riskReport);
  },

  "aics.apiConnections.entry.create": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const entry = createEntryFromParams(params);
      await writeConfig(opts, (config) => {
        const next = ensureApiConnections(config);
        next.apiConnections!.entries![entry.id] = entry;
        return { config: next, changedPaths: [`apiConnections.entries.${entry.id}`] };
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "invalid API connection",
        ),
      );
    }
  },

  "aics.apiConnections.entry.update": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const id = requireString(params, "id");
      await writeConfig(opts, (config) => {
        const next = ensureApiConnections(config);
        const previous = next.apiConnections!.entries![id];
        if (!previous) throw new Error(`API connection not found: ${id}`);
        const patch: Partial<ApiConnectionEntry> &
          Pick<ApiConnectionEntry, "name" | "kind" | "provider"> = {
          ...previous,
          ...(stringParam(params, "name") ? { name: stringParam(params, "name")! } : {}),
          kind: (stringParam(params, "kind") as ApiConnectionKind) ?? previous.kind,
          provider: stringParam(params, "provider") ?? previous.provider,
          ...(stringParam(params, "baseUrl") ? { baseUrl: stringParam(params, "baseUrl") } : {}),
          ...(stringParam(params, "endpoint") ? { endpoint: stringParam(params, "endpoint") } : {}),
          ...(params.secret !== undefined || params.secretEnvId !== undefined
            ? { secret: secretParam(params) }
            : {}),
          ...(params.consumers !== undefined ? { consumers: consumersParam(params) } : {}),
          ...(params.requestedScope !== undefined
            ? { requestedScope: requestedScopeParam(params) }
            : {}),
          ...(params.configBindings !== undefined ||
          params.bindingPath !== undefined ||
          params.configPath !== undefined
            ? { configBindings: bindingsParam(params) }
            : {}),
          ...(params.metadata !== undefined ? { metadata: metadataParam(params) } : {}),
        };
        next.apiConnections!.entries![id] = normalizeApiConnectionEntry(patch, previous);
        return { config: next, changedPaths: [`apiConnections.entries.${id}`] };
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "update failed",
        ),
      );
    }
  },

  "aics.apiConnections.entry.delete": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const id = requireString(params, "id");
      await writeConfig(
        opts,
        (config) => {
          const next = ensureApiConnections(config);
          delete next.apiConnections!.entries![id];
          return { config: next, changedPaths: [`apiConnections.entries.${id}`] };
        },
        { allowConfigSizeDrop: true },
      );
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "delete failed",
        ),
      );
    }
  },

  "aics.apiConnections.entry.bindConfigPath": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const id = requireString(params, "id");
      const path = requireString(params, "path");
      await writeConfig(opts, (config) => ({
        config: bindApiConnectionConfigPath(config, id, path),
        changedPaths: [`apiConnections.entries.${id}.configBindings`, path],
      }));
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : "bind failed"),
      );
    }
  },

  "aics.apiConnections.entry.materialize": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const id = stringParam(params, "id");
      await writeConfig(opts, (config) => materializeApiConnectionToConfig(config, id));
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "materialize failed",
        ),
      );
    }
  },
};
