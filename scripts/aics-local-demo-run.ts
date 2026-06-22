#!/usr/bin/env node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { OpenClawConfig } from "../src/config/types.js";
import { coreGatewayHandlers } from "../src/gateway/server-methods.js";
import {
  callClosedLoopReadiness,
  configForVerifyMode,
  loadLocalDemoConfig,
} from "./aics-local-demo-verify.js";

(globalThis as typeof globalThis & { require?: NodeRequire }).require ??= createRequire(
  import.meta.url,
);

type RunArgs = {
  confirmRealApiCost: boolean;
  localRehearsal: boolean;
  json: boolean;
};

function parseArgs(argv: string[]): RunArgs {
  const args: RunArgs = { confirmRealApiCost: false, localRehearsal: false, json: false };
  for (const arg of argv) {
    if (arg === "--confirm-real-api-cost") args.confirmRealApiCost = true;
    else if (arg === "--local-rehearsal") args.localRehearsal = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: npm run aics:local-demo:run -- --confirm-real-api-cost [--json]",
          "       npm run aics:local-demo:run -- --local-rehearsal [--json]",
          "",
          "Runs the prepared local marketplace-ops role task.",
          "This may call the configured role_execution model API.",
          "The command refuses to run unless --confirm-real-api-cost is present.",
          "--local-rehearsal runs the same role/category/Tool-Skill chain with a local image placeholder and does not call external model APIs.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function callRoleTaskRun(config: OpenClawConfig, params: Record<string, unknown>) {
  const handler = coreGatewayHandlers["dijie.roleTask.run"];
  if (!handler) throw new Error("Missing gateway handler: dijie.roleTask.run");
  let captured: { ok: boolean; payload?: unknown; error?: unknown } | null = null;
  await handler({
    req: {
      type: "req",
      id: "aics-local-demo-run",
      method: "dijie.roleTask.run",
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
    throw new Error(JSON.stringify(captured?.error ?? captured?.payload ?? "role task run failed"));
  }
  return captured.payload as Record<string, unknown>;
}

async function callExecutionEvidenceReadback(
  config: OpenClawConfig,
  params: Record<string, unknown>,
) {
  const handler = coreGatewayHandlers["aics.executionEvidence.readback.get"];
  if (!handler) throw new Error("Missing gateway handler: aics.executionEvidence.readback.get");
  let captured: { ok: boolean; payload?: unknown; error?: unknown } | null = null;
  await handler({
    req: {
      type: "req",
      id: "aics-local-demo-run-readback",
      method: "aics.executionEvidence.readback.get",
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
    throw new Error(JSON.stringify(captured?.error ?? captured?.payload ?? "readback failed"));
  }
  return captured.payload as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`本地 demo 尚未准备好：缺少 ${label}。请先运行 npm run aics:local-demo:verify。`);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function reasonsText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      const record = objectValue(item);
      return textValue(record.message) ?? textValue(record.reason) ?? textValue(record.code) ?? "";
    })
    .filter(Boolean)
    .join("；");
}

function hasModelUsageEvidence(value: unknown): boolean {
  const modelUsage = objectValue(value);
  return Boolean(
    modelUsage &&
    (typeof modelUsage.totalTokens === "number" ||
      typeof modelUsage.inputTokens === "number" ||
      typeof modelUsage.outputTokens === "number" ||
      typeof modelUsage.costCents === "number"),
  );
}

async function activateLocalDemoSecretsRuntime(
  config: OpenClawConfig,
  env: NodeJS.ProcessEnv,
): Promise<OpenClawConfig> {
  const runtime = await import("../src/secrets/runtime.js");
  const snapshot = await runtime.prepareSecretsRuntimeSnapshot({ config, env });
  runtime.activateSecretsRuntimeSnapshot(snapshot);
  return snapshot.config;
}

function noModelUsageReasonFromEvidence(evidence: Record<string, unknown>): string {
  if (evidence.modelUsageNotApplicable !== true) return "";
  return (
    textValue(evidence.modelUsageNotApplicableReason) || "本次执行未调用模型，因此无模型费用证据。"
  );
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
    .map((item) => textValue(item.label) ?? "")
    .filter(Boolean)
    .join("、");
}

function hasRequiredBusinessDeliverables(value: Array<Record<string, unknown>>): boolean {
  const labels = new Set(value.map((item) => textValue(item.label)).filter(Boolean));
  return REQUIRED_MARKETPLACE_OPS_DELIVERABLE_LABELS.every((label) => labels.has(label));
}

function demoBusinessArtifactLabel(ref: string, index: number): string {
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

function modelUsageText(value: unknown, noModelReason = ""): string {
  if (noModelReason) return `本次未调用模型 · ${noModelReason}`;
  const modelUsage = objectValue(value);
  if (!hasModelUsageEvidence(modelUsage)) return "缺失";
  const parts = [
    typeof modelUsage.totalTokens === "number" ? `${modelUsage.totalTokens} Token` : "",
    typeof modelUsage.costCents === "number" ? `¥${(modelUsage.costCents / 100).toFixed(2)}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "已读回";
}

export function renderHuman(result: Record<string, unknown>): string {
  if (result.ok === false) {
    const reasons = Array.isArray(result.blockedReasons)
      ? result.blockedReasons.map((item) => String(item)).join("；")
      : "未知阻塞";
    const needsCostConfirmation = reasons.includes("--confirm-real-api-cost");
    const needsLocalRehearsal = reasons.includes("--local-rehearsal");
    return [
      `本地 demo 执行阻塞：${reasons}`,
      ...(needsCostConfirmation
        ? [
            "下一步：确认会调用真实模型 API 并可能产生费用后，运行：",
            "npm run aics:local-demo:run -- --confirm-real-api-cost",
          ]
        : needsLocalRehearsal
          ? [
              "下一步：如只验收本地岗位执行链路且不调用外部模型 API，运行：",
              "npm run aics:local-demo:run -- --local-rehearsal",
            ]
          : ["下一步：按阻塞原因处理后重新运行。"]),
    ].join("\n");
  }
  const auditUpload =
    result.auditUpload &&
    typeof result.auditUpload === "object" &&
    !Array.isArray(result.auditUpload)
      ? (result.auditUpload as Record<string, unknown>)
      : {};
  const billingSummary =
    result.billingSummary &&
    typeof result.billingSummary === "object" &&
    !Array.isArray(result.billingSummary)
      ? (result.billingSummary as Record<string, unknown>)
      : {};
  const readback =
    result.executionEvidenceReadback &&
    typeof result.executionEvidenceReadback === "object" &&
    !Array.isArray(result.executionEvidenceReadback)
      ? (result.executionEvidenceReadback as Record<string, unknown>)
      : {};
  const roleResult = objectValue(result.roleResult);
  const artifactRefs = Array.isArray(roleResult.artifactRefs)
    ? roleResult.artifactRefs.filter((item): item is string => typeof item === "string")
    : [];
  const businessArtifactRefs = artifactRefs.filter(
    (ref) => !ref.startsWith("audit:") && !ref.startsWith("ledger:"),
  );
  const executionEvidence = objectValue(roleResult.executionEvidence);
  const modelUsage = executionEvidence.modelUsage;
  const noModelUsageReason = noModelUsageReasonFromEvidence(executionEvidence);
  const costSummary = objectValue(executionEvidence.costSummary);
  const humanConfirmationRef = textValue(executionEvidence.humanConfirmationRef);
  const businessDeliverables = recordArray(executionEvidence.businessDeliverables);
  const hasCostSummary =
    typeof costSummary.totalCostCents === "number" ||
    typeof costSummary.authorizationFeeCents === "number" ||
    typeof costSummary.executionFeeCents === "number" ||
    typeof costSummary.modelUsageCostCents === "number" ||
    typeof costSummary.ledgerRef === "string";
  const readbackComplete =
    readback.ok === true &&
    businessArtifactRefs.length > 0 &&
    hasRequiredBusinessDeliverables(businessDeliverables) &&
    hasCostSummary &&
    Boolean(humanConfirmationRef) &&
    (hasModelUsageEvidence(modelUsage) || Boolean(noModelUsageReason));
  return [
    readbackComplete
      ? "本地 demo 执行完成，岗位闭环已完成。"
      : "本地 demo 执行完成，但业务产物、审计、账本或模型费用证据未确认。",
    "执行证据：",
    `- executionId：${String(result.executionId ?? "")}`,
    `- auditRecordId：${String(auditUpload.auditRecordId ?? "")}`,
    `- ledgerRef：${String(billingSummary.ledgerRef ?? "")}`,
    `- costSummary：${hasCostSummary ? "已读回" : "缺失"}`,
    `- humanConfirmationRef：${humanConfirmationRef ?? "缺失"}`,
    `- businessDeliverables：${businessDeliverablesText(businessDeliverables)}`,
    `- modelUsage：${modelUsageText(modelUsage, noModelUsageReason)}`,
    `- 业务产物：${businessArtifactRefs.length ? businessArtifactRefs.map(demoBusinessArtifactLabel).join("、") : "无"}`,
    `- 证据读回：${readbackComplete ? "审计、账本、业务产物、商城运营业务明细、费用摘要、人工确认和模型费用证据已读回" : "未确认"}`,
    readbackComplete
      ? "下一步：运行 npm run aics:local-demo:verify -- --require-executed，可看到“已完成”和同一组证据。"
      : "下一步：先处理业务产物、审计、账本或模型费用证据阻塞，再重新验收。",
  ].join("\n");
}

export async function runLocalDemoRoleTask(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (!args.confirmRealApiCost && !args.localRehearsal) {
    return {
      ok: false,
      status: "blocked",
      blockedReasons: [
        "执行会调用 API 管理里配置的岗位执行模型。请显式传入 --confirm-real-api-cost 后再运行；如只验收本地链路且不调用外部模型 API，请传入 --local-rehearsal。",
      ],
    };
  }
  const loadedConfig = await loadLocalDemoConfig(env);
  const activatedConfig = await activateLocalDemoSecretsRuntime(loadedConfig, env);
  const config = configForVerifyMode(activatedConfig, {
    cloud: false,
    json: true,
    live: false,
    localRehearsal: args.localRehearsal,
    requireExecuted: false,
  });
  const readiness = await callClosedLoopReadiness(config, {
    cloud: false,
    json: true,
    live: false,
    localRehearsal: args.localRehearsal,
    requireExecuted: false,
  });
  const blocked = Array.isArray(readiness.checks)
    ? readiness.checks.filter((check) => check.status === "blocked")
    : [];
  if (blocked.length) {
    return {
      ok: false,
      status: "blocked",
      blockedReasons: blocked.map((check) => check.message ?? check.id ?? "存在阻塞项。"),
      readiness,
    };
  }
  const context = readiness.context ?? {};
  const runResult = await callRoleTaskRun(config, {
    roleListingId: requireString(context.roleListingId, "roleListingId"),
    entitlementId: requireString(context.entitlementId, "entitlementId"),
    taskPackageId: requireString(context.taskPackageId, "taskPackageId"),
    dispatchToRoleRequestId: requireString(
      context.dispatchToRoleRequestId,
      "dispatchToRoleRequestId",
    ),
    confirmExecution: true,
    costConfirmed: true,
    ...(args.localRehearsal ? { localRehearsal: true } : {}),
  });
  if (runResult.ok !== true) return runResult;

  const auditUpload = objectValue(runResult.auditUpload);
  const billingSummary = objectValue(runResult.billingSummary);
  const roleResult = objectValue(runResult.roleResult);
  const executionEvidence = objectValue(roleResult.executionEvidence);
  const readback = await callExecutionEvidenceReadback(config, {
    executionId: textValue(runResult.executionId),
    auditRecordId: textValue(auditUpload.auditRecordId),
    ledgerRef: textValue(billingSummary.ledgerRef) ?? textValue(executionEvidence.ledgerRef),
  });
  const hasAudit = Boolean(readback.audit && typeof readback.audit === "object");
  const hasLedger = Boolean(readback.ledger && typeof readback.ledger === "object");
  if (readback.ok !== true || !hasAudit || !hasLedger) {
    return {
      ok: false,
      status: "blocked",
      blockedReasons: [
        reasonsText(readback.blockedReasons) ||
          "本地 demo 执行已返回，但审计记录或账本记录不完整。",
      ],
      executionId: runResult.executionId,
      executionEvidenceReadback: readback,
    };
  }
  const closedLoopReadiness = await callClosedLoopReadiness(config, {
    cloud: false,
    json: true,
    live: false,
    localRehearsal: args.localRehearsal,
    requireExecuted: true,
  });
  const evidenceChecks = Array.isArray(closedLoopReadiness.checks)
    ? closedLoopReadiness.checks
    : [];
  const evidenceBlocked = evidenceChecks.find(
    (check) => check.id === "localEvidenceReadback" && check.status === "blocked",
  );
  if (closedLoopReadiness.ok === false || evidenceBlocked) {
    return {
      ...runResult,
      ok: false,
      status: "blocked",
      blockedReasons: [
        String(
          evidenceBlocked?.message ??
            "本地 demo 执行已返回，但业务产物、审计、账本或模型费用证据不完整。",
        ),
      ],
      executionEvidenceReadback: readback,
      closedLoopReadiness,
    };
  }
  return {
    ...runResult,
    executionEvidenceReadback: readback,
    closedLoopReadiness,
  };
}

async function runCli(): Promise<void> {
  try {
    const result = await runLocalDemoRoleTask();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderHuman(result));
    }
    process.exitCode = result.ok === true ? 0 : 1;
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
