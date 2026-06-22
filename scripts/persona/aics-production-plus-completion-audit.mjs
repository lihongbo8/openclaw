#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { validateFinalManifest } from "./aics-final-manifest.mjs";
import {
  REQUIRED_IDS,
  STANDARD_PERSONAS,
  evaluateProductionPlusEvidence,
  isCli,
  validatePersonaEvidenceSchema,
} from "./aics-persona-runner.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fileExists(path) {
  return existsSync(path) && statSync(path).isFile();
}

function dirExists(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

function safeReadJson(path) {
  if (!fileExists(path)) {
    return { ok: false, error: "missing_file" };
  }
  try {
    return { ok: true, value: readJson(path) };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

function check(id, passed, summary, evidence = {}, remediation = "") {
  return {
    id,
    status: passed ? "passed" : "failed",
    summary,
    evidence,
    remediation: passed ? null : remediation,
  };
}

function relativeArtifact(runDir, path) {
  return path.startsWith(runDir) ? path.slice(runDir.length + 1) : path;
}

function nestedNumber(value, path) {
  return path.split(".").reduce((current, segment) => current?.[segment], value);
}

function parseIsoMs(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function auditRunMetadata(runDir) {
  const topEvidencePath = join(runDir, "evidence.json");
  const rawEvidencePath = join(runDir, "persona-evidence", "persona-evidence.json");
  const seedPath = join(runDir, "resolved-seed.json");
  const manifestPath = join(runDir, "final-manifest.resolved.json");
  const validationPath = join(runDir, "run-metadata.validation.json");
  const topEvidence = safeReadJson(topEvidencePath);
  const rawEvidence = safeReadJson(rawEvidencePath);
  const seed = safeReadJson(seedPath);
  const manifest = safeReadJson(manifestPath);
  const validation = safeReadJson(validationPath);
  const missingFiles = [
    ...(topEvidence.ok ? [] : [relativeArtifact(runDir, topEvidencePath)]),
    ...(rawEvidence.ok ? [] : [relativeArtifact(runDir, rawEvidencePath)]),
    ...(seed.ok ? [] : [relativeArtifact(runDir, seedPath)]),
    ...(manifest.ok ? [] : [relativeArtifact(runDir, manifestPath)]),
    ...(validation.ok ? [] : [relativeArtifact(runDir, validationPath)]),
  ];
  if (missingFiles.length) {
    return check(
      "run_metadata",
      false,
      "run id and timestamps must prove one fresh coherent run",
      { missingArtifacts: missingFiles },
      "Keep top-level evidence, raw persona evidence, resolved seed, final manifest, and run-metadata validation artifacts in one run directory.",
    );
  }
  const validationMismatchCount = Array.isArray(validation.value.mismatches)
    ? validation.value.mismatches.length
    : 0;
  const runIds = {
    topEvidence: topEvidence.value.runId,
    rawEvidence: rawEvidence.value.runId,
    seed: seed.value.runId,
    manifest: manifest.value.runId,
  };
  const runIdValues = Object.values(runIds).filter(
    (value) => typeof value === "string" && value.trim(),
  );
  const missingRunIdFields = Object.entries(runIds)
    .filter(([, value]) => typeof value !== "string" || !value.trim())
    .map(([key]) => key);
  const uniqueRunIds = Array.from(new Set(runIdValues));
  const rawStartedMs = parseIsoMs(rawEvidence.value.startedAt);
  const rawEndedMs = parseIsoMs(rawEvidence.value.endedAt);
  const topStartedMs = parseIsoMs(topEvidence.value.startedAt);
  const topEndedMs = parseIsoMs(topEvidence.value.endedAt);
  const timestampErrors = [
    ...(rawStartedMs === null ? ["rawEvidence.startedAt_invalid"] : []),
    ...(rawEndedMs === null ? ["rawEvidence.endedAt_invalid"] : []),
    ...(topStartedMs === null ? ["topEvidence.startedAt_invalid"] : []),
    ...(topEndedMs === null ? ["topEvidence.endedAt_invalid"] : []),
    ...(rawStartedMs !== null && rawEndedMs !== null && rawEndedMs < rawStartedMs
      ? ["rawEvidence.ended_before_started"]
      : []),
    ...(topStartedMs !== null && topEndedMs !== null && topEndedMs < topStartedMs
      ? ["topEvidence.ended_before_started"]
      : []),
    ...(rawStartedMs !== null && topStartedMs !== null && topStartedMs !== rawStartedMs
      ? ["topEvidence.startedAt_mismatch"]
      : []),
    ...(rawEndedMs !== null && topEndedMs !== null && topEndedMs < rawEndedMs
      ? ["topEvidence.ended_before_rawEvidence_ended"]
      : []),
  ];
  return check(
    "run_metadata",
    validation.value.status === "valid" &&
      validationMismatchCount === 0 &&
      missingRunIdFields.length === 0 &&
      uniqueRunIds.length === 1 &&
      timestampErrors.length === 0,
    "run id and timestamps must prove one fresh coherent run",
    {
      validationPath: relativeArtifact(runDir, validationPath),
      validationStatus: validation.value.status,
      validationMismatchCount,
      validationMismatches: validation.value.mismatches,
      validationErrors: validation.value.errors,
      runIds,
      missingRunIdFields,
      uniqueRunIds,
      timestampErrors,
    },
    "Regenerate the run so run-metadata.validation.json is valid and seed, manifest, raw evidence, and top-level gate evidence share one runId and valid timestamps.",
  );
}

function auditFinalManifest(runDir) {
  const manifestPath = join(runDir, "final-manifest.resolved.json");
  const validationPath = join(runDir, "final-manifest.validation.json");
  const seedPath = join(runDir, "resolved-seed.json");
  const evidencePath = join(runDir, "persona-evidence", "persona-evidence.json");
  const manifest = safeReadJson(manifestPath);
  const validation = safeReadJson(validationPath);
  const seed = safeReadJson(seedPath);
  const evidence = safeReadJson(evidencePath);
  const missingFiles = [
    ...(manifest.ok ? [] : [relativeArtifact(runDir, manifestPath)]),
    ...(validation.ok ? [] : [relativeArtifact(runDir, validationPath)]),
    ...(seed.ok ? [] : [relativeArtifact(runDir, seedPath)]),
    ...(evidence.ok ? [] : [relativeArtifact(runDir, evidencePath)]),
  ];
  if (missingFiles.length) {
    return check(
      "final_manifest",
      false,
      "final manifest must be valid and match raw evidence readback",
      { missingArtifacts: missingFiles },
      "Keep final-manifest.resolved.json, final-manifest.validation.json, resolved-seed.json, and raw persona evidence in the run directory.",
    );
  }
  const freshValidation = validateFinalManifest(manifest.value, seed.value);
  const validationStatusMatches =
    validation.value.status === "valid" && freshValidation.status === "valid";
  const idMismatches = REQUIRED_IDS.filter(
    (key) => manifest.value[key] !== evidence.value.ids?.[key],
  );
  const billingPairs = [
    ["apiConnectionId", "apiConnectionId"],
    ["provider", "provider"],
    ["model", "model"],
    ["pricing.inputCnyPerMillion", "pricing.inputCnyPerMillion"],
    ["pricing.outputCnyPerMillion", "pricing.outputCnyPerMillion"],
    ["inputTokens", "inputTokens"],
    ["outputTokens", "outputTokens"],
    ["totalTokens", "totalTokens"],
    ["costCny", "costCny"],
    ["byConsumer.role_execution.totalTokens", "byConsumer.role_execution.totalTokens"],
    ["byConsumer.role_execution.costCny", "byConsumer.role_execution.costCny"],
  ];
  const billingMismatches = billingPairs.filter(
    ([manifestKey, evidenceKey]) =>
      nestedNumber(manifest.value.modelTokenBilling, manifestKey) !==
      nestedNumber(evidence.value.modelTokenBilling, evidenceKey),
  );
  return check(
    "final_manifest",
    validationStatusMatches && idMismatches.length === 0 && billingMismatches.length === 0,
    "final manifest must be valid and match raw evidence readback",
    {
      manifestPath: relativeArtifact(runDir, manifestPath),
      validationPath: relativeArtifact(runDir, validationPath),
      seedPath: relativeArtifact(runDir, seedPath),
      evidencePath: relativeArtifact(runDir, evidencePath),
      validationStatus: validation.value.status,
      freshValidationStatus: freshValidation.status,
      validationErrors: freshValidation.errors,
      idMismatches,
      billingMismatches: billingMismatches.map(([field]) => field),
    },
    "Regenerate final manifest from the same fresh seed and only claim completion when manifest ids and billing readback match raw evidence.",
  );
}

function auditSelectorCoverage(runDir) {
  const path = join(runDir, "selector-coverage", "selector-coverage.json");
  const parsed = safeReadJson(path);
  if (!parsed.ok) {
    return check(
      "selector_coverage",
      false,
      "final persona selectors must be covered by stable data-* selectors in source",
      { path: relativeArtifact(runDir, path), error: parsed.error },
      "Run aics-selector-coverage.mjs in strict mode and fix missing data-testid/data-aics selectors.",
    );
  }
  const report = parsed.value;
  return check(
    "selector_coverage",
    report.status === "covered" && report.missingSelectorCount === 0,
    "final persona selectors must be covered by stable data-* selectors in source",
    {
      path: relativeArtifact(runDir, path),
      status: report.status,
      requiredSelectorCount: report.requiredSelectorCount,
      coveredSelectorCount: report.coveredSelectorCount,
      missingSelectorCount: report.missingSelectorCount,
    },
    "Add missing stable selectors or point the audit at the source roots that contain them.",
  );
}

function auditReadiness(runDir) {
  const path = join(runDir, "readiness", "readiness.json");
  const parsed = safeReadJson(path);
  if (!parsed.ok) {
    return check(
      "readiness",
      false,
      "production-plus run must have ready environment preflight evidence",
      { path: relativeArtifact(runDir, path), error: parsed.error },
      "Run aics-production-plus-readiness.mjs with real cloud/OpenClaw URLs, tokens, and public key.",
    );
  }
  const readiness = parsed.value;
  const blockedChecks = Array.isArray(readiness.checks)
    ? readiness.checks.filter((item) => item?.status !== "passed")
    : [];
  const endpointProbeNames = new Set([
    "DIJIE_CLOUD_BASE_URL reachable",
    "OPENCLAW_LOCAL_URL reachable",
  ]);
  const endpointProbeChecks = Array.isArray(readiness.checks)
    ? readiness.checks.filter((item) => endpointProbeNames.has(item?.name))
    : [];
  const missingEndpointProbeNames = [...endpointProbeNames].filter(
    (name) => !endpointProbeChecks.some((item) => item.name === name && item.status === "passed"),
  );
  return check(
    "readiness",
    readiness.status === "ready" &&
      blockedChecks.length === 0 &&
      missingEndpointProbeNames.length === 0,
    "production-plus run must have ready environment preflight evidence",
    {
      path: relativeArtifact(runDir, path),
      status: readiness.status,
      blockedCheckCount: blockedChecks.length,
      blockedChecks: blockedChecks.map((item) => ({
        name: item.name,
        path: item.path,
        reason: item.reason,
      })),
      endpointProbeCount: endpointProbeChecks.length,
      missingEndpointProbeNames,
    },
    "Resolve every blocked readiness check and run endpoint probes before claiming production-plus completion.",
  );
}

function auditPlaywrightConfig(runDir) {
  const path = join(runDir, "playwright-config.json");
  const parsed = safeReadJson(path);
  if (!parsed.ok) {
    return check(
      "playwright_config",
      false,
      "Playwright persona config must be a production-plus final config",
      { path: relativeArtifact(runDir, path), error: parsed.error },
      "Generate the config through aics-production-plus-orchestrator.mjs --production-plus-final.",
    );
  }
  const config = parsed.value;
  const personaNames = new Set((config.personas ?? []).map((persona) => persona?.name));
  const missingPersonas = STANDARD_PERSONAS.filter((name) => !personaNames.has(name));
  const hasMainChatProbe = Boolean(config.openclawMainChatProbe?.selector);
  const hasLocalPageProbes =
    Array.isArray(config.localPageProbes) && config.localPageProbes.length >= 2;
  const hasNoGaps = Array.isArray(config.gaps) && config.gaps.length === 0;
  return check(
    "playwright_config",
    config.productionPlusFinal === true &&
      hasNoGaps &&
      missingPersonas.length === 0 &&
      hasMainChatProbe &&
      hasLocalPageProbes,
    "Playwright persona config must be a production-plus final config",
    {
      path: relativeArtifact(runDir, path),
      productionPlusFinal: config.productionPlusFinal,
      gapCount: Array.isArray(config.gaps) ? config.gaps.length : null,
      personaCount: Array.isArray(config.personas) ? config.personas.length : 0,
      missingPersonas,
      hasMainChatProbe,
      localPageProbeCount: Array.isArray(config.localPageProbes)
        ? config.localPageProbes.length
        : 0,
    },
    "Regenerate final Playwright config with a valid final manifest and complete persona/local probes.",
  );
}

function auditPersonaEvidence(runDir) {
  const path = join(runDir, "persona-evidence", "persona-evidence.json");
  const parsed = safeReadJson(path);
  if (!parsed.ok) {
    return check(
      "persona_evidence",
      false,
      "raw Playwright persona evidence must pass the production-plus gate",
      { path: relativeArtifact(runDir, path), error: parsed.error },
      "Run the Playwright persona collector and keep its full persona-evidence directory.",
    );
  }
  const evidence = parsed.value;
  const seedCandidates = ["resolved-seed.json", "seed.json", "api-seed.json"].map((name) =>
    join(runDir, name),
  );
  const seedPath = seedCandidates.find(fileExists);
  const seed = seedPath ? safeReadJson(seedPath) : null;
  const schemaErrors = validatePersonaEvidenceSchema(evidence);
  const gate = evaluateProductionPlusEvidence(evidence, {
    evidencePath: path,
    ...(seed?.ok ? { apiSeed: seed.value } : {}),
  });
  const failedGateIds = gate.gates
    .filter((item) => item.status !== "passed")
    .map((item) => item.id);
  return check(
    "persona_evidence",
    schemaErrors.length === 0 && gate.verdict === "production_plus_passed",
    "raw Playwright persona evidence must pass the production-plus gate",
    {
      path: relativeArtifact(runDir, path),
      seedPath: seedPath ? relativeArtifact(runDir, seedPath) : null,
      verdict: gate.verdict,
      source: gate.source,
      realBrowser: gate.realBrowser,
      realApplication: gate.realApplication,
      schemaErrorCount: schemaErrors.length,
      failedGateIds,
      screenshotArtifactCount: gate.proof.screenshotArtifactCount,
      validScreenshotArtifactCount: gate.proof.validScreenshotArtifactCount,
      actionCount: gate.proof.actionCount,
      failedActionCount: gate.proof.failedActionCount,
      consoleEventCount: gate.proof.consoleEventCount,
      networkEventCount: gate.proof.networkEventCount,
    },
    "Fix raw persona evidence until evaluateProductionPlusEvidence returns production_plus_passed.",
  );
}

function auditPersonaArtifactFiles(runDir) {
  const evidenceDir = join(runDir, "persona-evidence");
  const artifacts = [
    join(evidenceDir, "actions.ndjson"),
    join(evidenceDir, "console.ndjson"),
    join(evidenceDir, "network-summary.ndjson"),
  ];
  const screenshotDir = join(evidenceDir, "screenshots");
  const missing = [
    ...artifacts.filter((path) => !fileExists(path)).map((path) => relativeArtifact(runDir, path)),
    ...(dirExists(screenshotDir) ? [] : [relativeArtifact(runDir, screenshotDir)]),
  ];
  return check(
    "persona_artifacts",
    missing.length === 0,
    "persona run must retain screenshots, actions, console, and network artifacts",
    { missingArtifacts: missing },
    "Keep the full persona-evidence artifact directory; do not copy only persona-evidence.json.",
  );
}

function auditFinalGate(runDir) {
  const path = join(runDir, "evidence.json");
  const parsed = safeReadJson(path);
  if (!parsed.ok) {
    return check(
      "final_gate",
      false,
      "top-level gate artifact must record production_plus_passed",
      { path: relativeArtifact(runDir, path), error: parsed.error },
      "Run aics-persona-runner.mjs or the orchestrator gate stage to write top-level evidence.json.",
    );
  }
  const evidence = parsed.value;
  const failedGateIds = Array.isArray(evidence.gates)
    ? evidence.gates.filter((item) => item?.status !== "passed").map((item) => item.id)
    : ["gates_missing"];
  return check(
    "final_gate",
    evidence.verdict === "production_plus_passed" && failedGateIds.length === 0,
    "top-level gate artifact must record production_plus_passed",
    {
      path: relativeArtifact(runDir, path),
      verdict: evidence.verdict,
      failedGateIds,
      gateCount: Array.isArray(evidence.gates) ? evidence.gates.length : 0,
    },
    "Do not claim completion until top-level evidence.json has verdict production_plus_passed.",
  );
}

function auditRemediationContract(runDir) {
  const path = join(runDir, "remediation.json");
  const parsed = safeReadJson(path);
  if (!parsed.ok) {
    return check(
      "remediation_contract",
      false,
      "remediation artifact must prove completion and carry the implementation plan contract",
      { path: relativeArtifact(runDir, path), error: parsed.error },
      "Run the final gate so remediation.json includes completionAudit and implementationPlan.",
    );
  }
  const remediation = parsed.value;
  const completionAudit = remediation.completionAudit ?? {};
  const implementationPlan = remediation.implementationPlan ?? {};
  const groups = Array.isArray(implementationPlan.groups) ? implementationPlan.groups : [];
  const blockedGroups = groups.filter((group) => group?.status !== "covered");
  const missingGateIds = Array.isArray(completionAudit.missingGateIds)
    ? completionAudit.missingGateIds
    : ["missingGateIds_missing"];
  const ungrouped = Array.isArray(implementationPlan.ungrouped)
    ? implementationPlan.ungrouped
    : ["ungrouped_missing"];
  return check(
    "remediation_contract",
    remediation.verdict === "production_plus_passed" &&
      completionAudit.status === "achieved" &&
      completionAudit.verdict === "production_plus_passed" &&
      missingGateIds.length === 0 &&
      implementationPlan.status === "complete" &&
      implementationPlan.sourceVerdict === "production_plus_passed" &&
      ungrouped.length === 0 &&
      groups.length > 0 &&
      blockedGroups.length === 0,
    "remediation artifact must prove completion and carry the implementation plan contract",
    {
      path: relativeArtifact(runDir, path),
      verdict: remediation.verdict,
      completionAuditStatus: completionAudit.status,
      completionAuditVerdict: completionAudit.verdict,
      missingGateCount: missingGateIds.length,
      implementationPlanStatus: implementationPlan.status,
      implementationPlanSourceVerdict: implementationPlan.sourceVerdict,
      ungroupedCount: ungrouped.length,
      blockedGroupCount: blockedGroups.length,
    },
    "Do not claim completion until remediation.json has achieved completionAudit and a complete implementationPlan with no blocked or ungrouped gates.",
  );
}

function auditSummaryArtifacts(runDir) {
  const required = ["summary.md", "remediation.md", "remediation.json", "redacted-env.txt"];
  const missing = required.filter((name) => !fileExists(join(runDir, name)));
  return check(
    "summary_artifacts",
    missing.length === 0,
    "run directory must include summary, remediation, and redacted environment artifacts",
    { missingArtifacts: missing },
    "Keep the runner output artifacts so the production-plus result is reviewable and reproducible.",
  );
}

export function runCompletionAudit(args) {
  if (!args.runDir) throw new Error("--run-dir requires a value");
  const runDir = resolve(args.runDir);
  const runDirCheck = check(
    "run_directory",
    dirExists(runDir),
    "run directory must exist",
    { runDir },
    "Pass --run-dir pointing at one production-plus orchestrator output directory.",
  );
  const checks =
    runDirCheck.status === "passed"
      ? [
          runDirCheck,
          auditRunMetadata(runDir),
          auditFinalManifest(runDir),
          auditSelectorCoverage(runDir),
          auditReadiness(runDir),
          auditPlaywrightConfig(runDir),
          auditPersonaEvidence(runDir),
          auditPersonaArtifactFiles(runDir),
          auditFinalGate(runDir),
          auditRemediationContract(runDir),
          auditSummaryArtifacts(runDir),
        ]
      : [runDirCheck];
  const failedChecks = checks.filter((item) => item.status !== "passed");
  return {
    schemaVersion: 1,
    objective: "拟人化测试。超过生产级。然后出方案",
    status: failedChecks.length === 0 ? "complete" : "incomplete",
    generatedAt: new Date().toISOString(),
    runDir,
    checks,
    missingArtifacts: checks.flatMap((item) => item.evidence?.missingArtifacts ?? []),
    failedCheckIds: failedChecks.map((item) => item.id),
  };
}

export function renderCompletionAuditMarkdown(audit) {
  const formatEvidenceValue = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((item) => (item && typeof item === "object" ? JSON.stringify(item) : String(item)))
        .join(",");
    }
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value);
  };
  const escapeTableCell = (value) => value.replaceAll("|", "\\|");
  const lines = [
    "# AICS production-plus completion audit",
    "",
    `- objective: ${audit.objective}`,
    `- status: \`${audit.status}\``,
    `- runDir: \`${audit.runDir}\``,
    "",
    "| Check | Status | Evidence | Remediation |",
    "| --- | --- | --- | --- |",
  ];
  for (const item of audit.checks) {
    const evidence = Object.entries(item.evidence ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${escapeTableCell(formatEvidenceValue(value))}`)
      .join("; ");
    lines.push(
      `| \`${item.id}\` | ${item.status === "passed" ? "PASS" : "FAIL"} | ${evidence || item.summary} | ${item.remediation ?? ""} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function parseCompletionAuditArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run-dir") args.runDir = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--markdown") args.markdown = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

if (isCli(import.meta.url)) {
  try {
    const args = parseCompletionAuditArgs(process.argv.slice(2));
    const audit = runCompletionAudit(args);
    if (args.out) writeJson(resolve(args.out), audit);
    if (args.markdown) {
      mkdirSync(dirname(resolve(args.markdown)), { recursive: true });
      writeFileSync(resolve(args.markdown), renderCompletionAuditMarkdown(audit));
    }
    console.log(`status: ${audit.status}`);
    console.log(`failed checks: ${audit.failedCheckIds.join(",") || "none"}`);
    process.exitCode = audit.status === "complete" ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
