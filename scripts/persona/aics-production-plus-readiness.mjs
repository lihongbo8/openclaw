#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import JSON5 from "json5";
import {
  evaluateProductionPlusEvidence,
  isCli,
  validatePersonaEvidenceSchema,
} from "./aics-persona-runner.mjs";

const TOKEN_GROUPS = [
  ["DIJIE_VENDOR_ACCESS_TOKEN", "DIJIE_CLOUD_ACCESS_TOKEN"],
  ["DIJIE_ADMIN_ACCESS_TOKEN", "DIJIE_CLOUD_ACCESS_TOKEN"],
  ["DIJIE_BUYER_ACCESS_TOKEN", "DIJIE_CLOUD_ACCESS_TOKEN"],
];

const ENDPOINT_PROBES = [
  {
    envName: "DIJIE_CLOUD_BASE_URL",
    name: "DIJIE_CLOUD_BASE_URL reachable",
    defaultPath: "/dijie/gateway/health",
  },
  {
    envName: "OPENCLAW_LOCAL_URL",
    name: "OPENCLAW_LOCAL_URL reachable",
    defaultPath: "/healthz",
  },
];

const CONFIG_DERIVED_ENV = [
  "DIJIE_CLOUD_BASE_URL",
  "OPENCLAW_LOCAL_URL",
  "DIJIE_CLOUD_ACCESS_TOKEN",
  "DIJIE_INTERNAL_BRIDGE_BEARER",
  "DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM",
];

const DEFAULT_OPENCLAW_LOCAL_GATEWAY_PORT = 18789;
const DIJIE_CLOUD_MARKETPLACE_REPO_HINT = "/Users/weizuo/Documents/ai公司/dijie-role-marketplace";
const DIJIE_CLOUD_MARKETPLACE_START_HINT =
  "cd /Users/weizuo/Documents/ai公司/dijie-role-marketplace && bun run dev";

const REQUIRED_ENV_BY_CHECK_NAME = new Map([
  ["DIJIE_CLOUD_BASE_URL", ["DIJIE_CLOUD_BASE_URL"]],
  ["OPENCLAW_LOCAL_URL", ["OPENCLAW_LOCAL_URL"]],
  ["DIJIE_INTERNAL_BRIDGE_BEARER", ["DIJIE_INTERNAL_BRIDGE_BEARER"]],
  ["DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM", ["DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM"]],
  [
    "DIJIE_VENDOR_ACCESS_TOKEN or DIJIE_CLOUD_ACCESS_TOKEN",
    ["DIJIE_VENDOR_ACCESS_TOKEN", "DIJIE_CLOUD_ACCESS_TOKEN"],
  ],
  [
    "DIJIE_ADMIN_ACCESS_TOKEN or DIJIE_CLOUD_ACCESS_TOKEN",
    ["DIJIE_ADMIN_ACCESS_TOKEN", "DIJIE_CLOUD_ACCESS_TOKEN"],
  ],
  [
    "DIJIE_BUYER_ACCESS_TOKEN or DIJIE_CLOUD_ACCESS_TOKEN",
    ["DIJIE_BUYER_ACCESS_TOKEN", "DIJIE_CLOUD_ACCESS_TOKEN"],
  ],
  ["DIJIE_CLOUD_BASE_URL reachable", ["DIJIE_CLOUD_BASE_URL"]],
  ["OPENCLAW_LOCAL_URL reachable", ["OPENCLAW_LOCAL_URL"]],
]);

function checkPresent(env, name) {
  return typeof env[name] === "string" && env[name].trim()
    ? { name, status: "passed" }
    : { name, status: "blocked", reason: "missing" };
}

function expandUserPath(value, env = process.env) {
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  if (trimmed === "~") return env.HOME || homedir();
  if (trimmed.startsWith("~/")) return join(env.HOME || homedir(), trimmed.slice(2));
  return trimmed;
}

function readJsonLike(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON5.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function getPath(root, path) {
  if (!root || typeof path !== "string" || !path.trim()) return undefined;
  const parts = path
    .replace(/^\//, "")
    .split(/[./]/)
    .map((part) => part.trim())
    .filter(Boolean);
  let cursor = root;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function resolveConfigPath(env = process.env) {
  const explicit = env.OPENCLAW_CONFIG_PATH?.trim();
  if (explicit) return expandUserPath(explicit, env);
  const stateDir = expandUserPath(env.OPENCLAW_STATE_DIR?.trim() || "~/.openclaw", env);
  return join(stateDir, "openclaw.json");
}

function secretProviderPath(config, providerName, env = process.env) {
  const provider = config?.secrets?.providers?.[providerName];
  const path = typeof provider?.path === "string" ? provider.path.trim() : "";
  return path ? expandUserPath(path, env) : "";
}

function resolveSecretInput(config, input, env = process.env) {
  if (typeof input === "string" && input.trim()) return input.trim();
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  if (input.source === "env" && typeof input.id === "string") {
    return env[input.id]?.trim() || "";
  }
  if (
    input.source !== "file" ||
    typeof input.provider !== "string" ||
    typeof input.id !== "string"
  ) {
    return "";
  }
  const providerPath = secretProviderPath(config, input.provider, env);
  const providerPayload = readJsonLike(providerPath);
  const value = getPath(providerPayload, input.id);
  return typeof value === "string" ? value.trim() : "";
}

function findCloudBridgeEntry(config) {
  const entries = config?.apiConnections?.entries;
  if (!entries || typeof entries !== "object") return null;
  return (
    Object.values(entries).find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        entry.enabled !== false &&
        (entry.provider === "dijie-cloud-bridge" || entry.provider === "cloud-marketplace"),
    ) ?? null
  );
}

function configValueSources(config, env = process.env) {
  const aicsConfig = config?.plugins?.entries?.aics?.config ?? {};
  const bridgeEntry = findCloudBridgeEntry(config);
  const sources = {};

  const cloudBaseUrl =
    typeof bridgeEntry?.baseUrl === "string" && bridgeEntry.baseUrl.trim()
      ? bridgeEntry.baseUrl.trim()
      : typeof bridgeEntry?.endpoint === "string" && bridgeEntry.endpoint.trim()
        ? bridgeEntry.endpoint.trim()
        : typeof aicsConfig.cloudBaseUrl === "string"
          ? aicsConfig.cloudBaseUrl.trim()
          : "";
  if (cloudBaseUrl) sources.DIJIE_CLOUD_BASE_URL = cloudBaseUrl;

  const configuredLocalUrl =
    typeof aicsConfig.openclawLocalUrl === "string" && aicsConfig.openclawLocalUrl.trim()
      ? aicsConfig.openclawLocalUrl.trim()
      : typeof aicsConfig.localBaseUrl === "string" && aicsConfig.localBaseUrl.trim()
        ? aicsConfig.localBaseUrl.trim()
        : typeof aicsConfig.localUrl === "string" && aicsConfig.localUrl.trim()
          ? aicsConfig.localUrl.trim()
          : "";
  const localPort = Number.parseInt(
    env.OPENCLAW_LOCAL_PORT?.trim() ||
      env.OPENCLAW_GATEWAY_PORT?.trim() ||
      String(DEFAULT_OPENCLAW_LOCAL_GATEWAY_PORT),
    10,
  );
  const inferredLocalUrl =
    Number.isSafeInteger(localPort) && localPort > 0 ? `http://127.0.0.1:${localPort}` : "";
  if (configuredLocalUrl || inferredLocalUrl) {
    sources.OPENCLAW_LOCAL_URL = configuredLocalUrl || inferredLocalUrl;
  }

  const cloudAccessToken =
    resolveSecretInput(config, bridgeEntry?.secret, env) ||
    resolveSecretInput(config, aicsConfig.cloudAccessToken, env);
  if (cloudAccessToken) sources.DIJIE_CLOUD_ACCESS_TOKEN = cloudAccessToken;

  const bridgeBearer = resolveSecretInput(config, aicsConfig.cloudApiVariablesSyncBearer, env);
  if (bridgeBearer) sources.DIJIE_INTERNAL_BRIDGE_BEARER = bridgeBearer;

  const publicKey =
    typeof aicsConfig.executionTokenPublicKeyPem === "string"
      ? aicsConfig.executionTokenPublicKeyPem.trim()
      : "";
  if (publicKey) sources.DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM = publicKey;

  return sources;
}

export function hydrateReadinessEnvFromConfig(env = process.env, options = {}) {
  if (options.disableConfigHydration) {
    return { env: { ...env }, hydrated: {}, configPath: null };
  }
  const configPath = options.configPath ?? resolveConfigPath(env);
  const config = options.config ?? readJsonLike(configPath);
  if (!config) return { env: { ...env }, hydrated: {}, configPath };
  const sources = configValueSources(config, env);
  const nextEnv = { ...env };
  const hydrated = {};
  for (const name of CONFIG_DERIVED_ENV) {
    if (nextEnv[name]?.trim()) continue;
    if (!sources[name]) continue;
    nextEnv[name] = sources[name];
    hydrated[name] = {
      source: "api_connections_config",
      configPath,
    };
  }
  return { env: nextEnv, hydrated, configPath };
}

function checkHttpUrl(env, name) {
  const value = typeof env[name] === "string" ? env[name].trim() : "";
  if (!value) return { name, status: "blocked", reason: "missing" };
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? { name, status: "passed" }
      : { name, status: "blocked", reason: "must_be_http_or_https_url" };
  } catch {
    return { name, status: "blocked", reason: "must_be_http_or_https_url" };
  }
}

function endpointUrlForProbe(env, probe) {
  const value = typeof env[probe.envName] === "string" ? env[probe.envName].trim() : "";
  if (!value) return "";
  const url = new URL(value);
  if (probe.defaultPath && (url.pathname === "" || url.pathname === "/")) {
    url.pathname = probe.defaultPath;
  }
  return url.toString();
}

function checkPublicKeyPem(env, name) {
  const value = typeof env[name] === "string" ? env[name].trim().replaceAll("\\n", "\n") : "";
  if (!value) return { name, status: "blocked", reason: "missing" };
  const publicKeyPattern =
    /-----BEGIN (?:RSA )?PUBLIC KEY-----[\s\S]+-----END (?:RSA )?PUBLIC KEY-----/;
  return publicKeyPattern.test(value)
    ? { name, status: "passed" }
    : { name, status: "blocked", reason: "must_be_public_key_pem" };
}

function checkEvidence(path) {
  if (!existsSync(path)) {
    return { path, status: "blocked", reason: "missing" };
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { path, status: "blocked", reason: "invalid_json" };
  }
  const schemaErrors = validatePersonaEvidenceSchema(evidence);
  if (schemaErrors.length) {
    return {
      path,
      status: "blocked",
      reason: "schema_invalid",
      schemaErrorCount: schemaErrors.length,
      schemaErrors,
    };
  }
  const result = evaluateProductionPlusEvidence(evidence, { evidencePath: path });
  const failedGateIds = result.gates
    .filter((gate) => gate.status !== "passed")
    .map((gate) => gate.id);
  return {
    path,
    status: result.verdict === "production_plus_passed" ? "passed" : "blocked",
    ...(result.verdict === "production_plus_passed" ? {} : { reason: "production_plus_failed" }),
    verdict: result.verdict,
    failedGateIds,
  };
}

function endpointProbeFromResult(probe, result = {}) {
  if (result.status === "passed") {
    return {
      name: probe.name,
      envName: probe.envName,
      status: "passed",
      ...(typeof result.statusCode === "number" ? { statusCode: result.statusCode } : {}),
    };
  }
  return {
    name: probe.name,
    envName: probe.envName,
    status: "blocked",
    reason: result.reason ?? "endpoint_unreachable",
    ...(typeof result.statusCode === "number" ? { statusCode: result.statusCode } : {}),
  };
}

async function checkEndpointReachable(env, probe, options = {}) {
  const urlCheck = checkHttpUrl(env, probe.envName);
  if (urlCheck.status !== "passed") {
    return { name: probe.name, envName: probe.envName, status: "blocked", reason: urlCheck.reason };
  }
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    return {
      name: probe.name,
      envName: probe.envName,
      status: "blocked",
      reason: "fetch_unavailable",
    };
  }
  const timeoutMs = options.timeoutMs ?? 5_000;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchFn(endpointUrlForProbe(env, probe), {
      method: "GET",
      redirect: "manual",
      ...(controller ? { signal: controller.signal } : {}),
    });
    const statusCode = Number(response?.status ?? 0);
    return statusCode > 0 && statusCode < 500
      ? { name: probe.name, envName: probe.envName, status: "passed", statusCode }
      : {
          name: probe.name,
          envName: probe.envName,
          status: "blocked",
          reason: "http_status_not_ready",
          statusCode,
        };
  } catch (error) {
    return {
      name: probe.name,
      envName: probe.envName,
      status: "blocked",
      reason: error?.name === "AbortError" ? "timeout" : "endpoint_unreachable",
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function summarizeReadiness(checks) {
  const blockedChecks = checks
    .filter((check) => check.status !== "passed")
    .map((check) => ({
      label: check.name ?? check.path,
      ...(check.reason ? { reason: check.reason } : {}),
      ...(check.statusCode ? { statusCode: check.statusCode } : {}),
    }));
  const endpointOnlyBlocked =
    blockedChecks.length > 0 &&
    blockedChecks.every((check) =>
      ["endpoint_unreachable", "timeout", "http_status_not_ready"].includes(
        String(check.reason ?? ""),
      ),
    );
  const blockedServiceEnv = endpointOnlyBlocked
    ? Array.from(
        new Set(
          blockedChecks.flatMap((check) => REQUIRED_ENV_BY_CHECK_NAME.get(check.label) ?? []),
        ),
      )
    : [];
  const nextRequiredEnvRaw = Array.from(
    new Set(blockedChecks.flatMap((check) => REQUIRED_ENV_BY_CHECK_NAME.get(check.label) ?? [])),
  );
  const nextRequiredEnv = endpointOnlyBlocked ? [] : nextRequiredEnvRaw;
  const operatorSteps = buildOperatorSteps(nextRequiredEnv, blockedChecks, blockedServiceEnv);
  return {
    blockedChecks,
    nextRequiredServices: endpointOnlyBlocked
      ? blockedChecks.map((check) => ({
          label: check.label,
          ...(check.reason ? { reason: check.reason } : {}),
          requiredConfig: REQUIRED_ENV_BY_CHECK_NAME.get(check.label) ?? [],
        }))
      : [],
    nextRequiredEnv,
    operatorSteps,
    operatorChecklist: buildOperatorChecklist(operatorSteps, [
      ...nextRequiredEnv,
      ...blockedServiceEnv,
    ]),
  };
}

function humanRequiredEnvLabel(name) {
  const labels = {
    DIJIE_CLOUD_BASE_URL: "云端商城 API 地址",
    OPENCLAW_LOCAL_URL: "本地 OpenClaw UI 地址",
    DIJIE_INTERNAL_BRIDGE_BEARER: "本地和云端通信令牌",
    DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM: "执行令牌公钥",
    DIJIE_CLOUD_ACCESS_TOKEN: "云端通用访问令牌",
    DIJIE_VENDOR_ACCESS_TOKEN: "开发者/卖家访问令牌",
    DIJIE_ADMIN_ACCESS_TOKEN: "审核/管理访问令牌",
    DIJIE_BUYER_ACCESS_TOKEN: "购买者访问令牌",
  };
  return labels[name] ?? name;
}

function buildOperatorSteps(nextRequiredEnv, blockedChecks, blockedServiceEnv = []) {
  if (!nextRequiredEnv?.length && !blockedChecks?.length) {
    return [
      {
        step: "运行最终验收",
        status: "ready",
        action:
          "readiness 已通过；继续运行 production-plus orchestrator，拿到 production_plus_passed。",
      },
    ];
  }
  const has = (name) => nextRequiredEnv.includes(name) || blockedServiceEnv.includes(name);
  const endpointBlocked = blockedChecks.some((check) =>
    String(check.label ?? "").includes("reachable"),
  );
  const endpointOnlyBlocked =
    endpointBlocked &&
    blockedChecks.every((check) =>
      ["endpoint_unreachable", "timeout", "http_status_not_ready"].includes(
        String(check.reason ?? ""),
      ),
    );
  const steps = [];
  if (endpointOnlyBlocked) {
    const blockedServices = [
      has("DIJIE_CLOUD_BASE_URL") ? "云端商城/桥服务" : "",
      has("OPENCLAW_LOCAL_URL") ? "本地 OpenClaw 网关" : "",
    ]
      .filter(Boolean)
      .join("和");
    steps.push({
      step: "1. 启动或修复服务",
      status: "blocked",
      action: `配置已经齐了；现在是健康检查访问不到${blockedServices || "服务"}。启动或修复对应服务，然后重新跑 readiness endpoint probe。`,
      requiredInputs: ["DIJIE_CLOUD_BASE_URL", "OPENCLAW_LOCAL_URL"].filter(has),
    });
  } else if (has("DIJIE_CLOUD_BASE_URL") || has("OPENCLAW_LOCAL_URL") || endpointBlocked) {
    steps.push({
      step: "1. 连接两个地址",
      status: "blocked",
      action:
        "填云端商城 API 地址和本地 OpenClaw UI 地址，然后重新跑 readiness。地址必须是 http:// 或 https://，并且 endpoint probe 要能访问。",
      requiredInputs: ["DIJIE_CLOUD_BASE_URL", "OPENCLAW_LOCAL_URL"].filter(has),
    });
  }
  if (has("DIJIE_INTERNAL_BRIDGE_BEARER") || has("DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM")) {
    steps.push({
      step: "2. 准备执行通行证",
      status: "blocked",
      action: "填本地到云端的 bridge bearer 和执行令牌公钥。readiness 只记录字段名，不记录密钥值。",
      requiredInputs: [
        "DIJIE_INTERNAL_BRIDGE_BEARER",
        "DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM",
      ].filter(has),
    });
  }
  if (
    has("DIJIE_VENDOR_ACCESS_TOKEN") ||
    has("DIJIE_ADMIN_ACCESS_TOKEN") ||
    has("DIJIE_BUYER_ACCESS_TOKEN") ||
    has("DIJIE_CLOUD_ACCESS_TOKEN")
  ) {
    steps.push({
      step: "3. 准备三类真人身份",
      status: "blocked",
      action: "准备开发者、审核管理者、购买者访问令牌；也可以先用云端通用访问令牌替代三类身份。",
      requiredInputs: [
        "DIJIE_VENDOR_ACCESS_TOKEN",
        "DIJIE_ADMIN_ACCESS_TOKEN",
        "DIJIE_BUYER_ACCESS_TOKEN",
        "DIJIE_CLOUD_ACCESS_TOKEN",
      ].filter(has),
    });
  }
  steps.push({
    step: `${steps.length + 1}. 跑最终真人验收`,
    status: "pending",
    action:
      "readiness 全部通过后，运行 final manifest 校验和 production-plus orchestrator；只有 verdict 为 production_plus_passed 才算生产级完成。",
  });
  return steps;
}

function buildOperatorChecklist(operatorSteps, nextRequiredEnv) {
  const commandHint =
    "node scripts/persona/aics-production-plus-readiness.mjs --probe-endpoints --output-dir /private/tmp/aics-production-plus-readiness";
  return operatorSteps.map((step) => {
    const requiredInputs = Array.isArray(step.requiredInputs) ? step.requiredInputs : [];
    return {
      label: step.step,
      status: step.status,
      action: step.action,
      ...(requiredInputs.length
        ? {
            requiredInputs,
            requiredInputLabels: requiredInputs.map(humanRequiredEnvLabel),
          }
        : {}),
      commandHint,
      ...(requiredInputs.includes("DIJIE_CLOUD_BASE_URL")
        ? {
            serviceHint:
              "云端商城服务在本机通常来自 dijie-role-marketplace 仓库，后端 API 默认 http://127.0.0.1:9000。",
            startHint: DIJIE_CLOUD_MARKETPLACE_START_HINT,
          }
        : {}),
      secretHandling:
        "只填写本机环境变量；readiness 只记录字段名、状态、原因和端点状态码，不记录密钥值。",
    };
  });
}

export function parseReadinessArgs(argv) {
  const args = { outputDir: "/private/tmp/aics-production-plus-readiness" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output-dir") args.outputDir = argv[++i];
    else if (arg === "--evidence") args.evidence = argv[++i];
    else if (arg === "--probe-endpoints") args.probeEndpoints = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function evaluateReadiness(env = process.env, options = {}) {
  const hydratedEnv =
    options.hydratedEnv ??
    hydrateReadinessEnvFromConfig(env, {
      config: options.config,
      configPath: options.configPath,
      disableConfigHydration: options.disableConfigHydration,
    });
  const effectiveEnv = hydratedEnv.env;
  const envChecks = [
    checkHttpUrl(effectiveEnv, "DIJIE_CLOUD_BASE_URL"),
    checkHttpUrl(effectiveEnv, "OPENCLAW_LOCAL_URL"),
    checkPresent(effectiveEnv, "DIJIE_INTERNAL_BRIDGE_BEARER"),
    checkPublicKeyPem(effectiveEnv, "DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM"),
  ];
  const tokenChecks = TOKEN_GROUPS.map((group) => ({
    name: group.join(" or "),
    ...(group.some((name) => typeof effectiveEnv[name] === "string" && effectiveEnv[name].trim())
      ? { status: "passed" }
      : { status: "blocked", reason: "missing" }),
  }));
  const fileChecks = [
    "scripts/aics-production-plus-persona.mjs",
    "scripts/persona/aics-persona-runner.mjs",
    "scripts/persona/aics-build-playwright-config.mjs",
    "scripts/persona/aics-playwright-persona.mjs",
    "scripts/persona/aics-production-plus-orchestrator.mjs",
    "scripts/persona/aics-final-manifest.mjs",
    "scripts/persona/evidence-schema.json",
  ].map((path) => ({ path, status: existsSync(path) ? "passed" : "blocked" }));
  const checks = [...envChecks, ...tokenChecks, ...fileChecks];
  if (options.evidence) checks.push(checkEvidence(options.evidence));
  const summary = summarizeReadiness(checks);
  return {
    status: checks.every((check) => check.status === "passed") ? "ready" : "blocked",
    generatedAt: new Date().toISOString(),
    configHydration: {
      configPath: hydratedEnv.configPath,
      hydratedEnv: Object.keys(hydratedEnv.hydrated ?? {}),
    },
    checks,
    ...summary,
  };
}

export function renderReadinessMarkdown(readiness) {
  const endpointOnlyBlocked =
    readiness.blockedChecks?.length &&
    readiness.blockedChecks.every((check) =>
      ["endpoint_unreachable", "timeout", "http_status_not_ready"].includes(
        String(check.reason ?? ""),
      ),
    );
  const lines = [
    "# AICS production-plus readiness",
    "",
    `- status: \`${readiness.status}\``,
    "",
    ...readiness.checks.map((check) => {
      const label = check.name ?? check.path;
      const reason = check.reason ? ` (${check.reason})` : "";
      return `- ${check.status === "passed" ? "PASS" : "BLOCKED"} ${label}${reason}`;
    }),
    "",
  ];
  if (readiness.status !== "ready") {
    lines.push(
      "## 真人准备清单",
      "",
      ...(readiness.operatorSteps?.length
        ? readiness.operatorSteps.flatMap((item) => [
            `- ${item.step}：${item.action}`,
            ...(item.requiredInputs?.length ? [`  - 需要：${item.requiredInputs.join("、")}`] : []),
          ])
        : []),
      "",
      endpointOnlyBlocked ? "## 当前不可达服务" : "## 缺少的具体字段",
      "",
      ...(endpointOnlyBlocked
        ? readiness.blockedChecks.map(
            (check) => `- ${check.label}${check.reason ? `：${check.reason}` : ""}`,
          )
        : readiness.nextRequiredEnv?.length
          ? readiness.nextRequiredEnv.map(
              (name) => `- 准备 ${humanRequiredEnvLabel(name)}：\`${name}\``,
            )
          : ["- 环境变量没有明显缺口；请查看下方 blocked 检查项。"]),
      "",
      "## 可执行检查清单",
      "",
      ...(readiness.operatorChecklist?.length
        ? readiness.operatorChecklist.flatMap((item) => [
            `- ${item.label}：${item.action}`,
            ...(item.requiredInputLabels?.length
              ? [`  - 需要：${item.requiredInputLabels.join("、")}`]
              : []),
            ...(item.serviceHint ? [`  - 服务位置：${item.serviceHint}`] : []),
            ...(item.startHint ? [`  - 启动命令：\`${item.startHint}\``] : []),
            `  - 复查命令：\`${item.commandHint}\``,
          ])
        : ["- 无额外检查清单。"]),
      "",
      endpointOnlyBlocked ? "## Required Service" : "## Required Environment",
      "",
      ...(endpointOnlyBlocked
        ? readiness.blockedChecks.map((check) => `- ${check.label}`)
        : readiness.nextRequiredEnv?.length
          ? readiness.nextRequiredEnv.map((name) => `- ${name}`)
          : ["- No environment variable gaps detected; inspect blocked checks above."]),
      ...(endpointOnlyBlocked
        ? [
            "",
            "## Service Startup Hint",
            "",
            `- Cloud marketplace repo: \`${DIJIE_CLOUD_MARKETPLACE_REPO_HINT}\``,
            `- Local dev command: \`${DIJIE_CLOUD_MARKETPLACE_START_HINT}\``,
          ]
        : []),
      "",
      "## Required Environment",
      "",
      ...(endpointOnlyBlocked
        ? [
            "- No missing environment variable detected; blocked checks are service reachability checks.",
          ]
        : readiness.nextRequiredEnv?.length
          ? readiness.nextRequiredEnv.map((name) => `- ${name}`)
          : ["- No environment variable gaps detected; inspect blocked checks above."]),
      "",
      "## Next Commands",
      "",
      "```bash",
      "node scripts/persona/aics-production-plus-readiness.mjs --probe-endpoints --output-dir /private/tmp/aics-production-plus-readiness",
      "node scripts/persona/aics-final-manifest.mjs --validate --seed docs/aics-persona-runs/<runId>/api-seed.json --manifest docs/aics-persona-runs/<runId>/final-manifest.json",
      'node scripts/persona/aics-production-plus-orchestrator.mjs --seed-file docs/aics-persona-runs/<runId>/api-seed.json --production-plus-final --probe-endpoints --final-manifest docs/aics-persona-runs/<runId>/final-manifest.json --base-url "$DIJIE_CLOUD_BASE_URL" --openclaw-url "$OPENCLAW_LOCAL_URL" --run-id <runId> --output-dir docs/aics-persona-runs/<runId>',
      "```",
      "",
      "## Secret Handling",
      "",
      "- Readiness reports only field names, statuses, reasons, and endpoint status codes.",
      "- Do not paste token values, private URLs, prompt text, package bodies, or user data into evidence files.",
      "- Required secret fields: DIJIE_INTERNAL_BRIDGE_BEARER, DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM, and vendor/admin/buyer access tokens or DIJIE_CLOUD_ACCESS_TOKEN.",
      "",
    );
  }
  return lines.join("\n");
}

export function renderReadinessEnvTemplate(readiness) {
  const requiredEnv = readiness.nextRequiredEnv?.length
    ? readiness.nextRequiredEnv
    : [
        "DIJIE_CLOUD_BASE_URL",
        "OPENCLAW_LOCAL_URL",
        "DIJIE_INTERNAL_BRIDGE_BEARER",
        "DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM",
        "DIJIE_CLOUD_ACCESS_TOKEN",
        "DIJIE_VENDOR_ACCESS_TOKEN",
        "DIJIE_ADMIN_ACCESS_TOKEN",
        "DIJIE_BUYER_ACCESS_TOKEN",
      ];
  const orderedEnv = [
    "DIJIE_CLOUD_BASE_URL",
    "OPENCLAW_LOCAL_URL",
    "DIJIE_INTERNAL_BRIDGE_BEARER",
    "DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM",
    "DIJIE_CLOUD_ACCESS_TOKEN",
    "DIJIE_VENDOR_ACCESS_TOKEN",
    "DIJIE_ADMIN_ACCESS_TOKEN",
    "DIJIE_BUYER_ACCESS_TOKEN",
  ].filter((name) => requiredEnv.includes(name));
  const placeholderByName = {
    DIJIE_CLOUD_BASE_URL: "<https://cloud.example>",
    OPENCLAW_LOCAL_URL: "<http://127.0.0.1:5173>",
    DIJIE_INTERNAL_BRIDGE_BEARER: "<internal-bridge-bearer>",
    DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM: "<public-key-pem>",
    DIJIE_CLOUD_ACCESS_TOKEN: "<optional-shared-cloud-access-token>",
    DIJIE_VENDOR_ACCESS_TOKEN: "<vendor-actor-access-token>",
    DIJIE_ADMIN_ACCESS_TOKEN: "<admin-actor-access-token>",
    DIJIE_BUYER_ACCESS_TOKEN: "<buyer-actor-access-token>",
  };
  const lines = [
    "# AICS production-plus environment template.",
    "# Fill real values locally. Do not commit filled secrets.",
    "# Prefer actor-scoped tokens. DIJIE_CLOUD_ACCESS_TOKEN is an optional shared fallback.",
    "",
    ...orderedEnv.map((name) => `export ${name}="${placeholderByName[name] ?? "<value>"}"`),
    "",
  ];
  return lines.join("\n");
}

export async function evaluateReadinessWithEndpointProbes(env = process.env, options = {}) {
  const hydratedEnv =
    options.hydratedEnv ??
    hydrateReadinessEnvFromConfig(env, {
      config: options.config,
      configPath: options.configPath,
      disableConfigHydration: options.disableConfigHydration,
    });
  const effectiveEnv = hydratedEnv.env;
  const readiness = evaluateReadiness(env, { ...options, hydratedEnv });
  const endpointChecks = options.endpointProbeResults
    ? ENDPOINT_PROBES.map((probe) =>
        endpointProbeFromResult(probe, options.endpointProbeResults[probe.envName]),
      )
    : await Promise.all(
        ENDPOINT_PROBES.map((probe) =>
          checkEndpointReachable(effectiveEnv, probe, {
            fetchFn: options.fetchFn,
            timeoutMs: options.timeoutMs,
          }),
        ),
      );
  const checks = [...readiness.checks, ...endpointChecks];
  const summary = summarizeReadiness(checks);
  return {
    ...readiness,
    status: checks.every((check) => check.status === "passed") ? "ready" : "blocked",
    checks,
    ...summary,
  };
}

export async function runReadiness(args, options = {}) {
  const out = resolve(args.outputDir);
  mkdirSync(out, { recursive: true });
  const readiness = args.probeEndpoints
    ? await evaluateReadinessWithEndpointProbes(process.env, {
        evidence: args.evidence,
        fetchFn: options.fetchFn,
        timeoutMs: options.timeoutMs,
      })
    : evaluateReadiness(process.env, { evidence: args.evidence });
  const jsonPath = resolve(out, "readiness.json");
  const markdownPath = resolve(out, "readiness.md");
  const envTemplatePath = resolve(out, "env-template.sh");
  writeFileSync(jsonPath, `${JSON.stringify(readiness, null, 2)}\n`);
  writeFileSync(markdownPath, renderReadinessMarkdown(readiness));
  writeFileSync(envTemplatePath, renderReadinessEnvTemplate(readiness));
  return { readiness, jsonPath, markdownPath, envTemplatePath };
}

if (isCli(import.meta.url)) {
  try {
    const { readiness, jsonPath, markdownPath, envTemplatePath } = await runReadiness(
      parseReadinessArgs(process.argv.slice(2)),
    );
    console.log(`status: ${readiness.status}`);
    console.log(`readiness: ${jsonPath}`);
    console.log(`summary: ${markdownPath}`);
    console.log(`env template: ${envTemplatePath}`);
    process.exitCode = readiness.status === "ready" ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
