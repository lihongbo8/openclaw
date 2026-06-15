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

function materializeDijieCloudBridge(
  root: MutableRecord,
  entry: ApiConnectionEntry,
  changedPaths: string[],
): void {
  const baseUrl = entry.baseUrl ?? entry.endpoint;
  const bridgeValues: Array<[string, unknown, { preserveExisting?: boolean }?]> = [
    ["plugins.entries.aics.enabled", true],
    ["plugins.entries.aics.config.cloudBaseUrl", baseUrl],
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
      "local-admin-device",
      { preserveExisting: true },
    ],
    [
      "plugins.entries.aics.config.defaultWorkspaceRef",
      "local-admin-workspace",
      { preserveExisting: true },
    ],
    [
      "plugins.entries.aics.config.defaultLocalGatewayId",
      "openclaw-local-gateway",
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
