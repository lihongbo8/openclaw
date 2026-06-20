import { isDeepStrictEqual } from "node:util";
import type { ApiConnectionEntry } from "../config/types.api-connections.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { dedupeBindings } from "./model.js";

type MutableRecord = Record<string, unknown>;

function cloneConfig(config: OpenClawConfig): OpenClawConfig {
  return structuredClone(config) as OpenClawConfig;
}

function shouldMaterializeEndpoint(path: string): boolean {
  const key = path.split(".").at(-1)?.toLowerCase() ?? "";
  return key === "baseurl" || key.endsWith("baseurl") || key === "endpoint" || key === "url";
}

function setPath(root: MutableRecord, path: string, value: unknown): void {
  const parts = path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return;
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as MutableRecord;
  }
  cursor[parts.at(-1)!] = value;
}

function deletePath(root: MutableRecord, path: string): boolean {
  const parts = path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  let cursor: unknown = root;
  for (const part of parts.slice(0, -1)) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return false;
    cursor = (cursor as MutableRecord)[part];
  }
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return false;
  const finalKey = parts.at(-1)!;
  if (!Object.prototype.hasOwnProperty.call(cursor, finalKey)) return false;
  delete (cursor as MutableRecord)[finalKey];
  return true;
}

function getPath(root: MutableRecord, path: string): unknown {
  const parts = path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let cursor: unknown = root;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as MutableRecord)[part];
  }
  return cursor;
}

function modelIdsManagedByEntry(entry: ApiConnectionEntry): Set<string> {
  return new Set([
    ...metadataStringArray(entry, "availableModels"),
    ...(metadataString(entry, "defaultModel") ? [metadataString(entry, "defaultModel")!] : []),
  ]);
}

function metadataString(entry: ApiConnectionEntry, key: string): string | undefined {
  const dijie = entry.metadata?.dijie;
  const value =
    dijie && typeof dijie === "object" && !Array.isArray(dijie)
      ? (dijie as Record<string, unknown>)[key]
      : entry.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataStringArray(entry: ApiConnectionEntry, key: string): string[] {
  const value = entry.metadata?.[key];
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item))),
  );
}

function materializeModelProvider(
  root: MutableRecord,
  entry: ApiConnectionEntry,
  changedPaths: string[],
): void {
  const provider = entry.provider.trim();
  if (!provider) return;
  const providerPath = `models.providers.${provider}`;
  const current = getPath(root, providerPath);
  const providerConfig =
    current && typeof current === "object" && !Array.isArray(current)
      ? ({ ...(current as MutableRecord) } as MutableRecord)
      : {};
  const existingModels = Array.isArray(providerConfig.models)
    ? (providerConfig.models as MutableRecord[])
    : [];
  const existingModelIds = new Set(
    existingModels.flatMap((model) => {
      const id = model.id;
      return typeof id === "string" && id.trim() ? [id.trim()] : [];
    }),
  );
  const availableModels = metadataStringArray(entry, "availableModels");
  const defaultModel = metadataString(entry, "defaultModel");
  const modelIds = Array.from(
    new Set([...(defaultModel ? [defaultModel] : []), ...availableModels]),
  );
  const nextModels = [
    ...existingModels,
    ...modelIds
      .filter((id) => !existingModelIds.has(id))
      .map((id) => ({
        id,
        name: id,
        reasoning: /reason|thinking|o[13]/i.test(id),
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
        metadataSource: "models-add",
      })),
  ];
  const auth =
    entry.authMode === "oauth"
      ? "oauth"
      : entry.authMode === "none"
        ? providerConfig.auth
        : "api-key";
  const nextProviderConfig: MutableRecord = {
    ...providerConfig,
    ...(entry.baseUrl || entry.endpoint ? { baseUrl: entry.baseUrl ?? entry.endpoint } : {}),
    models: nextModels,
  };
  if (auth) {
    nextProviderConfig.auth = auth;
  }
  if (entry.authMode === "oauth") {
    delete nextProviderConfig.apiKey;
  } else if (entry.secret !== undefined) {
    nextProviderConfig.apiKey = entry.secret;
  }

  if (!isDeepStrictEqual(providerConfig, nextProviderConfig)) {
    setPath(root, providerPath, nextProviderConfig);
    changedPaths.push(providerPath);
  }
}

function materializeDijieCloudBridge(
  root: MutableRecord,
  entry: ApiConnectionEntry,
  changedPaths: string[],
): void {
  const baseUrl = entry.baseUrl ?? entry.endpoint;
  const bridgeValues: Array<[string, unknown, { preserveExisting?: boolean }?]> = [
    ["plugins.entries.aics.enabled", true],
    ["plugins.entries.aics.config.cloudBaseUrl", baseUrl],
    [
      "plugins.entries.aics.config.cloudHealthPath",
      "/dijie/gateway/health",
      { preserveExisting: true },
    ],
    [
      "plugins.entries.aics.config.cloudApiVariablesSyncPath",
      "/dijie/api-variables/sync",
      { preserveExisting: true },
    ],
    [
      "plugins.entries.aics.config.cloudApiVariablesSyncBearer",
      { source: "env", provider: "default", id: "DIJIE_INTERNAL_BRIDGE_BEARER" },
      { preserveExisting: true },
    ],
    ["plugins.entries.aics.config.cloudAccessToken", entry.secret],
    [
      "plugins.entries.aics.config.cloudExecutionTokenPath",
      "/dijie/execution-token",
      { preserveExisting: true },
    ],
    [
      "plugins.entries.aics.config.cloudExecutionReadPath",
      "/dijie/executions",
      { preserveExisting: true },
    ],
    [
      "plugins.entries.aics.config.cloudMarketplaceInstalledRolesPath",
      "/dijie/my-roles",
      { preserveExisting: true },
    ],
    [
      "plugins.entries.aics.config.cloudAuthorizationPath",
      "/dijie/authorizations",
      { preserveExisting: true },
    ],
    ["plugins.entries.aics.config.cloudAuditPath", "/dijie/audit", { preserveExisting: true }],
    [
      "plugins.entries.aics.config.defaultDeviceId",
      metadataString(entry, "deviceId") ?? "local-admin-device",
      { preserveExisting: true },
    ],
    [
      "plugins.entries.aics.config.defaultWorkspaceRef",
      metadataString(entry, "workspaceRef") ?? "local-admin-workspace",
      { preserveExisting: true },
    ],
    [
      "plugins.entries.aics.config.defaultLocalGatewayId",
      metadataString(entry, "localGatewayId") ?? "openclaw-local-gateway",
      { preserveExisting: true },
    ],
    [
      "plugins.entries.aics.config.defaultRoleListingId",
      metadataString(entry, "roleListingId"),
      { preserveExisting: true },
    ],
    [
      "plugins.entries.aics.config.defaultEntitlementId",
      metadataString(entry, "entitlementId"),
      { preserveExisting: true },
    ],
    ["plugins.entries.aics.config.cloudAuditUploadEnabled", true, { preserveExisting: true }],
    ["plugins.entries.aics.config.cloudAuditUploadRequired", true, { preserveExisting: true }],
  ];

  for (const [path, value, options] of bridgeValues) {
    if (value === undefined) continue;
    if (options?.preserveExisting && getPath(root, path) !== undefined) continue;
    setPath(root, path, value);
    changedPaths.push(path);
  }
}

export function materializeApiConnectionToConfig(
  config: OpenClawConfig,
  entryId?: string,
): { config: OpenClawConfig; changedPaths: string[] } {
  const next = cloneConfig(config);
  const entries = next.apiConnections?.entries ?? {};
  const ids = entryId ? [entryId] : Object.keys(entries);
  const changedPaths: string[] = [];
  const now = new Date().toISOString();

  for (const id of ids) {
    const entry = entries[id];
    if (!entry || entry.enabled === false) continue;
    if (entry.kind === "model") {
      const changedPathCountBefore = changedPaths.length;
      materializeModelProvider(next as unknown as MutableRecord, entry, changedPaths);
      const bindingPath = `models.providers.${entry.provider}`;
      const bindings = dedupeBindings(entry.configBindings);
      const alreadyMaterialized =
        bindings.length === 1 &&
        bindings[0]?.path === bindingPath &&
        bindings[0]?.owner === "apiConnections" &&
        Boolean(bindings[0]?.materializedAt);
      if (changedPaths.length > changedPathCountBefore || !alreadyMaterialized) {
        entries[id] = {
          ...entry,
          configBindings: [
            {
              path: bindingPath,
              owner: "apiConnections",
              materializedAt: now,
            },
          ],
          updatedAt: now,
        };
      }
      continue;
    }
    if (entry.provider === "dijie-cloud-bridge" || entry.provider === "cloud-marketplace") {
      materializeDijieCloudBridge(next as unknown as MutableRecord, entry, changedPaths);
      entries[id] = {
        ...entry,
        configBindings: [
          {
            path: "plugins.entries.aics.config.cloudAccessToken",
            owner: "apiConnections",
            materializedAt: now,
          },
          {
            path: "plugins.entries.aics.config.cloudBaseUrl",
            owner: "apiConnections",
            materializedAt: now,
          },
        ],
        updatedAt: now,
      };
      continue;
    }
    const bindings = dedupeBindings(entry.configBindings);
    for (const binding of bindings) {
      const value = shouldMaterializeEndpoint(binding.path)
        ? (entry.baseUrl ?? entry.endpoint)
        : entry.secret;
      if (value === undefined) continue;
      setPath(next as unknown as MutableRecord, binding.path, value);
      changedPaths.push(binding.path);
    }
    entries[id] = {
      ...entry,
      configBindings: bindings.map((binding) => ({
        ...binding,
        owner: "apiConnections",
        materializedAt: now,
      })),
      updatedAt: now,
    };
  }

  return { config: next, changedPaths };
}

function unmaterializeModelProvider(
  root: MutableRecord,
  entry: ApiConnectionEntry,
  changedPaths: string[],
): void {
  const provider = entry.provider.trim();
  if (!provider) return;
  const providerPath = `models.providers.${provider}`;
  const current = getPath(root, providerPath);
  if (!current || typeof current !== "object" || Array.isArray(current)) return;
  const providerConfig = { ...(current as MutableRecord) };
  let changed = false;

  if (isDeepStrictEqual(providerConfig.apiKey, entry.secret)) {
    delete providerConfig.apiKey;
    changed = true;
  }
  if (
    (entry.authMode === "oauth" && providerConfig.auth === "oauth") ||
    (entry.authMode !== "oauth" &&
      providerConfig.auth === "api-key" &&
      providerConfig.apiKey === undefined)
  ) {
    delete providerConfig.auth;
    changed = true;
  }

  const managedModelIds = modelIdsManagedByEntry(entry);
  if (managedModelIds.size > 0 && Array.isArray(providerConfig.models)) {
    const nextModels = (providerConfig.models as MutableRecord[]).filter((model) => {
      const modelId = typeof model.id === "string" ? model.id : "";
      return !(model.metadataSource === "models-add" && managedModelIds.has(modelId));
    });
    if (nextModels.length !== providerConfig.models.length) {
      providerConfig.models = nextModels;
      changed = true;
    }
  }

  const canDeleteProvider =
    changed &&
    (!Array.isArray(providerConfig.models) || providerConfig.models.length === 0) &&
    providerConfig.apiKey === undefined &&
    providerConfig.auth === undefined &&
    (providerConfig.baseUrl === undefined ||
      providerConfig.baseUrl === entry.baseUrl ||
      providerConfig.baseUrl === entry.endpoint);
  if (canDeleteProvider) {
    if (deletePath(root, providerPath)) changedPaths.push(providerPath);
    return;
  }
  if (changed && !isDeepStrictEqual(current, providerConfig)) {
    setPath(root, providerPath, providerConfig);
    changedPaths.push(providerPath);
  }
}

function unmaterializeDijieCloudBridge(
  root: MutableRecord,
  entry: ApiConnectionEntry,
  changedPaths: string[],
): void {
  const expectedBaseUrl = entry.baseUrl ?? entry.endpoint;
  const values: Array<[string, unknown]> = [
    ["plugins.entries.aics.config.cloudAccessToken", entry.secret],
    ["plugins.entries.aics.config.cloudBaseUrl", expectedBaseUrl],
  ];
  for (const [path, expected] of values) {
    if (expected === undefined) continue;
    if (!isDeepStrictEqual(getPath(root, path), expected)) continue;
    if (deletePath(root, path)) changedPaths.push(path);
  }
}

export function unmaterializeApiConnectionFromConfig(
  config: OpenClawConfig,
  entry: ApiConnectionEntry | undefined,
): { config: OpenClawConfig; changedPaths: string[] } {
  if (!entry) return { config, changedPaths: [] };
  const materializedBindings = dedupeBindings(entry.configBindings).filter(
    (binding) => binding.owner === "apiConnections" && Boolean(binding.materializedAt),
  );
  if (materializedBindings.length === 0) return { config, changedPaths: [] };
  const next = cloneConfig(config);
  const changedPaths: string[] = [];

  if (entry.kind === "model") {
    unmaterializeModelProvider(next as unknown as MutableRecord, entry, changedPaths);
  } else if (entry.provider === "dijie-cloud-bridge" || entry.provider === "cloud-marketplace") {
    unmaterializeDijieCloudBridge(next as unknown as MutableRecord, entry, changedPaths);
  } else {
    for (const binding of materializedBindings) {
      const expected = shouldMaterializeEndpoint(binding.path)
        ? (entry.baseUrl ?? entry.endpoint)
        : entry.secret;
      if (expected === undefined) continue;
      if (!isDeepStrictEqual(getPath(next as unknown as MutableRecord, binding.path), expected)) {
        continue;
      }
      if (deletePath(next as unknown as MutableRecord, binding.path)) {
        changedPaths.push(binding.path);
      }
    }
  }

  return { config: next, changedPaths };
}

export function bindApiConnectionConfigPath(
  config: OpenClawConfig,
  entryId: string,
  path: string,
): OpenClawConfig {
  const next = cloneConfig(config);
  const entry = next.apiConnections?.entries?.[entryId];
  if (!entry) {
    throw new Error(`API connection not found: ${entryId}`);
  }
  entry.configBindings = dedupeBindings([
    ...(entry.configBindings ?? []),
    { path, owner: "apiConnections" },
  ]);
  entry.updatedAt = new Date().toISOString();
  return next;
}
