import { spawn } from "node:child_process";
import crypto from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { verifyDijieExecutionToken } from "@openclaw/gateway-protocol";
import {
  jsonResult,
  type AnyAgentTool,
  type OpenClawConfig,
  type PluginRuntime,
} from "openclaw/plugin-sdk/core";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import {
  resolveAicsRoleRequiredCapabilities,
  type AicsRoleCapabilityValidation,
} from "./role-capabilities.js";

type AicsConfig = {
  repoRoot: string;
  pythonBinary: string;
  rolePackageOutputRoot: string;
  allowWrites: boolean;
  maxOutputChars: number;
  executionTokenPublicKeyPem?: string;
  localExecutorCommand?: string;
  localExecutorArgs?: string[];
  localExecutorModel?: string;
  localExecutorProfile?: string;
  localExecutorMode: "auto" | "native" | "subprocess";
  useLegacyCodexCliArgs: boolean;
  cloudExecutionTokenUrl?: string;
  cloudExecutionReadUrl?: string;
  cloudMarketplaceInstalledRolesUrl?: string;
  cloudAuthorizationUrl?: string;
  cloudAuditUrl?: string;
  cloudAccessToken?: string;
  defaultDeviceId?: string;
  defaultWorkspaceRef?: string;
  defaultLocalGatewayId?: string;
  cloudAuditUploadEnabled: boolean;
  cloudAuditUploadRequired: boolean;
};

type EnvSecretRef = {
  source: "env";
  provider: string;
  id: string;
};

type CommandResult = {
  command: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  modelProxyUsage?: DijieModelProxyUsage;
};

type DijieExecutionStatus = "completed" | "failed" | "cancelled" | "timed_out";

type DijieRoleTokenPricing = {
  inputTokenCentsPerMillion: number;
  outputTokenCentsPerMillion: number;
  currency: string;
  developerReceivableBps: number;
  platformFeeBps: number;
};

type DijieExecutionTokenPricing = {
  kind: "one_time_authorization";
  authorizationFeeCents: number;
  currency: string;
  platformFeeBps: number;
  developerReceivableCents: number;
};

type DijieExecutionPreflightOk = {
  ok: true;
  executionId: string;
  actorId: string;
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
  pricing: DijieExecutionTokenPricing;
  roleTokenPricing: DijieRoleTokenPricing;
  scopes: string[];
  expiresAt: string;
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

type DijieRoleTaskToolUsage = {
  openToolPool: true;
  invocationPath: "openclaw-native-embedded-agent";
  toolCallCount: number;
};

type DijieRoleTaskStatus = "completed" | "failed" | "cancelled" | "timed_out";

type DijieRoleArtifact = {
  id: string;
  type: string;
  title: string;
  sizeBytes?: number;
  sha256?: string;
  path?: string;
};

type DijieRoleFeedbackPacket = {
  packetVersion: 1;
  packetId: string;
  mode: "developer_package" | "authorized_execution";
  producedAt: string;
  role: {
    packageId: string;
    packageVersion: string;
    roleListingId?: string;
    developerRef?: string;
  };
  schedulerContext: {
    schedulerRunId?: string;
    executionId?: string;
    entitlementId?: string;
    deviceId?: string;
    workspaceRef?: string;
    localGatewayId?: string;
  };
  status: DijieExecutionStatus;
  startedAt: string;
  endedAt: string;
  summary?: string;
  changedFiles: string[];
  artifacts: DijieRoleArtifact[];
  toolUsage: DijieToolUsage;
  modelProxyUsage?: DijieModelProxyUsage;
  costUsage?: {
    inputTokens: number;
    outputTokens: number;
    currency?: string;
    estimatedCents?: number;
  };
  riskEvents: Array<{
    level: "low" | "medium" | "high" | "critical";
    category: string;
    summary: string;
    requiresHumanConfirmation: boolean;
  }>;
  evolutionSuggestions: Array<{
    target:
      | "capability_rubric"
      | "failure_mode_library"
      | "test_example_library"
      | "dispatch_strategy"
      | "role_package";
    summary: string;
    evidenceRefs: string[];
  }>;
  error?: string;
};

type RolePackageFile = {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
};

type RolePackageValidation = {
  ok: boolean;
  errors: string[];
  capabilities: AicsRoleCapabilityValidation;
};

const DEFAULT_REPO_ROOT = "/Users/weizuo/Desktop/ai_gongsi_kekong_xitong";
const DEFAULT_ROLE_PACKAGE_OUTPUT_ROOT =
  "/Users/weizuo/Documents/ai公司/openclaw-workspace/aics-role-packages";
const DEFAULT_MAX_OUTPUT_CHARS = 12000;
const DEFAULT_CLOUD_EXECUTION_TOKEN_PATH = "/dijie/execution-token";
const DEFAULT_CLOUD_EXECUTION_READ_PATH = "/dijie/executions";
const DEFAULT_CLOUD_MARKETPLACE_INSTALLED_ROLES_PATH = "/dijie/my-roles";
const DEFAULT_CLOUD_AUTHORIZATION_PATH = "/dijie/authorizations";
const DEFAULT_CLOUD_AUDIT_PATH = "/dijie/audit";
const DEFAULT_ROLE_TASK_TIMEOUT_MS = 120000;
const ROLE_TASK_AUDIT_RETURN_BUFFER_MS = 10000;
const MIN_ROLE_TASK_EMBEDDED_TIMEOUT_MS = 1000;

const DEVELOPER_MODE_GUIDE_PROMPT = [
  "开发者模式内置指南：",
  "- 你是迭界AI主系统里的岗位开发专属助手，不是普通使用者模式助手。",
  "- 开发者只需要用自然语言讲业务逻辑和业务流程；输入、输出、规则、验收标准、岗位包结构、协议映射、验证材料和上传标准都是平台职责，已经内置在你的资料包里。",
  "- 不要让开发者定义、填写或逐项确认输入、输出、规则、验收标准这些平台标准；只有业务逻辑本身不清楚时，才用业务语言追问。",
  "- 不要要求开发者理解 execution token、Gateway、AuditSummary、RoleResult、entitlement、审计上传、结算协议或平台接口。",
  "- 平台接口、协议、鉴权、审计、计费、开发者中心上传要求和 role_package 目录规范都已经内置在你的资料包里。",
  "- 不要为了凑包而伪造需求、输入输出、规则或验收标准。",
  "- 生成岗位包时，把业务需求翻译成完整可审核的程序包，而不是只写商品介绍。",
].join("\n");

const ROLE_PACKAGE_BUILT_IN_MATERIALS = [
  "内置资料包：",
  "- package contract: 岗位包必须输出到 role_package/。",
  "- required files: role_package/manifest.json, role_package/listing.md, role_package/README.md。",
  "- role knowledge: 岗位包是无状态岗位能力模板，只保存公开业务逻辑、通用岗位经验、业务流程、判断规则、常见失败模式和验收样例。",
  "- local capabilities: manifest.requiredCapabilities 只声明本地 OpenClaw 抽象能力需求，例如 workspace.read、image.inspect、document.write、human.confirm。",
  "- OpenClaw tool protocol: requiredCapabilities 只是进入 OpenClaw tools.catalog/tools.effective/tools.invoke 前的产品语义，不是新工具协议。",
  "- integration example: 至少提供一个 wrapper、adapter 或接入示例文件，用来说明业务流程到 requiredCapabilities 的边界，不能实现或携带浏览器、文件、命令、API、MCP 等实施工具。",
  "- validation material: 至少提供一个 validation 或 smoke test 说明/脚本。",
  "- platform handles: execution token、Gateway 调用、AuditSummary、RoleResult、审计上传、Token 计费和开发者结算由平台桥处理。",
  "- forbidden content: 不写 provider key 名称或值、secret/token 字段、cloud bearer、raw execution token、本地绝对路径、用户主对话完整历史、使用者模式私有记忆、岗位实例运行库、岗位实例工作记忆或记忆候选原文。",
  "- forbidden tools: 不在 role_package/ 内打包实施工具、MCP server、API client、本地工具实现或工具 schema；实施工具由 OpenClaw/迭界AI主系统通过 OpenClaw 工具协议开放调用、确认和审计。",
  "- developer-center handoff: 包生成后交付可下载的 role_package/，由开发者中心负责上传、价格、Token 单价、审核和发布。",
].join("\n");

export const AICS_DEVELOPER_MODE_CONTEXT_ALLOWLIST = [
  "natural-language business logic",
  "developer-provided business materials",
  "built-in developer-mode material pack",
  "public role_package contract, protocol templates, and upload standards",
  "isolated local workspace with relative role_package/ paths",
] as const;

export const AICS_DEVELOPER_MODE_CONTEXT_DENYLIST = [
  "executionId",
  "actorId",
  "entitlementId",
  "order or wallet state",
  "pricing snapshots",
  "cloud bearer tokens",
  "raw execution tokens",
  "provider key names or values",
  "review or settlement state",
  "ordinary user conversation history",
  "private memories",
] as const;

const FORBIDDEN_DEVELOPER_MODE_CONTEXT_KEYS = new Set([
  "executionid",
  "execution_id",
  "actorid",
  "actor_id",
  "rolelistingid",
  "role_listing_id",
  "entitlementid",
  "entitlement_id",
  "order",
  "ordergroup",
  "order_group",
  "ordergroupid",
  "order_group_id",
  "orderid",
  "order_id",
  "orderref",
  "order_ref",
  "wallet",
  "walletid",
  "wallet_id",
  "walletstate",
  "wallet_state",
  "pricing",
  "pricingsnapshot",
  "pricing_snapshot",
  "roletokenpricing",
  "role_token_pricing",
  "cloudbearer",
  "cloud_bearer",
  "cloudaccesstoken",
  "cloud_access_token",
  "bearertoken",
  "bearer_token",
  "executiontoken",
  "execution_token",
  "rawtoken",
  "raw_token",
  "providerkey",
  "provider_key",
  "providerapikey",
  "provider_api_key",
  "apikey",
  "api_key",
  "secret",
  "secretkey",
  "secret_key",
  "reviewstate",
  "review_state",
  "settlementstate",
  "settlement_state",
  "conversationhistory",
  "conversation_history",
  "privatememory",
  "private_memory",
]);

const BACKEND_ONLY_ARTIFACT_KEYS = new Set([
  ...FORBIDDEN_DEVELOPER_MODE_CONTEXT_KEYS,
  "deviceref",
  "device_ref",
  "deviceid",
  "device_id",
  "workspaceref",
  "workspace_ref",
  "localgatewayid",
  "local_gateway_id",
]);

const PROVIDER_KEY_NAME_PATTERN =
  /\b(?:OPENAI|ANTHROPIC|GOOGLE|GEMINI|AZURE|DEEPSEEK|DASHSCOPE|QWEN|OPENROUTER|MISTRAL|TOGETHER|COHERE|GROQ|XAI|PERPLEXITY|HUGGINGFACE|HF)_[A-Z0-9_]*(?:API_)?(?:KEY|TOKEN|SECRET)\b/iu;
const PROVIDER_KEY_VALUE_PATTERN =
  /\b(?:sk-[A-Za-z0-9][A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/u;
const CLOUD_BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=_-]{12,}\b/iu;
const SECRET_FIELD_PATTERN =
  /["']?[A-Za-z0-9_-]*(?:secret|api[_-]?key|provider[_-]?key|bearer[_-]?token|access[_-]?token|execution[_-]?token)[A-Za-z0-9_-]*["']?\s*[:=]/iu;
const LOCAL_ABSOLUTE_PATH_PATTERN =
  /(?:^|[\s"'(=:[,])(?:\/(?:Users|private|tmp|var|home|opt)\/[^\s"',)]+|[A-Za-z]:\\[^\s"',)]+)/u;
const ROLE_PACKAGE_MANIFEST_PATH = "role_package/manifest.json";
const DEFAULT_PUBLIC_ROLE_PACKAGE_NAME = "Dijie Role Package";
const DEFAULT_PUBLIC_ROLE_PACKAGE_VERSION = "1.0.0";
const DEFAULT_PUBLIC_ROLE_PACKAGE_PERMISSIONS = ["workspace.read", "workspace.write"] as const;
const DEFAULT_PUBLIC_ROLE_PACKAGE_REQUIRED_CAPABILITIES = [
  "workspace.read",
  "workspace.write",
  "human.confirm",
] as const;
const REQUIRED_CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const ROLE_PACKAGE_TOOL_IMPLEMENTATION_PATH_PATTERN =
  /(^|\/)(tool-?implementations?|tools?|mcp-?servers?|browser-?tools?|command-?tools?|api-?clients?)(\/|[-_.])/iu;
const ROLE_PACKAGE_KNOWLEDGE_PATH_PATTERN =
  /(^|\/)(business|knowledge|playbooks?|sops?|workflows?|experience|failure-modes?|examples?)(\/|[-_.])|[-_.](business|knowledge|playbook|sop|workflow|experience|failure-mode|example)\./iu;

const DijieExecutionPreflightParamsSchema = Type.Object(
  {
    executionToken: Type.String({ minLength: 1 }),
    roleListingId: Type.String({ minLength: 1 }),
    entitlementId: Type.String({ minLength: 1 }),
    deviceId: Type.String({ minLength: 1 }),
    workspaceRef: Type.String({ minLength: 1 }),
    localGatewayId: Type.String({ minLength: 1 }),
    nowMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const RoleBuilderParamsSchema = Type.Object(
  {
    request_zh: Type.String({
      minLength: 1,
      description: "Chinese natural-language role-builder request.",
    }),
    confirm_brief: Type.Optional(
      Type.Boolean({
        description:
          "When true, asks 迭界AI to confirm the brief and write the local role package. Requires allowWrites=true.",
      }),
    ),
    package_only: Type.Optional(
      Type.Boolean({
        description:
          "When true with confirm_brief=true, generates and validates the public developer role_package before marketplace listing exists. Does not require execution token, entitlement, audit upload, or billing facts.",
      }),
    ),
    role_build_brief_json: Type.Optional(
      Type.String({
        minLength: 2,
        description:
          "Confirmed RoleBuildBrief JSON. Required when confirm_brief=true so the local executor receives the approved brief instead of an informal request.",
      }),
    ),
    execution_token: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Short-lived cloud execution token. Required when confirm_brief=true.",
      }),
    ),
    role_listing_id: Type.Optional(Type.String({ minLength: 1 })),
    entitlement_id: Type.Optional(Type.String({ minLength: 1 })),
    device_id: Type.Optional(Type.String({ minLength: 1 })),
    workspace_ref: Type.Optional(Type.String({ minLength: 1 })),
    local_gateway_id: Type.Optional(Type.String({ minLength: 1 })),
    developer_id: Type.Optional(Type.String({ minLength: 1 })),
    output_root: Type.Optional(Type.String({ minLength: 1 })),
    timeout_ms: Type.Optional(Type.Integer({ minimum: 1000, maximum: 300000 })),
  },
  { additionalProperties: false },
);

const RoleTaskRunParamsSchema = Type.Object(
  {
    role_listing_id: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Optional explicit marketplace role listing id. Main chat should normally provide role_title or role_query instead.",
      }),
    ),
    entitlement_id: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Optional explicit user entitlement id. Main chat should not ask the user to provide this.",
      }),
    ),
    role_query: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Natural-language role name or selection hint from the user, for example 商品图检查岗位.",
      }),
    ),
    task_text: Type.String({
      minLength: 1,
      description: "Natural-language task request for the selected role.",
    }),
    role_title: Type.Optional(Type.String({ minLength: 1 })),
    role_summary: Type.Optional(Type.String({ minLength: 1 })),
    required_capabilities: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    confirm_execution: Type.Boolean({
      description:
        "Must be true only after the user has confirmed the selected role, audit upload, and possible cost.",
    }),
    workspace_dir: Type.String({
      minLength: 1,
      description: "Local workspace directory where the role task should execute.",
    }),
    workspace_ref: Type.Optional(Type.String({ minLength: 1 })),
    device_id: Type.Optional(Type.String({ minLength: 1 })),
    local_gateway_id: Type.Optional(Type.String({ minLength: 1 })),
    timeout_ms: Type.Optional(Type.Integer({ minimum: 1000, maximum: 300000 })),
  },
  { additionalProperties: false },
);

const ExecutionTokenRequestParamsSchema = Type.Object(
  {
    cloud_access_token: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Optional transient Dijie cloud customer bearer token. If omitted, the backend-only plugin cloudAccessToken is used.",
      }),
    ),
    role_listing_id: Type.String({ minLength: 1 }),
    entitlement_id: Type.String({ minLength: 1 }),
    device_id: Type.String({ minLength: 1 }),
    workspace_ref: Type.String({ minLength: 1 }),
    local_gateway_id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const ExecutionAuditReadParamsSchema = Type.Object(
  {
    cloud_access_token: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Optional transient Dijie cloud customer bearer token. If omitted, the backend-only plugin cloudAccessToken is used.",
      }),
    ),
    execution_id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const MarketplaceInstalledRolesParamsSchema = Type.Object(
  {
    cloud_access_token: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Optional transient Dijie cloud customer bearer token. If omitted, the backend-only plugin cloudAccessToken is used.",
      }),
    ),
    workspace_ref: Type.Optional(Type.String({ minLength: 1 })),
    device_id: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const RoleAuthorizationCreateParamsSchema = Type.Object(
  {
    cloud_access_token: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Optional transient Dijie cloud customer bearer token. If omitted, the backend-only plugin cloudAccessToken is used.",
      }),
    ),
    role_listing_id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isOneTimeAuthorizationPricing(value: unknown): boolean {
  const pricing = asRecord(value);
  return (
    pricing.kind === "one_time_authorization" &&
    isNonNegativeInteger(pricing.authorizationFeeCents) &&
    isNonEmptyString(pricing.currency) &&
    pricing.platformFeeBps === 0 &&
    isNonNegativeInteger(pricing.developerReceivableCents) &&
    pricing.developerReceivableCents === pricing.authorizationFeeCents
  );
}

function isRoleTokenPricing(value: unknown): value is DijieRoleTokenPricing {
  const pricing = asRecord(value);
  return (
    isNonNegativeInteger(pricing.inputTokenCentsPerMillion) &&
    isNonNegativeInteger(pricing.outputTokenCentsPerMillion) &&
    isNonEmptyString(pricing.currency) &&
    pricing.developerReceivableBps === 10000 &&
    pricing.platformFeeBps === 0
  );
}

function readPluginConfig(raw: unknown): AicsConfig {
  const pluginRecord = asRecord(raw);
  const record =
    pluginRecord.config &&
    typeof pluginRecord.config === "object" &&
    !Array.isArray(pluginRecord.config)
      ? asRecord(pluginRecord.config)
      : pluginRecord;
  const cloudBaseUrl =
    typeof record.cloudBaseUrl === "string" && record.cloudBaseUrl.trim()
      ? record.cloudBaseUrl.trim()
      : readEnv(["DIJIE_CLOUD_BASE_URL", "OPENCLAW_DIJIE_CLOUD_BASE_URL"]);
  const repoRoot =
    typeof record.repoRoot === "string" && record.repoRoot.trim()
      ? record.repoRoot
      : DEFAULT_REPO_ROOT;
  const pythonBinary =
    typeof record.pythonBinary === "string" && record.pythonBinary.trim()
      ? record.pythonBinary
      : "python3";
  const rolePackageOutputRoot =
    typeof record.rolePackageOutputRoot === "string" && record.rolePackageOutputRoot.trim()
      ? record.rolePackageOutputRoot
      : DEFAULT_ROLE_PACKAGE_OUTPUT_ROOT;
  const allowWrites = record.allowWrites === true;
  const maxOutputChars =
    typeof record.maxOutputChars === "number" && Number.isFinite(record.maxOutputChars)
      ? Math.max(1000, Math.trunc(record.maxOutputChars))
      : DEFAULT_MAX_OUTPUT_CHARS;
  const executionTokenPublicKeyPem =
    typeof record.executionTokenPublicKeyPem === "string" &&
    record.executionTokenPublicKeyPem.trim()
      ? record.executionTokenPublicKeyPem
      : undefined;
  const explicitLocalExecutorCommand =
    typeof record.localExecutorCommand === "string" && record.localExecutorCommand.trim()
      ? record.localExecutorCommand.trim()
      : undefined;
  // Legacy only: older local configs used Codex CLI field names. Product-facing
  // config must use localExecutor* until this subprocess adapter is replaced by
  // OpenClaw-native workspace/session execution.
  const legacyCodexBinary =
    typeof record.codexBinary === "string" && record.codexBinary.trim()
      ? record.codexBinary.trim()
      : undefined;
  const localExecutorCommand = explicitLocalExecutorCommand ?? legacyCodexBinary;
  const localExecutorArgs = Array.isArray(record.localExecutorArgs)
    ? record.localExecutorArgs.filter((arg): arg is string => typeof arg === "string")
    : undefined;
  const localExecutorModel =
    typeof record.localExecutorModel === "string" && record.localExecutorModel.trim()
      ? record.localExecutorModel.trim()
      : typeof record.codexModel === "string" && record.codexModel.trim()
        ? record.codexModel.trim()
        : undefined;
  const localExecutorProfile =
    typeof record.localExecutorProfile === "string" && record.localExecutorProfile.trim()
      ? record.localExecutorProfile.trim()
      : typeof record.codexProfile === "string" && record.codexProfile.trim()
        ? record.codexProfile.trim()
        : undefined;
  const localExecutorMode =
    record.localExecutorMode === "native" ||
    record.localExecutorMode === "subprocess" ||
    record.localExecutorMode === "auto"
      ? record.localExecutorMode
      : "auto";
  const cloudExecutionTokenPath =
    typeof record.cloudExecutionTokenPath === "string" && record.cloudExecutionTokenPath.trim()
      ? record.cloudExecutionTokenPath.trim()
      : DEFAULT_CLOUD_EXECUTION_TOKEN_PATH;
  const cloudExecutionTokenUrl =
    typeof record.cloudExecutionTokenUrl === "string" && record.cloudExecutionTokenUrl.trim()
      ? record.cloudExecutionTokenUrl.trim()
      : cloudBaseUrl
        ? new URL(cloudExecutionTokenPath, cloudBaseUrl).toString()
        : undefined;
  const cloudExecutionReadPath =
    typeof record.cloudExecutionReadPath === "string" && record.cloudExecutionReadPath.trim()
      ? record.cloudExecutionReadPath.trim()
      : DEFAULT_CLOUD_EXECUTION_READ_PATH;
  const cloudExecutionReadUrl =
    typeof record.cloudExecutionReadUrl === "string" && record.cloudExecutionReadUrl.trim()
      ? record.cloudExecutionReadUrl.trim()
      : cloudBaseUrl
        ? new URL(cloudExecutionReadPath, cloudBaseUrl).toString()
        : undefined;
  const cloudMarketplaceInstalledRolesPath =
    typeof record.cloudMarketplaceInstalledRolesPath === "string" &&
    record.cloudMarketplaceInstalledRolesPath.trim()
      ? record.cloudMarketplaceInstalledRolesPath.trim()
      : DEFAULT_CLOUD_MARKETPLACE_INSTALLED_ROLES_PATH;
  const cloudMarketplaceInstalledRolesUrl =
    typeof record.cloudMarketplaceInstalledRolesUrl === "string" &&
    record.cloudMarketplaceInstalledRolesUrl.trim()
      ? record.cloudMarketplaceInstalledRolesUrl.trim()
      : cloudBaseUrl
        ? new URL(cloudMarketplaceInstalledRolesPath, cloudBaseUrl).toString()
        : undefined;
  const cloudAuthorizationPath =
    typeof record.cloudAuthorizationPath === "string" && record.cloudAuthorizationPath.trim()
      ? record.cloudAuthorizationPath.trim()
      : DEFAULT_CLOUD_AUTHORIZATION_PATH;
  const cloudAuthorizationUrl =
    typeof record.cloudAuthorizationUrl === "string" && record.cloudAuthorizationUrl.trim()
      ? record.cloudAuthorizationUrl.trim()
      : cloudBaseUrl
        ? new URL(cloudAuthorizationPath, cloudBaseUrl).toString()
        : undefined;
  const cloudAuditPath =
    typeof record.cloudAuditPath === "string" && record.cloudAuditPath.trim()
      ? record.cloudAuditPath.trim()
      : DEFAULT_CLOUD_AUDIT_PATH;
  const cloudAuditUrl =
    typeof record.cloudAuditUrl === "string" && record.cloudAuditUrl.trim()
      ? record.cloudAuditUrl.trim()
      : cloudBaseUrl
        ? new URL(cloudAuditPath, cloudBaseUrl).toString()
        : undefined;
  const cloudAuditUploadRequired =
    record.cloudAuditUploadRequired === true || record.auditUploadRequired === true;
  const cloudAuditUploadEnabled =
    cloudAuditUploadRequired ||
    record.cloudAuditUploadEnabled === true ||
    record.auditUploadEnabled === true;
  const cloudAccessToken =
    resolveStringOrEnvSecretRef(record.cloudAccessToken) ??
    readEnv(["DIJIE_CLOUD_ACCESS_TOKEN", "OPENCLAW_DIJIE_CLOUD_ACCESS_TOKEN"]);
  const defaultDeviceId =
    typeof record.defaultDeviceId === "string" && record.defaultDeviceId.trim()
      ? record.defaultDeviceId.trim()
      : typeof record.deviceId === "string" && record.deviceId.trim()
        ? record.deviceId.trim()
        : readEnv(["DIJIE_DEVICE_ID", "OPENCLAW_DIJIE_DEVICE_ID"]);
  const defaultWorkspaceRef =
    typeof record.defaultWorkspaceRef === "string" && record.defaultWorkspaceRef.trim()
      ? record.defaultWorkspaceRef.trim()
      : typeof record.workspaceRef === "string" && record.workspaceRef.trim()
        ? record.workspaceRef.trim()
        : readEnv(["DIJIE_WORKSPACE_REF", "OPENCLAW_DIJIE_WORKSPACE_REF"]);
  const defaultLocalGatewayId =
    typeof record.defaultLocalGatewayId === "string" && record.defaultLocalGatewayId.trim()
      ? record.defaultLocalGatewayId.trim()
      : typeof record.localGatewayId === "string" && record.localGatewayId.trim()
        ? record.localGatewayId.trim()
        : readEnv(["DIJIE_LOCAL_GATEWAY_ID", "OPENCLAW_DIJIE_LOCAL_GATEWAY_ID"]);

  return {
    repoRoot: path.resolve(repoRoot),
    pythonBinary,
    rolePackageOutputRoot: path.resolve(rolePackageOutputRoot),
    allowWrites,
    maxOutputChars,
    executionTokenPublicKeyPem,
    localExecutorCommand,
    localExecutorArgs,
    localExecutorModel,
    localExecutorProfile,
    localExecutorMode,
    useLegacyCodexCliArgs: !explicitLocalExecutorCommand && Boolean(legacyCodexBinary),
    cloudExecutionTokenUrl,
    cloudExecutionReadUrl,
    cloudMarketplaceInstalledRolesUrl,
    cloudAuthorizationUrl,
    cloudAuditUrl,
    cloudAccessToken,
    defaultDeviceId,
    defaultWorkspaceRef,
    defaultLocalGatewayId,
    cloudAuditUploadEnabled,
    cloudAuditUploadRequired,
  };
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function isEnvSecretRef(value: unknown): value is EnvSecretRef {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).source === "env" &&
    typeof (value as Record<string, unknown>).id === "string" &&
    Boolean(String((value as Record<string, unknown>).id).trim())
  );
}

function resolveStringOrEnvSecretRef(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (isEnvSecretRef(value)) {
    return readEnv([value.id]);
  }
  return undefined;
}

function preflightError(error: string, code: string) {
  return {
    ok: false,
    code,
    error,
  };
}

export function verifyDijieExecutionPreflight(
  config: Pick<AicsConfig, "executionTokenPublicKeyPem">,
  rawParams: unknown,
) {
  const params = asRecord(rawParams);
  const executionToken = stringField(params, "executionToken");
  if (!executionToken) {
    return preflightError("executionToken is required.", "missing_execution_token");
  }

  const requiredFields = [
    "roleListingId",
    "entitlementId",
    "deviceId",
    "workspaceRef",
    "localGatewayId",
  ] as const;
  const missing = requiredFields.filter((field) => !stringField(params, field));
  if (missing.length > 0) {
    return preflightError(`Missing required fields: ${missing.join(", ")}`, "missing_context");
  }

  const nowMs =
    typeof params.nowMs === "number" && Number.isInteger(params.nowMs) ? params.nowMs : Date.now();
  const verified = verifyDijieExecutionToken(
    executionToken,
    config.executionTokenPublicKeyPem,
    nowMs,
  );
  if (!verified.ok) {
    return preflightError(verified.error, "invalid_execution_token");
  }

  for (const field of requiredFields) {
    if (verified.claims[field] !== stringField(params, field)) {
      return preflightError(
        `Execution token ${field} does not match local request context.`,
        "context_mismatch",
      );
    }
  }

  if (
    !verified.claims.scopes.includes("role.build") &&
    !verified.claims.scopes.includes("role.execute")
  ) {
    return preflightError("Execution token does not include role.build scope.", "missing_scope");
  }

  return {
    ok: true,
    executionId: verified.claims.executionId,
    actorId: verified.claims.actorId,
    roleListingId: verified.claims.roleListingId,
    packageId: verified.claims.packageId,
    packageVersion: verified.claims.packageVersion,
    developerRef: verified.claims.developerRef,
    listingOwnerRef: verified.claims.listingOwnerRef,
    billingBeneficiaryRef: verified.claims.billingBeneficiaryRef,
    entitlementId: verified.claims.entitlementId,
    deviceId: verified.claims.deviceId,
    workspaceRef: verified.claims.workspaceRef,
    localGatewayId: verified.claims.localGatewayId,
    pricing: verified.claims.pricing,
    roleTokenPricing: verified.claims.roleTokenPricing,
    scopes: verified.claims.scopes,
    expiresAt: new Date(verified.claims.exp * 1000).toISOString(),
  };
}

function assertDijieExecutionPreflightOk(
  preflight: ReturnType<typeof verifyDijieExecutionPreflight>,
): asserts preflight is DijieExecutionPreflightOk {
  if (preflight.ok === true) {
    return;
  }
  const failure = asRecord(preflight);
  throw new Error(
    `dijie.execution.preflight failed: ${stringField(failure, "code") ?? "invalid_execution_token"}: ${
      stringField(failure, "error") ?? "execution token preflight failed"
    }`,
  );
}

function requireStringParam(
  params: Record<string, unknown>,
  field: string,
  message = `${field} is required`,
): string {
  const value = stringField(params, field);
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function resolveCloudAccessTokenParam(
  config: AicsConfig,
  params: Record<string, unknown>,
  message: string,
): string {
  const cloudAccessToken = stringField(params, "cloud_access_token") ?? config.cloudAccessToken;
  if (!cloudAccessToken) {
    throw new Error(message);
  }
  return cloudAccessToken;
}

function buildPreflightParams(params: Record<string, unknown>) {
  return {
    executionToken: requireStringParam(
      params,
      "execution_token",
      "execution_token is required when confirm_brief=true",
    ),
    roleListingId: requireStringParam(
      params,
      "role_listing_id",
      "role_listing_id is required when confirm_brief=true",
    ),
    entitlementId: requireStringParam(
      params,
      "entitlement_id",
      "entitlement_id is required when confirm_brief=true",
    ),
    deviceId: requireStringParam(
      params,
      "device_id",
      "device_id is required when confirm_brief=true",
    ),
    workspaceRef: requireStringParam(
      params,
      "workspace_ref",
      "workspace_ref is required when confirm_brief=true",
    ),
    localGatewayId: requireStringParam(
      params,
      "local_gateway_id",
      "local_gateway_id is required when confirm_brief=true",
    ),
  };
}

function normalizeContextKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
}

function isForbiddenDeveloperModeContextKey(key: string): boolean {
  return FORBIDDEN_DEVELOPER_MODE_CONTEXT_KEYS.has(normalizeContextKey(key));
}

function redactForbiddenDeveloperModeContextText(value: string): string {
  return value
    .replace(PROVIDER_KEY_NAME_PATTERN, "[redacted_provider_key_name]")
    .replace(PROVIDER_KEY_VALUE_PATTERN, "[redacted_provider_key_value]")
    .replace(CLOUD_BEARER_PATTERN, "[redacted_cloud_bearer]");
}

function sanitizeDeveloperModeContextValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactForbiddenDeveloperModeContextText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDeveloperModeContextValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isForbiddenDeveloperModeContextKey(key))
      .map(([key, entry]) => [key, sanitizeDeveloperModeContextValue(entry)]),
  );
}

function sanitizeDeveloperModeBriefJson(roleBuildBriefJson: string): string {
  try {
    return JSON.stringify(
      sanitizeDeveloperModeContextValue(JSON.parse(roleBuildBriefJson)),
      null,
      2,
    );
  } catch {
    return redactForbiddenDeveloperModeContextText(roleBuildBriefJson);
  }
}

function buildLocalExecutorRoleBuilderPrompt(params: {
  requestZh: string;
  roleBuildBriefJson: string;
}): string {
  const sanitizedRequestZh = redactForbiddenDeveloperModeContextText(params.requestZh);
  const sanitizedRoleBuildBriefJson = sanitizeDeveloperModeBriefJson(params.roleBuildBriefJson);
  return [
    "你是迭界AI主系统岗位包生成，正在通过 OpenClaw main-system local execution / 本地主系统编程执行生成岗位包。",
    "",
    "开发者模式上下文 allowlist：",
    `- 允许：${AICS_DEVELOPER_MODE_CONTEXT_ALLOWLIST.join("、")}。`,
    "- 禁止：平台后端执行/身份/授权 ID、订单或钱包状态、价格快照、云端 bearer、raw token、provider key、审核/结算状态、普通用户对话历史和私有记忆。",
    "",
    DEVELOPER_MODE_GUIDE_PROMPT,
    "",
    ROLE_PACKAGE_BUILT_IN_MATERIALS,
    "",
    "硬性边界：",
    "- 只在当前工作区内创建或修改文件。",
    "- 必须把岗位包写入 `role_package/` 目录。",
    "- 不要写平台数据库，不要修改钱包、订单、entitlement、listing、deployment 或审核状态。",
    "- 如果确认 brief 缺少生成岗位包所需的核心字段，必须失败并在最终回复中明确列出缺失项，不能伪造成功。",
    "- 不要把模型密钥、provider auth、secret 原文写入岗位包。",
    "- 不要读取或输出平台后端资料；execution token、entitlement、审计、结算、订单、钱包和审核状态只由平台桥内部处理。",
    "",
    "最低产物：",
    "- `role_package/manifest.json`",
    "- `role_package/listing.md`",
    "- `role_package/README.md`",
    "- 至少一个 business/knowledge/playbook/workflow/experience/example 业务知识材料文件",
    "- 至少一个 wrapper/adapter 或接入示例文件，只说明 requiredCapabilities 到本地 OpenClaw 工具层的映射边界",
    "- 至少一个 validation 或 smoke test 说明/脚本",
    "",
    "隔离 workspace：当前工作目录就是本次岗位包生成的唯一工作区；只使用 `role_package/` 相对路径，不写本地绝对路径。",
    "",
    "用户中文需求：",
    sanitizedRequestZh,
    "",
    "已确认 RoleBuildBrief JSON：",
    sanitizedRoleBuildBriefJson,
  ].join("\n");
}

function expandLocalExecutorArg(arg: string, outputRoot: string, lastMessagePath: string): string {
  return arg
    .replaceAll("{outputRoot}", outputRoot)
    .replaceAll("{lastMessagePath}", lastMessagePath);
}

function buildLocalExecutorArgs(
  config: AicsConfig,
  outputRoot: string,
  lastMessagePath: string,
): string[] {
  if (config.localExecutorArgs) {
    return config.localExecutorArgs.map((arg) =>
      expandLocalExecutorArg(arg, outputRoot, lastMessagePath),
    );
  }
  if (!config.useLegacyCodexCliArgs) {
    return [];
  }
  // Legacy compatibility path only. This is not the 迭界AI product execution
  // boundary; the product path is the generic local executor and, next,
  // OpenClaw-native workspace/session execution.
  const args = [
    "exec",
    "--cd",
    outputRoot,
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--json",
    "--output-last-message",
    lastMessagePath,
  ];
  if (config.localExecutorModel) {
    args.push("--model", config.localExecutorModel);
  }
  if (config.localExecutorProfile) {
    args.push("--profile", config.localExecutorProfile);
  }
  args.push("-");
  return args;
}

function requireExistingRepo(config: AicsConfig): void {
  if (!existsSync(path.join(config.repoRoot, "main.py"))) {
    throw new Error(`迭界AI repo root is invalid or missing main.py: ${config.repoRoot}`);
  }
}

function resolveOutputRoot(config: AicsConfig, requested: unknown): string {
  const base = path.resolve(config.rolePackageOutputRoot);
  const outputRoot =
    typeof requested === "string" && requested.trim() ? path.resolve(requested) : base;
  const realBaseParent = path.resolve(base);
  const relative = path.relative(realBaseParent, outputRoot);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return outputRoot;
  }
  throw new Error(`output_root must stay under ${realBaseParent}`);
}

function truncateOutput(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return {
    text: `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`,
    truncated: true,
  };
}

function buildDefaultCommandEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONPYCACHEPREFIX: process.env.PYTHONPYCACHEPREFIX ?? "/private/tmp/aics_pycache",
  };
}

function buildLocalExecutorCommandEnv(): NodeJS.ProcessEnv {
  const allowedKeys = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "TERM",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
  ];
  const env: NodeJS.ProcessEnv = {
    PYTHONPYCACHEPREFIX: process.env.PYTHONPYCACHEPREFIX ?? "/private/tmp/aics_pycache",
  };
  for (const key of allowedKeys) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    maxOutputChars: number;
    timeoutMs?: number;
    stdin?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? buildDefaultCommandEnv(),
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let killedForTimeout = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          killedForTimeout = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : null;

    const childStdout = child.stdout;
    const childStderr = child.stderr;
    if (!childStdout || !childStderr) {
      reject(new Error("failed to open subprocess stdout/stderr pipes"));
      return;
    }
    childStdout.setEncoding("utf8");
    childStderr.setEncoding("utf8");
    childStdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    childStderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      if (timer) {
        clearTimeout(timer);
      }
      const out = truncateOutput(stdout, options.maxOutputChars);
      const err = truncateOutput(stderr, options.maxOutputChars);
      resolve({
        command: [command, ...args],
        cwd: options.cwd,
        exitCode,
        signal: killedForTimeout ? "SIGTERM" : signal,
        stdout: out.text,
        stderr: err.text,
        truncated: out.truncated || err.truncated,
      });
    });
    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    }
  });
}

type NativeRoleBuilderRuntime = Pick<PluginRuntime, "agent"> | undefined;

function canRunOpenClawNativeExecutor(
  runtime: NativeRoleBuilderRuntime,
): runtime is Pick<PluginRuntime, "agent"> {
  return typeof runtime?.agent?.runEmbeddedAgent === "function";
}

function collectEmbeddedAgentText(
  result: Awaited<ReturnType<PluginRuntime["agent"]["runEmbeddedAgent"]>>,
): string {
  const payloadText = result.payloads
    ?.map((payload) => payload.text)
    .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
    .join("\n");
  if (payloadText?.trim()) {
    return payloadText;
  }
  if (result.meta.finalAssistantVisibleText?.trim()) {
    return result.meta.finalAssistantVisibleText;
  }
  if (result.meta.finalAssistantRawText?.trim()) {
    return result.meta.finalAssistantRawText;
  }
  return "";
}

function embeddedAgentErrorText(
  result: Awaited<ReturnType<PluginRuntime["agent"]["runEmbeddedAgent"]>>,
): string {
  const payloadErrors = result.payloads
    ?.filter((payload) => payload.isError && payload.text?.trim())
    .map((payload) => payload.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n");
  if (payloadErrors?.trim()) {
    return payloadErrors;
  }
  if (result.meta.failureSignal?.message) {
    return result.meta.failureSignal.message;
  }
  if (result.meta.error?.message) {
    return result.meta.error.message;
  }
  return "";
}

function finiteTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function extractOpenClawNativeModelProxyUsage(
  result: Awaited<ReturnType<PluginRuntime["agent"]["runEmbeddedAgent"]>>,
): DijieModelProxyUsage {
  const meta = asRecord(result.meta);
  const agentMeta = asRecord(meta.agentMeta);
  const usage = asRecord(agentMeta.usage);
  const executionTrace = asRecord(meta.executionTrace);
  const attempts = Array.isArray(executionTrace.attempts) ? executionTrace.attempts : [];
  const inputTokens = finiteTokenCount(usage.input);
  const outputTokens = finiteTokenCount(usage.output);
  return {
    requestCount:
      attempts.length > 0 ? attempts.length : inputTokens > 0 || outputTokens > 0 ? 1 : 0,
    inputTokens,
    outputTokens,
  };
}

function zeroModelProxyUsage(): DijieModelProxyUsage {
  return {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

async function runOpenClawNativeRoleBuilder(params: {
  runtime: Pick<PluginRuntime, "agent">;
  runtimeConfig: OpenClawConfig;
  prompt: string;
  workspaceRoot: string;
  timeoutMs: number;
  maxOutputChars: number;
  preflight?: DijieExecutionPreflightOk;
}): Promise<CommandResult> {
  const sessionId = params.preflight
    ? `dijie-role-builder-${String(params.preflight.executionId)}`
    : `dijie-role-package-${Date.now()}`;
  const sessionFile = path.join(params.workspaceRoot, ".dijie_openclaw_native_session.json");
  const runId = `${sessionId}-${Date.now()}`;

  const result = await params.runtime.agent.runEmbeddedAgent({
    sessionId,
    sessionKey: sessionId,
    sandboxSessionKey: sessionId,
    sessionFile,
    workspaceDir: params.workspaceRoot,
    cwd: params.workspaceRoot,
    config: params.runtimeConfig,
    prompt: params.prompt,
    transcriptPrompt: "Generate a Dijie role_package from the confirmed RoleBuildBrief.",
    timeoutMs: params.timeoutMs,
    runId,
    trigger: "manual",
    messageChannel: "dijie-role-builder",
    disableMessageTool: true,
    cleanupBundleMcpOnRunEnd: true,
  });

  const stdout = truncateOutput(collectEmbeddedAgentText(result), params.maxOutputChars);
  const stderr = truncateOutput(embeddedAgentErrorText(result), params.maxOutputChars);
  const timedOut = Boolean(result.meta.timeoutPhase);
  const failed =
    timedOut ||
    result.meta.aborted === true ||
    Boolean(result.meta.error) ||
    Boolean(result.meta.failureSignal) ||
    Boolean(result.payloads?.some((payload) => payload.isError));

  return {
    command: ["openclaw-native", "runEmbeddedAgent"],
    cwd: params.workspaceRoot,
    exitCode: timedOut ? null : failed ? 1 : 0,
    signal: timedOut ? "SIGTERM" : null,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    modelProxyUsage: extractOpenClawNativeModelProxyUsage(result),
  };
}

function normalizeRequiredCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)),
  );
}

function safeRoleTaskSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "role-task";
}

function buildRoleTaskPrompt(params: {
  roleListingId: string;
  entitlementId: string;
  taskText: string;
  roleTitle?: string;
  roleSummary?: string;
  requiredCapabilities: string[];
}) {
  const roleTitle = params.roleTitle?.trim() || params.roleListingId;
  const roleSummary = params.roleSummary?.trim()
    ? redactForbiddenDeveloperModeContextText(params.roleSummary.trim())
    : "当前仅有岗位摘要，后续可接入完整 role_package。";
  const requiredCapabilities =
    params.requiredCapabilities.length > 0
      ? params.requiredCapabilities.join(", ")
      : "未声明，按任务需要使用当前 OpenClaw 已接入工具。";

  return [
    "你正在以迭界AI岗位任务执行器身份处理一个已授权岗位任务。",
    "",
    "产品边界：",
    "- 工具开放使用，岗位任务可以直接调用当前 OpenClaw 已接入工具。",
    "- 岗位无需工具授权，不要新增岗位专属的工具准入流程，不要把岗位和工具做成绑定关系。",
    "- requiredCapabilities 只描述岗位能力需求，不是工具授权表。",
    "- 通过 OpenClaw 本地工具池完成必要读取、编辑、浏览、执行或确认动作，并遵守现有安全策略。",
    "- 高风险、不可逆、费用、外部发布或人工判断动作必须请求人工确认。",
    "- 不输出 raw metadata、token、secret、本地绝对路径、平台内部协议或完整私有对话历史。",
    "",
    "岗位信息：",
    `- roleListingId: ${params.roleListingId}`,
    `- entitlementId: ${params.entitlementId}`,
    `- title: ${roleTitle}`,
    `- requiredCapabilities: ${requiredCapabilities}`,
    "",
    "岗位摘要：",
    roleSummary,
    "",
    "用户任务：",
    params.taskText.trim(),
    "",
    "完成后请用简洁中文输出：执行结果、关键依据、已使用的能力或工具类别、需要人工确认的事项、下一步建议。",
  ].join("\n");
}

function roleTaskNeedsDesignBriefArtifact(params: {
  taskText: string;
  requiredCapabilities: string[];
}): boolean {
  const text = params.taskText.toLowerCase();
  const canWriteDocument = params.requiredCapabilities.some(
    (capability) => capability === "document.write",
  );
  if (!canWriteDocument) {
    return false;
  }
  const designIntentPatterns = [
    /主图方案/u,
    /详情页(?:结构|尺寸|规范|方案)/u,
    /设计方案/u,
    /中国风/u,
    /整套详情页/u,
  ];
  return designIntentPatterns.some((pattern) => pattern.test(text));
}

function extractQuotedProductName(taskText: string): string {
  const match = taskText.match(/产品(?:是|为)?[「“"]([^」”"]+)[」”"]/u);
  return match?.[1]?.trim() || "岗位商城首批岗位商品";
}

function buildRoleTaskDesignBriefContent(params: {
  roleListingId: string;
  entitlementId: string;
  taskText: string;
  roleTitle?: string;
  requiredCapabilities: string[];
  startedAt: string;
}) {
  const roleTitle = params.roleTitle?.trim() || params.roleListingId;
  const productName = extractQuotedProductName(params.taskText);
  const referenceReadable = params.taskText.includes("e.tb.cn")
    ? "参考页为淘宝短链，正式执行侧可能需要登录或扫码，当前文本方案按商品标题、中国风要求和电商详情页通用规范产出。"
    : "未提供可直接读取的参考页，当前文本方案按任务描述、岗位商城授权转化目标和电商详情页通用规范产出。";

  return [
    "# 岗位商城电商美工展示优化方案",
    "",
    `- 岗位：${roleTitle}`,
    `- roleListingId：${params.roleListingId}`,
    `- entitlementId：${params.entitlementId}`,
    `- 产出时间：${params.startedAt}`,
    `- 服务对象：${productName}`,
    `- 参考页状态：${referenceReadable}`,
    "",
    "## 5 张岗位商品主图方案",
    "",
    "1. 岗位价值主图：岗位名称居中，突出“授权后可执行 / 产物可回写 / 审计可追踪”，适合作为首图。",
    "2. 使用场景主图：展示经营后台到岗位执行的路径，强调从观察、规划、调度到产物回写的闭环。",
    "3. 能力边界主图：用三栏展示可做、需确认、不可做，降低授权前误解。",
    "4. 结果样例主图：展示方案文本、图片建议、详情结构等产物类型，强化购买后的确定性。",
    "5. 授权费用主图：清晰展示一次授权、执行费用确认和 ledger 记录，减少费用顾虑。",
    "",
    "## 主图巡检报告",
    "",
    "- 主体占比：首图建议岗位名称和核心收益占画面 50%-65%，辅助流程信息控制在 3 个以内。",
    "- 信息密度：每张主图保留 1 个主卖点和 2-3 个辅助标签，避免授权、费用、能力说明混在一屏。",
    "- 风格一致性：岗位商城建议使用清晰的运营后台视觉语言，避免营销噪音压过能力边界。",
    "- 合规风险：避免“全自动赚钱”“永久可用”“效果保证”等绝对化词汇；可使用“人工确认执行”“产物可追踪”等稳妥表达。",
    "- 图片能力备注：本 artifact 为正式文本设计方案；图片生成产物可作为后续增强任务单独发起。",
    "",
    "## 岗位商品详情页结构与尺寸规范",
    "",
    "- 详情页宽度：淘宝/天猫无线详情建议按 750px 宽设计，模块高度按内容分段，单屏控制在 900-1400px。",
    "- 首屏：岗位名称 + 一句话服务结果 + 授权状态说明，建议 750x1000。",
    "- 能力模块：输入要求、可调用能力、输出产物、失败边界，每个模块 750x900 左右。",
    "- 流程模块：购买/授权、费用确认、调度执行、产物回写、审计读取，建议 750x1200。",
    "- 案例模块：用首批岗位商品的示例任务和示例产物说明实际价值，建议 750x1000。",
    "- 费用授权模块：一次授权费、执行费用确认、ledger 记录和退款/失败边界，建议 750x900。",
    "",
    "## 使用说明",
    "",
    "- 使用者后续若要生成图片，请提供岗位商品名称、能力边界、目标用户、品牌/Logo、主色、禁用词、平台尺寸要求。",
    "- 若只提供文字需求，本岗位应至少返回设计方案文本 artifact，不能空产物标记业务成功。",
  ].join("\n");
}

function createRoleTaskTextArtifact(params: {
  workspaceDir: string;
  runId: string;
  roleListingId: string;
  entitlementId: string;
  taskText: string;
  roleTitle?: string;
  requiredCapabilities: string[];
  startedAt: string;
}):
  | {
      relativePath: string;
      artifact: DijieRoleArtifact;
      content: string;
    }
  | undefined {
  if (!roleTaskNeedsDesignBriefArtifact(params)) {
    return undefined;
  }
  const content = buildRoleTaskDesignBriefContent(params);
  const relativePath = path.posix.join(
    "business_artifacts",
    `${safeRoleTaskSlug(params.runId)}-design-brief.md`,
  );
  const absolutePath = path.join(params.workspaceDir, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
  return {
    relativePath,
    content,
    artifact: {
      id: `artifact_${safeRoleTaskSlug(params.runId)}_design_brief`,
      type: "role_task_design_brief",
      title: "岗位商城电商美工展示优化方案文本",
      path: relativePath,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
    },
  };
}

function statusFromEmbeddedAgentResult(
  result: Awaited<ReturnType<PluginRuntime["agent"]["runEmbeddedAgent"]>>,
): DijieRoleTaskStatus {
  if (result.meta.timeoutPhase) {
    return "timed_out";
  }
  if (result.meta.aborted === true) {
    return "cancelled";
  }
  if (result.meta.error || result.meta.failureSignal) {
    return "failed";
  }
  if (
    result.payloads?.some((payload) => payload.isError) &&
    !collectEmbeddedAgentText(result).trim()
  ) {
    return "failed";
  }
  return "completed";
}

function countEmbeddedAgentToolCalls(value: unknown): number {
  const seen = new Set<unknown>();
  let count = 0;

  function visit(node: unknown) {
    if (!node || typeof node !== "object" || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if ((key === "toolCalls" || key === "tool_calls") && Array.isArray(child)) {
        count += child.length;
      }
      visit(child);
    }
  }

  visit(value);
  return count;
}

function buildRoleTaskRuntimeConfig(runtimeConfig: OpenClawConfig): OpenClawConfig {
  return {
    ...runtimeConfig,
    plugins: {
      ...runtimeConfig.plugins,
      entries: {
        ...runtimeConfig.plugins?.entries,
        aics: {
          ...runtimeConfig.plugins?.entries?.aics,
          enabled: false,
        },
      },
    },
  };
}

function embeddedRoleTaskTimeoutResult(params: {
  timeoutMs: number;
}): Awaited<ReturnType<PluginRuntime["agent"]["runEmbeddedAgent"]>> {
  return {
    payloads: [
      {
        isError: true,
        text: `迭界AI岗位任务执行超过 ${params.timeoutMs}ms，已按 timed_out 失败处理。`,
      },
    ],
    meta: {
      timeoutPhase: "dijie_role_task_run",
      failureSignal: {
        message: `dijie_role_task_run timed out after ${params.timeoutMs}ms`,
      },
    },
  } as Awaited<ReturnType<PluginRuntime["agent"]["runEmbeddedAgent"]>>;
}

function roleTaskEmbeddedTimeoutMs(requestedTimeoutMs: number): number {
  return Math.max(
    MIN_ROLE_TASK_EMBEDDED_TIMEOUT_MS,
    requestedTimeoutMs - ROLE_TASK_AUDIT_RETURN_BUFFER_MS,
  );
}

async function withRoleTaskHardTimeout(
  promise: ReturnType<PluginRuntime["agent"]["runEmbeddedAgent"]>,
  timeoutMs: number,
): Promise<Awaited<ReturnType<PluginRuntime["agent"]["runEmbeddedAgent"]>>> {
  let timer: NodeJS.Timeout | undefined;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      resolve(embeddedRoleTaskTimeoutResult({ timeoutMs }));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (timer) {
          clearTimeout(timer);
        }
        resolve(value);
      },
      (error) => {
        if (timer) {
          clearTimeout(timer);
        }
        reject(error);
      },
    );
  });
}

async function runOpenClawNativeRoleTask(params: {
  runtime: Pick<PluginRuntime, "agent">;
  runtimeConfig: OpenClawConfig;
  workspaceDir: string;
  roleListingId: string;
  entitlementId: string;
  taskText: string;
  roleTitle?: string;
  roleSummary?: string;
  requiredCapabilities: string[];
  timeoutMs: number;
  maxOutputChars: number;
}) {
  const workspaceDir = realpathSync(params.workspaceDir);
  const startedAt = new Date().toISOString();
  const runId = `dijie-role-task-${safeRoleTaskSlug(params.roleListingId)}-${Date.now()}`;
  const sessionId = runId;
  const sessionFile = path.join(workspaceDir, `.dijie_role_task_session-${runId}.json`);
  const prompt = buildRoleTaskPrompt(params);
  const embeddedTimeoutMs = roleTaskEmbeddedTimeoutMs(params.timeoutMs);
  const synchronousArtifact = createRoleTaskTextArtifact({
    workspaceDir,
    runId,
    roleListingId: params.roleListingId,
    entitlementId: params.entitlementId,
    taskText: params.taskText,
    ...(params.roleTitle ? { roleTitle: params.roleTitle } : {}),
    requiredCapabilities: params.requiredCapabilities,
    startedAt,
  });
  if (synchronousArtifact) {
    const endedAt = new Date().toISOString();
    const capabilityValidation = resolveAicsRoleRequiredCapabilities(params.requiredCapabilities);
    const modelProxyUsage = zeroModelProxyUsage();
    const toolUsage: DijieRoleTaskToolUsage = {
      openToolPool: true,
      invocationPath: "openclaw-native-embedded-agent",
      toolCallCount: 0,
    };
    const roleResult = {
      runId,
      roleListingId: params.roleListingId,
      entitlementId: params.entitlementId,
      status: "completed" as const,
      startedAt,
      endedAt,
      summary: "迭界AI岗位任务执行完成。",
      output: truncateOutput(synchronousArtifact.content, params.maxOutputChars).text,
      changedFiles: [synchronousArtifact.relativePath],
      artifacts: [synchronousArtifact.artifact],
    };
    const auditSummary = {
      runId,
      roleListingId: params.roleListingId,
      entitlementId: params.entitlementId,
      status: "completed" as const,
      startedAt,
      endedAt,
      modelProxyUsage,
      toolUsage,
      requiredCapabilities: params.requiredCapabilities,
      capabilityValidation,
      changedFiles: roleResult.changedFiles,
      artifacts: roleResult.artifacts,
      result: roleResult,
    };

    return {
      ok: true,
      summary: roleResult.summary,
      status: "completed" as const,
      roleListingId: params.roleListingId,
      entitlementId: params.entitlementId,
      runId,
      roleResult,
      auditSummary,
      workboardEvent: {
        type: "role_task.completed",
        runId,
        roleListingId: params.roleListingId,
        entitlementId: params.entitlementId,
        status: "completed" as const,
        startedAt,
        endedAt,
      },
      modelProxyUsage,
      toolUsage,
      requiredCapabilities: params.requiredCapabilities,
      capabilityValidation,
      changedFiles: roleResult.changedFiles,
      artifacts: roleResult.artifacts,
      executionEngine: "openclaw-native",
    };
  }

  const embeddedRun = params.runtime.agent.runEmbeddedAgent({
    sessionId,
    sessionKey: sessionId,
    sandboxSessionKey: sessionId,
    sessionFile,
    workspaceDir,
    cwd: workspaceDir,
    config: buildRoleTaskRuntimeConfig(params.runtimeConfig),
    prompt,
    transcriptPrompt: "Run the selected Dijie role task with OpenClaw tools.",
    timeoutMs: embeddedTimeoutMs,
    runId,
    trigger: "manual",
    messageChannel: "dijie-role-task",
    disableMessageTool: true,
    cleanupBundleMcpOnRunEnd: true,
  });
  const result = await withRoleTaskHardTimeout(embeddedRun, embeddedTimeoutMs);

  const endedAt = new Date().toISOString();
  const status = statusFromEmbeddedAgentResult(result);
  const output = truncateOutput(collectEmbeddedAgentText(result), params.maxOutputChars);
  const error = truncateOutput(embeddedAgentErrorText(result), params.maxOutputChars);
  const modelProxyUsage = extractOpenClawNativeModelProxyUsage(result);
  const toolUsage: DijieRoleTaskToolUsage = {
    openToolPool: true,
    invocationPath: "openclaw-native-embedded-agent",
    toolCallCount: countEmbeddedAgentToolCalls(result.meta),
  };
  const capabilityValidation = resolveAicsRoleRequiredCapabilities(params.requiredCapabilities);
  const roleResult = {
    runId,
    roleListingId: params.roleListingId,
    entitlementId: params.entitlementId,
    status,
    startedAt,
    endedAt,
    summary:
      status === "completed"
        ? "迭界AI岗位任务执行完成。"
        : status === "timed_out"
          ? "迭界AI岗位任务执行超时。"
          : status === "cancelled"
            ? "迭界AI岗位任务已取消。"
            : "迭界AI岗位任务执行失败。",
    output: output.text,
    changedFiles: [] as string[],
    artifacts: [] as DijieRoleArtifact[],
    ...(error.text ? { error: error.text } : {}),
  };
  const auditSummary = {
    runId,
    roleListingId: params.roleListingId,
    entitlementId: params.entitlementId,
    status,
    startedAt,
    endedAt,
    modelProxyUsage,
    toolUsage,
    requiredCapabilities: params.requiredCapabilities,
    capabilityValidation,
    changedFiles: roleResult.changedFiles,
    artifacts: roleResult.artifacts,
    result: roleResult,
  };

  return {
    ok: status === "completed",
    summary: roleResult.summary,
    status,
    roleListingId: params.roleListingId,
    entitlementId: params.entitlementId,
    runId,
    roleResult,
    auditSummary,
    workboardEvent: {
      type: `role_task.${status}`,
      runId,
      roleListingId: params.roleListingId,
      entitlementId: params.entitlementId,
      status,
      startedAt,
      endedAt,
    },
    modelProxyUsage,
    toolUsage,
    requiredCapabilities: params.requiredCapabilities,
    capabilityValidation,
    changedFiles: roleResult.changedFiles,
    artifacts: roleResult.artifacts,
    executionEngine: "openclaw-native",
  };
}

async function resolveRoleTaskExecutionContext(
  config: AicsConfig,
  params: Record<string, unknown>,
): Promise<DijieRoleTaskExecutionContext> {
  const taskText = requireStringParam(params, "task_text");
  const explicitRoleListingId = stringField(params, "role_listing_id");
  const explicitEntitlementId = stringField(params, "entitlement_id");
  const roleQuery = stringField(params, "role_query");
  const roleTitle = stringField(params, "role_title");
  const requiredCapabilities = normalizeRequiredCapabilities(params.required_capabilities);
  const deviceId = stringField(params, "device_id") ?? config.defaultDeviceId;
  const workspaceRef = stringField(params, "workspace_ref") ?? config.defaultWorkspaceRef;
  const localGatewayId = stringField(params, "local_gateway_id") ?? config.defaultLocalGatewayId;

  let context: DijieInstalledRoleContext | undefined;
  const hasExplicitContext = Boolean(explicitRoleListingId && explicitEntitlementId);
  if (hasExplicitContext) {
    context = {
      roleListingId: explicitRoleListingId!,
      entitlementId: explicitEntitlementId!,
      ...(roleTitle ? { roleTitle } : {}),
      ...(stringField(params, "role_summary")
        ? { roleSummary: stringField(params, "role_summary") }
        : {}),
      requiredCapabilities,
      source: "explicit-params",
    };
  } else {
    if (!config.cloudAccessToken) {
      throw new Error(
        "AICS main-chat execution context requires a backend-only cloudAccessToken; do not ask the user to paste bearer tokens into chat.",
      );
    }
    const roles = await readCloudInstalledRoles({
      config,
      cloudAccessToken: config.cloudAccessToken,
      ...(workspaceRef ? { workspaceRef } : {}),
      ...(deviceId ? { deviceId } : {}),
    });
    context = selectInstalledRoleContext(roles, {
      ...(explicitRoleListingId ? { roleListingId: explicitRoleListingId } : {}),
      ...(explicitEntitlementId ? { entitlementId: explicitEntitlementId } : {}),
      ...(roleQuery ? { roleQuery } : {}),
      ...(roleTitle ? { roleTitle } : {}),
      taskText,
    });
    if (!context) {
      throw new Error(
        "AICS main-chat execution context could not match the requested role from installed roles. Ask the user to choose one installed role by name, not by token or entitlement.",
      );
    }
  }

  const mergedRequiredCapabilities =
    requiredCapabilities.length > 0 ? requiredCapabilities : context.requiredCapabilities;
  const resolvedContext = {
    ...context,
    requiredCapabilities: mergedRequiredCapabilities,
  };

  if (!config.cloudAccessToken && hasExplicitContext) {
    return {
      ...resolvedContext,
      auditUploadPlanned: false,
    };
  }
  if (!config.cloudAccessToken || !deviceId || !workspaceRef || !localGatewayId) {
    if (hasExplicitContext) {
      return {
        ...resolvedContext,
        auditUploadPlanned: false,
      };
    }
    throw new Error(
      "AICS main-chat execution context requires backend cloudAccessToken, defaultDeviceId, defaultWorkspaceRef, and defaultLocalGatewayId.",
    );
  }

  const grant = await requestCloudExecutionGrant({
    config,
    cloudAccessToken: config.cloudAccessToken,
    roleListingId: resolvedContext.roleListingId,
    entitlementId: resolvedContext.entitlementId,
    deviceId,
    workspaceRef,
    localGatewayId,
  });
  const preflight = verifyDijieExecutionPreflight(config, {
    executionToken: grant.token,
    roleListingId: grant.roleListingId,
    entitlementId: grant.entitlementId,
    deviceId: grant.deviceId,
    workspaceRef: grant.workspaceRef,
    localGatewayId: grant.localGatewayId,
  });
  assertDijieExecutionPreflightOk(preflight);

  return {
    ...resolvedContext,
    roleListingId: preflight.roleListingId,
    entitlementId: preflight.entitlementId,
    executionToken: grant.token,
    preflight,
    auditUploadPlanned: config.cloudAuditUploadEnabled,
  };
}

function buildRoleTaskCloudToolUsage(toolUsage: DijieRoleTaskToolUsage): DijieToolUsage {
  return {
    shellCommands: toolUsage.toolCallCount,
    testsRun: 0,
    filesRead: 0,
    filesChanged: 0,
  };
}

function buildDijieRoleTaskCloudAuditSummary(params: {
  preflight: DijieExecutionPreflightOk;
  roleTaskResult: Awaited<ReturnType<typeof runOpenClawNativeRoleTask>>;
}) {
  const modelProxyUsage = params.roleTaskResult.modelProxyUsage ?? zeroModelProxyUsage();
  const toolUsage = buildRoleTaskCloudToolUsage(params.roleTaskResult.toolUsage);
  const outputText =
    typeof params.roleTaskResult.roleResult.output === "string"
      ? params.roleTaskResult.roleResult.output.trim()
      : "";
  const hasBusinessArtifact = Boolean(outputText);
  const status =
    params.roleTaskResult.status === "completed" && !hasBusinessArtifact
      ? "failed"
      : params.roleTaskResult.status;
  const summary = outputText || params.roleTaskResult.roleResult.summary;
  const changedFiles = params.roleTaskResult.changedFiles ?? [];
  const roleTaskArtifacts = params.roleTaskResult.artifacts ?? [];
  const artifacts: DijieRoleArtifact[] =
    status === "completed"
      ? roleTaskArtifacts.length > 0
        ? roleTaskArtifacts
        : [
            {
              id: `artifact_${params.preflight.executionId}_role_task_result`,
              type: "role_task_result_text",
              title: "岗位任务业务结果文本",
              sizeBytes: Buffer.byteLength(outputText, "utf8"),
              sha256: crypto.createHash("sha256").update(outputText).digest("hex"),
            },
          ]
      : [];
  const error =
    params.roleTaskResult.roleResult.error ||
    (params.roleTaskResult.status === "completed" && !hasBusinessArtifact
      ? "failed/no_artifact"
      : undefined);
  const roleResult = {
    executionId: params.preflight.executionId,
    roleListingId: params.preflight.roleListingId,
    packageId: params.preflight.packageId,
    packageVersion: params.preflight.packageVersion,
    developerRef: params.preflight.developerRef,
    listingOwnerRef: params.preflight.listingOwnerRef,
    billingBeneficiaryRef: params.preflight.billingBeneficiaryRef,
    status,
    startedAt: params.roleTaskResult.roleResult.startedAt,
    endedAt: params.roleTaskResult.roleResult.endedAt,
    roleTokenPricing: params.preflight.roleTokenPricing,
    modelProxyUsage,
    summary,
    changedFiles,
    artifacts,
    ...(error ? { error } : {}),
  };

  return {
    executionId: params.preflight.executionId,
    deviceId: params.preflight.deviceId,
    workspaceRef: params.preflight.workspaceRef,
    roleListingId: params.preflight.roleListingId,
    packageId: params.preflight.packageId,
    packageVersion: params.preflight.packageVersion,
    developerRef: params.preflight.developerRef,
    listingOwnerRef: params.preflight.listingOwnerRef,
    billingBeneficiaryRef: params.preflight.billingBeneficiaryRef,
    entitlementId: params.preflight.entitlementId,
    localGatewayId: params.preflight.localGatewayId,
    status,
    startedAt: params.roleTaskResult.roleResult.startedAt,
    endedAt: params.roleTaskResult.roleResult.endedAt,
    roleTokenPricing: params.preflight.roleTokenPricing,
    modelProxyUsage,
    toolUsage,
    result: roleResult,
  };
}

function toWorkspaceRelativePath(rootRealPath: string, absolutePath: string): string {
  const relative = path.relative(rootRealPath, absolutePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`role package file escaped output workspace: ${absolutePath}`);
  }
  return relative.split(path.sep).join("/");
}

function listWorkspaceFiles(workspaceRoot: string): RolePackageFile[] {
  const rootRealPath = realpathSync(workspaceRoot);
  const files: RolePackageFile[] = [];

  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        throw new Error(
          `role package output must not contain symlinks: ${path.join(directory, entry.name)}`,
        );
      }
      const absolutePath = path.join(directory, entry.name);
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!stats.isFile()) {
        continue;
      }
      const realPath = realpathSync(absolutePath);
      const relativePath = toWorkspaceRelativePath(rootRealPath, realPath);
      const content = readFileSync(realPath);
      files.push({
        relativePath,
        absolutePath: realPath,
        sizeBytes: stats.size,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
      });
    }
  }

  visit(rootRealPath);
  return files.sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
  );
}

function isRolePackageRelativePath(value: string): boolean {
  return (
    value.startsWith("role_package/") &&
    !value.startsWith("/") &&
    !value.split("/").includes("..") &&
    !LOCAL_ABSOLUTE_PATH_PATTERN.test(value)
  );
}

function isRolePackageEntrypointCandidate(relativePath: string): boolean {
  return (
    isRolePackageRelativePath(relativePath) &&
    relativePath !== ROLE_PACKAGE_MANIFEST_PATH &&
    /(^|\/)(wrappers?|adapters?|examples?|samples?|integrations?)(\/|[-_.])|[-_.](wrapper|adapter|example|sample|integration)\./i.test(
      relativePath,
    )
  );
}

function isRolePackageToolImplementationPath(relativePath: string): boolean {
  return ROLE_PACKAGE_TOOL_IMPLEMENTATION_PATH_PATTERN.test(relativePath);
}

function emptyRoleCapabilityValidation(): AicsRoleCapabilityValidation {
  return {
    required: [],
    resolved: [],
    missing: [],
  };
}

function validateRequiredCapabilities(value: unknown): {
  errors: string[];
  capabilities: AicsRoleCapabilityValidation;
} {
  if (!Array.isArray(value)) {
    return {
      errors: ["role_package/manifest.json requiredCapabilities must be a non-empty array"],
      capabilities: emptyRoleCapabilityValidation(),
    };
  }
  const capabilities = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  if (capabilities.length === 0) {
    return {
      errors: [
        "role_package/manifest.json requiredCapabilities must include local OpenClaw capability names",
      ],
      capabilities: emptyRoleCapabilityValidation(),
    };
  }
  const errors: string[] = [];
  for (const capability of capabilities) {
    if (!REQUIRED_CAPABILITY_PATTERN.test(capability)) {
      errors.push(
        "role_package/manifest.json requiredCapabilities entries must be stable names like workspace.read or human.confirm",
      );
      break;
    }
    if (
      PROVIDER_KEY_NAME_PATTERN.test(capability) ||
      PROVIDER_KEY_VALUE_PATTERN.test(capability) ||
      CLOUD_BEARER_PATTERN.test(capability) ||
      SECRET_FIELD_PATTERN.test(capability)
    ) {
      errors.push("role_package/manifest.json requiredCapabilities must not contain secrets");
      break;
    }
  }
  const capabilityValidation = resolveAicsRoleRequiredCapabilities(capabilities);
  for (const capability of capabilityValidation.missing) {
    errors.push(
      `role_package/manifest.json requiredCapabilities has no OpenClaw tool protocol bridge for ${capability.capability}`,
    );
  }
  return {
    errors,
    capabilities: capabilityValidation,
  };
}

function chooseRolePackageEntrypoint(files: RolePackageFile[]): string {
  return (
    files
      .map((file) => file.relativePath)
      .filter((relativePath) => isRolePackageEntrypointCandidate(relativePath))
      .sort((a, b) => {
        const rank = (relativePath: string) => {
          if (/(^|\/)adapters?(\/|[-_.])/i.test(relativePath)) {
            return 0;
          }
          if (/(^|\/)wrappers?(\/|[-_.])/i.test(relativePath)) {
            return 1;
          }
          if (/(^|\/)(examples?|samples?|integrations?)(\/|[-_.])/i.test(relativePath)) {
            return 2;
          }
          return 3;
        };
        const rankDelta = rank(a) - rank(b);
        return rankDelta !== 0 ? rankDelta : a < b ? -1 : a > b ? 1 : 0;
      })[0] ?? ""
  );
}

function safePublicManifestString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const redacted = redactForbiddenDeveloperModeContextText(value).trim();
  if (
    !redacted ||
    LOCAL_ABSOLUTE_PATH_PATTERN.test(redacted) ||
    SECRET_FIELD_PATTERN.test(redacted)
  ) {
    return undefined;
  }
  return redacted;
}

function firstSafePublicManifestString(values: unknown[]): string | undefined {
  for (const value of values) {
    const safe = safePublicManifestString(value);
    if (safe) {
      return safe;
    }
  }
  return undefined;
}

function readRoleBuildBriefRecord(roleBuildBriefJson: string): Record<string, unknown> {
  try {
    return asRecord(sanitizeDeveloperModeContextValue(JSON.parse(roleBuildBriefJson)));
  } catch {
    return {};
  }
}

function readGeneratedRolePackageRequiredCapabilities(files: RolePackageFile[]): unknown {
  const manifestFile = files.find((file) => file.relativePath === ROLE_PACKAGE_MANIFEST_PATH);
  if (!manifestFile) {
    return undefined;
  }
  try {
    const manifest = asRecord(JSON.parse(readFileSync(manifestFile.absolutePath, "utf8")));
    if ("requiredCapabilities" in manifest) {
      return manifest.requiredCapabilities;
    }
    if ("required_capabilities" in manifest) {
      return manifest.required_capabilities;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function slugifyRolePackageName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48)
    .replace(/_+$/u, "");
}

function deterministicRolePackageId(name: string): string {
  const slug = slugifyRolePackageName(name);
  if (slug) {
    return `pkg_${slug}`;
  }
  const digest = crypto.createHash("sha256").update(name).digest("hex").slice(0, 12);
  return `pkg_role_package_${digest}`;
}

function normalizeRolePackageManifest(params: {
  workspaceRoot: string;
  files: RolePackageFile[];
  roleBuildBriefJson: string;
  packageId?: string;
  packageVersion?: string;
}) {
  const rolePackageDir = path.join(params.workspaceRoot, "role_package");
  const hasRolePackageOutput =
    existsSync(rolePackageDir) ||
    params.files.some((file) => file.relativePath.startsWith("role_package/"));
  if (!hasRolePackageOutput) {
    return;
  }

  mkdirSync(rolePackageDir, { recursive: true });
  const briefRecord = readRoleBuildBriefRecord(params.roleBuildBriefJson);
  const name =
    firstSafePublicManifestString([
      briefRecord.name,
      briefRecord.roleName,
      briefRecord.role_name,
      briefRecord.title,
    ]) ?? DEFAULT_PUBLIC_ROLE_PACKAGE_NAME;
  const rolePackageId =
    safePublicManifestString(params.packageId) ?? deterministicRolePackageId(name);
  const version =
    safePublicManifestString(params.packageVersion) ?? DEFAULT_PUBLIC_ROLE_PACKAGE_VERSION;
  const entrypoint = chooseRolePackageEntrypoint(params.files);
  const requiredCapabilities = readGeneratedRolePackageRequiredCapabilities(params.files) ?? [
    ...DEFAULT_PUBLIC_ROLE_PACKAGE_REQUIRED_CAPABILITIES,
  ];
  const files = params.files
    .filter(
      (file) =>
        file.relativePath.startsWith("role_package/") &&
        file.relativePath !== ROLE_PACKAGE_MANIFEST_PATH,
    )
    .map((file) => ({
      path: file.relativePath,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
    }));

  const manifest = {
    manifestVersion: 1,
    rolePackageId,
    version,
    name,
    entrypoint,
    permissions: [...DEFAULT_PUBLIC_ROLE_PACKAGE_PERMISSIONS],
    requiredCapabilities,
    files,
  };
  writeFileSync(
    path.join(params.workspaceRoot, ROLE_PACKAGE_MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function combineRolePackageValidation(
  validation: RolePackageValidation,
  additionalErrors: string[],
) {
  const errors = Array.from(new Set([...additionalErrors, ...validation.errors]));
  return {
    ok: errors.length === 0,
    errors,
    capabilities: validation.capabilities,
  };
}

function uniqueNonEmptyStrings(values: Array<unknown>): string[] {
  return Array.from(
    new Set(
      values.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      ),
    ),
  );
}

function buildForbiddenArtifactExactValues(params: {
  preflight: DijieExecutionPreflightOk;
  executionToken: string;
}): string[] {
  return uniqueNonEmptyStrings([
    params.executionToken,
    params.preflight.executionId,
    params.preflight.actorId,
    params.preflight.roleListingId,
    params.preflight.entitlementId,
    params.preflight.deviceId,
    params.preflight.workspaceRef,
    params.preflight.localGatewayId,
  ]);
}

function artifactBackendOnlyKeys(content: string): string[] {
  const keys: string[] = [];
  const keyMatches = content.matchAll(/["']?([A-Za-z][A-Za-z0-9_-]{2,})["']?\s*[:=]/gu);
  for (const match of keyMatches) {
    const key = match[1];
    if (key && BACKEND_ONLY_ARTIFACT_KEYS.has(normalizeContextKey(key))) {
      keys.push(key);
    }
  }
  return Array.from(new Set(keys));
}

function scanRolePackageArtifactContent(params: {
  file: RolePackageFile;
  content: string;
  workspaceRoot: string;
  forbiddenExactValues: string[];
}): string[] {
  const errors: string[] = [];
  const prefix = `${params.file.relativePath} contains`;

  for (const exactValue of params.forbiddenExactValues) {
    if (params.content.includes(exactValue)) {
      errors.push(`${prefix} backend-only id or raw execution token`);
      break;
    }
  }

  if (
    PROVIDER_KEY_NAME_PATTERN.test(params.content) ||
    PROVIDER_KEY_VALUE_PATTERN.test(params.content)
  ) {
    errors.push(`${prefix} provider key name or value`);
  }
  if (CLOUD_BEARER_PATTERN.test(params.content)) {
    errors.push(`${prefix} cloud bearer token`);
  }
  if (SECRET_FIELD_PATTERN.test(params.content)) {
    errors.push(`${prefix} secret or token field`);
  }
  if (
    LOCAL_ABSOLUTE_PATH_PATTERN.test(params.content) ||
    params.content.includes(params.workspaceRoot)
  ) {
    errors.push(`${prefix} local absolute path`);
  }
  for (const backendOnlyKey of artifactBackendOnlyKeys(params.content)) {
    errors.push(`${prefix} backend-only field ${backendOnlyKey}`);
  }
  return errors;
}

function scanRolePackageArtifacts(params: {
  workspaceRoot: string;
  files: RolePackageFile[];
  preflight?: DijieExecutionPreflightOk;
  executionToken?: string;
}): string[] {
  const forbiddenExactValues =
    params.preflight && params.executionToken
      ? buildForbiddenArtifactExactValues({
          preflight: params.preflight,
          executionToken: params.executionToken,
        })
      : [];
  const errors: string[] = [];
  for (const file of params.files) {
    if (!file.relativePath.startsWith("role_package/")) {
      continue;
    }
    const content = readFileSync(file.absolutePath, "utf8");
    errors.push(
      ...scanRolePackageArtifactContent({
        file,
        content,
        workspaceRoot: params.workspaceRoot,
        forbiddenExactValues,
      }),
    );
  }
  return errors;
}

function validateRolePackage(
  workspaceRoot: string,
  files: RolePackageFile[],
  scanContext?: {
    preflight: DijieExecutionPreflightOk;
    executionToken: string;
  },
): RolePackageValidation {
  const filePaths = new Set(files.map((file) => file.relativePath));
  const errors: string[] = [];
  let capabilityValidation = emptyRoleCapabilityValidation();
  const requiredFiles = [
    ROLE_PACKAGE_MANIFEST_PATH,
    "role_package/listing.md",
    "role_package/README.md",
  ];
  for (const requiredFile of requiredFiles) {
    if (!filePaths.has(requiredFile)) {
      errors.push(`missing ${requiredFile}`);
    }
  }

  if (filePaths.has(ROLE_PACKAGE_MANIFEST_PATH)) {
    try {
      const manifest = JSON.parse(
        readFileSync(path.join(workspaceRoot, ROLE_PACKAGE_MANIFEST_PATH), "utf8"),
      );
      const manifestRecord =
        manifest && typeof manifest === "object" && !Array.isArray(manifest)
          ? (manifest as Record<string, unknown>)
          : {};
      if (manifestRecord.manifestVersion !== 1) {
        errors.push("role_package/manifest.json manifestVersion must be 1");
      }
      for (const field of ["rolePackageId", "version", "name", "entrypoint"]) {
        if (typeof manifestRecord[field] !== "string" || !manifestRecord[field].trim()) {
          errors.push(`role_package/manifest.json ${field} is required`);
        }
      }
      if ("roleListingId" in manifestRecord || "role_listing_id" in manifestRecord) {
        errors.push("role_package/manifest.json must not contain backend-only roleListingId");
      }
      if (
        typeof manifestRecord.entrypoint === "string" &&
        manifestRecord.entrypoint.trim() &&
        (!manifestRecord.entrypoint.startsWith("role_package/") ||
          manifestRecord.entrypoint.startsWith("/") ||
          manifestRecord.entrypoint.split("/").includes("..") ||
          LOCAL_ABSOLUTE_PATH_PATTERN.test(manifestRecord.entrypoint))
      ) {
        errors.push("role_package/manifest.json entrypoint must be a role_package/ relative path");
      }
      if (
        typeof manifestRecord.entrypoint === "string" &&
        manifestRecord.entrypoint.trim() &&
        !filePaths.has(manifestRecord.entrypoint)
      ) {
        errors.push("role_package/manifest.json entrypoint must reference an existing file");
      }
      if (
        typeof manifestRecord.entrypoint === "string" &&
        manifestRecord.entrypoint.trim() &&
        filePaths.has(manifestRecord.entrypoint) &&
        !isRolePackageEntrypointCandidate(manifestRecord.entrypoint)
      ) {
        errors.push(
          "role_package/manifest.json entrypoint must reference a wrapper, adapter, or example file",
        );
      }
      if (!Array.isArray(manifestRecord.permissions)) {
        errors.push("role_package/manifest.json permissions must be an array");
      } else {
        const permissions = manifestRecord.permissions;
        if (
          permissions.length !== DEFAULT_PUBLIC_ROLE_PACKAGE_PERMISSIONS.length ||
          !DEFAULT_PUBLIC_ROLE_PACKAGE_PERMISSIONS.every(
            (permission, index) => permissions[index] === permission,
          )
        ) {
          errors.push("role_package/manifest.json permissions must use the public default");
        }
      }
      const requiredCapabilityValidation = validateRequiredCapabilities(
        manifestRecord.requiredCapabilities,
      );
      capabilityValidation = requiredCapabilityValidation.capabilities;
      errors.push(...requiredCapabilityValidation.errors);
      if (!Array.isArray(manifestRecord.files)) {
        errors.push("role_package/manifest.json files must be an array");
      } else {
        const filesByPath = new Map(files.map((file) => [file.relativePath, file]));
        const manifestFilePaths = new Set<string>();
        for (const entry of manifestRecord.files) {
          const fileEntry = asRecord(entry);
          const filePath = typeof fileEntry.path === "string" ? fileEntry.path.trim() : "";
          if (!filePath || !isRolePackageRelativePath(filePath)) {
            errors.push("role_package/manifest.json files entries must use role_package/ paths");
            continue;
          }
          if (filePath === ROLE_PACKAGE_MANIFEST_PATH) {
            errors.push("role_package/manifest.json files must exclude role_package/manifest.json");
            continue;
          }
          if (manifestFilePaths.has(filePath)) {
            errors.push("role_package/manifest.json files entries must be unique");
            continue;
          }
          manifestFilePaths.add(filePath);
          const workspaceFile = filesByPath.get(filePath);
          if (!workspaceFile) {
            errors.push("role_package/manifest.json files entries must reference existing files");
            continue;
          }
          if (fileEntry.sha256 !== workspaceFile.sha256) {
            errors.push("role_package/manifest.json files entries must match file sha256");
          }
          if (fileEntry.sizeBytes !== workspaceFile.sizeBytes) {
            errors.push("role_package/manifest.json files entries must match file sizeBytes");
          }
        }
        const expectedFilePaths = files
          .map((file) => file.relativePath)
          .filter(
            (relativePath) =>
              relativePath.startsWith("role_package/") &&
              relativePath !== ROLE_PACKAGE_MANIFEST_PATH,
          );
        for (const expectedFilePath of expectedFilePaths) {
          if (!manifestFilePaths.has(expectedFilePath)) {
            errors.push(
              "role_package/manifest.json files entries must include every role_package file",
            );
            break;
          }
        }
      }
    } catch {
      errors.push("role_package/manifest.json must contain valid JSON");
    }
  }

  const rolePackageFiles = files
    .map((file) => file.relativePath)
    .filter((relativePath) => relativePath.startsWith("role_package/"));
  for (const relativePath of rolePackageFiles) {
    if (isRolePackageToolImplementationPath(relativePath)) {
      errors.push(
        `${relativePath} must not ship implementation tools or tool schemas; role packages declare requiredCapabilities and local OpenClaw executes through tools.catalog/tools.effective/tools.invoke`,
      );
    }
  }
  const hasWrapperAdapterOrExample = rolePackageFiles.some((relativePath) =>
    /(^|\/)(wrappers?|adapters?|examples?|samples?|integrations?)(\/|[-_.])|[-_.](wrapper|adapter|example|sample|integration)\./i.test(
      relativePath,
    ),
  );
  if (!hasWrapperAdapterOrExample) {
    errors.push("missing role_package wrapper, adapter, or integration example file");
  }

  const hasValidationOrSmoke = rolePackageFiles.some((relativePath) =>
    /(validation|validate|smoke|tests?|spec)(\/|[-_.]|\.)/i.test(relativePath),
  );
  if (!hasValidationOrSmoke) {
    errors.push("missing role_package validation or smoke test material");
  }

  const hasBusinessKnowledge = rolePackageFiles.some((relativePath) =>
    ROLE_PACKAGE_KNOWLEDGE_PATH_PATTERN.test(relativePath),
  );
  if (!hasBusinessKnowledge) {
    errors.push(
      "missing role_package business knowledge, workflow, experience, or example material",
    );
  }

  errors.push(
    ...scanRolePackageArtifacts({
      workspaceRoot,
      files,
      ...(scanContext
        ? {
            preflight: scanContext.preflight,
            executionToken: scanContext.executionToken,
          }
        : {}),
    }),
  );

  return {
    ok: errors.length === 0,
    errors,
    capabilities: capabilityValidation,
  };
}

function statusFromLocalExecutorAndValidation(
  result: CommandResult,
  validationOk: boolean,
): DijieExecutionStatus {
  if (result.signal === "SIGTERM" && result.exitCode === null) {
    return "timed_out";
  }
  return result.exitCode === 0 && validationOk ? "completed" : "failed";
}

function errorFromLocalExecutorAndValidation(
  result: CommandResult,
  validationErrors: string[],
): string | undefined {
  if (result.signal === "SIGTERM" && result.exitCode === null) {
    return "local executor timed out";
  }
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    return detail
      ? `local executor failed: ${detail}`
      : `local executor failed with exit code ${String(result.exitCode)}`;
  }
  if (validationErrors.length > 0) {
    return `role_package validation failed: ${validationErrors.join("; ")}`;
  }
  return undefined;
}

function artifactId(relativePath: string): string {
  const normalized = relativePath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `artifact_${normalized || "role_package"}`;
}

function rolePackageArtifacts(files: RolePackageFile[]): DijieRoleArtifact[] {
  return files
    .filter((file) => file.relativePath.startsWith("role_package/"))
    .map((file) => ({
      id: artifactId(file.relativePath),
      type: "role_package_file",
      title: file.relativePath,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    }));
}

function readRolePackageMetadata(files: RolePackageFile[]): {
  packageId?: string;
  packageVersion?: string;
} {
  const manifestFile = files.find((file) => file.relativePath === ROLE_PACKAGE_MANIFEST_PATH);
  if (!manifestFile) {
    return {};
  }
  try {
    const manifest = asRecord(JSON.parse(readFileSync(manifestFile.absolutePath, "utf8")));
    return {
      ...(isNonEmptyString(manifest.rolePackageId)
        ? { packageId: manifest.rolePackageId.trim() }
        : {}),
      ...(isNonEmptyString(manifest.version) ? { packageVersion: manifest.version.trim() } : {}),
    };
  } catch {
    return {};
  }
}

function buildDijieToolUsage(filesChanged: number): DijieToolUsage {
  return {
    shellCommands: 1,
    testsRun: 1,
    filesRead: 0,
    filesChanged,
  };
}

function estimateDijieTokenCostCents(
  usage: DijieModelProxyUsage,
  pricing: DijieRoleTokenPricing,
): number {
  const rawCents =
    (usage.inputTokens * pricing.inputTokenCentsPerMillion +
      usage.outputTokens * pricing.outputTokenCentsPerMillion) /
    1_000_000;
  return rawCents > 0 ? Math.ceil(rawCents) : 0;
}

function buildRoleFeedbackPacketId(params: {
  preflight?: DijieExecutionPreflightOk;
  mode: "developer_package" | "authorized_execution";
  packageId: string;
  packageVersion: string;
  startedAt: string;
  endedAt: string;
  changedFiles: string[];
}): string {
  if (params.preflight) {
    return `packet_${params.preflight.executionId}`;
  }
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        mode: params.mode,
        packageId: params.packageId,
        packageVersion: params.packageVersion,
        startedAt: params.startedAt,
        endedAt: params.endedAt,
        changedFiles: params.changedFiles,
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return `packet_${digest}`;
}

function buildDijieRoleFeedbackPacket(params: {
  result: CommandResult;
  startedAt: string;
  endedAt: string;
  files: RolePackageFile[];
  validation: { ok: boolean; errors: string[] };
  preflight?: DijieExecutionPreflightOk;
}): DijieRoleFeedbackPacket {
  const changedFiles = params.files.map((file) => file.relativePath);
  const artifacts = rolePackageArtifacts(params.files);
  const status = statusFromLocalExecutorAndValidation(params.result, params.validation.ok);
  const error = errorFromLocalExecutorAndValidation(params.result, params.validation.errors);
  const modelProxyUsage = params.result.modelProxyUsage ?? zeroModelProxyUsage();
  const mode = params.preflight ? "authorized_execution" : "developer_package";
  const manifest = readRolePackageMetadata(params.files);
  const packageId = params.preflight?.packageId ?? manifest.packageId ?? "pkg_unresolved";
  const packageVersion = params.preflight?.packageVersion ?? manifest.packageVersion ?? "0.0.0";
  const packetId = buildRoleFeedbackPacketId({
    preflight: params.preflight,
    mode,
    packageId,
    packageVersion,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    changedFiles,
  });

  return {
    packetVersion: 1,
    packetId,
    mode,
    producedAt: params.endedAt,
    role: {
      packageId,
      packageVersion,
      ...(params.preflight
        ? {
            roleListingId: params.preflight.roleListingId,
            developerRef: params.preflight.developerRef,
          }
        : {}),
    },
    schedulerContext: params.preflight
      ? {
          executionId: params.preflight.executionId,
          entitlementId: params.preflight.entitlementId,
          deviceId: params.preflight.deviceId,
          workspaceRef: params.preflight.workspaceRef,
          localGatewayId: params.preflight.localGatewayId,
        }
      : {},
    status,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    summary:
      status === "completed"
        ? mode === "developer_package"
          ? "迭界AI role-builder generated and validated a public developer role_package."
          : "迭界AI role-builder generated and validated a local role_package."
        : mode === "developer_package"
          ? "迭界AI role-builder did not produce a valid public developer role_package."
          : "迭界AI role-builder did not produce a valid local role_package.",
    changedFiles,
    artifacts,
    toolUsage: buildDijieToolUsage(changedFiles.length),
    modelProxyUsage,
    ...(params.preflight
      ? {
          costUsage: {
            inputTokens: modelProxyUsage.inputTokens,
            outputTokens: modelProxyUsage.outputTokens,
            currency: params.preflight.roleTokenPricing.currency,
            estimatedCents: estimateDijieTokenCostCents(
              modelProxyUsage,
              params.preflight.roleTokenPricing,
            ),
          },
        }
      : {}),
    riskEvents:
      params.validation.errors.length > 0
        ? [
            {
              level: "medium",
              category: "role_package_validation",
              summary: params.validation.errors[0] ?? "role_package validation failed",
              requiresHumanConfirmation: true,
            },
          ]
        : [],
    evolutionSuggestions: [],
    ...(error ? { error } : {}),
  };
}

function buildDijieAuditSummary(params: {
  preflight: DijieExecutionPreflightOk;
  roleFeedbackPacket: DijieRoleFeedbackPacket;
}) {
  const modelProxyUsage = params.roleFeedbackPacket.modelProxyUsage ?? zeroModelProxyUsage();
  const roleResult = {
    executionId: params.preflight.executionId,
    roleListingId: params.preflight.roleListingId,
    packageId: params.preflight.packageId,
    packageVersion: params.preflight.packageVersion,
    developerRef: params.preflight.developerRef,
    listingOwnerRef: params.preflight.listingOwnerRef,
    billingBeneficiaryRef: params.preflight.billingBeneficiaryRef,
    status: params.roleFeedbackPacket.status,
    startedAt: params.roleFeedbackPacket.startedAt,
    endedAt: params.roleFeedbackPacket.endedAt,
    roleTokenPricing: params.preflight.roleTokenPricing,
    modelProxyUsage,
    summary: params.roleFeedbackPacket.summary,
    changedFiles: params.roleFeedbackPacket.changedFiles,
    artifacts: params.roleFeedbackPacket.artifacts,
    ...(params.roleFeedbackPacket.error ? { error: params.roleFeedbackPacket.error } : {}),
  };

  return {
    executionId: params.preflight.executionId,
    deviceId: params.preflight.deviceId,
    workspaceRef: params.preflight.workspaceRef,
    roleListingId: params.preflight.roleListingId,
    packageId: params.preflight.packageId,
    packageVersion: params.preflight.packageVersion,
    developerRef: params.preflight.developerRef,
    listingOwnerRef: params.preflight.listingOwnerRef,
    billingBeneficiaryRef: params.preflight.billingBeneficiaryRef,
    entitlementId: params.preflight.entitlementId,
    localGatewayId: params.preflight.localGatewayId,
    status: params.roleFeedbackPacket.status,
    startedAt: params.roleFeedbackPacket.startedAt,
    endedAt: params.roleFeedbackPacket.endedAt,
    roleTokenPricing: params.preflight.roleTokenPricing,
    modelProxyUsage,
    toolUsage: params.roleFeedbackPacket.toolUsage,
    result: roleResult,
  };
}

function buildDeveloperRolePackageResult(params: { roleFeedbackPacket: DijieRoleFeedbackPacket }) {
  return {
    status: params.roleFeedbackPacket.status,
    summary: params.roleFeedbackPacket.summary,
    changedFiles: params.roleFeedbackPacket.changedFiles,
    artifacts: params.roleFeedbackPacket.artifacts,
    ...(params.roleFeedbackPacket.error ? { error: params.roleFeedbackPacket.error } : {}),
  };
}

async function uploadDijieAudit(params: {
  config: AicsConfig;
  executionToken: string;
  auditSummary: unknown;
}) {
  if (!params.config.cloudAuditUploadEnabled) {
    return { ok: true, skipped: true, required: false };
  }
  if (!params.config.cloudAuditUrl) {
    return {
      ok: false,
      skipped: false,
      required: params.config.cloudAuditUploadRequired,
      error: "cloudAuditUrl or cloudBaseUrl is required when Dijie audit upload is enabled.",
    };
  }
  if (typeof globalThis.fetch !== "function") {
    return {
      ok: false,
      skipped: false,
      required: params.config.cloudAuditUploadRequired,
      error: "global fetch is unavailable for Dijie audit upload.",
    };
  }

  try {
    const response = await globalThis.fetch(params.config.cloudAuditUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${params.executionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ auditSummary: params.auditSummary }),
    });
    const responseText = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        skipped: false,
        required: params.config.cloudAuditUploadRequired,
        statusCode: response.status,
        error: responseText.trim() || `Dijie audit upload failed with HTTP ${response.status}`,
      };
    }
    return {
      ok: true,
      skipped: false,
      required: params.config.cloudAuditUploadRequired,
      statusCode: response.status,
      response: responseText ? parseAuditUploadResponse(responseText) : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      required: params.config.cloudAuditUploadRequired,
      error: cloudFetchDiagnostic({
        operation: "审计上传",
        url: params.config.cloudAuditUrl,
        error,
        cloudAccessToken: params.executionToken,
      }),
    };
  }
}

function parseAuditUploadResponse(responseText: string): unknown {
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

function redactCloudAccessTokenText(value: string, cloudAccessToken: string): string {
  return cloudAccessToken
    ? value.replaceAll(cloudAccessToken, "[redacted_cloud_access_token]")
    : value;
}

function cloudPathForDiagnostic(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "迭界AI cloud";
  }
}

function cloudFetchDiagnostic(params: {
  operation: string;
  url: string;
  error: unknown;
  cloudAccessToken: string;
}): string {
  const detail = params.error instanceof Error ? params.error.message : String(params.error);
  return redactCloudAccessTokenText(
    [
      `迭界AI ${params.operation} 请求在收到响应前失败（${cloudPathForDiagnostic(params.url)}）。`,
      "请检查 cloudBaseUrl、网络连接和 Marketplace API 服务是否可用。",
      detail ? `原始错误：${detail}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    params.cloudAccessToken,
  );
}

function redactCloudAccessTokenValue(value: unknown, cloudAccessToken: string): unknown {
  if (typeof value === "string") {
    return redactCloudAccessTokenText(value, cloudAccessToken);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactCloudAccessTokenValue(entry, cloudAccessToken));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      const normalizedKey = key.replaceAll("_", "").toLowerCase();
      if (
        normalizedKey === "cloudaccesstoken" ||
        normalizedKey === "authorization" ||
        normalizedKey === "bearertoken"
      ) {
        return [key, "[redacted_cloud_access_token]"];
      }
      return [key, redactCloudAccessTokenValue(entry, cloudAccessToken)];
    }),
  );
}

function executionAuditReadUrl(baseUrl: string, executionId: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(encodeURIComponent(executionId), normalizedBase).toString();
}

function marketplaceInstalledRolesUrl(
  baseUrl: string,
  params: { workspaceRef?: string; deviceId?: string },
): string {
  const url = new URL(baseUrl);
  if (params.workspaceRef) {
    url.searchParams.set("workspaceRef", params.workspaceRef);
  }
  if (params.deviceId) {
    url.searchParams.set("deviceId", params.deviceId);
  }
  return url.toString();
}

type DijieInstalledRoleContext = {
  roleListingId: string;
  entitlementId: string;
  roleTitle?: string;
  roleSummary?: string;
  requiredCapabilities: string[];
  source: "explicit-params" | "cloud-installed-role";
};

type DijieExecutionGrant = {
  executionId: string;
  roleListingId: string;
  entitlementId: string;
  deviceId: string;
  workspaceRef: string;
  localGatewayId: string;
  token: string;
  roleTokenPricing: DijieRoleTokenPricing;
};

type DijieRoleTaskExecutionContext = DijieInstalledRoleContext & {
  executionToken?: string;
  preflight?: DijieExecutionPreflightOk;
  auditUploadPlanned: boolean;
};

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function normalizeRoleMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function parseInstalledRoleContext(value: unknown): DijieInstalledRoleContext | undefined {
  const record = asRecord(value);
  const role = asRecord(record.role);
  const roleListingId =
    stringField(role, "id") ??
    stringField(role, "roleListingId") ??
    stringField(record, "roleListingId") ??
    stringField(record, "role_listing_id");
  const entitlementId =
    stringField(record, "entitlementId") ??
    stringField(record, "entitlement_id") ??
    stringField(record, "id");
  if (!roleListingId || !entitlementId) {
    return undefined;
  }

  const roleTitle = stringField(role, "title") ?? stringField(record, "title");
  const roleSummary =
    stringField(role, "subtitle") ??
    stringField(role, "description") ??
    stringField(record, "description");
  const requiredCapabilities =
    stringArrayField(role.capabilities).length > 0
      ? stringArrayField(role.capabilities)
      : stringArrayField(role.requiredCapabilities);

  return {
    roleListingId,
    entitlementId,
    ...(roleTitle ? { roleTitle } : {}),
    ...(roleSummary ? { roleSummary } : {}),
    requiredCapabilities,
    source: "cloud-installed-role",
  };
}

function scoreInstalledRoleMatch(
  role: DijieInstalledRoleContext,
  params: {
    roleListingId?: string;
    entitlementId?: string;
    roleQuery?: string;
    roleTitle?: string;
    taskText: string;
  },
): number {
  let score = 0;
  if (params.roleListingId && role.roleListingId === params.roleListingId) {
    score += 100;
  }
  if (params.entitlementId && role.entitlementId === params.entitlementId) {
    score += 100;
  }
  const query = normalizeRoleMatchText(params.roleQuery ?? params.roleTitle ?? "");
  const taskText = normalizeRoleMatchText(params.taskText);
  const title = normalizeRoleMatchText(role.roleTitle ?? "");
  const id = normalizeRoleMatchText(role.roleListingId);
  if (query) {
    if (title === query || id === query) {
      score += 60;
    } else if (title.includes(query) || query.includes(title) || id.includes(query)) {
      score += 35;
    }
  }
  if (title && taskText.includes(title)) {
    score += 20;
  }
  return score;
}

function selectInstalledRoleContext(
  roles: unknown[],
  params: {
    roleListingId?: string;
    entitlementId?: string;
    roleQuery?: string;
    roleTitle?: string;
    taskText: string;
  },
): DijieInstalledRoleContext | undefined {
  const candidates = roles
    .map(parseInstalledRoleContext)
    .filter((role): role is DijieInstalledRoleContext => Boolean(role));
  if (candidates.length === 0) {
    return undefined;
  }
  const scored = candidates
    .map((role) => ({ role, score: scoreInstalledRoleMatch(role, params) }))
    .sort((a, b) => b.score - a.score);
  if (scored[0]?.score && scored[0].score > 0) {
    return scored[0].role;
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

async function readCloudInstalledRoles(params: {
  config: AicsConfig;
  cloudAccessToken: string;
  workspaceRef?: string;
  deviceId?: string;
}): Promise<unknown[]> {
  if (!params.config.cloudMarketplaceInstalledRolesUrl) {
    throw new Error(
      "cloudMarketplaceInstalledRolesUrl or cloudBaseUrl is required before resolving main-chat installed roles.",
    );
  }
  if (typeof globalThis.fetch !== "function") {
    throw new Error("global fetch is unavailable for Dijie installed role reads.");
  }

  const installedRolesUrl = marketplaceInstalledRolesUrl(
    params.config.cloudMarketplaceInstalledRolesUrl,
    {
      workspaceRef: params.workspaceRef,
      deviceId: params.deviceId,
    },
  );
  let response: Response;
  try {
    response = await globalThis.fetch(installedRolesUrl, {
      method: "GET",
      headers: {
        authorization: `Bearer ${params.cloudAccessToken}`,
        accept: "application/json",
      },
    });
  } catch (error) {
    throw new Error(
      cloudFetchDiagnostic({
        operation: "已授权岗位读取",
        url: installedRolesUrl,
        error,
        cloudAccessToken: params.cloudAccessToken,
      }),
    );
  }

  const responseText = await response.text();
  const payload = responseText ? asRecord(parseAuditUploadResponse(responseText)) : {};
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      redactCloudAccessTokenText(
        stringField(payload, "error") ??
          stringField(payload, "reason") ??
          `Dijie marketplace returned HTTP ${response.status}`,
        params.cloudAccessToken,
      ),
    );
  }
  const roles = Array.isArray(payload.roles)
    ? payload.roles
    : Array.isArray(payload.installedRoles)
      ? payload.installedRoles
      : undefined;
  if (!roles) {
    throw new Error("迭界AI installed-role resolver response did not include roles.");
  }
  return roles;
}

async function requestCloudExecutionGrant(params: {
  config: AicsConfig;
  cloudAccessToken: string;
  roleListingId: string;
  entitlementId: string;
  deviceId: string;
  workspaceRef: string;
  localGatewayId: string;
}): Promise<DijieExecutionGrant> {
  if (!params.config.cloudExecutionTokenUrl) {
    throw new Error(
      "cloudExecutionTokenUrl or cloudBaseUrl is required before requesting Dijie execution tokens.",
    );
  }
  if (typeof globalThis.fetch !== "function") {
    throw new Error("global fetch is unavailable for Dijie execution token requests.");
  }

  let response: Response;
  try {
    response = await globalThis.fetch(params.config.cloudExecutionTokenUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${params.cloudAccessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        roleListingId: params.roleListingId,
        entitlementId: params.entitlementId,
        deviceId: params.deviceId,
        workspaceRef: params.workspaceRef,
        localGatewayId: params.localGatewayId,
      }),
    });
  } catch (error) {
    throw new Error(
      cloudFetchDiagnostic({
        operation: "执行授权申请",
        url: params.config.cloudExecutionTokenUrl,
        error,
        cloudAccessToken: params.cloudAccessToken,
      }),
    );
  }

  const responseText = await response.text();
  const payload = responseText ? asRecord(parseAuditUploadResponse(responseText)) : {};
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      redactCloudAccessTokenText(
        stringField(payload, "error") ??
          stringField(payload, "reason") ??
          `Dijie cloud returned HTTP ${response.status}`,
        params.cloudAccessToken,
      ),
    );
  }

  const grant = asRecord(payload.grant);
  const token = stringField(grant, "token");
  const executionId = stringField(grant, "executionId");
  const roleListingId = stringField(grant, "roleListingId");
  const entitlementId = stringField(grant, "entitlementId");
  const deviceId = stringField(grant, "deviceId");
  const workspaceRef = stringField(grant, "workspaceRef");
  const localGatewayId = stringField(grant, "localGatewayId");
  if (
    !token ||
    !executionId ||
    !roleListingId ||
    !entitlementId ||
    !deviceId ||
    !workspaceRef ||
    !localGatewayId ||
    !isRoleTokenPricing(grant.roleTokenPricing)
  ) {
    throw new Error("迭界AI execution-token resolver response did not include a valid grant.");
  }

  return {
    executionId,
    roleListingId,
    entitlementId,
    deviceId,
    workspaceRef,
    localGatewayId,
    token,
    roleTokenPricing: grant.roleTokenPricing,
  };
}

function createExecutionTokenRequestTool(config: AicsConfig): AnyAgentTool {
  return {
    name: "dijie_execution_token_request",
    label: "迭界AI Execution Token Request",
    description:
      "Request a short-lived execution token from 迭界AI岗位商城. Requires configured cloudExecutionTokenUrl/cloudBaseUrl and a transient customer bearer token.",
    parameters: ExecutionTokenRequestParamsSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = asRecord(rawParams);
      if (!config.cloudExecutionTokenUrl) {
        throw new Error(
          "cloudExecutionTokenUrl or cloudBaseUrl is required before requesting Dijie execution tokens.",
        );
      }
      if (typeof globalThis.fetch !== "function") {
        throw new Error("global fetch is unavailable for Dijie execution token requests.");
      }
      const cloudAccessToken = resolveCloudAccessTokenParam(
        config,
        params,
        "cloud_access_token or backend aics.cloudAccessToken is required for Dijie execution token requests",
      );
      const requestBody = {
        roleListingId: requireStringParam(params, "role_listing_id"),
        entitlementId: requireStringParam(params, "entitlement_id"),
        deviceId: requireStringParam(params, "device_id"),
        workspaceRef: requireStringParam(params, "workspace_ref"),
        localGatewayId: requireStringParam(params, "local_gateway_id"),
      };

      let response: Response;
      try {
        response = await globalThis.fetch(config.cloudExecutionTokenUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${cloudAccessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });
      } catch (error) {
        return jsonResult({
          ok: false,
          summary: "迭界AI cloud execution token request failed",
          error: cloudFetchDiagnostic({
            operation: "执行授权申请",
            url: config.cloudExecutionTokenUrl,
            error,
            cloudAccessToken,
          }),
        });
      }

      const responseText = await response.text();
      const payload = responseText ? asRecord(parseAuditUploadResponse(responseText)) : {};
      if (!response.ok || payload.ok !== true) {
        return jsonResult({
          ok: false,
          summary: "迭界AI cloud execution token request was rejected",
          statusCode: response.status,
          error: redactCloudAccessTokenText(
            stringField(payload, "error") ??
              stringField(payload, "reason") ??
              `Dijie cloud returned HTTP ${response.status}`,
            cloudAccessToken,
          ),
        });
      }

      const grant = asRecord(payload.grant);
      const token = stringField(grant, "token");
      if (
        !token ||
        !stringField(grant, "executionId") ||
        !stringField(grant, "roleListingId") ||
        !stringField(grant, "entitlementId") ||
        !stringField(grant, "deviceId") ||
        !stringField(grant, "workspaceRef") ||
        !stringField(grant, "localGatewayId") ||
        !isOneTimeAuthorizationPricing(grant.pricing) ||
        !isRoleTokenPricing(grant.roleTokenPricing) ||
        !Array.isArray(grant.scopes) ||
        !grant.scopes.every(isNonEmptyString)
      ) {
        return jsonResult({
          ok: false,
          summary: "迭界AI cloud execution token response did not include a valid grant",
          statusCode: response.status,
        });
      }

      return jsonResult({
        ok: true,
        summary: "迭界AI cloud execution token issued",
        grant: {
          executionId: stringField(grant, "executionId"),
          roleListingId: stringField(grant, "roleListingId"),
          entitlementId: stringField(grant, "entitlementId"),
          deviceId: stringField(grant, "deviceId"),
          workspaceRef: stringField(grant, "workspaceRef"),
          localGatewayId: stringField(grant, "localGatewayId"),
          token,
          issuedAt: stringField(grant, "issuedAt"),
          expiresAt: stringField(grant, "expiresAt"),
          pricing: grant.pricing,
          roleTokenPricing: grant.roleTokenPricing,
          scopes: Array.isArray(grant.scopes) ? grant.scopes : undefined,
        },
      });
    },
  };
}

function createExecutionAuditReadTool(config: AicsConfig): AnyAgentTool {
  return {
    name: "dijie_execution_audit_read",
    label: "迭界AI Execution Audit Read",
    description:
      "Read the safe execution audit projection from 迭界AI岗位商城. Requires configured cloudExecutionReadUrl/cloudBaseUrl and a transient customer bearer token.",
    parameters: ExecutionAuditReadParamsSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = asRecord(rawParams);
      if (!config.cloudExecutionReadUrl) {
        throw new Error(
          "cloudExecutionReadUrl or cloudBaseUrl is required before reading Dijie execution audits.",
        );
      }
      if (typeof globalThis.fetch !== "function") {
        throw new Error("global fetch is unavailable for Dijie execution audit reads.");
      }
      const cloudAccessToken = resolveCloudAccessTokenParam(
        config,
        params,
        "cloud_access_token or backend aics.cloudAccessToken is required for Dijie execution audit reads",
      );
      const executionId = requireStringParam(params, "execution_id");

      const readUrl = executionAuditReadUrl(config.cloudExecutionReadUrl, executionId);
      let response: Response;
      try {
        response = await globalThis.fetch(readUrl, {
          method: "GET",
          headers: {
            authorization: `Bearer ${cloudAccessToken}`,
            accept: "application/json",
          },
        });
      } catch (error) {
        return jsonResult({
          ok: false,
          summary: "迭界AI cloud execution audit read failed",
          error: cloudFetchDiagnostic({
            operation: "执行审计回读",
            url: readUrl,
            error,
            cloudAccessToken,
          }),
        });
      }

      const responseText = await response.text();
      const payload = responseText ? asRecord(parseAuditUploadResponse(responseText)) : {};
      if (!response.ok || payload.ok !== true) {
        return jsonResult({
          ok: false,
          summary: "迭界AI cloud execution audit read was rejected",
          statusCode: response.status,
          error: redactCloudAccessTokenText(
            stringField(payload, "error") ??
              stringField(payload, "reason") ??
              `Dijie cloud returned HTTP ${response.status}`,
            cloudAccessToken,
          ),
        });
      }

      return jsonResult({
        ok: true,
        summary: "迭界AI cloud execution audit read completed",
        execution: redactCloudAccessTokenValue(
          payload.execution === undefined ? payload : payload.execution,
          cloudAccessToken,
        ),
      });
    },
  };
}

function createMarketplaceInstalledRolesTool(config: AicsConfig): AnyAgentTool {
  return {
    name: "dijie_marketplace_roles_list",
    label: "迭界AI Marketplace Roles",
    description:
      "Read installed and authorized roles from 迭界AI岗位商城. Requires configured cloudMarketplaceInstalledRolesUrl/cloudBaseUrl and a transient customer bearer token.",
    parameters: MarketplaceInstalledRolesParamsSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = asRecord(rawParams);
      if (!config.cloudMarketplaceInstalledRolesUrl) {
        throw new Error(
          "cloudMarketplaceInstalledRolesUrl or cloudBaseUrl is required before reading installed roles.",
        );
      }
      if (typeof globalThis.fetch !== "function") {
        throw new Error("global fetch is unavailable for Dijie installed role reads.");
      }
      const cloudAccessToken = resolveCloudAccessTokenParam(
        config,
        params,
        "cloud_access_token or backend aics.cloudAccessToken is required for Dijie installed role reads",
      );

      const installedRolesUrl = marketplaceInstalledRolesUrl(
        config.cloudMarketplaceInstalledRolesUrl,
        {
          workspaceRef: stringField(params, "workspace_ref"),
          deviceId: stringField(params, "device_id"),
        },
      );
      let response: Response;
      try {
        response = await globalThis.fetch(installedRolesUrl, {
          method: "GET",
          headers: {
            authorization: `Bearer ${cloudAccessToken}`,
            accept: "application/json",
          },
        });
      } catch (error) {
        return jsonResult({
          ok: false,
          summary: "迭界AI marketplace installed roles read failed",
          error: cloudFetchDiagnostic({
            operation: "已授权岗位读取",
            url: installedRolesUrl,
            error,
            cloudAccessToken,
          }),
        });
      }

      const responseText = await response.text();
      const payload = responseText ? asRecord(parseAuditUploadResponse(responseText)) : {};
      if (!response.ok || payload.ok !== true) {
        return jsonResult({
          ok: false,
          summary: "迭界AI marketplace installed roles read was rejected",
          statusCode: response.status,
          error: redactCloudAccessTokenText(
            stringField(payload, "error") ??
              stringField(payload, "reason") ??
              `Dijie marketplace returned HTTP ${response.status}`,
            cloudAccessToken,
          ),
        });
      }

      const roles = Array.isArray(payload.roles)
        ? payload.roles
        : Array.isArray(payload.installedRoles)
          ? payload.installedRoles
          : undefined;
      if (!roles) {
        return jsonResult({
          ok: false,
          summary: "迭界AI marketplace installed roles response did not include roles",
          statusCode: response.status,
        });
      }

      return jsonResult({
        ok: true,
        summary: "迭界AI marketplace installed roles read completed",
        roles: redactCloudAccessTokenValue(roles, cloudAccessToken),
        source: "cloud",
      });
    },
  };
}

function createRoleAuthorizationTool(config: AicsConfig): AnyAgentTool {
  return {
    name: "dijie_role_authorization_create",
    label: "迭界AI Role Authorization",
    description:
      "Create a formal zero-price Dijie role entitlement through the cloud marketplace. Paid roles still require checkout facts.",
    parameters: RoleAuthorizationCreateParamsSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = asRecord(rawParams);
      if (!config.cloudAuthorizationUrl) {
        throw new Error(
          "cloudAuthorizationUrl or cloudBaseUrl is required before creating Dijie role authorizations.",
        );
      }
      if (typeof globalThis.fetch !== "function") {
        throw new Error("global fetch is unavailable for Dijie role authorization requests.");
      }
      const cloudAccessToken = resolveCloudAccessTokenParam(
        config,
        params,
        "cloud_access_token or backend aics.cloudAccessToken is required for Dijie role authorization",
      );
      const roleListingId = requireStringParam(params, "role_listing_id");

      let response: Response;
      try {
        response = await globalThis.fetch(config.cloudAuthorizationUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${cloudAccessToken}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ roleListingId }),
        });
      } catch (error) {
        return jsonResult({
          ok: false,
          summary: "迭界AI role authorization request failed",
          error: cloudFetchDiagnostic({
            operation: "岗位正式授权",
            url: config.cloudAuthorizationUrl,
            error,
            cloudAccessToken,
          }),
        });
      }

      const responseText = await response.text();
      const payload = responseText ? asRecord(parseAuditUploadResponse(responseText)) : {};
      if (!response.ok || payload.ok !== true) {
        return jsonResult({
          ok: false,
          summary: "迭界AI role authorization was rejected",
          statusCode: response.status,
          code: stringField(payload, "code"),
          error: redactCloudAccessTokenText(
            stringField(payload, "error") ??
              stringField(payload, "reason") ??
              `Dijie marketplace returned HTTP ${response.status}`,
            cloudAccessToken,
          ),
        });
      }

      return jsonResult({
        ok: true,
        summary: "迭界AI role authorization completed",
        entitlementId: stringField(payload, "entitlementId"),
        entitlement: redactCloudAccessTokenValue(payload.entitlement, cloudAccessToken),
        ledgerEntry: redactCloudAccessTokenValue(payload.ledgerEntry, cloudAccessToken),
        source: "cloud",
      });
    },
  };
}

function createStatusTool(config: AicsConfig): AnyAgentTool {
  return {
    name: "aics_status",
    label: "迭界AI Status",
    description:
      "Inspect the local 迭界AI repo and run the approved doctor command through the OpenClaw runtime.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      requireExistingRepo(config);
      const repoRealPath = realpathSync(config.repoRoot);
      const branch = await runCommand("git", ["branch", "--show-current"], {
        cwd: repoRealPath,
        maxOutputChars: config.maxOutputChars,
        timeoutMs: 10000,
      });
      const status = await runCommand("git", ["status", "--short"], {
        cwd: repoRealPath,
        maxOutputChars: config.maxOutputChars,
        timeoutMs: 10000,
      });
      const doctor = await runCommand(config.pythonBinary, ["main.py", "--doctor"], {
        cwd: repoRealPath,
        maxOutputChars: config.maxOutputChars,
        timeoutMs: 60000,
      });

      return jsonResult({
        summary:
          doctor.exitCode === 0
            ? "迭界AI repo reachable and doctor command completed"
            : "迭界AI repo reachable but doctor command failed",
        repoRoot: repoRealPath,
        branch: branch.stdout.trim(),
        dirtyFiles: status.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        doctor,
      });
    },
  };
}

function resolveRoleBuilderExecutor(params: {
  config: AicsConfig;
  runtime: NativeRoleBuilderRuntime;
}) {
  const nativeAvailable = canRunOpenClawNativeExecutor(params.runtime);
  const subprocessAvailable = Boolean(params.config.localExecutorCommand);

  if (params.config.localExecutorMode === "native") {
    return nativeAvailable ? "native" : undefined;
  }
  if (params.config.localExecutorMode === "subprocess") {
    return subprocessAvailable ? "subprocess" : undefined;
  }
  if (nativeAvailable) {
    return "native";
  }
  return subprocessAvailable ? "subprocess" : undefined;
}

function createRoleTaskRunTool(
  config: AicsConfig,
  runtime: NativeRoleBuilderRuntime,
  runtimeConfig: OpenClawConfig,
): AnyAgentTool {
  return {
    name: "dijie_role_task_run",
    label: "迭界AI Role Task Run",
    description:
      "Run an authorized Dijie marketplace role task through the OpenClaw-native embedded agent and the open local tool pool. Roles do not require separate tool grants.",
    parameters: RoleTaskRunParamsSchema,
    execute: async (_toolCallId, rawParams) => {
      if (!canRunOpenClawNativeExecutor(runtime)) {
        throw new Error(
          "dijie.roleTask.run requires OpenClaw-native runEmbeddedAgent so role tasks can use the local OpenClaw tool pool.",
        );
      }
      const params = asRecord(rawParams);
      if (params.confirm_execution !== true) {
        throw new Error(
          "confirm_execution=true is required after the user confirms role execution, audit, and possible cost.",
        );
      }
      const executionContext = await resolveRoleTaskExecutionContext(config, params);
      const taskText = requireStringParam(params, "task_text");
      const workspaceDir = requireStringParam(params, "workspace_dir");
      const timeoutMs =
        typeof params.timeout_ms === "number" && Number.isInteger(params.timeout_ms)
          ? params.timeout_ms
          : DEFAULT_ROLE_TASK_TIMEOUT_MS;

      const result = await runOpenClawNativeRoleTask({
        runtime,
        runtimeConfig,
        workspaceDir,
        roleListingId: executionContext.roleListingId,
        entitlementId: executionContext.entitlementId,
        taskText,
        roleTitle: stringField(params, "role_title") ?? executionContext.roleTitle,
        roleSummary: stringField(params, "role_summary") ?? executionContext.roleSummary,
        requiredCapabilities: executionContext.requiredCapabilities,
        timeoutMs,
        maxOutputChars: config.maxOutputChars,
      });

      if (!executionContext.preflight || !executionContext.executionToken) {
        return jsonResult({
          ...result,
          executionContext: {
            source: executionContext.source,
            cloudAuthorized: false,
            auditUploadPlanned: false,
          },
          auditUpload: { ok: true, skipped: true, required: false },
        });
      }

      const auditSummary = buildDijieRoleTaskCloudAuditSummary({
        preflight: executionContext.preflight,
        roleTaskResult: result,
      });
      const auditUpload = await uploadDijieAudit({
        config,
        executionToken: executionContext.executionToken,
        auditSummary,
      });
      const executionOk = auditSummary.status === "completed" && auditUpload.ok;

      return jsonResult({
        ...result,
        ok: executionOk,
        status: auditSummary.status,
        roleResult: {
          ...result.roleResult,
          status: auditSummary.status,
          ...(auditSummary.result.error ? { error: auditSummary.result.error } : {}),
        },
        summary: executionOk
          ? auditUpload.skipped
            ? "迭界AI role task local execution completed and validated"
            : "迭界AI role task local execution completed, validated, and audited"
          : auditSummary.status !== "completed"
            ? result.summary
            : "迭界AI role task audit upload failed",
        executionId: executionContext.preflight.executionId,
        roleListingId: executionContext.preflight.roleListingId,
        packageId: executionContext.preflight.packageId,
        packageVersion: executionContext.preflight.packageVersion,
        developerRef: executionContext.preflight.developerRef,
        listingOwnerRef: executionContext.preflight.listingOwnerRef,
        billingBeneficiaryRef: executionContext.preflight.billingBeneficiaryRef,
        entitlementId: executionContext.preflight.entitlementId,
        deviceId: executionContext.preflight.deviceId,
        workspaceRef: executionContext.preflight.workspaceRef,
        localGatewayId: executionContext.preflight.localGatewayId,
        roleTokenPricing: executionContext.preflight.roleTokenPricing,
        auditSummary,
        auditUpload,
        executionContext: {
          source: executionContext.source,
          cloudAuthorized: true,
          auditUploadPlanned: executionContext.auditUploadPlanned,
        },
      });
    },
  };
}

function createRoleBuilderTool(
  config: AicsConfig,
  runtime: NativeRoleBuilderRuntime,
  runtimeConfig: OpenClawConfig,
): AnyAgentTool {
  return {
    name: "dijie_role_builder",
    label: "迭界AI Role Builder",
    description:
      "Run the 迭界AI role-builder intake path from OpenClaw. By default this creates only a RoleBuildBrief; package writing requires allowWrites=true and confirm_brief=true.",
    parameters: RoleBuilderParamsSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = asRecord(rawParams);
      const requestZh = params.request_zh;
      if (typeof requestZh !== "string" || !requestZh.trim()) {
        throw new Error("request_zh is required");
      }
      const confirmBrief = params.confirm_brief === true;
      const packageOnly = params.package_only === true;
      if (packageOnly && !confirmBrief) {
        throw new Error("package_only requires confirm_brief=true");
      }
      if (confirmBrief && !config.allowWrites) {
        throw new Error("confirm_brief requires aics.allowWrites=true in OpenClaw config");
      }
      const roleBuilderExecutor = resolveRoleBuilderExecutor({ config, runtime });
      if (confirmBrief && !roleBuilderExecutor) {
        throw new Error(
          "confirm_brief requires OpenClaw-native runEmbeddedAgent or aics.localExecutorCommand. The role builder must fail closed when no local execution engine is configured.",
        );
      }
      const outputRoot = resolveOutputRoot(config, params.output_root);
      const timeoutMs =
        typeof params.timeout_ms === "number" && Number.isInteger(params.timeout_ms)
          ? params.timeout_ms
          : 120000;

      if (confirmBrief) {
        const roleBuildBriefJson = requireStringParam(
          params,
          "role_build_brief_json",
          "role_build_brief_json is required when confirm_brief=true",
        );
        const preflight = packageOnly
          ? undefined
          : verifyDijieExecutionPreflight(config, buildPreflightParams(params));
        if (preflight) {
          assertDijieExecutionPreflightOk(preflight);
        }
        mkdirSync(outputRoot, { recursive: true });
        const workspaceRoot = realpathSync(outputRoot);
        const lastMessagePath = path.join(workspaceRoot, ".dijie_local_executor_last_message.md");
        const prompt = buildLocalExecutorRoleBuilderPrompt({
          requestZh,
          roleBuildBriefJson,
        });
        const startedAt = new Date().toISOString();
        const result =
          roleBuilderExecutor === "native" && canRunOpenClawNativeExecutor(runtime)
            ? await runOpenClawNativeRoleBuilder({
                runtime,
                runtimeConfig,
                prompt,
                workspaceRoot,
                timeoutMs,
                maxOutputChars: config.maxOutputChars,
                ...(preflight?.ok ? { preflight } : {}),
              })
            : await runCommand(
                requireStringParam(
                  { localExecutorCommand: config.localExecutorCommand },
                  "localExecutorCommand",
                  "localExecutorCommand is required for subprocess role-builder execution",
                ),
                buildLocalExecutorArgs(config, workspaceRoot, lastMessagePath),
                {
                  cwd: workspaceRoot,
                  maxOutputChars: config.maxOutputChars,
                  timeoutMs,
                  stdin: prompt,
                  env: buildLocalExecutorCommandEnv(),
                },
              );
        const endedAt = new Date().toISOString();
        const executionToken = packageOnly
          ? undefined
          : requireStringParam(params, "execution_token");
        const preNormalizationFiles = listWorkspaceFiles(workspaceRoot);
        const preNormalizationScanErrors = scanRolePackageArtifacts({
          workspaceRoot,
          files: preNormalizationFiles,
          ...(preflight?.ok && executionToken
            ? {
                preflight,
                executionToken,
              }
            : {}),
        });
        normalizeRolePackageManifest({
          workspaceRoot,
          files: preNormalizationFiles,
          roleBuildBriefJson,
          ...(preflight?.ok
            ? {
                packageId: preflight.packageId,
                packageVersion: preflight.packageVersion,
              }
            : {}),
        });
        const files = listWorkspaceFiles(workspaceRoot);
        const validation =
          preflight?.ok && executionToken
            ? combineRolePackageValidation(
                validateRolePackage(workspaceRoot, files, {
                  preflight,
                  executionToken,
                }),
                preNormalizationScanErrors,
              )
            : combineRolePackageValidation(
                validateRolePackage(workspaceRoot, files),
                preNormalizationScanErrors,
              );
        const roleFeedbackPacket = buildDijieRoleFeedbackPacket({
          result,
          startedAt,
          endedAt,
          files,
          validation,
          ...(preflight?.ok ? { preflight } : {}),
        });
        if (packageOnly) {
          const packageResult = buildDeveloperRolePackageResult({
            roleFeedbackPacket,
          });
          const executionOk = packageResult.status === "completed";

          return jsonResult({
            ok: executionOk,
            summary:
              packageResult.status === "completed"
                ? "迭界AI role-builder developer package generation completed and validated"
                : "迭界AI role-builder developer package generation failed or produced an invalid role_package",
            confirmed: true,
            packageOnly: true,
            status: packageResult.status,
            changedFiles: packageResult.changedFiles,
            artifacts: packageResult.artifacts,
            result: packageResult,
            roleFeedbackPacket,
            rolePackageValidation: validation,
            allowWrites: config.allowWrites,
            outputRoot: workspaceRoot,
            executionEngine: roleBuilderExecutor === "native" ? "openclaw-native" : "subprocess",
            localExecutor: result,
          });
        }
        if (!preflight?.ok || !executionToken) {
          throw new Error("authorized role-builder execution requires verified preflight");
        }
        const auditSummary = buildDijieAuditSummary({
          preflight,
          roleFeedbackPacket,
        });
        const auditUpload = await uploadDijieAudit({
          config,
          executionToken: executionToken,
          auditSummary,
        });
        const executionOk = auditSummary.status === "completed" && auditUpload.ok;

        return jsonResult({
          ok: executionOk,
          summary: executionOk
            ? auditUpload.skipped
              ? "迭界AI role-builder OpenClaw main-system local execution completed and validated"
              : "迭界AI role-builder OpenClaw main-system local execution completed, validated, and audited"
            : auditSummary.status !== "completed"
              ? "迭界AI role-builder local executor failed or produced an invalid role_package"
              : "迭界AI role-builder audit upload failed",
          confirmed: true,
          executionId: preflight.executionId,
          roleListingId: preflight.roleListingId,
          packageId: preflight.packageId,
          packageVersion: preflight.packageVersion,
          developerRef: preflight.developerRef,
          listingOwnerRef: preflight.listingOwnerRef,
          billingBeneficiaryRef: preflight.billingBeneficiaryRef,
          entitlementId: preflight.entitlementId,
          deviceId: preflight.deviceId,
          workspaceRef: preflight.workspaceRef,
          localGatewayId: preflight.localGatewayId,
          status: auditSummary.status,
          changedFiles: auditSummary.result.changedFiles,
          artifacts: auditSummary.result.artifacts,
          roleTokenPricing: auditSummary.roleTokenPricing,
          modelProxyUsage: auditSummary.modelProxyUsage,
          toolUsage: auditSummary.toolUsage,
          result: auditSummary.result,
          auditSummary,
          roleFeedbackPacket,
          rolePackageValidation: validation,
          auditUpload,
          allowWrites: config.allowWrites,
          outputRoot: workspaceRoot,
          executionEngine: roleBuilderExecutor === "native" ? "openclaw-native" : "subprocess",
          localExecutor: result,
        });
      }

      requireExistingRepo(config);
      const developerId =
        typeof params.developer_id === "string" && params.developer_id.trim()
          ? params.developer_id
          : "merchant_001";

      const args = [
        "main.py",
        "--generate-local-role-package",
        requestZh,
        "--generate-local-role-package-developer-id",
        developerId,
        "--generate-local-role-package-output-root",
        outputRoot,
      ];
      if (confirmBrief) {
        args.push("--generate-local-role-package-confirm");
      }

      const result = await runCommand(config.pythonBinary, args, {
        cwd: realpathSync(config.repoRoot),
        maxOutputChars: config.maxOutputChars,
        timeoutMs,
      });

      return jsonResult({
        summary:
          result.exitCode === 0
            ? confirmBrief
              ? "迭界AI role-builder package command completed"
              : "迭界AI role-builder brief command completed"
            : "迭界AI role-builder command failed",
        confirmed: confirmBrief,
        allowWrites: config.allowWrites,
        outputRoot,
        result,
      });
    },
  };
}

function readToolResultDetails(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return {};
  }
  const details = (result as { details?: unknown }).details;
  return asRecord(details);
}

async function runRoleBuilderGatewayRequest(
  tool: AnyAgentTool,
  params: unknown,
  failureSummary = "迭界AI role-builder request failed before local execution could complete",
): Promise<Record<string, unknown>> {
  return await runAicsGatewayToolRequest(
    tool,
    params,
    failureSummary,
    "gateway-dijie-role-builder",
  );
}

async function runAicsGatewayToolRequest(
  tool: AnyAgentTool,
  params: unknown,
  failureSummary: string,
  toolCallId: string,
): Promise<Record<string, unknown>> {
  try {
    const result = await tool.execute(toolCallId, params);
    const details = readToolResultDetails(result);
    return {
      ok: details.ok !== false,
      ...details,
    };
  } catch (error) {
    return {
      ok: false,
      summary: failureSummary,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default definePluginEntry({
  id: "aics",
  name: "迭界AI",
  description: "迭界AI business logic bridge for OpenClaw.",
  register(api) {
    const config = readPluginConfig(api.pluginConfig);
    const executionAuditReadTool = createExecutionAuditReadTool(config);
    const executionTokenRequestTool = createExecutionTokenRequestTool(config);
    const marketplaceInstalledRolesTool = createMarketplaceInstalledRolesTool(config);
    const roleAuthorizationTool = createRoleAuthorizationTool(config);
    const roleTaskRunTool = createRoleTaskRunTool(config, api.runtime, api.config);
    const roleBuilderTool = createRoleBuilderTool(config, api.runtime, api.config);
    api.registerGatewayMethod(
      "dijie.execution.preflight",
      ({ params, respond }) => {
        respond(true, verifyDijieExecutionPreflight(config, params));
      },
      { scope: "operator.write" },
    );
    api.registerGatewayMethod(
      "dijie.roleBuilder.run",
      async ({ params }) => (await runRoleBuilderGatewayRequest(roleBuilderTool, params)) as never,
      { scope: "operator.write" },
    );
    api.registerGatewayMethod(
      "dijie.executionToken.request",
      async ({ params }) =>
        (await runRoleBuilderGatewayRequest(
          executionTokenRequestTool,
          params,
          "迭界AI execution token request failed before cloud authorization could complete",
        )) as never,
      { scope: "operator.write" },
    );
    api.registerGatewayMethod(
      "dijie.executionAudit.read",
      async ({ params }) =>
        (await runRoleBuilderGatewayRequest(
          executionAuditReadTool,
          params,
          "迭界AI execution audit read failed before cloud read could complete",
        )) as never,
      { scope: "operator.read" },
    );
    api.registerGatewayMethod(
      "dijie.marketplace.roles.list",
      async ({ params }) =>
        (await runRoleBuilderGatewayRequest(
          marketplaceInstalledRolesTool,
          params,
          "迭界AI marketplace installed roles read failed before marketplace read could complete",
        )) as never,
      { scope: "operator.read" },
    );
    api.registerGatewayMethod(
      "dijie.roleAuthorization.create",
      async ({ params }) =>
        (await runRoleBuilderGatewayRequest(
          roleAuthorizationTool,
          params,
          "迭界AI role authorization failed before cloud authorization could complete",
        )) as never,
      { scope: "operator.write" },
    );
    api.registerGatewayMethod(
      "dijie.roleTask.run",
      async ({ params }) =>
        (await runAicsGatewayToolRequest(
          roleTaskRunTool,
          params,
          "迭界AI role task failed before OpenClaw-native execution could complete",
          "gateway-dijie-role-task-run",
        )) as never,
      { scope: "operator.write" },
    );
    api.registerTool(createStatusTool(config));
    api.registerTool(executionAuditReadTool);
    api.registerTool(executionTokenRequestTool);
    api.registerTool(marketplaceInstalledRolesTool);
    api.registerTool(roleAuthorizationTool);
    api.registerTool(roleTaskRunTool);
    api.registerTool(roleBuilderTool);
  },
});
