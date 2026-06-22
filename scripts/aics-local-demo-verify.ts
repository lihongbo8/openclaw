#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

(globalThis as typeof globalThis & { require?: NodeRequire }).require ??= createRequire(
  import.meta.url,
);

type OpenClawConfig = typeof import("../src/config/types.js").OpenClawConfig;
type ClosedLoopReadiness = {
  ok?: boolean;
  status?: string;
  mode?: string;
  checks?: Array<{
    id?: string;
    label?: string;
    status?: string;
    message?: string;
    httpStatus?: number;
  }>;
  nextActions?: Array<{
    id?: string;
    label?: string;
    message?: string;
    action?: string;
  }>;
  context?: Record<string, unknown>;
};

type LocalDemoVerifySummary = ReturnType<typeof summarize>;

type VerifyArgs = {
  cloud: boolean;
  json: boolean;
  live?: boolean;
  localRehearsal: boolean;
  requireExecuted: boolean;
  timeoutMs?: number;
  roleListingId?: string;
  entitlementId?: string;
  outputPath?: string;
  internalReadiness?: boolean;
};

type ChainEvidence = {
  mode: string;
  rolePrepared: boolean;
  authorized: boolean;
  dispatchReady: boolean;
  evidenceReadback: boolean;
  modelUsageReadback: boolean;
  roleListingId: string | null;
  entitlementId: string | null;
  taskPackageId: string | null;
  dispatchToRoleRequestId: string | null;
  categoryCapabilityId: string | null;
  requiredCapabilityRefs: string[];
  executionId: string | null;
  auditRecordId: string | null;
  ledgerRef: string | null;
  modelUsage: Record<string, unknown> | null;
  modelUsageNotApplicableReason: string | null;
  costSummary: Record<string, unknown> | null;
  humanConfirmationRef: string | null;
  costSummaryReadback: boolean;
  humanConfirmationReadback: boolean;
  businessDeliverables: Array<Record<string, unknown>>;
  businessDeliverablesReadback: boolean;
  artifactRefs: string[];
  businessArtifactRefs: string[];
  rolesCount: number | null;
  authorizedRolesCount: number | null;
  roleReviewsCount: number | null;
  categoryCapabilityRequestsCount: number | null;
};

type ProductionFinalGate = {
  status: "not_evaluated";
  requiredVerdict: "production_plus_passed";
  reason: string;
  nextAction: string;
  operatorChecklist: Array<{
    label: string;
    detail: string;
    requiredInput?: string;
  }>;
  operatorSteps: Array<{
    step: string;
    status: "blocked" | "pending" | "ready";
    action: string;
    requiredInputs?: string[];
  }>;
  requiredInputs: string[];
  readinessCommand: string;
  finalCommand: string;
  secretHandling: string;
};

function parseArgs(argv: string[]): VerifyArgs {
  const args: VerifyArgs = {
    cloud: false,
    json: false,
    localRehearsal: false,
    requireExecuted: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--cloud") args.cloud = true;
    else if (arg === "--local-rehearsal") args.localRehearsal = true;
    else if (arg === "--live") args.live = true;
    else if (arg === "--no-live") args.live = false;
    else if (arg === "--require-executed") args.requireExecuted = true;
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++i]);
    else if (arg === "--role-listing-id") args.roleListingId = argv[++i];
    else if (arg === "--entitlement-id") args.entitlementId = argv[++i];
    else if (arg === "--output") args.outputPath = argv[++i];
    else if (arg === "--internal-readiness") args.internalReadiness = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: npm run aics:local-demo:verify -- [--json] [--output <path>] [--timeout-ms <ms>] [--require-executed] [--live|--no-live] [--cloud]",
          "",
          "Checks the local marketplace-ops demo chain without creating or deleting data.",
          "By default this forces local-mode checks even when a localhost cloud bridge exists.",
          "--cloud preserves the configured cloud bridge and checks cloud readiness instead.",
          "--local-rehearsal checks the local non-paid execution path that does not call external model APIs.",
          "--require-executed fails until execution result, business artifact, audit, ledger, and model usage or an explicit no-model reason read back.",
          "--output writes the machine-readable local acceptance manifest to a JSON file.",
          "--timeout-ms caps the readiness wait; on timeout the command writes a blocked manifest instead of hanging.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function stripParentOnlyArgs(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      index += 1;
      continue;
    }
    if (arg === "--internal-readiness") continue;
    result.push(arg);
  }
  return result;
}

function writeAcceptanceManifest(
  summary: ReturnType<typeof summarize>,
  outputPath: string,
): string {
  const resolved = resolve(outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return resolved;
}

function resolveCliTimeoutMs(args: VerifyArgs): number {
  const timeoutMs = Number.isFinite(args.timeoutMs) ? Number(args.timeoutMs) : 15_000;
  return Math.max(500, Math.min(60_000, Math.floor(timeoutMs)));
}

function timeoutReadiness(timeoutMs: number, args: VerifyArgs): ClosedLoopReadiness {
  const mode = args.cloud ? "cloud" : "local";
  return {
    ok: false,
    status: "blocked",
    mode,
    checks: [
      {
        id: "readinessTimeout",
        label: "本地验收响应",
        status: "blocked",
        message: `验收脚本等待 ${timeoutMs}ms 后仍未拿到 readiness 结果，已停止等待，避免真人操作时卡死。`,
      },
    ],
    nextActions: [
      {
        id: "readinessTimeout",
        label: "重新检查本地服务",
        message: "本地验收入口没有及时返回。",
        action:
          "确认本地 OpenClaw 服务和数据库没有被上一次测试占用；然后运行 npm run aics:local-demo:verify -- --timeout-ms 15000。",
      },
    ],
    context: {
      timeoutMs,
      timedOut: true,
      mode,
    },
  };
}

function parseChildSummary(stdout: string): LocalDemoVerifySummary {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("readiness child produced no output");
  }
  return JSON.parse(trimmed) as LocalDemoVerifySummary;
}

async function runLocalDemoVerifyChildForCli(
  argv: string[],
  args: VerifyArgs,
): Promise<{ summary: LocalDemoVerifySummary; timedOut: boolean }> {
  const timeoutMs = resolveCliTimeoutMs(args);
  const childArgs = [
    ...process.execArgv,
    process.argv[1],
    "--internal-readiness",
    "--json",
    ...stripParentOnlyArgs(argv).filter((arg) => arg !== "--json"),
  ];
  return await new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: { summary: LocalDemoVerifySummary; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolveChild(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      rejectChild(error);
    };
    timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
      finish({
        summary: summarize(timeoutReadiness(timeoutMs, args), args),
        timedOut: true,
      });
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      try {
        const summary = parseChildSummary(stdout);
        finish({ summary, timedOut: false });
      } catch (error) {
        fail(
          new Error(
            `readiness child failed${typeof code === "number" ? ` with exit ${code}` : ""}: ${
              error instanceof Error ? error.message : String(error)
            }${stderr.trim() ? `\n${stderr.trim()}` : ""}`,
          ),
        );
      }
    });
  });
}

function actionForCheck(check: NonNullable<ClosedLoopReadiness["checks"]>[number]): string {
  const localEvidenceReadbackAction =
    "页面验收：到岗位执行页点击“运行任务”，确认真实 API 费用提示；命令行验收：运行 npm run aics:local-demo:run -- --confirm-real-api-cost；完成后运行 npm run aics:local-demo:verify -- --require-executed。";
  switch (check.id) {
    case "roleExecutionModel":
      return "到 API 管理填写模型 API Key，并保留“岗位执行”用途。";
    case "localAuthorizedRole":
      return "先创建/审核/上架商城运营诊断官，再在费用与授权创建 0 元正式授权。";
    case "localExecutionQueue":
      return "到任务调度生成派发单，并确认执行与费用。";
    case "localEvidenceReadback":
      return `${localEvidenceReadbackAction} 无付费 API 验收可运行：npm run aics:local-demo:run -- --local-rehearsal。`;
    case "cloudBaseUrl":
    case "cloudAccessToken":
    case "localExecutionContext":
    case "myRoles":
    case "executionToken":
      return "如果正在接云端 SaaS，请在 API 管理修复迭界AI云端连接；本地版可先不配置云端。";
    default:
      return "按页面提示修复该阻塞项后重新检查。";
  }
}

function normalizeChecks(readiness: ClosedLoopReadiness) {
  return Array.isArray(readiness.checks) ? readiness.checks : [];
}

function normalizeNextActions(readiness: ClosedLoopReadiness) {
  return Array.isArray(readiness.nextActions) ? readiness.nextActions : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function businessDeliverablesText(value: Array<Record<string, unknown>>): string {
  if (!value.length) return "缺失";
  return value
    .map((item) => stringValue(item.label) ?? "")
    .filter(Boolean)
    .join("、");
}

function hasRequiredBusinessDeliverables(value: Array<Record<string, unknown>>): boolean {
  const labels = new Set(value.map((item) => stringValue(item.label)).filter(Boolean));
  return REQUIRED_MARKETPLACE_OPS_DELIVERABLE_LABELS.every((label) => labels.has(label));
}

function hasModelUsageEvidence(value: unknown): value is Record<string, unknown> {
  const modelUsage = objectValue(value);
  return Boolean(
    modelUsage &&
    (typeof modelUsage.totalTokens === "number" ||
      typeof modelUsage.inputTokens === "number" ||
      typeof modelUsage.outputTokens === "number" ||
      typeof modelUsage.costCents === "number"),
  );
}

function modelUsageText(
  value: Record<string, unknown> | null,
  noModelReason?: string | null,
): string {
  if (!value && noModelReason) return `本次未调用模型 · ${noModelReason}`;
  if (!value) return "缺失";
  const parts = [
    typeof value.totalTokens === "number" ? `${value.totalTokens} Token` : "",
    typeof value.costCents === "number" ? `¥${(value.costCents / 100).toFixed(2)}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "缺失";
}

function businessArtifactLabel(ref: string, index: number): string {
  const value = ref.trim();
  if (!value) return `业务产物 ${index + 1}`;
  const name = value.split(/[\\/]/u).pop() || value;
  if (/hero\.(png|jpe?g|webp)$/iu.test(name)) return `图片 ${name}`;
  if (/detail\.html?$/iu.test(name)) return `详情页 ${name}`;
  if (/execution-summary\.json$/iu.test(name)) return `执行摘要 ${name}`;
  if (/artifacts\.zip$/iu.test(name)) return `打包文件 ${name}`;
  if (/artifact-manifest\.json$/iu.test(name)) return `产物清单 ${name}`;
  return value;
}

function businessArtifactText(refs: string[]): string {
  return refs.length ? refs.map(businessArtifactLabel).join("、") : "无";
}

function categoryCapabilitySummary(evidence: ChainEvidence): string {
  const requiredCapabilityRefs = evidence.requiredCapabilityRefs ?? [];
  if (evidence.categoryCapabilityId) return "已绑定";
  if (
    requiredCapabilityRefs.length &&
    evidence.authorized &&
    evidence.dispatchReady &&
    evidence.evidenceReadback
  ) {
    return `本地能力已覆盖（${requiredCapabilityRefs.join("、")}）`;
  }
  if (requiredCapabilityRefs.length) {
    return `已声明，待闭环验证（${requiredCapabilityRefs.join("、")}）`;
  }
  return "缺失";
}

function checkPassed(checks: NonNullable<ClosedLoopReadiness["checks"]>, id: string): boolean {
  return checks.some((check) => check.id === id && check.status === "pass");
}

function buildChainEvidence(
  readiness: ClosedLoopReadiness,
  checks: NonNullable<ClosedLoopReadiness["checks"]>,
): ChainEvidence {
  const context = readiness.context ?? {};
  const artifactRefs = stringArray(context.artifactRefs);
  const businessArtifactRefs = artifactRefs.filter(
    (ref) => !ref.startsWith("audit:") && !ref.startsWith("ledger:"),
  );
  const modelUsage = objectValue(context.modelUsage);
  const modelUsageNotApplicableReason = stringValue(context.modelUsageNotApplicableReason);
  const modelUsageReadback =
    hasModelUsageEvidence(modelUsage) || Boolean(modelUsageNotApplicableReason);
  const costSummary = objectValue(context.costSummary);
  const humanConfirmationRef = stringValue(context.humanConfirmationRef);
  const businessDeliverables = recordArray(context.businessDeliverables);
  const costSummaryReadback = Boolean(
    costSummary &&
    (typeof costSummary.totalCostCents === "number" ||
      typeof costSummary.authorizationFeeCents === "number" ||
      typeof costSummary.executionFeeCents === "number" ||
      typeof costSummary.modelUsageCostCents === "number" ||
      typeof costSummary.ledgerRef === "string"),
  );
  return {
    mode: readiness.mode ?? "unknown",
    rolePrepared: checkPassed(checks, "localRolePreparation"),
    authorized: checkPassed(checks, "localAuthorizedRole"),
    dispatchReady: checkPassed(checks, "localExecutionQueue"),
    evidenceReadback: checkPassed(checks, "localEvidenceReadback"),
    modelUsageReadback,
    roleListingId: stringValue(context.roleListingId),
    entitlementId: stringValue(context.entitlementId),
    taskPackageId: stringValue(context.taskPackageId),
    dispatchToRoleRequestId: stringValue(context.dispatchToRoleRequestId),
    categoryCapabilityId: stringValue(context.categoryCapabilityId),
    requiredCapabilityRefs: stringArray(context.requiredCapabilityRefs),
    executionId: stringValue(context.executionId),
    auditRecordId: stringValue(context.auditRecordId),
    ledgerRef: stringValue(context.ledgerRef),
    modelUsage,
    modelUsageNotApplicableReason,
    costSummary,
    humanConfirmationRef,
    costSummaryReadback,
    humanConfirmationReadback: Boolean(humanConfirmationRef),
    businessDeliverables,
    businessDeliverablesReadback: hasRequiredBusinessDeliverables(businessDeliverables),
    artifactRefs,
    businessArtifactRefs,
    rolesCount: numberValue(context.rolesCount),
    authorizedRolesCount: numberValue(context.authorizedRolesCount),
    roleReviewsCount: numberValue(context.roleReviewsCount),
    categoryCapabilityRequestsCount: numberValue(context.categoryCapabilityRequestsCount),
  };
}

function productionFinalGate(): ProductionFinalGate {
  return {
    status: "not_evaluated",
    requiredVerdict: "production_plus_passed",
    reason:
      "云端 SaaS、多账号和真实远端部署属于追加验收；本地版先按当前检查项完成，不用等待云端部署。",
    nextAction:
      "本地版可跳过；需要上线云端 SaaS、使用者中心或真实远端商城时，再运行 production-plus orchestrator。",
    operatorChecklist: [
      {
        label: "连接真实云端商城",
        detail: "填写并探测云端商城地址，确认审核、授权、岗位和商品接口都能读取。",
        requiredInput: "DIJIE_CLOUD_BASE_URL",
      },
      {
        label: "打开本地 OpenClaw UI",
        detail:
          "确认本地管理后台可以被浏览器访问，persona 测试会真实点击 API 管理、费用与授权、任务调度和岗位执行。",
        requiredInput: "OPENCLAW_LOCAL_URL",
      },
      {
        label: "准备云端桥接与执行令牌",
        detail: "让本地 gateway 可以安全调用云端桥接接口，并验证岗位执行 token。",
        requiredInput: "DIJIE_INTERNAL_BRIDGE_BEARER / DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM",
      },
      {
        label: "准备三类真人身份",
        detail:
          "开发者、管理者、购买者身份都要能登录或调用；没有分身份 token 时可用云端通用 token 代替。",
        requiredInput:
          "DIJIE_VENDOR_ACCESS_TOKEN / DIJIE_ADMIN_ACCESS_TOKEN / DIJIE_BUYER_ACCESS_TOKEN",
      },
      {
        label: "跑云端 SaaS 最终验收",
        detail:
          "云端部署时再验证多账号、远端商城、云端授权、同步本地、主流程调度执行、账本审计读回全链路。",
        requiredInput: "production_plus_passed",
      },
    ],
    operatorSteps: [
      {
        step: "1. 连接两个地址",
        status: "blocked",
        action:
          "填云端商城 API 地址和本地 OpenClaw UI 地址，然后重新跑 readiness；两个地址都必须可访问。",
        requiredInputs: ["DIJIE_CLOUD_BASE_URL", "OPENCLAW_LOCAL_URL"],
      },
      {
        step: "2. 准备执行通行证",
        status: "blocked",
        action: "填本地到云端的 bridge bearer 和执行令牌公钥；证据只显示字段名，不显示密钥值。",
        requiredInputs: ["DIJIE_INTERNAL_BRIDGE_BEARER", "DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM"],
      },
      {
        step: "3. 准备三类真人身份",
        status: "blocked",
        action: "准备开发者、审核管理者、购买者访问令牌；也可以先用云端通用访问令牌替代三类身份。",
        requiredInputs: [
          "DIJIE_VENDOR_ACCESS_TOKEN",
          "DIJIE_ADMIN_ACCESS_TOKEN",
          "DIJIE_BUYER_ACCESS_TOKEN",
          "DIJIE_CLOUD_ACCESS_TOKEN",
        ],
      },
      {
        step: "4. 跑云端 SaaS 最终验收",
        status: "pending",
        action:
          "云端 SaaS readiness 全部通过后，运行 final manifest 校验和 production-plus orchestrator；只有 verdict 为 production_plus_passed 才算云端 SaaS 通过。",
      },
    ],
    requiredInputs: [
      "DIJIE_CLOUD_BASE_URL",
      "OPENCLAW_LOCAL_URL",
      "DIJIE_INTERNAL_BRIDGE_BEARER",
      "DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM",
      "DIJIE_VENDOR_ACCESS_TOKEN 或 DIJIE_CLOUD_ACCESS_TOKEN",
      "DIJIE_ADMIN_ACCESS_TOKEN 或 DIJIE_CLOUD_ACCESS_TOKEN",
      "DIJIE_BUYER_ACCESS_TOKEN 或 DIJIE_CLOUD_ACCESS_TOKEN",
    ],
    readinessCommand:
      "node scripts/persona/aics-production-plus-readiness.mjs --probe-endpoints --output-dir /private/tmp/aics-production-plus-readiness",
    finalCommand:
      'node scripts/persona/aics-production-plus-orchestrator.mjs --seed-file docs/aics-persona-runs/<runId>/api-seed.json --production-plus-final --probe-endpoints --final-manifest docs/aics-persona-runs/<runId>/final-manifest.json --base-url "$DIJIE_CLOUD_BASE_URL" --openclaw-url "$OPENCLAW_LOCAL_URL" --run-id <runId> --output-dir docs/aics-persona-runs/<runId>',
    secretHandling:
      "只填写环境变量名和占位符，不把 token、私有 URL、prompt、包正文或用户数据写入证据。",
  };
}

export function summarize(readiness: ClosedLoopReadiness, args: VerifyArgs) {
  const checks = normalizeChecks(readiness);
  const readinessNextActions = normalizeNextActions(readiness);
  const blockedChecks = checks.filter((check) => check.status === "blocked");
  const skippedChecks = checks.filter((check) => check.status === "skipped");
  const chainEvidence = buildChainEvidence(readiness, checks);
  const executed =
    chainEvidence.evidenceReadback &&
    Boolean(chainEvidence.executionId) &&
    Boolean(chainEvidence.auditRecordId) &&
    Boolean(chainEvidence.ledgerRef) &&
    chainEvidence.businessArtifactRefs.length > 0 &&
    chainEvidence.businessDeliverablesReadback &&
    chainEvidence.costSummaryReadback &&
    chainEvidence.humanConfirmationReadback &&
    chainEvidence.modelUsageReadback;
  const requireExecutedBlocked = args.requireExecuted && !executed;
  const status = blockedChecks.length || requireExecutedBlocked ? "blocked" : "ready";
  const readyButNotExecuted = !blockedChecks.length && !executed && !args.requireExecuted;
  const fallbackNextActions = [
    ...(blockedChecks.length && !readinessNextActions.length
      ? blockedChecks.map((check) => ({
          id: check.id ?? "unknown",
          label: check.label ?? check.id ?? "未知检查",
          message: check.message ?? "存在阻塞。",
          action: actionForCheck(check),
        }))
      : []),
    ...(requireExecutedBlocked && !readinessNextActions.length
      ? [
          {
            id: "localEvidenceReadback",
            label: "本地审计账本读回",
            message:
              "已要求完整验收，但当前还没有执行结果、业务产物、商城运营业务明细、审计、账本、费用摘要、人工确认，以及模型费用证据或未调用模型说明读回。",
            action: actionForCheck({ id: "localEvidenceReadback" }),
          },
        ]
      : []),
    ...(readyButNotExecuted && !readinessNextActions.length
      ? [
          {
            id: "localEvidenceReadback",
            label: "本地审计账本读回",
            message:
              "本地 API、授权和执行队列已准备好，但还没有真实执行结果、业务产物、商城运营业务明细、审计、账本、费用摘要、人工确认，以及模型费用证据或未调用模型说明读回。",
            action: actionForCheck({ id: "localEvidenceReadback" }),
          },
        ]
      : []),
  ];
  const nextActions = readinessNextActions.length ? readinessNextActions : fallbackNextActions;
  const normalizedNextActions = !executed
    ? nextActions.map((action) =>
        action.id === "localEvidenceReadback"
          ? {
              ...action,
              action: actionForCheck({ id: "localEvidenceReadback" }),
            }
          : action,
      )
    : nextActions;
  return {
    ok: status === "ready",
    status,
    mode: readiness.mode ?? "unknown",
    executed,
    requireExecuted: args.requireExecuted,
    checks,
    skippedChecks,
    nextActions: normalizedNextActions,
    context: readiness.context ?? {},
    chainEvidence,
    productionFinalGate: productionFinalGate(),
  };
}

export async function callClosedLoopReadiness(config: OpenClawConfig, args: VerifyArgs) {
  const { coreGatewayHandlers } = await import("../src/gateway/server-methods.js");
  const handler = coreGatewayHandlers["aics.closedLoop.readiness.get"];
  if (!handler) throw new Error("Missing gateway handler: aics.closedLoop.readiness.get");
  const params: Record<string, unknown> = {
    mode: args.cloud ? "cloud" : "local",
    ...(typeof args.live === "boolean" ? { live: args.live } : {}),
    ...(Number.isFinite(args.timeoutMs) ? { timeoutMs: args.timeoutMs } : {}),
    ...(args.roleListingId ? { roleListingId: args.roleListingId } : {}),
    ...(args.entitlementId ? { entitlementId: args.entitlementId } : {}),
    ...(args.localRehearsal ? { localRehearsal: true } : {}),
  };
  let captured: { ok: boolean; payload?: unknown; error?: unknown } | null = null;
  await handler({
    req: {
      type: "req",
      id: "aics-local-demo-verify",
      method: "aics.closedLoop.readiness.get",
      params,
    },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      captured = { ok, payload, error };
    },
    context: {
      getRuntimeConfig: () => config,
    },
  } as never);
  if (!captured?.ok) {
    throw new Error(JSON.stringify(captured?.error ?? captured?.payload ?? "readiness failed"));
  }
  return captured.payload as ClosedLoopReadiness;
}

export function configForVerifyMode(config: OpenClawConfig, args: VerifyArgs): OpenClawConfig {
  if (args.cloud) return config;
  const cloned = structuredClone(config) as Record<string, unknown>;
  const plugins = cloned.plugins as Record<string, unknown> | undefined;
  const entries = plugins?.entries as Record<string, unknown> | undefined;
  const aicsEntry = entries?.aics as Record<string, unknown> | undefined;
  const aicsConfig = aicsEntry?.config as Record<string, unknown> | undefined;
  if (aicsConfig) {
    for (const key of [
      "cloudBaseUrl",
      "cloudAccessToken",
      "defaultRoleListingId",
      "defaultEntitlementId",
      "defaultDeviceId",
      "defaultWorkspaceRef",
      "defaultLocalGatewayId",
    ]) {
      delete aicsConfig[key];
    }
  }
  const apiConnections = cloned.apiConnections as Record<string, unknown> | undefined;
  const apiEntries = apiConnections?.entries as Record<string, unknown> | undefined;
  if (apiEntries) {
    for (const [id, value] of Object.entries(apiEntries)) {
      const entry = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      const kind = typeof entry.kind === "string" ? entry.kind : "";
      const provider = typeof entry.provider === "string" ? entry.provider : "";
      if (
        kind === "marketplace" ||
        provider === "dijie-cloud-bridge" ||
        provider === "cloud-marketplace"
      ) {
        delete apiEntries[id];
      }
    }
  }
  return cloned as OpenClawConfig;
}

export async function loadLocalDemoConfig(env = process.env): Promise<OpenClawConfig> {
  const { createConfigIO } = await import("../src/config/config.js");
  return createConfigIO({
    pluginValidation: "skip",
    shellEnvFallback: env.OPENCLAW_AICS_VERIFY_SKIP_SHELL_ENV_FALLBACK !== "0" ? "defer" : "load",
    observe: false,
  }).loadConfig() as OpenClawConfig;
}

export function renderHuman(summary: ReturnType<typeof summarize>): string {
  const context = summary.context ?? {};
  const evidence = summary.chainEvidence;
  const requiredCapabilityRefs = evidence.requiredCapabilityRefs ?? [];
  const finalGate = summary.productionFinalGate ?? productionFinalGate();
  const statusLabel =
    summary.status === "ready" && summary.executed
      ? "已完成"
      : summary.status === "ready"
        ? "可继续"
        : "阻塞";
  const lines = [
    `本地 demo 验收状态：${statusLabel}`,
    `模式：${summary.mode}`,
    `已执行并读回完整闭环证据：${summary.executed ? "是" : "否"}`,
    "",
    "检查项：",
    ...summary.checks.map((check) => {
      const label = check.label ?? check.id ?? "未知检查";
      const status =
        check.status === "pass" ? "PASS" : check.status === "skipped" ? "SKIP" : "BLOCKED";
      return `- ${status} ${label}：${check.message ?? ""}`;
    }),
    "",
    "真人验收摘要：",
    `- 岗位授权：${evidence.authorized ? "已授权" : "缺失"}`,
    `- 品类能力：${categoryCapabilitySummary(evidence)}`,
    `- 执行队列：${evidence.dispatchReady ? "已派发" : "缺失"}`,
    `- 业务成果：${businessArtifactText(evidence.businessArtifactRefs)}`,
    `- 业务明细：${evidence.businessDeliverablesReadback ? businessDeliverablesText(evidence.businessDeliverables) : "缺失"}`,
    `- 审计记录：${evidence.auditRecordId ? "已读回" : "未读回"}`,
    `- 账本记录：${evidence.ledgerRef ? "已读回" : "未读回"}`,
    `- 费用摘要：${evidence.costSummaryReadback ? "已读回" : "未读回"}`,
    `- 人工确认：${evidence.humanConfirmationRef ?? "未读回"}`,
    `- 模型费用：${modelUsageText(evidence.modelUsage, evidence.modelUsageNotApplicableReason)}`,
    "",
    "技术证据：",
    `- roleListingId：${evidence.roleListingId ?? "缺失"}`,
    `- entitlementId：${evidence.entitlementId ?? "缺失"}`,
    `- taskPackageId：${evidence.taskPackageId ?? "缺失"}`,
    `- dispatchToRoleRequestId：${evidence.dispatchToRoleRequestId ?? "缺失"}`,
    `- categoryCapabilityId：${evidence.categoryCapabilityId ?? "缺失"}`,
    `- requiredCapabilityRefs：${requiredCapabilityRefs.length ? requiredCapabilityRefs.join("、") : "缺失"}`,
    `- executionId：${evidence.executionId ?? "未执行"}`,
    `- auditRecordId：${evidence.auditRecordId ?? "未读回"}`,
    `- ledgerRef：${evidence.ledgerRef ?? "未读回"}`,
    `- costSummary：${evidence.costSummaryReadback ? "已读回" : "缺失"}`,
    `- humanConfirmationRef：${evidence.humanConfirmationRef ?? "缺失"}`,
    `- businessDeliverables：${businessDeliverablesText(evidence.businessDeliverables)}`,
    `- modelUsage：${modelUsageText(evidence.modelUsage, evidence.modelUsageNotApplicableReason)}`,
    `- 业务产物：${businessArtifactText(evidence.businessArtifactRefs)}`,
    "",
    "云端 SaaS 最终验收：未执行（本地版可跳过）",
    `- 云端必须结果：${finalGate.requiredVerdict}`,
    `- 原因：${finalGate.reason}`,
    `- 下一步：${finalGate.nextAction}`,
    "- 真人准备清单：",
    ...finalGate.operatorChecklist.map(
      (item) =>
        `  - ${item.label}：${item.detail}${item.requiredInput ? `（需要：${item.requiredInput}）` : ""}`,
    ),
    "- 云端 SaaS 操作步骤：",
    ...finalGate.operatorSteps.map(
      (item) =>
        `  - ${item.step}：${item.action}${item.requiredInputs?.length ? `（需要：${item.requiredInputs.join("、")}）` : ""}`,
    ),
    `- 需要准备：${finalGate.requiredInputs.join("、")}`,
    `- 先跑 readiness：${finalGate.readinessCommand}`,
    `- 最终验收：${finalGate.finalCommand}`,
    `- 密钥处理：${finalGate.secretHandling}`,
  ];
  if (summary.nextActions.length) {
    lines.push("", "下一步：");
    for (const action of summary.nextActions) {
      lines.push(`- ${action.label}：${action.action}`);
    }
  } else if (summary.executed) {
    lines.push(
      "",
      "本地岗位闭环已完成：执行结果、审计记录、账本记录、业务产物、商城运营业务明细、费用摘要、人工确认，以及模型费用证据或未调用模型说明均已读回。",
      "",
      "执行证据：",
      `- executionId：${evidence.executionId ?? ""}`,
      `- auditRecordId：${evidence.auditRecordId ?? ""}`,
      `- ledgerRef：${evidence.ledgerRef ?? ""}`,
      `- costSummary：${evidence.costSummaryReadback ? "已读回" : "缺失"}`,
      `- humanConfirmationRef：${evidence.humanConfirmationRef ?? ""}`,
      `- businessDeliverables：${businessDeliverablesText(evidence.businessDeliverables)}`,
      `- modelUsage：${modelUsageText(evidence.modelUsage, evidence.modelUsageNotApplicableReason)}`,
      `- 业务产物：${businessArtifactText(evidence.businessArtifactRefs)}`,
    );
  }
  return lines.join("\n");
}

export async function runLocalDemoVerify(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const config = await loadLocalDemoConfig(env);
  const readiness = await callClosedLoopReadiness(configForVerifyMode(config, args), args);
  return summarize(readiness, args);
}

async function runCli(): Promise<void> {
  try {
    const argv = process.argv.slice(2);
    const args = parseArgs(argv);
    if (args.internalReadiness) {
      const summary = await runLocalDemoVerify(stripParentOnlyArgs(argv));
      console.log(JSON.stringify(summary, null, 2));
      process.exitCode = summary.ok ? 0 : 1;
      return;
    }
    const { summary } = await runLocalDemoVerifyChildForCli(argv, args);
    if (args.outputPath) {
      writeAcceptanceManifest(summary, args.outputPath);
    }
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(renderHuman(summary));
    }
    process.exitCode = summary.ok ? 0 : 1;
  } catch (error) {
    if (process.argv.includes("--json")) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      );
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}
