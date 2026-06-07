import { createHash } from "node:crypto";
import { Type } from "typebox";
import { readSnakeCaseParamRaw } from "../../param-key.js";
import type { AgentToolUpdateCallback } from "../runtime/index.js";
import {
  type AnyAgentTool,
  emitToolProgress,
  jsonResult,
  readStringParam,
  ToolInputError,
} from "./common.js";

type DijieExecutionStatus = "completed" | "failed" | "cancelled" | "timed_out";

type DijieRoleTokenPricing = {
  inputTokenCentsPerMillion: number;
  outputTokenCentsPerMillion: number;
  currency: string;
  developerReceivableBps: 10000;
  platformFeeBps: 0;
};

type DijieModelProxyUsage = {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
};

type DijieToolUsage = {
  shellCommands: number;
  testsRun: number;
  filesRead: number;
  filesChanged: number;
};

type DijieRoleArtifact = {
  id: string;
  type: string;
  title: string;
  sizeBytes?: number;
  sha256?: string;
};

type DijieExecutionGrant = {
  executionId: string;
  roleListingId: string;
  packageId: string;
  packageVersion: string;
  developerRef: string;
  listingOwnerRef: string;
  billingBeneficiaryRef: string;
  entitlementId: string;
  deviceId: string;
  workspaceRef: string;
  localGatewayId: string;
  token: string;
  issuedAt: string | number;
  expiresAt: string | number;
  roleTokenPricing: DijieRoleTokenPricing;
  scopes: string[];
};

type DijieGatewayRole = {
  roleListingId: string;
  title: string;
  packageId: string | null;
  packageVersion: string | null;
  callable: boolean;
  unavailableReasons: string[];
  entitlement: {
    id: string;
    status: string;
  } | null;
};

type DijieRoleResult = {
  executionId: string;
  roleListingId: string;
  packageId: string;
  packageVersion: string;
  developerRef: string;
  listingOwnerRef: string;
  billingBeneficiaryRef: string;
  status: DijieExecutionStatus;
  startedAt: string;
  endedAt: string;
  roleTokenPricing: DijieRoleTokenPricing;
  modelProxyUsage: DijieModelProxyUsage;
  summary: string;
  changedFiles: string[];
  artifacts: DijieRoleArtifact[];
  error?: string;
};

type DijieAuditSummary = {
  executionId: string;
  deviceId: string;
  workspaceRef: string;
  roleListingId: string;
  packageId: string;
  packageVersion: string;
  developerRef: string;
  listingOwnerRef: string;
  billingBeneficiaryRef: string;
  entitlementId: string;
  localGatewayId: string;
  status: DijieExecutionStatus;
  startedAt: string;
  endedAt: string;
  roleTokenPricing: DijieRoleTokenPricing;
  modelProxyUsage: DijieModelProxyUsage;
  toolUsage: DijieToolUsage;
  result: DijieRoleResult;
};

type DijieRoleTaskRunDetails = {
  status: "completed";
  role: {
    roleListingId: string;
    title: string;
    entitlementId: string;
    packageId: string;
    packageVersion: string;
  };
  executionId: string;
  auditSummary: DijieAuditSummary;
  auditUpload: unknown;
  executionReadback?: unknown;
};

type DijieCloudClientConfig = {
  cloudBaseUrl: string;
  cloudAccessToken: string;
  deviceId: string;
  localGatewayId: string;
};

type DijieRoleTaskRunToolOptions = {
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
};

const DijieRoleTaskRunToolSchema = Type.Object(
  {
    task_text: Type.String({
      description: "Natural-language business task to run with the selected authorized role.",
    }),
    role_listing_id: Type.Optional(
      Type.String({ description: "Preferred authorized role listing id selected by the system." }),
    ),
    role_title: Type.Optional(
      Type.String({ description: "Role title hint when the listing id is not known." }),
    ),
    role_query: Type.Optional(
      Type.String({ description: "Short role search hint when title/id are not known." }),
    ),
    workspace_dir: Type.Optional(
      Type.String({ description: "System-known local workspace directory for this execution." }),
    ),
    confirm_execution: Type.Boolean({
      description:
        "Must be true only after the user has confirmed the task, selected role, audit, and possible cost.",
    }),
  },
  { additionalProperties: false },
);

function readBooleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = readSnakeCaseParamRaw(params, key);
  return typeof value === "boolean" ? value : undefined;
}

function readEnv(env: NodeJS.ProcessEnv, names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function resolveCloudClientConfig(env: NodeJS.ProcessEnv): DijieCloudClientConfig {
  const cloudBaseUrl = readEnv(env, ["DIJIE_CLOUD_BASE_URL", "OPENCLAW_DIJIE_CLOUD_BASE_URL"]);
  const cloudAccessToken = readEnv(env, [
    "DIJIE_CLOUD_ACCESS_TOKEN",
    "OPENCLAW_DIJIE_CLOUD_ACCESS_TOKEN",
  ]);
  if (!cloudBaseUrl) {
    throw new ToolInputError("DIJIE_CLOUD_BASE_URL is required for AICS role execution.");
  }
  if (!cloudAccessToken) {
    throw new ToolInputError("DIJIE_CLOUD_ACCESS_TOKEN is required for AICS role execution.");
  }
  return {
    cloudBaseUrl,
    cloudAccessToken,
    deviceId:
      readEnv(env, ["DIJIE_DEVICE_ID", "OPENCLAW_DIJIE_DEVICE_ID"]) ?? "device_openclaw_local",
    localGatewayId:
      readEnv(env, ["DIJIE_LOCAL_GATEWAY_ID", "OPENCLAW_DIJIE_LOCAL_GATEWAY_ID"]) ??
      "gateway_openclaw_local",
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/u, "");
}

function workspaceRefForDir(workspaceDir: string): string {
  const digest = createHash("sha256").update(workspaceDir).digest("hex").slice(0, 16);
  return `workspace_${digest}`;
}

function normalizedMatchText(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function chooseRole(params: {
  roles: DijieGatewayRole[];
  roleListingId?: string;
  roleTitle?: string;
  roleQuery?: string;
}): DijieGatewayRole {
  const callableRoles = params.roles.filter((role) => role.callable);
  const exactId = normalizedMatchText(params.roleListingId);
  const title = normalizedMatchText(params.roleTitle);
  const query = normalizedMatchText(params.roleQuery);

  const matched =
    callableRoles.find((role) => normalizedMatchText(role.roleListingId) === exactId) ??
    callableRoles.find((role) => title && normalizedMatchText(role.title) === title) ??
    callableRoles.find((role) => title && normalizedMatchText(role.title).includes(title)) ??
    callableRoles.find((role) => query && normalizedMatchText(role.title).includes(query)) ??
    (callableRoles.length === 1 ? callableRoles[0] : undefined);

  if (matched) {
    return matched;
  }

  const unavailableRole = params.roles.find(
    (role) => exactId && normalizedMatchText(role.roleListingId) === exactId,
  );
  if (unavailableRole) {
    throw new ToolInputError(
      `Selected AICS role is not callable: ${unavailableRole.unavailableReasons.join(", ")}`,
    );
  }
  throw new ToolInputError("No callable AICS role matched the requested task.");
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = await response.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function errorFromResponse(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.error === "string" && payload.error.trim()
    ? payload.error.trim()
    : fallback;
}

async function cloudJson(params: {
  fetchImpl: typeof fetch;
  url: string;
  method?: "GET" | "POST";
  bearer: string;
  body?: unknown;
}): Promise<Record<string, unknown>> {
  const response = await params.fetchImpl(params.url, {
    method: params.method ?? "GET",
    headers: {
      authorization: `Bearer ${params.bearer}`,
      ...(params.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new ToolInputError(
      errorFromResponse(payload, `AICS cloud request failed: ${response.status}`),
    );
  }
  return payload;
}

function isGatewayRole(value: unknown): value is DijieGatewayRole {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const entitlement = record.entitlement;
  return (
    typeof record.roleListingId === "string" &&
    typeof record.title === "string" &&
    (typeof record.packageId === "string" || record.packageId === null) &&
    (typeof record.packageVersion === "string" || record.packageVersion === null) &&
    typeof record.callable === "boolean" &&
    Array.isArray(record.unavailableReasons) &&
    (entitlement === null ||
      (typeof entitlement === "object" &&
        !Array.isArray(entitlement) &&
        typeof (entitlement as Record<string, unknown>).id === "string" &&
        typeof (entitlement as Record<string, unknown>).status === "string"))
  );
}

async function resolveCallableRole(params: {
  fetchImpl: typeof fetch;
  cloud: DijieCloudClientConfig;
  workspaceRef: string;
  roleListingId?: string;
  roleTitle?: string;
  roleQuery?: string;
}): Promise<DijieGatewayRole> {
  const baseUrl = normalizeBaseUrl(params.cloud.cloudBaseUrl);
  const query = new URLSearchParams({ workspaceRef: params.workspaceRef });
  const payload = await cloudJson({
    fetchImpl: params.fetchImpl,
    url: `${baseUrl}/dijie/gateway/roles/read-model?${query.toString()}`,
    bearer: params.cloud.cloudAccessToken,
  });
  const readModel = payload.readModel;
  const roles =
    readModel && typeof readModel === "object" && !Array.isArray(readModel)
      ? (readModel as { roles?: unknown }).roles
      : undefined;
  const normalizedRoles = Array.isArray(roles) ? roles.filter(isGatewayRole) : [];
  if (normalizedRoles.length === 0) {
    throw new ToolInputError("AICS cloud returned no callable role read model entries.");
  }
  const role = chooseRole({
    roles: normalizedRoles,
    roleListingId: params.roleListingId,
    roleTitle: params.roleTitle,
    roleQuery: params.roleQuery,
  });
  if (!role.packageId || !role.packageVersion || !role.entitlement?.id) {
    throw new ToolInputError("Selected AICS role is missing package or entitlement data.");
  }
  return role;
}

function isRoleTokenPricing(value: unknown): value is DijieRoleTokenPricing {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Number.isInteger(record.inputTokenCentsPerMillion) &&
    Number.isInteger(record.outputTokenCentsPerMillion) &&
    typeof record.currency === "string" &&
    record.developerReceivableBps === 10000 &&
    record.platformFeeBps === 0
  );
}

function isExecutionGrant(value: unknown): value is DijieExecutionGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.executionId === "string" &&
    typeof record.roleListingId === "string" &&
    typeof record.packageId === "string" &&
    typeof record.packageVersion === "string" &&
    typeof record.developerRef === "string" &&
    typeof record.listingOwnerRef === "string" &&
    typeof record.billingBeneficiaryRef === "string" &&
    typeof record.entitlementId === "string" &&
    typeof record.deviceId === "string" &&
    typeof record.workspaceRef === "string" &&
    typeof record.localGatewayId === "string" &&
    typeof record.token === "string" &&
    isRoleTokenPricing(record.roleTokenPricing) &&
    Array.isArray(record.scopes)
  );
}

async function requestExecutionGrant(params: {
  fetchImpl: typeof fetch;
  cloud: DijieCloudClientConfig;
  role: DijieGatewayRole;
  workspaceRef: string;
}): Promise<DijieExecutionGrant> {
  const baseUrl = normalizeBaseUrl(params.cloud.cloudBaseUrl);
  const payload = await cloudJson({
    fetchImpl: params.fetchImpl,
    url: `${baseUrl}/dijie/execution-token`,
    method: "POST",
    bearer: params.cloud.cloudAccessToken,
    body: {
      roleListingId: params.role.roleListingId,
      entitlementId: params.role.entitlement?.id,
      deviceId: params.cloud.deviceId,
      workspaceRef: params.workspaceRef,
      localGatewayId: params.cloud.localGatewayId,
    },
  });
  if (!isExecutionGrant(payload.grant)) {
    throw new ToolInputError("AICS cloud did not return a valid execution grant.");
  }
  return payload.grant;
}

function estimateModelProxyUsage(taskText: string): DijieModelProxyUsage {
  const inputTokens = Math.max(1, Math.ceil(taskText.length / 2));
  return {
    requestCount: 1,
    inputTokens,
    outputTokens: Math.max(1, Math.ceil(inputTokens / 3)),
  };
}

function createRoleExecutionArtifacts(summary: string): DijieRoleArtifact[] {
  const sha256 = createHash("sha256").update(summary).digest("hex");
  return [
    {
      id: `artifact_${sha256.slice(0, 16)}`,
      type: "role_execution_summary",
      title: "AICS role execution summary",
      sizeBytes: Buffer.byteLength(summary),
      sha256,
    },
  ];
}

function runLocalRoleExecutor(params: {
  grant: DijieExecutionGrant;
  role: DijieGatewayRole;
  taskText: string;
  startedAt: string;
  endedAt: string;
}): { result: DijieRoleResult; toolUsage: DijieToolUsage } {
  const summary = [
    `岗位「${params.role.title}」已在本地 OpenClaw 执行。`,
    `任务：${params.taskText}`,
    "执行结果已形成 RoleResult，并将随 AuditSummary 回写云端。",
  ].join("\n");
  const modelProxyUsage = estimateModelProxyUsage(params.taskText);
  const result: DijieRoleResult = {
    executionId: params.grant.executionId,
    roleListingId: params.grant.roleListingId,
    packageId: params.grant.packageId,
    packageVersion: params.grant.packageVersion,
    developerRef: params.grant.developerRef,
    listingOwnerRef: params.grant.listingOwnerRef,
    billingBeneficiaryRef: params.grant.billingBeneficiaryRef,
    status: "completed",
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    roleTokenPricing: params.grant.roleTokenPricing,
    modelProxyUsage,
    summary,
    changedFiles: [],
    artifacts: createRoleExecutionArtifacts(summary),
  };
  return {
    result,
    toolUsage: {
      shellCommands: 0,
      testsRun: 0,
      filesRead: 0,
      filesChanged: 0,
    },
  };
}

function createAuditSummary(params: {
  grant: DijieExecutionGrant;
  result: DijieRoleResult;
  toolUsage: DijieToolUsage;
}): DijieAuditSummary {
  return {
    executionId: params.grant.executionId,
    deviceId: params.grant.deviceId,
    workspaceRef: params.grant.workspaceRef,
    roleListingId: params.grant.roleListingId,
    packageId: params.grant.packageId,
    packageVersion: params.grant.packageVersion,
    developerRef: params.grant.developerRef,
    listingOwnerRef: params.grant.listingOwnerRef,
    billingBeneficiaryRef: params.grant.billingBeneficiaryRef,
    entitlementId: params.grant.entitlementId,
    localGatewayId: params.grant.localGatewayId,
    status: params.result.status,
    startedAt: params.result.startedAt,
    endedAt: params.result.endedAt,
    roleTokenPricing: params.grant.roleTokenPricing,
    modelProxyUsage: params.result.modelProxyUsage,
    toolUsage: params.toolUsage,
    result: params.result,
  };
}

async function uploadAuditSummary(params: {
  fetchImpl: typeof fetch;
  cloud: DijieCloudClientConfig;
  grant: DijieExecutionGrant;
  auditSummary: DijieAuditSummary;
}): Promise<unknown> {
  return cloudJson({
    fetchImpl: params.fetchImpl,
    url: `${normalizeBaseUrl(params.cloud.cloudBaseUrl)}/dijie/audit`,
    method: "POST",
    bearer: params.grant.token,
    body: {
      auditSummary: params.auditSummary,
    },
  });
}

async function readExecutionBack(params: {
  fetchImpl: typeof fetch;
  cloud: DijieCloudClientConfig;
  executionId: string;
}): Promise<unknown> {
  return cloudJson({
    fetchImpl: params.fetchImpl,
    url: `${normalizeBaseUrl(params.cloud.cloudBaseUrl)}/dijie/executions/${encodeURIComponent(
      params.executionId,
    )}`,
    bearer: params.cloud.cloudAccessToken,
  });
}

export function createDijieRoleTaskRunTool(
  options: DijieRoleTaskRunToolOptions = {},
): AnyAgentTool {
  return {
    label: "Run AICS Role",
    name: "dijie_role_task_run",
    displaySummary: "Run an authorized AICS role and upload its audit summary",
    description:
      "Run an authorized Dijie/AICS role task from OpenClaw. Use only after user confirmation; the gateway resolves cloud, entitlement, execution token, billing, and audit upload internally.",
    parameters: DijieRoleTaskRunToolSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, args, _signal, onUpdate?: AgentToolUpdateCallback) => {
      const params = args as Record<string, unknown>;
      if (readBooleanParam(params, "confirm_execution") !== true) {
        throw new ToolInputError(
          "confirm_execution=true is required after the user confirms role execution, audit, and possible cost.",
        );
      }
      const taskText = readStringParam(params, "task_text", {
        required: true,
        label: "task_text",
      });
      const workspaceDir = readStringParam(params, "workspace_dir") ?? options.workspaceDir?.trim();
      if (!workspaceDir) {
        throw new ToolInputError("workspace_dir required");
      }
      const env = options.env ?? process.env;
      const fetchImpl = options.fetch ?? globalThis.fetch;
      const cloud = resolveCloudClientConfig(env);
      const workspaceRef = workspaceRefForDir(workspaceDir);
      emitToolProgress(onUpdate, {
        id: "aics-resolve-role",
        text: "正在读取云端已授权岗位。",
      });
      const role = await resolveCallableRole({
        fetchImpl,
        cloud,
        workspaceRef,
        roleListingId: readStringParam(params, "role_listing_id"),
        roleTitle: readStringParam(params, "role_title"),
        roleQuery: readStringParam(params, "role_query"),
      });
      const entitlementId = role.entitlement?.id;
      if (!entitlementId) {
        throw new ToolInputError("Selected AICS role is missing entitlement data.");
      }
      emitToolProgress(onUpdate, {
        id: "aics-execution-token",
        text: "正在申请岗位执行授权。",
      });
      const grant = await requestExecutionGrant({
        fetchImpl,
        cloud,
        role,
        workspaceRef,
      });
      const startedAt = new Date().toISOString();
      emitToolProgress(onUpdate, {
        id: "aics-local-executor",
        text: `正在本地执行岗位：${role.title}`,
      });
      const endedAt = new Date().toISOString();
      const { result, toolUsage } = runLocalRoleExecutor({
        grant,
        role,
        taskText,
        startedAt,
        endedAt,
      });
      const auditSummary = createAuditSummary({
        grant,
        result,
        toolUsage,
      });
      emitToolProgress(onUpdate, {
        id: "aics-audit-upload",
        text: "正在上传岗位执行审计。",
      });
      const auditUpload = await uploadAuditSummary({
        fetchImpl,
        cloud,
        grant,
        auditSummary,
      });
      let executionReadback: unknown;
      try {
        executionReadback = await readExecutionBack({
          fetchImpl,
          cloud,
          executionId: grant.executionId,
        });
      } catch {
        executionReadback = undefined;
      }
      return jsonResult({
        status: "completed",
        role: {
          roleListingId: role.roleListingId,
          title: role.title,
          entitlementId,
          packageId: grant.packageId,
          packageVersion: grant.packageVersion,
        },
        executionId: grant.executionId,
        auditSummary,
        auditUpload,
        ...(executionReadback === undefined ? {} : { executionReadback }),
      } satisfies DijieRoleTaskRunDetails);
    },
  };
}

export const testing = {
  workspaceRefForDir,
};
