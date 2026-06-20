import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const STANDARD_PERSONAS = [
  "developer",
  "admin_reviewer",
  "buyer_storefront",
  "user_center",
  "openclaw_local_operator",
  "ledger_receivables_reader",
];

export const REQUIRED_IDS = [
  "rolePackageId",
  "rolePackageVersion",
  "roleListingId",
  "reviewId",
  "entitlementId",
  "executionId",
  "auditRecordId",
  "ledgerEntryId",
];

const MODEL_TOKEN_BILLING_FINAL_PROBES = [
  "apiModelPricing",
  "apiMeteringReadback",
  "apiUsageAttribution",
];

const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/i,
  /\b(?:token|secret|api[_-]?key)\b\s*[:=]\s*["']?[^"'\s]{8,}/i,
  /\/Users\/[^\s"'`]+|\/home\/[^\s"'`]+/i,
];

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function collectStrings(value, out = []) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

export function scanEvidenceForSecrets(evidence) {
  const leaks = [];
  for (const text of collectStrings(evidence)) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        leaks.push({ pattern: String(pattern), sample: text.slice(0, 120) });
        break;
      }
    }
  }
  return leaks;
}

function itemStatus(item) {
  return typeof item?.status === "string" ? item.status : undefined;
}

function itemName(item) {
  return typeof item?.name === "string" ? item.name : "";
}

function itemPersona(item) {
  if (typeof item?.persona === "string") return item.persona;
  const name = itemName(item);
  const match = /^([a-z0-9_]+):/i.exec(name);
  return match?.[1];
}

function isPassed(item) {
  return itemStatus(item) === "passed" || item?.passed === true;
}

function hasPassedPersonaAssertion(items, persona) {
  return asArray(items).some((item) => {
    if (!isPassed(item)) return false;
    return itemPersona(item) === persona || itemName(item).startsWith(`${persona}:`);
  });
}

function hasPassedNegativeApiCheck(evidence, persona) {
  const checks = asArray(evidence?.proof?.apiChecks).concat(asArray(evidence?.apiChecks));
  return checks.some((check) => {
    if (check?.kind !== "negative") return false;
    if (!isPassed(check)) return false;
    return itemPersona(check) === persona || itemName(check).startsWith(`${persona}:`);
  });
}

function proofNumber(evidence, key) {
  const value = evidence?.proof?.[key] ?? evidence?.[key];
  return typeof value === "number" ? value : 0;
}

function finitePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function hasCompleteModelTokenBillingReadback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const byConsumer = value.byConsumer;
  const roleExecution =
    byConsumer && typeof byConsumer === "object" && !Array.isArray(byConsumer)
      ? byConsumer.role_execution
      : null;
  const positiveConsumerNames =
    byConsumer && typeof byConsumer === "object" && !Array.isArray(byConsumer)
      ? Object.entries(byConsumer)
          .filter(([, item]) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return false;
            return (
              finitePositiveNumber(item.totalTokens) > 0 && finitePositiveNumber(item.costCny) > 0
            );
          })
          .map(([name]) => name)
      : [];
  const hasAdditionalConsumer = positiveConsumerNames.some((name) => name !== "role_execution");
  const pricing = value.pricing;
  const hasPricing =
    pricing &&
    typeof pricing === "object" &&
    !Array.isArray(pricing) &&
    (finitePositiveNumber(pricing.inputCnyPerMillion) > 0 ||
      finitePositiveNumber(pricing.outputCnyPerMillion) > 0);
  return (
    value.status === "passed" &&
    value.source === "api_readback" &&
    typeof value.apiConnectionId === "string" &&
    value.apiConnectionId.trim().length > 0 &&
    typeof value.provider === "string" &&
    value.provider.trim().length > 0 &&
    typeof value.model === "string" &&
    value.model.trim().length > 0 &&
    hasPricing &&
    finitePositiveNumber(value.inputTokens) > 0 &&
    finitePositiveNumber(value.outputTokens) > 0 &&
    finitePositiveNumber(value.totalTokens) > 0 &&
    finitePositiveNumber(value.costCny) > 0 &&
    roleExecution &&
    typeof roleExecution === "object" &&
    !Array.isArray(roleExecution) &&
    finitePositiveNumber(roleExecution.totalTokens) > 0 &&
    finitePositiveNumber(roleExecution.costCny) > 0 &&
    hasAdditionalConsumer
  );
}

function hasCompleteOpenclawMainChatEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const path = typeof value.path === "string" ? value.path : "";
  const source = typeof value.source === "string" ? value.source : "";
  if (path !== "main_chat") return false;
  if (!["playwright", "api_readback"].includes(source)) return false;
  if (value.status === "passed") {
    const assertion = value.assertion;
    return (
      assertion &&
      typeof assertion === "object" &&
      !Array.isArray(assertion) &&
      assertion.status === "passed" &&
      (typeof assertion.selector === "string" || typeof assertion.expectedText === "string")
    );
  }
  if (value.status === "provider-config-blocked") {
    const blockedReason = value.blockedReason;
    return (
      blockedReason &&
      typeof blockedReason === "object" &&
      !Array.isArray(blockedReason) &&
      typeof blockedReason.code === "string" &&
      blockedReason.code.trim().length > 0 &&
      typeof blockedReason.stage === "string" &&
      blockedReason.stage === "main_chat"
    );
  }
  return false;
}

function inspectPngArtifact(path) {
  const name = basename(path);
  if (!existsSync(path) || !statSync(path).isFile()) {
    return { name, valid: false, reason: "missing" };
  }
  const bytes = readFileSync(path);
  const hasSignature =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  if (!hasSignature) return { name, valid: false, reason: "invalid_signature" };
  if (bytes.length < 33) return { name, valid: false, reason: "missing_ihdr" };
  const chunkType = bytes.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") return { name, valid: false, reason: "missing_ihdr" };
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width <= 0 || height <= 0)
    return { name, valid: false, reason: "invalid_dimensions", width, height };
  return { name, valid: true, width, height };
}

export function collectScreenshotProof(evidencePath, evidence) {
  const evidenceDir = evidencePath ? dirname(resolve(evidencePath)) : process.cwd();
  const screenshotDir = join(evidenceDir, "screenshots");
  const declared = Math.max(
    proofNumber(evidence, "screenshotCount"),
    proofNumber(evidence, "screenshotArtifactCount"),
  );
  if (!existsSync(screenshotDir)) {
    return {
      declaredScreenshotCount: declared,
      screenshotArtifactCount: 0,
      validScreenshotArtifactCount: 0,
      screenshotArtifactCountsMatch: declared === 0,
      screenshotArtifactDetails: [],
    };
  }
  const pngs = readdirSync(screenshotDir)
    .filter((name) => name.endsWith(".png"))
    .map((name) => join(screenshotDir, name));
  const screenshotArtifactDetails = pngs.map(inspectPngArtifact);
  const validScreenshotArtifactCount = screenshotArtifactDetails.filter(
    (item) => item.valid,
  ).length;
  return {
    declaredScreenshotCount: declared,
    screenshotArtifactCount: pngs.length,
    validScreenshotArtifactCount,
    screenshotArtifactCountsMatch:
      declared === pngs.length && declared === validScreenshotArtifactCount,
    screenshotArtifactDetails,
  };
}

function safeArtifactPath(evidenceDir, artifactPath) {
  if (typeof artifactPath !== "string" || !artifactPath.trim()) return null;
  const resolved = resolve(evidenceDir, artifactPath);
  const rel = relative(evidenceDir, resolved);
  if (rel.startsWith("..") || rel === "" || rel.startsWith("/") || /^[A-Za-z]:/.test(rel))
    return null;
  return resolved;
}

function scanArtifactTextForSecrets(text) {
  const safeText = String(text)
    .replace(/\bBearer\s+\[redacted\]/gi, "Bearer x")
    .replace(/\bsk-\[redacted\]/gi, "sk-x")
    .replace(/\b(token|secret|api[_-]?key)\b\s*[:=]\s*["']?\[redacted\]/gi, "$1=x");
  return scanEvidenceForSecrets(safeText);
}

function inspectNdjsonArtifact(evidenceDir, artifactPath) {
  const resolved = safeArtifactPath(evidenceDir, artifactPath);
  if (!resolved) {
    return {
      declaredPath: artifactPath ?? null,
      exists: false,
      validNdjson: false,
      rowCount: 0,
      secretLeakCount: 0,
      issue: "artifact path must be a non-empty relative path inside evidence directory",
    };
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    return {
      declaredPath: artifactPath,
      exists: false,
      validNdjson: false,
      rowCount: 0,
      secretLeakCount: 0,
      issue: "artifact file is missing",
    };
  }
  const raw = readFileSync(resolved, "utf-8");
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
  const parsedRows = [];
  let validNdjson = true;
  for (const line of lines) {
    try {
      parsedRows.push(JSON.parse(line));
    } catch {
      validNdjson = false;
    }
  }
  const secretLeaks = scanArtifactTextForSecrets(raw);
  return {
    declaredPath: artifactPath,
    exists: true,
    validNdjson,
    rowCount: parsedRows.length,
    secretLeakCount: secretLeaks.length,
    ...(secretLeaks.length ? { secretLeaks } : {}),
  };
}

function readNdjsonArtifactRows(evidenceDir, artifactPath) {
  const resolved = safeArtifactPath(evidenceDir, artifactPath);
  if (!resolved || !existsSync(resolved) || !statSync(resolved).isFile()) return [];
  const raw = readFileSync(resolved, "utf-8");
  return raw
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function collectConsoleNetworkArtifactProof(evidencePath, evidence) {
  const evidenceDir = evidencePath ? dirname(resolve(evidencePath)) : process.cwd();
  const artifactRefs = evidence?.proof?.artifacts;
  const consoleRef = artifactRefs?.console;
  const networkRef = artifactRefs?.networkSummary;
  const consoleArtifact = inspectNdjsonArtifact(evidenceDir, consoleRef);
  const networkSummaryArtifact = inspectNdjsonArtifact(evidenceDir, networkRef);
  const declaredConsoleEventCount = proofNumber(evidence, "consoleEventCount");
  const declaredNetworkEventCount = proofNumber(evidence, "networkEventCount");
  const artifactRefsDeclared =
    typeof consoleRef === "string" &&
    consoleRef.trim() &&
    typeof networkRef === "string" &&
    networkRef.trim();
  const countsMatch =
    consoleArtifact.rowCount === declaredConsoleEventCount &&
    networkSummaryArtifact.rowCount === declaredNetworkEventCount;
  return {
    consoleArtifact,
    networkSummaryArtifact,
    consoleNetworkArtifactsValid:
      Boolean(artifactRefsDeclared) &&
      consoleArtifact.exists &&
      networkSummaryArtifact.exists &&
      consoleArtifact.validNdjson &&
      networkSummaryArtifact.validNdjson &&
      countsMatch &&
      consoleArtifact.secretLeakCount === 0 &&
      networkSummaryArtifact.secretLeakCount === 0,
    consoleNetworkArtifactCountsMatch: countsMatch,
    consoleEventCount: declaredConsoleEventCount,
    networkEventCount: declaredNetworkEventCount,
  };
}

export function collectActionArtifactProof(evidencePath, evidence) {
  const evidenceDir = evidencePath ? dirname(resolve(evidencePath)) : process.cwd();
  const artifactRefs = evidence?.proof?.artifacts;
  const actionRef = artifactRefs?.actions;
  const actionArtifact = inspectNdjsonArtifact(evidenceDir, actionRef);
  const actionArtifactRows = readNdjsonArtifactRows(evidenceDir, actionRef);
  const declaredActionCount = proofNumber(evidence, "actionCount");
  const declaredFailedActionCount = proofNumber(evidence, "failedActionCount");
  const actionTrace = asArray(evidence?.proof?.actionTrace);
  const passedActionPersonas = new Set(
    actionTrace
      .filter((action) => isPassed(action))
      .map((action) => itemPersona(action))
      .filter(Boolean),
  );
  const missingActionTracePersonas = STANDARD_PERSONAS.filter(
    (persona) => !passedActionPersonas.has(persona),
  );
  const artifactPassedActionPersonas = new Set(
    actionArtifactRows
      .filter((action) => isPassed(action))
      .map((action) => itemPersona(action))
      .filter(Boolean),
  );
  const missingActionArtifactPersonas = STANDARD_PERSONAS.filter(
    (persona) => !artifactPassedActionPersonas.has(persona),
  );
  const artifactFailedActionCount = actionArtifactRows.filter((action) => !isPassed(action)).length;
  const actionArtifactCountsMatch = actionArtifact.rowCount === declaredActionCount;
  return {
    actionArtifact,
    actionArtifactCountsMatch,
    actionCount: declaredActionCount,
    failedActionCount: declaredFailedActionCount,
    missingActionTracePersonas,
    missingActionArtifactPersonas,
    artifactFailedActionCount,
    actionTraceValid:
      typeof actionRef === "string" &&
      actionRef.trim() &&
      actionArtifact.exists &&
      actionArtifact.validNdjson &&
      actionArtifactCountsMatch &&
      actionArtifact.secretLeakCount === 0 &&
      declaredActionCount >= STANDARD_PERSONAS.length &&
      declaredFailedActionCount === 0 &&
      artifactFailedActionCount === 0 &&
      missingActionTracePersonas.length === 0 &&
      missingActionArtifactPersonas.length === 0,
  };
}

function gate(id, passed, summary, remediation, details = {}) {
  return {
    id,
    status: passed ? "passed" : "failed",
    summary,
    remediation: passed ? null : remediation,
    ...details,
  };
}

const REMEDIATION_GROUPS = [
  {
    id: "runtime_environment",
    title: "真实运行环境",
    gateIds: ["real_browser_application", "screenshots", "fresh_final_probes"],
    nextAction:
      "配置真实 Dijie cloud 与 OpenClaw local URL、token、公钥，运行 production-plus orchestrator。",
  },
  {
    id: "persona_coverage",
    title: "六类拟人化角色覆盖",
    gateIds: [
      "standard_personas",
      "persona_positive_assertions",
      "persona_negative_assertions",
      "negative_api_cross_checks",
      "persona_action_trace",
    ],
    nextAction:
      "补齐 developer/admin/buyer/user/local operator/ledger 六类 persona 的真实页面动作、正向断言、负向断言和 API cross-check。",
  },
  {
    id: "readback_traceability",
    title: "业务链路读回与追踪",
    gateIds: ["required_ids_readback", "model_token_billing_readback"],
    nextAction:
      "从真实 API/UI readback 捕获 package/listing/review/entitlement/execution/audit/ledger id，并证明模型 Token 费用按 role_execution 和至少一个其他入口归属。",
  },
  {
    id: "artifact_integrity",
    title: "证据 artifact 完整性",
    gateIds: ["console_network_clean", "security_no_leaks"],
    nextAction:
      "确保 screenshots、actions.ndjson、console.ndjson、network-summary.ndjson 可解析、计数匹配、无 raw token/API key/本地路径/私有正文。",
  },
  {
    id: "openclaw_local_surfaces",
    title: "OpenClaw 本地端关键页面",
    gateIds: [
      "openclaw_main_chat_path",
      "api_management_model_pricing_page",
      "billing_page_model_metering",
    ],
    nextAction:
      "用 Playwright 打开本地 /chat、/api-management 和 /usage，命中稳定 data-testid 并证明主对话、API 管理模型定价、模型 Token 费用读回页面都可见。",
  },
];

function buildImplementationPlan(result, failedGates) {
  const failedById = new Map(failedGates.map((gate) => [gate.id, gate]));
  const groups = REMEDIATION_GROUPS.map((group) => {
    const gates = group.gateIds
      .map((id) => failedById.get(id))
      .filter(Boolean)
      .map((gate) => ({
        id: gate.id,
        summary: gate.summary,
        remediation: gate.remediation,
      }));
    return {
      id: group.id,
      title: group.title,
      status: gates.length ? "blocked" : "covered",
      nextAction: group.nextAction,
      gates,
    };
  });
  const ungrouped = failedGates
    .filter((gate) => !REMEDIATION_GROUPS.some((group) => group.gateIds.includes(gate.id)))
    .map((gate) => ({
      id: gate.id,
      summary: gate.summary,
      remediation: gate.remediation,
    }));
  const nextCommands = [
    "node scripts/persona/aics-production-plus-readiness.mjs --probe-endpoints --output-dir /private/tmp/aics-production-plus-readiness",
    "node scripts/persona/aics-final-manifest.mjs --validate --seed docs/aics-persona-runs/<runId>/api-seed.json --manifest docs/aics-persona-runs/<runId>/final-manifest.json",
    "node scripts/persona/aics-production-plus-orchestrator.mjs --seed-file docs/aics-persona-runs/<runId>/api-seed.json --production-plus-final --probe-endpoints --final-manifest docs/aics-persona-runs/<runId>/final-manifest.json --output-dir docs/aics-persona-runs/<runId> --run-id <runId>",
  ];
  return {
    status: result.verdict === "production_plus_passed" ? "complete" : "needs_work",
    sourceVerdict: result.verdict,
    groups,
    ungrouped,
    nextCommands,
  };
}

function hasPassedLocalPageProbe(evidence, path) {
  return asArray(evidence.localPageProbes).some(
    (probe) =>
      probe?.path === path &&
      probe.status === "passed" &&
      probe.source === "playwright" &&
      probe.assertion?.status === "passed",
  );
}

export function validatePersonaEvidenceSchema(evidence = {}) {
  const errors = [];
  if (evidence.schemaVersion !== 2) errors.push("schemaVersion must be 2");
  if (!["chrome", "playwright", "dry-run", "unknown"].includes(evidence.source)) {
    errors.push("source must be one of chrome/playwright/dry-run/unknown");
  }
  if (typeof evidence.realBrowser !== "boolean") errors.push("realBrowser must be boolean");
  if (typeof evidence.realApplication !== "boolean") errors.push("realApplication must be boolean");
  if (!Array.isArray(evidence.personas)) errors.push("personas must be an array");
  if (!Array.isArray(evidence.positive)) errors.push("positive must be an array");
  if (!Array.isArray(evidence.negative)) errors.push("negative must be an array");
  if (!evidence.proof || typeof evidence.proof !== "object" || Array.isArray(evidence.proof)) {
    errors.push("proof must be an object");
  }
  if (!evidence.ids || typeof evidence.ids !== "object" || Array.isArray(evidence.ids)) {
    errors.push("ids must be an object");
  }
  if (
    !evidence.finalProbes ||
    typeof evidence.finalProbes !== "object" ||
    Array.isArray(evidence.finalProbes)
  ) {
    errors.push("finalProbes must be an object");
  }
  if (!Array.isArray(evidence.localPageProbes)) {
    errors.push("localPageProbes must be an array");
  } else {
    for (const [index, probe] of evidence.localPageProbes.entries()) {
      if (typeof probe?.name !== "string" || !probe.name.trim()) {
        errors.push(`localPageProbes[${index}].name must be a non-empty string`);
      }
      if (typeof probe?.path !== "string" || !probe.path.trim()) {
        errors.push(`localPageProbes[${index}].path must be a non-empty string`);
      }
      if (!["passed", "failed", "blocked"].includes(probe?.status)) {
        errors.push(`localPageProbes[${index}].status must be passed/failed/blocked`);
      }
      if (!["playwright", "api_readback", "missing"].includes(probe?.source)) {
        errors.push(`localPageProbes[${index}].source must be playwright/api_readback/missing`);
      }
      if (probe?.status === "passed" && probe?.assertion?.status !== "passed") {
        errors.push(`localPageProbes[${index}].assertion.status must be passed when probe passed`);
      }
      const expectedTexts = probe?.assertion?.expectedTexts;
      if (
        expectedTexts !== undefined &&
        (!Array.isArray(expectedTexts) ||
          expectedTexts.some((item) => typeof item !== "string" || !item.trim()))
      ) {
        errors.push(`localPageProbes[${index}].assertion.expectedTexts must be a string array`);
      }
    }
  }
  if (!Object.prototype.hasOwnProperty.call(evidence, "modelTokenBilling")) {
    errors.push("modelTokenBilling must be present as object or null");
  } else if (
    evidence.modelTokenBilling !== null &&
    (typeof evidence.modelTokenBilling !== "object" || Array.isArray(evidence.modelTokenBilling))
  ) {
    errors.push("modelTokenBilling must be an object or null");
  } else if (evidence.modelTokenBilling && typeof evidence.modelTokenBilling === "object") {
    const billing = evidence.modelTokenBilling;
    if (billing.source !== "api_readback") {
      errors.push("modelTokenBilling.source must be api_readback");
    }
    if (!["passed", "failed", "blocked"].includes(billing.status)) {
      errors.push("modelTokenBilling.status must be passed/failed/blocked");
    }
    if (
      billing.pricing !== undefined &&
      (!billing.pricing || typeof billing.pricing !== "object" || Array.isArray(billing.pricing))
    ) {
      errors.push("modelTokenBilling.pricing must be an object when present");
    }
    if (
      billing.byConsumer !== undefined &&
      (!billing.byConsumer ||
        typeof billing.byConsumer !== "object" ||
        Array.isArray(billing.byConsumer))
    ) {
      errors.push("modelTokenBilling.byConsumer must be an object when present");
    }
    for (const key of ["inputTokens", "outputTokens", "totalTokens", "costCny"]) {
      if (billing[key] !== undefined && (typeof billing[key] !== "number" || billing[key] < 0)) {
        errors.push(`modelTokenBilling.${key} must be a non-negative number when present`);
      }
    }
    if (billing.pricing && typeof billing.pricing === "object" && !Array.isArray(billing.pricing)) {
      for (const key of ["inputCnyPerMillion", "outputCnyPerMillion"]) {
        if (
          billing.pricing[key] !== undefined &&
          (typeof billing.pricing[key] !== "number" || billing.pricing[key] < 0)
        ) {
          errors.push(
            `modelTokenBilling.pricing.${key} must be a non-negative number when present`,
          );
        }
      }
    }
  }
  const mainChat = evidence.openclawMainChat;
  if (!mainChat || typeof mainChat !== "object" || Array.isArray(mainChat)) {
    errors.push("openclawMainChat must be an object");
  } else {
    if (!["passed", "failed", "blocked", "provider-config-blocked"].includes(mainChat.status)) {
      errors.push("openclawMainChat.status must be passed/failed/blocked/provider-config-blocked");
    }
    if (mainChat.path !== "main_chat") {
      errors.push("openclawMainChat.path must be main_chat");
    }
    if (
      !["playwright", "api_readback", "dry-run", "self-check", "missing"].includes(mainChat.source)
    ) {
      errors.push(
        "openclawMainChat.source must be playwright/api_readback/dry-run/self-check/missing",
      );
    }
    if (mainChat.status === "passed") {
      const assertion = mainChat.assertion;
      if (
        !assertion ||
        typeof assertion !== "object" ||
        Array.isArray(assertion) ||
        assertion.status !== "passed"
      ) {
        errors.push("openclawMainChat.assertion.status must be passed when status is passed");
      }
    }
    if (mainChat.status === "provider-config-blocked") {
      const blockedReason = mainChat.blockedReason;
      if (!blockedReason || typeof blockedReason !== "object" || Array.isArray(blockedReason)) {
        errors.push(
          "openclawMainChat.blockedReason must be an object when provider-config-blocked",
        );
      } else {
        if (typeof blockedReason.code !== "string" || !blockedReason.code.trim()) {
          errors.push("openclawMainChat.blockedReason.code must be a non-empty string");
        }
        if (blockedReason.stage !== "main_chat") {
          errors.push("openclawMainChat.blockedReason.stage must be main_chat");
        }
      }
    }
  }
  for (const [index, persona] of asArray(evidence.personas).entries()) {
    if (typeof persona?.name !== "string" || !persona.name.trim()) {
      errors.push(`personas[${index}].name must be a non-empty string`);
    }
    if (!["passed", "failed", "blocked"].includes(persona?.status)) {
      errors.push(`personas[${index}].status must be passed/failed/blocked`);
    }
  }
  for (const key of ["consoleErrorCount", "network5xxCount"]) {
    if (evidence[key] !== undefined && (typeof evidence[key] !== "number" || evidence[key] < 0)) {
      errors.push(`${key} must be a non-negative number when present`);
    }
  }
  if (evidence.proof && typeof evidence.proof === "object" && !Array.isArray(evidence.proof)) {
    for (const key of [
      "screenshotCount",
      "apiCheckCount",
      "pageProbeCount",
      "actionCount",
      "failedActionCount",
      "consoleEventCount",
      "networkEventCount",
    ]) {
      if (
        evidence.proof[key] !== undefined &&
        (typeof evidence.proof[key] !== "number" || evidence.proof[key] < 0)
      ) {
        errors.push(`proof.${key} must be a non-negative number when present`);
      }
    }
    if (evidence.proof.actionTrace !== undefined && !Array.isArray(evidence.proof.actionTrace)) {
      errors.push("proof.actionTrace must be an array when present");
    }
    if (evidence.proof.apiChecks !== undefined && !Array.isArray(evidence.proof.apiChecks)) {
      errors.push("proof.apiChecks must be an array when present");
    }
    if (evidence.proof.artifacts !== undefined) {
      const artifacts = evidence.proof.artifacts;
      if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
        errors.push("proof.artifacts must be an object when present");
      } else {
        for (const key of ["actions", "console", "networkSummary", "screenshotsDir"]) {
          if (artifacts[key] !== undefined && typeof artifacts[key] !== "string") {
            errors.push(`proof.artifacts.${key} must be a string when present`);
          }
        }
      }
    }
  }
  if (
    !evidence.secretScan ||
    typeof evidence.secretScan !== "object" ||
    Array.isArray(evidence.secretScan) ||
    typeof evidence.secretScan.leakCount !== "number" ||
    evidence.secretScan.leakCount < 0
  ) {
    errors.push("secretScan.leakCount must be a non-negative number");
  }
  return errors;
}

function mergeIds(evidence, apiSeed) {
  return {
    ...(apiSeed?.ids ?? {}),
    ...(evidence?.ids ?? {}),
    rolePackageId:
      evidence?.rolePackageId ??
      evidence?.ids?.rolePackageId ??
      apiSeed?.rolePackageId ??
      apiSeed?.ids?.rolePackageId,
    rolePackageVersion:
      evidence?.rolePackageVersion ??
      evidence?.ids?.rolePackageVersion ??
      apiSeed?.rolePackageVersion ??
      apiSeed?.ids?.rolePackageVersion,
    roleListingId:
      evidence?.roleListingId ??
      evidence?.ids?.roleListingId ??
      apiSeed?.roleListingId ??
      apiSeed?.ids?.roleListingId,
    reviewId:
      evidence?.reviewId ?? evidence?.ids?.reviewId ?? apiSeed?.reviewId ?? apiSeed?.ids?.reviewId,
    orderId:
      evidence?.orderId ?? evidence?.ids?.orderId ?? apiSeed?.orderId ?? apiSeed?.ids?.orderId,
    entitlementId:
      evidence?.entitlementId ??
      evidence?.ids?.entitlementId ??
      apiSeed?.entitlementId ??
      apiSeed?.ids?.entitlementId,
    executionId:
      evidence?.executionId ??
      evidence?.ids?.executionId ??
      apiSeed?.executionId ??
      apiSeed?.ids?.executionId,
    auditRecordId:
      evidence?.auditRecordId ??
      evidence?.ids?.auditRecordId ??
      apiSeed?.auditRecordId ??
      apiSeed?.ids?.auditRecordId,
    ledgerEntryId:
      evidence?.ledgerEntryId ??
      evidence?.ids?.ledgerEntryId ??
      apiSeed?.ledgerEntryId ??
      apiSeed?.ids?.ledgerEntryId,
  };
}

export function normalizePersonaEvidence(evidence = {}, options = {}) {
  const ids = mergeIds(evidence, options.apiSeed);
  const screenshotProof = collectScreenshotProof(options.evidencePath, evidence);
  const consoleNetworkArtifactProof = collectConsoleNetworkArtifactProof(
    options.evidencePath,
    evidence,
  );
  const actionArtifactProof = collectActionArtifactProof(options.evidencePath, evidence);
  const schemaErrors = validatePersonaEvidenceSchema(evidence);
  return {
    schemaVersion: evidence.schemaVersion,
    source: evidence.source ?? "unknown",
    realBrowser: evidence.realBrowser === true,
    realApplication: evidence.realApplication === true,
    startedAt: evidence.startedAt ?? nowIso(),
    endedAt: evidence.endedAt ?? nowIso(),
    personas: asArray(evidence.personas),
    positive: asArray(evidence.positive),
    negative: asArray(evidence.negative),
    apiChecks: asArray(evidence.apiChecks),
    proof: {
      ...(evidence.proof ?? {}),
      ...screenshotProof,
      ...actionArtifactProof,
      ...consoleNetworkArtifactProof,
    },
    ids,
    gaps: asArray(evidence.gaps),
    consoleErrorCount: Number(evidence.consoleErrorCount ?? evidence.proof?.consoleErrorCount ?? 0),
    network5xxCount: Number(evidence.network5xxCount ?? evidence.proof?.network5xxCount ?? 0),
    schemaErrors,
    secretLeaks: scanEvidenceForSecrets(evidence),
    raw: evidence,
  };
}

export function evaluateProductionPlusEvidence(evidence = {}, options = {}) {
  const normalized = normalizePersonaEvidence(evidence, options);
  const personasByName = new Map(normalized.personas.map((persona) => [persona.name, persona]));
  const missingPersonas = STANDARD_PERSONAS.filter((persona) => !personasByName.has(persona));
  const failedPersonas = STANDARD_PERSONAS.filter((persona) => {
    const item = personasByName.get(persona);
    return !item || !isPassed(item);
  });
  const missingPositivePersonas = STANDARD_PERSONAS.filter(
    (persona) => !hasPassedPersonaAssertion(normalized.positive, persona),
  );
  const missingNegativePersonas = STANDARD_PERSONAS.filter(
    (persona) => !hasPassedPersonaAssertion(normalized.negative, persona),
  );
  const missingNegativeApiPersonas = STANDARD_PERSONAS.filter(
    (persona) => !hasPassedNegativeApiCheck(normalized, persona),
  );
  const passedApiChecks = asArray(normalized.proof.apiChecks)
    .concat(normalized.apiChecks)
    .filter(isPassed).length;
  const missingIds = REQUIRED_IDS.filter((key) => !normalized.ids[key]);
  const hasFreshSeed =
    normalized.raw.freshApiSeed === true || normalized.raw.finalProbes?.freshApiSeed === true;
  const hasFinalProbes =
    normalized.raw.finalProbes?.developerPackageSubmit === true &&
    normalized.raw.finalProbes?.adminReviewPublish === true &&
    normalized.raw.finalProbes?.buyerAuthorizationOrCheckout === true &&
    normalized.raw.finalProbes?.userCenterCloudExecution === true &&
    normalized.raw.finalProbes?.openclawLocalSync === true &&
    normalized.raw.finalProbes?.openclawLocalExecution === true &&
    normalized.raw.finalProbes?.auditUpload === true &&
    normalized.raw.finalProbes?.ledgerReadback === true &&
    normalized.raw.finalProbes?.receivablesReadback === true &&
    normalized.raw.finalProbes?.crossActorNegatives === true &&
    normalized.raw.finalProbes?.apiIdCapture === true &&
    normalized.raw.finalProbes?.screenshots === true &&
    MODEL_TOKEN_BILLING_FINAL_PROBES.every((key) => normalized.raw.finalProbes?.[key] === true);
  const missingModelTokenBillingProbes = MODEL_TOKEN_BILLING_FINAL_PROBES.filter(
    (key) => normalized.raw.finalProbes?.[key] !== true,
  );
  const modelTokenBilling = normalized.raw.modelTokenBilling;
  const modelTokenBillingReadbackOk = hasCompleteModelTokenBillingReadback(modelTokenBilling);
  const openclawMainChat =
    normalized.raw.openclawMainChat ??
    (normalized.raw.openclawMainChatStatus
      ? { status: normalized.raw.openclawMainChatStatus }
      : null);
  const mainChatOk = hasCompleteOpenclawMainChatEvidence(openclawMainChat);
  const apiManagementPageOk = hasPassedLocalPageProbe(
    normalized.raw,
    "api_management_model_pricing",
  );
  const billingPageOk = hasPassedLocalPageProbe(normalized.raw, "billing_model_metering");
  const collectorSecretScan =
    normalized.raw.secretScan && typeof normalized.raw.secretScan === "object"
      ? normalized.raw.secretScan
      : { leakCount: 0 };
  const evidenceSecretLeakCount = normalized.secretLeaks.length;
  const collectorSecretLeakCount =
    typeof collectorSecretScan.leakCount === "number" ? collectorSecretScan.leakCount : 0;
  const totalSecretLeakCount = evidenceSecretLeakCount + collectorSecretLeakCount;

  const gates = [
    gate(
      "schema_contract",
      normalized.schemaErrors.length === 0,
      "evidence must satisfy the production-plus schema contract",
      "修正 evidence 必填字段、枚举和数组结构；不能由 normalize 默认补齐生产级证据字段。",
      { schemaErrors: normalized.schemaErrors },
    ),
    gate(
      "schema_v2",
      normalized.schemaVersion === 2,
      "evidence.schemaVersion must be 2",
      "升级 evidence schema，并固定 evidence.json 机器字段。",
      { actual: normalized.schemaVersion },
    ),
    gate(
      "real_browser_application",
      ["chrome", "playwright"].includes(normalized.source) &&
        normalized.realBrowser &&
        normalized.realApplication,
      "real Chrome/Playwright browser evidence against an http(s) application is required",
      "用真实 Chrome/Playwright 打开被测应用，不用 mock/data/file 页面冒充业务证据。",
      {
        source: normalized.source,
        realBrowser: normalized.realBrowser,
        realApplication: normalized.realApplication,
      },
    ),
    gate(
      "screenshots",
      normalized.proof.declaredScreenshotCount > 0 &&
        normalized.proof.screenshotArtifactCountsMatch === true,
      "declared screenshot count must match retained valid PNG artifacts with non-zero dimensions",
      "让 persona runner 写入与 proof.screenshotCount 一致的 screenshots/*.png，并校验 PNG 签名、IHDR、非零尺寸和数量一致性。",
      normalized.proof,
    ),
    gate(
      "standard_personas",
      missingPersonas.length === 0 && failedPersonas.length === 0,
      "six standard personas must exist and pass",
      "补齐 developer/admin/buyer/user/OpenClaw/ledger 六类 persona，并让每个 persona 有独立上下文和通过状态。",
      { missingPersonas, failedPersonas },
    ),
    gate(
      "persona_positive_assertions",
      missingPositivePersonas.length === 0,
      "each standard persona needs a passed positive assertion",
      "为每个 persona 增加 `<persona>:` 前缀的正向断言。",
      { missingPositivePersonas },
    ),
    gate(
      "persona_negative_assertions",
      missingNegativePersonas.length === 0,
      "each standard persona needs a passed negative assertion",
      "为每个 persona 增加 `<persona>:` 前缀的越权/失败注入负向断言。",
      { missingNegativePersonas },
    ),
    gate(
      "negative_api_cross_checks",
      passedApiChecks >= 6 && missingNegativeApiPersonas.length === 0,
      "six persona-scoped negative API cross-checks are required",
      "把匿名、跨 actor、未授权、缺确认、缺 token 等负例接入浏览器上下文 API cross-check。",
      { passedApiChecks, missingNegativeApiPersonas },
    ),
    gate(
      "required_ids_readback",
      missingIds.length === 0,
      "all required ids must be present and traceable",
      "从真实 readback 捕获 package/listing/review/entitlement/execution/audit/ledger id。",
      { missingIds },
    ),
    gate(
      "security_no_leaks",
      totalSecretLeakCount === 0,
      "evidence must not leak tokens, keys, prompts, local paths, or package bodies",
      "对截图、日志、network summary 和 evidence 做脱敏扫描，禁止写 raw token、本地路径和私有正文。",
      {
        leakCount: totalSecretLeakCount,
        evidenceLeakCount: evidenceSecretLeakCount,
        collectorLeakCount: collectorSecretLeakCount,
        leaks: normalized.secretLeaks,
        collectorSurfaces: collectorSecretScan.surfaces ?? {},
      },
    ),
    gate(
      "console_network_clean",
      normalized.consoleErrorCount === 0 &&
        normalized.network5xxCount === 0 &&
        normalized.proof.consoleNetworkArtifactsValid === true,
      "console errors and network 5xx must be zero, with valid redacted NDJSON artifacts",
      "修正页面 console error/network 5xx；写入有效的 console.ndjson 和 network-summary.ndjson，确保行数匹配、可解析、无 raw token/API key/本地路径。",
      {
        consoleErrorCount: normalized.consoleErrorCount,
        network5xxCount: normalized.network5xxCount,
        consoleArtifact: normalized.proof.consoleArtifact,
        networkSummaryArtifact: normalized.proof.networkSummaryArtifact,
        consoleNetworkArtifactCountsMatch: normalized.proof.consoleNetworkArtifactCountsMatch,
      },
    ),
    gate(
      "persona_action_trace",
      normalized.proof.actionTraceValid === true,
      "each standard persona must have passed audited browser actions with valid actions.ndjson",
      "为六类 persona 增加真实 click/fill/wait 等动作；写入 actions.ndjson，确保 actionCount 匹配、failedActionCount 为 0、每个 persona 至少一个 passed action，且不泄漏输入原文。",
      {
        actionCount: normalized.proof.actionCount,
        failedActionCount: normalized.proof.failedActionCount,
        artifactFailedActionCount: normalized.proof.artifactFailedActionCount,
        actionArtifact: normalized.proof.actionArtifact,
        actionArtifactCountsMatch: normalized.proof.actionArtifactCountsMatch,
        missingActionTracePersonas: normalized.proof.missingActionTracePersonas,
        missingActionArtifactPersonas: normalized.proof.missingActionArtifactPersonas,
      },
    ),
    gate(
      "fresh_final_probes",
      hasFreshSeed && hasFinalProbes,
      "fresh seed and all final probes are required",
      "用新 runId 生成 fresh API seed，并逐项声明 developer submit、admin publish、buyer auth、cloud/local execution、audit、ledger、receivables、cross-actor negatives 和 screenshots。",
      { hasFreshSeed, hasFinalProbes },
    ),
    gate(
      "openclaw_main_chat_path",
      mainChatOk,
      "OpenClaw main chat path must have independent passed or structured provider-config-blocked evidence",
      "为 OpenClaw main chat 增加独立 persona 步骤和结构化 blocked reason，不能用 role tool path 代替。",
      { openclawMainChat: openclawMainChat ?? null },
    ),
    gate(
      "model_token_billing_readback",
      missingModelTokenBillingProbes.length === 0 && modelTokenBillingReadbackOk,
      "model Token pricing, metering readback, and multi-consumer attribution are required",
      "在 API 管理填写模型输入/输出单价，读回 apiConnections.metadata.metering，并证明 byConsumer.role_execution 与至少一个其他入口都产生 Token 和 CNY 费用。",
      {
        missingModelTokenBillingProbes,
        modelTokenBilling: modelTokenBilling ?? null,
      },
    ),
    gate(
      "api_management_model_pricing_page",
      apiManagementPageOk,
      "API 管理页必须能用真实页面证据展示模型、用途、Token 定价和计量入口",
      "让 Playwright 打开本地端 /api-management，命中 openclaw-api-management 稳定选择器，并看到模型定价、输入/输出 Token 单价、提供给和 API 列表与计量。",
      { localPageProbes: normalized.raw.localPageProbes ?? [] },
    ),
    gate(
      "billing_page_model_metering",
      billingPageOk,
      "费用与授权页必须能用真实页面证据展示模型 Token 费用读回",
      "让 Playwright 打开本地端 /usage，命中 openclaw-billing-model-metering 稳定选择器，并看到模型 Token 费用读回文本。",
      { localPageProbes: normalized.raw.localPageProbes ?? [] },
    ),
  ];

  const verdict = gates.every((item) => item.status === "passed")
    ? "production_plus_passed"
    : "failed";
  return {
    runId: options.runId ?? normalized.raw.runId ?? `aics-persona-${Date.now()}`,
    startedAt: normalized.startedAt,
    endedAt: nowIso(),
    verdict,
    source: normalized.source,
    realBrowser: normalized.realBrowser,
    realApplication: normalized.realApplication,
    gates,
    ids: normalized.ids,
    personas: normalized.personas,
    positive: normalized.positive,
    negative: normalized.negative,
    proof: normalized.proof,
    finalProbes: normalized.raw.finalProbes ?? {},
    modelTokenBilling: normalized.raw.modelTokenBilling ?? null,
    openclawMainChat: openclawMainChat ?? { status: null },
    localPageProbes: normalized.raw.localPageProbes ?? [],
    consoleErrorCount: normalized.consoleErrorCount,
    network5xxCount: normalized.network5xxCount,
    schemaErrors: normalized.schemaErrors,
    secretScan: normalized.raw.secretScan ?? { leakCount: normalized.secretLeaks.length },
    gaps: normalized.gaps,
  };
}

export function buildRemediation(result) {
  const failedGates = result.gates.filter((gate) => gate.status !== "passed");
  const implementationPlan = buildImplementationPlan(result, failedGates);
  const completionAudit = {
    objective: "拟人化测试超过生产级",
    status: result.verdict === "production_plus_passed" ? "achieved" : "not_achieved",
    verdict: result.verdict,
    provenGateIds: result.gates.filter((gate) => gate.status === "passed").map((gate) => gate.id),
    missingGateIds: failedGates.map((gate) => gate.id),
    requirements: result.gates.map((gate) => ({
      id: gate.id,
      status: gate.status === "passed" ? "proven" : "missing",
      evidence: gate.summary,
      remediation: gate.remediation,
    })),
  };
  return {
    verdict: result.verdict,
    completionAudit,
    implementationPlan,
    gates: failedGates.map((gate) => ({
      id: gate.id,
      summary: gate.summary,
      remediation: gate.remediation,
    })),
    missingIds: result.gates.find((gate) => gate.id === "required_ids_readback")?.missingIds ?? [],
    personaWork: result.gates
      .filter((gate) =>
        [
          "standard_personas",
          "persona_positive_assertions",
          "persona_negative_assertions",
          "negative_api_cross_checks",
        ].includes(gate.id),
      )
      .flatMap((gate) => [
        ...(gate.missingPersonas ?? []),
        ...(gate.failedPersonas ?? []),
        ...(gate.missingPositivePersonas ?? []),
        ...(gate.missingNegativePersonas ?? []),
        ...(gate.missingNegativeApiPersonas ?? []),
      ]),
    gaps: result.gaps,
    nextCommandPath:
      "node scripts/persona/aics-production-plus-orchestrator.mjs --seed-file docs/aics-persona-runs/<runId>/api-seed.json --production-plus-final --probe-endpoints --final-manifest docs/aics-persona-runs/<runId>/final-manifest.json --output-dir docs/aics-persona-runs/<runId> --run-id <runId>",
  };
}

export function renderSummaryMarkdown(result) {
  return [
    `# AICS production-plus persona run ${result.runId}`,
    "",
    `- verdict: \`${result.verdict}\``,
    `- startedAt: \`${result.startedAt}\``,
    `- endedAt: \`${result.endedAt}\``,
    "",
    "## Gates",
    "",
    ...result.gates.map(
      (gate) => `- ${gate.status === "passed" ? "PASS" : "FAIL"} \`${gate.id}\`: ${gate.summary}`,
    ),
    "",
  ].join("\n");
}

export function renderRemediationMarkdown(remediation) {
  const lines = [
    "# AICS production-plus remediation",
    "",
    `- verdict: \`${remediation.verdict}\``,
    "",
  ];
  if (remediation.completionAudit) {
    lines.push(
      "## Completion Audit",
      "",
      `- objective: ${remediation.completionAudit.objective}`,
      `- status: \`${remediation.completionAudit.status}\``,
      `- proven gates: ${remediation.completionAudit.provenGateIds.length}`,
      `- missing gates: ${remediation.completionAudit.missingGateIds.length}`,
      "",
    );
  }
  if (remediation.implementationPlan) {
    lines.push("## Implementation Plan", "");
    for (const group of remediation.implementationPlan.groups.filter(
      (item) => item.status === "blocked",
    )) {
      lines.push(`- ${group.title}: ${group.nextAction}`);
      for (const gate of group.gates) {
        lines.push(`  - \`${gate.id}\`: ${gate.remediation}`);
      }
    }
    if (remediation.implementationPlan.ungrouped.length) {
      lines.push("- 未分组缺口:");
      for (const gate of remediation.implementationPlan.ungrouped) {
        lines.push(`  - \`${gate.id}\`: ${gate.remediation}`);
      }
    }
    lines.push("");
  }
  if (remediation.gates.length === 0) {
    lines.push("All production-plus gates passed.");
  } else {
    lines.push("## Required Changes", "");
    for (const gate of remediation.gates) {
      lines.push(`- \`${gate.id}\`: ${gate.remediation}`);
    }
  }
  if (remediation.missingIds.length) {
    lines.push("", "## Missing IDs", "", ...remediation.missingIds.map((id) => `- ${id}`));
  }
  if (remediation.personaWork.length) {
    lines.push(
      "",
      "## Persona Work",
      "",
      ...Array.from(new Set(remediation.personaWork)).map((persona) => `- ${persona}`),
    );
  }
  if (
    Array.isArray(remediation.implementationPlan?.nextCommands) &&
    remediation.implementationPlan.nextCommands.length
  ) {
    lines.push("", "## Next Commands", "");
    for (const command of remediation.implementationPlan.nextCommands) {
      lines.push(`- \`${command}\``);
    }
  }
  lines.push("", "## Next Command", "", `\`${remediation.nextCommandPath}\``, "");
  return lines.join("\n");
}

export function writeRunArtifacts(result, outputDir) {
  const out = resolve(outputDir);
  const remediation = buildRemediation(result);
  const evidencePath = join(out, "evidence.json");
  const remediationPath = join(out, "remediation.json");
  const remediationMarkdownPath = join(out, "remediation.md");
  const summaryPath = join(out, "summary.md");
  writeJson(evidencePath, {
    schemaVersion: 2,
    runId: result.runId,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    verdict: result.verdict,
    source: result.source,
    realBrowser: result.realBrowser,
    realApplication: result.realApplication,
    gates: result.gates,
    ids: result.ids,
    personas: result.personas,
    positive: result.positive,
    negative: result.negative,
    proof: result.proof,
    finalProbes: result.finalProbes,
    modelTokenBilling: result.modelTokenBilling,
    openclawMainChat: result.openclawMainChat,
    localPageProbes: result.localPageProbes,
    consoleErrorCount: result.consoleErrorCount,
    network5xxCount: result.network5xxCount,
    schemaErrors: result.schemaErrors,
    secretScan: result.secretScan,
    remediation: {
      json: relative(out, remediationPath),
      markdown: relative(out, remediationMarkdownPath),
    },
  });
  writeJson(remediationPath, remediation);
  writeFileSync(remediationMarkdownPath, renderRemediationMarkdown(remediation));
  writeFileSync(summaryPath, renderSummaryMarkdown(result));
  writeFileSync(join(out, "redacted-env.txt"), "redacted=true\n");
  return {
    outputDir: out,
    evidencePath,
    remediationPath,
    remediationMarkdownPath,
    summaryPath,
  };
}

export function parseRunnerArgs(argv) {
  const args = {
    apiSeed: false,
    selfCheck: false,
    dryRun: false,
    outputDir: "docs/aics-persona-runs/latest",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--api-seed") args.apiSeed = true;
    else if (arg === "--self-check") args.selfCheck = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--output-dir") args.outputDir = argv[++i];
    else if (arg === "--persona-evidence") args.personaEvidence = argv[++i];
    else if (arg === "--api-seed-file") args.apiSeedFile = argv[++i];
    else if (arg === "--write-api-seed") args.writeApiSeed = argv[++i];
    else if (arg === "--run-id") args.runId = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.outputDir) throw new Error("--output-dir requires a value");
  return args;
}

export function selfCheckEvidence() {
  return {
    schemaVersion: 2,
    source: "playwright",
    realBrowser: true,
    realApplication: false,
    personas: [{ name: "buyer_storefront", status: "passed" }],
    positive: [{ name: "buyer_storefront: self-check page rendered", status: "passed" }],
    negative: [{ name: "buyer_storefront: self-check contains no bearer", status: "passed" }],
    proof: { screenshotCount: 0, apiCheckCount: 0, pageProbeCount: 0, apiChecks: [] },
    ids: {},
    finalProbes: {},
    localPageProbes: [],
    modelTokenBilling: null,
    openclawMainChat: {
      status: "failed",
      source: "self-check",
      path: "main_chat",
      blockedReason: { code: "self_check_not_real_application", stage: "main_chat" },
    },
    secretScan: { leakCount: 0, surfaces: {} },
    gaps: ["self-check uses a data page and cannot prove production-plus"],
  };
}

export function dryRunEvidence() {
  return {
    schemaVersion: 2,
    source: "dry-run",
    realBrowser: false,
    realApplication: false,
    personas: [],
    positive: [],
    negative: [],
    proof: { screenshotCount: 0, apiCheckCount: 0, pageProbeCount: 0, apiChecks: [] },
    ids: {},
    finalProbes: {},
    localPageProbes: [],
    modelTokenBilling: null,
    openclawMainChat: {
      status: "failed",
      source: "dry-run",
      path: "main_chat",
      blockedReason: { code: "dry_run_no_browser", stage: "main_chat" },
    },
    secretScan: { leakCount: 0, surfaces: {} },
    gaps: ["dry-run has no real browser evidence"],
  };
}

export function buildApiSeed(runId = `aics-persona-${Date.now()}`) {
  return {
    schemaVersion: 1,
    runId,
    generatedAt: nowIso(),
    ids: {},
    gaps: [
      "API seed is scaffold-only until real Dijie/OpenClaw endpoints are connected.",
      "Do not treat this file as production-plus evidence.",
    ],
  };
}

export function runPersonaGate(args) {
  const runId = args.runId ?? `aics-persona-${Date.now()}`;
  let apiSeed;
  if (args.apiSeedFile) apiSeed = readJsonFile(args.apiSeedFile);
  if (args.writeApiSeed) {
    apiSeed = apiSeed ?? buildApiSeed(runId);
    writeJson(args.writeApiSeed, apiSeed);
  }
  const evidence = args.selfCheck
    ? selfCheckEvidence()
    : args.dryRun
      ? dryRunEvidence()
      : args.personaEvidence
        ? readJsonFile(args.personaEvidence)
        : dryRunEvidence();
  const result = evaluateProductionPlusEvidence(evidence, {
    runId,
    apiSeed,
    evidencePath: args.personaEvidence,
  });
  const artifacts = writeRunArtifacts(result, args.outputDir);
  return { result, artifacts };
}

export function isCli(importMetaUrl, argv1 = process.argv[1]) {
  return argv1 ? pathToFileURL(resolve(argv1)).href === importMetaUrl : false;
}

export function scriptDir(importMetaUrl) {
  return dirname(fileURLToPath(importMetaUrl));
}
