import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPlaywrightConfig,
  validateProductionPlusSelectorContract,
} from "../../scripts/persona/aics-build-playwright-config.mjs";
import {
  buildFinalManifest,
  validateFinalManifest,
} from "../../scripts/persona/aics-final-manifest.mjs";
import {
  dryRunEvidence,
  evaluateProductionPlusEvidence,
  buildApiSeed,
  parseRunnerArgs,
  REQUIRED_IDS,
  STANDARD_PERSONAS,
  runPersonaGate,
  selfCheckEvidence,
  validatePersonaEvidenceSchema,
  writeRunArtifacts,
} from "../../scripts/persona/aics-persona-runner.mjs";
import { collectPlaywrightEvidence } from "../../scripts/persona/aics-playwright-persona.mjs";
import {
  renderCompletionAuditMarkdown,
  runCompletionAudit,
} from "../../scripts/persona/aics-production-plus-completion-audit.mjs";
import {
  completeSyntheticEvidence,
  runGateRegression,
} from "../../scripts/persona/aics-production-plus-gate-regression.mjs";
import {
  parseOrchestratorArgs,
  runProductionPlusOrchestrator,
} from "../../scripts/persona/aics-production-plus-orchestrator.mjs";
import {
  evaluateReadiness,
  evaluateReadinessWithEndpointProbes,
  hydrateReadinessEnvFromConfig,
  renderReadinessEnvTemplate,
  renderReadinessMarkdown,
} from "../../scripts/persona/aics-production-plus-readiness.mjs";
import { buildSelectorCoverageReport } from "../../scripts/persona/aics-selector-coverage.mjs";

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000000000000000000049454e44ae426082",
  "hex",
);

function writeEvidence(dir: string, evidence = completeSyntheticEvidence()): string {
  const screenshotsDir = join(dir, "screenshots");
  mkdirSync(screenshotsDir, { recursive: true });
  writeFileSync(join(dir, "persona-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(join(screenshotsDir, "shot.png"), PNG_BYTES);
  writeFileSync(
    join(dir, "actions.ndjson"),
    (evidence.proof?.actionTrace ?? [])
      .map((action: unknown) => JSON.stringify(action))
      .join("\n") + (evidence.proof?.actionTrace?.length ? "\n" : ""),
  );
  writeFileSync(join(dir, "console.ndjson"), "");
  writeFileSync(join(dir, "network-summary.ndjson"), "");
  return join(dir, "persona-evidence.json");
}

function finalManifest() {
  return {
    productionPlusFinal: true,
    rolePackageId: "pkg_123",
    rolePackageVersion: "1.0.0",
    roleListingId: "role_123",
    reviewId: "review_123",
    entitlementId: "ent_123",
    executionId: "exec_123",
    auditRecordId: "audit_123",
    ledgerEntryId: "ledger_123",
    coverage: {
      freshApiSeed: true,
      developerPackageSubmit: true,
      adminReviewPublish: true,
      buyerAuthorizationOrCheckout: true,
      userCenterCloudExecution: true,
      openclawLocalSync: true,
      openclawLocalExecution: true,
      auditUpload: true,
      ledgerReadback: true,
      receivablesReadback: true,
      crossActorNegatives: true,
      apiIdCapture: true,
      screenshots: true,
      apiModelPricing: true,
      apiMeteringReadback: true,
      apiUsageAttribution: true,
    },
    modelTokenBilling: {
      status: "passed",
      apiConnectionId: "model-openai",
      provider: "openai",
      model: "gpt-5.5",
      pricing: {
        currency: "CNY",
        unit: "1M_tokens",
        inputCnyPerMillion: 8,
        outputCnyPerMillion: 32,
      },
      inputTokens: 1680,
      outputTokens: 720,
      totalTokens: 2400,
      costCny: 0.03648,
      byConsumer: {
        role_execution: {
          calls: 1,
          inputTokens: 1280,
          outputTokens: 620,
          totalTokens: 1900,
          costCny: 0.03008,
        },
        local_dialog: {
          calls: 1,
          inputTokens: 400,
          outputTokens: 100,
          totalTokens: 500,
          costCny: 0.0064,
        },
      },
    },
  };
}

function writeSelectorSourceFixture(dir: string): string {
  const report = buildSelectorCoverageReport({ cwd: dir, sourceRoots: ["."] });
  const selectorIds = report.selectors.map((entry: { id: string }) => entry.id);
  writeFileSync(
    join(dir, "selectors.tsx"),
    selectorIds.map((id: string) => `<div data-testid="${id}" />`).join("\n"),
  );
  return dir;
}

function readyProductionPlusEnv() {
  return {
    DIJIE_CLOUD_BASE_URL: "http://cloud.test",
    OPENCLAW_LOCAL_URL: "http://openclaw.test",
    DIJIE_INTERNAL_BRIDGE_BEARER: "internal-token",
    DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM:
      "-----BEGIN PUBLIC KEY-----\\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALocalTestOnlyPersonaReadinessKey\\n-----END PUBLIC KEY-----",
    DIJIE_VENDOR_ACCESS_TOKEN: "vendor-token",
    DIJIE_ADMIN_ACCESS_TOKEN: "admin-token",
    DIJIE_BUYER_ACCESS_TOKEN: "buyer-token",
  };
}

function writeCompletionAuditRun(
  dir: string,
  options: {
    readinessStatus?: "ready" | "blocked";
    evidence?: Record<string, unknown>;
  } = {},
) {
  const runId = "completion-audit-run";
  const evidence = {
    ...(options.evidence ?? completeSyntheticEvidence()),
    runId,
    startedAt: "2026-06-16T00:00:00.000Z",
    endedAt: "2026-06-16T00:00:01.000Z",
  };
  const personaEvidenceDir = join(dir, "persona-evidence");
  const personaEvidencePath = writeEvidence(personaEvidenceDir, evidence);
  const gate = evaluateProductionPlusEvidence(evidence, {
    evidencePath: personaEvidencePath,
    runId,
  });
  writeRunArtifacts(gate, dir);
  mkdirSync(join(dir, "selector-coverage"), { recursive: true });
  writeFileSync(
    join(dir, "selector-coverage", "selector-coverage.json"),
    `${JSON.stringify(
      {
        status: "covered",
        generatedAt: "2026-06-16T00:00:00.000Z",
        sourceRoots: ["ui/src"],
        scannedFileCount: 1,
        requiredSelectorCount: 19,
        coveredSelectorCount: 19,
        missingSelectorCount: 0,
        selectors: [],
      },
      null,
      2,
    )}\n`,
  );
  mkdirSync(join(dir, "readiness"), { recursive: true });
  writeFileSync(
    join(dir, "readiness", "readiness.json"),
    `${JSON.stringify(
      {
        status: options.readinessStatus ?? "ready",
        generatedAt: "2026-06-16T00:00:00.000Z",
        checks:
          options.readinessStatus === "blocked"
            ? [{ name: "DIJIE_CLOUD_BASE_URL", status: "blocked", reason: "missing" }]
            : [
                { name: "DIJIE_CLOUD_BASE_URL", status: "passed" },
                { name: "OPENCLAW_LOCAL_URL", status: "passed" },
                { name: "DIJIE_CLOUD_BASE_URL reachable", status: "passed", statusCode: 200 },
                { name: "OPENCLAW_LOCAL_URL reachable", status: "passed", statusCode: 200 },
              ],
      },
      null,
      2,
    )}\n`,
  );
  const seed = { ids: completeSyntheticEvidence().ids, runId };
  const manifest = buildFinalManifest({ seed, runId });
  writeFileSync(join(dir, "resolved-seed.json"), `${JSON.stringify(seed, null, 2)}\n`);
  writeFileSync(
    join(dir, "final-manifest.resolved.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, "run-metadata.validation.json"),
    `${JSON.stringify({ status: "valid", mismatches: [], errors: [] }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, "final-manifest.validation.json"),
    `${JSON.stringify(validateFinalManifest(manifest, seed), null, 2)}\n`,
  );
  writeFileSync(
    join(dir, "playwright-config.json"),
    `${JSON.stringify(
      buildPlaywrightConfig({
        seed,
        baseUrl: "http://cloud.test",
        openclawUrl: "http://openclaw.test",
        productionPlusFinal: true,
        finalManifest: manifest,
      }),
      null,
      2,
    )}\n`,
  );
  return { gate, personaEvidencePath };
}

function apiConnectionsBillingReadback() {
  return {
    readModel: {
      entries: [
        {
          id: "model-openai",
          kind: "model",
          provider: "openai",
          metadata: {
            defaultModel: "gpt-5.5",
            pricing: {
              currency: "CNY",
              unit: "1M_tokens",
              inputCnyPerMillion: 8,
              outputCnyPerMillion: 32,
            },
            metering: {
              calls: 2,
              inputTokens: 1680,
              outputTokens: 720,
              totalTokens: 2400,
              costCny: 0.03648,
              byConsumer: {
                role_execution: {
                  calls: 1,
                  inputTokens: 1280,
                  outputTokens: 620,
                  totalTokens: 1900,
                  costCny: 0.03008,
                },
                local_dialog: {
                  calls: 1,
                  inputTokens: 400,
                  outputTokens: 100,
                  totalTokens: 500,
                  costCny: 0.0064,
                },
              },
            },
          },
        },
      ],
    },
  };
}

function fakePlaywright(
  options: {
    bodyText?: string;
    apiJson?: Record<string, unknown>;
    apiConnectionsJson?: Record<string, unknown> | null;
    networkUrl?: string;
    fetchedUrls?: string[];
    visitedUrls?: string[];
  } = {},
) {
  return {
    chromium: {
      launch: async () => ({
        newContext: async () => {
          const handlers: Record<string, Array<(value: unknown) => void>> = {};
          return {
            request: {
              fetch: async (url: string, init: { method?: string } = {}) => {
                options.fetchedUrls?.push(String(url));
                return {
                  status: () => {
                    if (String(url).includes("/aics/api-connections/read-model")) return 200;
                    if (String(url).includes("/executions/") && (init.method ?? "GET") === "GET")
                      return 200;
                    if (String(url).includes("/ledger/")) return 200;
                    return 403;
                  },
                  json: async () => {
                    if (options.apiJson) return options.apiJson;
                    if (String(url).includes("/aics/api-connections/read-model")) {
                      return options.apiConnectionsJson === null
                        ? {}
                        : (options.apiConnectionsJson ?? apiConnectionsBillingReadback());
                    }
                    if (String(url).includes("/executions/")) return { auditRecordId: "audit_123" };
                    if (String(url).includes("/ledger/")) return { ledgerEntryId: "ledger_123" };
                    return {};
                  },
                };
              },
            },
            newPage: async () => ({
              on: (event: string, handler: (value: unknown) => void) => {
                handlers[event] ??= [];
                handlers[event]!.push(handler);
              },
              goto: async (url: string) => {
                options.visitedUrls?.push(String(url));
                handlers.console?.forEach((handler) =>
                  handler({
                    type: () => "log",
                    text: () => "developer page loaded",
                  }),
                );
                handlers.response?.forEach((handler) =>
                  handler({
                    status: () => 200,
                    url: () => options.networkUrl ?? "http://cloud.test/vendor/dijie/role-listings",
                  }),
                );
              },
              textContent: async () =>
                options.bodyText ??
                "OpenClaw 岗位 审核 执行 账本 API 管理 模型定价 输入 Token 单价 输出 Token 单价 手动输入模型 ID 模型验证 提供给 API 列表与计量 模型 Token 费用读回 岗位执行 gpt-5.5 ¥0.03",
              locator: () => ({ count: async () => 1 }),
              screenshot: async ({ path }: { path: string }) => writeFileSync(path, PNG_BYTES),
              click: async () => undefined,
              fill: async () => undefined,
              check: async () => undefined,
              uncheck: async () => undefined,
              press: async () => undefined,
              selectOption: async () => undefined,
              waitForSelector: async () => undefined,
              waitForURL: async () => undefined,
              waitForTimeout: async () => undefined,
            }),
            close: async () => undefined,
          };
        },
        close: async () => undefined,
      }),
    },
  };
}

describe("AICS production-plus persona gate", () => {
  it("passes only complete synthetic evidence with a real PNG proof artifact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aics-persona-test-"));
    const evidencePath = writeEvidence(dir);

    const result = evaluateProductionPlusEvidence(completeSyntheticEvidence(), { evidencePath });

    expect(result.verdict).toBe("production_plus_passed");
    expect(result.gates.every((gate) => gate.status === "passed")).toBe(true);
  });

  it("rejects screenshot artifacts that only contain a PNG signature", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aics-persona-bad-screenshot-"));
    const evidencePath = writeEvidence(dir);
    writeFileSync(
      join(dir, "screenshots", "shot.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const result = evaluateProductionPlusEvidence(completeSyntheticEvidence(), { evidencePath });
    const screenshotGate = result.gates.find((item: { id: string }) => item.id === "screenshots");

    expect(result.verdict).toBe("failed");
    expect(screenshotGate).toMatchObject({
      status: "failed",
      screenshotArtifactDetails: [
        expect.objectContaining({ valid: false, reason: "missing_ihdr" }),
      ],
    });
  });

  it("rejects screenshot evidence when declared count does not match retained valid artifacts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aics-persona-missing-screenshot-count-"));
    const evidence = completeSyntheticEvidence();
    evidence.proof.screenshotCount = 2;
    const evidencePath = writeEvidence(dir, evidence);

    const result = evaluateProductionPlusEvidence(evidence, { evidencePath });
    const screenshotGate = result.gates.find((item: { id: string }) => item.id === "screenshots");

    expect(result.verdict).toBe("failed");
    expect(screenshotGate).toMatchObject({
      status: "failed",
      declaredScreenshotCount: 2,
      screenshotArtifactCount: 1,
      validScreenshotArtifactCount: 1,
      screenshotArtifactCountsMatch: false,
    });
  });

  it("fails production-plus when console/network artifacts are missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aics-persona-no-console-network-"));
    const screenshotsDir = join(dir, "screenshots");
    mkdirSync(screenshotsDir, { recursive: true });
    const evidencePath = join(dir, "persona-evidence.json");
    writeFileSync(evidencePath, `${JSON.stringify(completeSyntheticEvidence(), null, 2)}\n`);
    writeFileSync(join(screenshotsDir, "shot.png"), PNG_BYTES);

    const result = evaluateProductionPlusEvidence(completeSyntheticEvidence(), { evidencePath });

    expect(result.verdict).toBe("failed");
    const gate = result.gates.find((item: { id: string }) => item.id === "console_network_clean");
    expect(gate?.status).toBe("failed");
    expect(gate?.consoleArtifact.exists).toBe(false);
    expect(gate?.networkSummaryArtifact.exists).toBe(false);
  });

  it("fails fake browser evidence and turns gaps into remediation", () => {
    const result = evaluateProductionPlusEvidence({
      ...completeSyntheticEvidence(),
      source: "dry-run",
      realBrowser: false,
      realApplication: false,
    });

    expect(result.verdict).toBe("failed");
    expect(result.gates.find((gate) => gate.id === "real_browser_application")?.status).toBe(
      "failed",
    );
  });

  it("fails malformed evidence instead of normalizing missing schema fields into a pass", () => {
    const malformed = completeSyntheticEvidence();
    delete (malformed as { schemaVersion?: number }).schemaVersion;
    delete (malformed as { secretScan?: unknown }).secretScan;
    malformed.consoleErrorCount = "0";
    malformed.proof = { actionCount: "2", actionTrace: "not-array" };
    malformed.personas[0]!.status = "done";

    const result = evaluateProductionPlusEvidence(malformed);

    expect(validatePersonaEvidenceSchema(malformed)).toEqual(
      expect.arrayContaining([
        "schemaVersion must be 2",
        "secretScan.leakCount must be a non-negative number",
        "consoleErrorCount must be a non-negative number when present",
        "proof.actionCount must be a non-negative number when present",
        "proof.actionTrace must be an array when present",
        "personas[0].status must be passed/failed/blocked",
      ]),
    );
    expect(result.verdict).toBe("failed");
    expect(result.gates.find((gate) => gate.id === "schema_contract")?.status).toBe("failed");
    expect(result.gates.find((gate) => gate.id === "schema_v2")?.status).toBe("failed");
  });

  it("fails malformed evidence when proof is missing", () => {
    const malformed = completeSyntheticEvidence();
    delete (malformed as { proof?: unknown }).proof;

    expect(validatePersonaEvidenceSchema(malformed)).toEqual(
      expect.arrayContaining(["proof must be an object"]),
    );
    expect(evaluateProductionPlusEvidence(malformed).verdict).toBe("failed");
  });

  it("treats missing or loose OpenClaw main chat evidence as a schema error", () => {
    const missing = completeSyntheticEvidence();
    delete (missing as { openclawMainChat?: unknown }).openclawMainChat;
    expect(validatePersonaEvidenceSchema(missing)).toEqual(
      expect.arrayContaining(["openclawMainChat must be an object"]),
    );

    const loose = completeSyntheticEvidence();
    loose.openclawMainChat = { status: "provider-config-blocked" };
    expect(validatePersonaEvidenceSchema(loose)).toEqual(
      expect.arrayContaining([
        "openclawMainChat.path must be main_chat",
        "openclawMainChat.source must be playwright/api_readback/dry-run/self-check/missing",
        "openclawMainChat.blockedReason must be an object when provider-config-blocked",
      ]),
    );
    expect(evaluateProductionPlusEvidence(loose).verdict).toBe("failed");
  });

  it("treats missing or malformed model token billing as a schema error", () => {
    const missing = completeSyntheticEvidence();
    delete (missing as { modelTokenBilling?: unknown }).modelTokenBilling;
    expect(validatePersonaEvidenceSchema(missing)).toEqual(
      expect.arrayContaining(["modelTokenBilling must be present as object or null"]),
    );
    expect(evaluateProductionPlusEvidence(missing).verdict).toBe("failed");

    const malformed = completeSyntheticEvidence();
    malformed.modelTokenBilling = {
      source: "manifest",
      status: "done",
      inputTokens: -1,
      pricing: [],
      byConsumer: null,
    };
    expect(validatePersonaEvidenceSchema(malformed)).toEqual(
      expect.arrayContaining([
        "modelTokenBilling.source must be api_readback",
        "modelTokenBilling.status must be passed/failed/blocked",
        "modelTokenBilling.pricing must be an object when present",
        "modelTokenBilling.byConsumer must be an object when present",
        "modelTokenBilling.inputTokens must be a non-negative number when present",
      ]),
    );
    expect(evaluateProductionPlusEvidence(malformed).verdict).toBe("failed");
  });

  it("keeps JSON schema required fields aligned with runner evidence fixtures", () => {
    const schema = JSON.parse(readFileSync("scripts/persona/evidence-schema.json", "utf-8"));
    const required = new Set(schema.required);
    const contractFields = [
      "openclawMainChat",
      "localPageProbes",
      "modelTokenBilling",
      "secretScan",
    ];

    for (const field of contractFields) {
      expect(required.has(field)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(completeSyntheticEvidence(), field)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(dryRunEvidence(), field)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(selfCheckEvidence(), field)).toBe(true);
    }
    expect(validatePersonaEvidenceSchema(completeSyntheticEvidence())).toEqual([]);
  });

  it("keeps generated non-production evidence schema-valid while still failing production gates", () => {
    for (const evidence of [dryRunEvidence(), selfCheckEvidence()]) {
      const result = evaluateProductionPlusEvidence(evidence);

      expect(evidence.modelTokenBilling).toBeNull();
      expect(validatePersonaEvidenceSchema(evidence)).toEqual([]);
      expect(result.verdict).toBe("failed");
      expect(result.gates.find((gate) => gate.id === "schema_contract")?.status).toBe("passed");
      expect(result.gates.find((gate) => gate.id === "real_browser_application")?.status).toBe(
        "failed",
      );
    }
  });

  it("writes evidence and remediation artifacts from the CLI runner", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "aics-persona-source-"));
    const outDir = mkdtempSync(join(tmpdir(), "aics-persona-out-"));
    const evidencePath = writeEvidence(sourceDir);

    const { result, artifacts } = runPersonaGate(
      parseRunnerArgs(["--persona-evidence", evidencePath, "--output-dir", outDir]),
    );

    expect(result.verdict).toBe("production_plus_passed");
    const artifactEvidence = JSON.parse(readFileSync(artifacts.evidencePath, "utf-8"));
    expect(artifactEvidence.verdict).toBe("production_plus_passed");
    expect(artifactEvidence.source).toBe("playwright");
    expect(artifactEvidence.realBrowser).toBe(true);
    expect(artifactEvidence.realApplication).toBe(true);
    expect(artifactEvidence.finalProbes.screenshots).toBe(true);
    expect(artifactEvidence.secretScan.leakCount).toBe(0);
    expect(artifactEvidence.schemaErrors).toEqual([]);
    const remediation = JSON.parse(readFileSync(artifacts.remediationPath, "utf-8"));
    expect(remediation.completionAudit).toMatchObject({
      objective: "拟人化测试超过生产级",
      status: "achieved",
      verdict: "production_plus_passed",
      missingGateIds: [],
    });
    expect(remediation.implementationPlan).toMatchObject({
      status: "complete",
      sourceVerdict: "production_plus_passed",
      ungrouped: [],
    });
    expect(
      remediation.implementationPlan.groups.every(
        (group: { status: string }) => group.status === "covered",
      ),
    ).toBe(true);
    const remediationMarkdown = readFileSync(artifacts.remediationMarkdownPath, "utf-8");
    expect(remediationMarkdown).toContain("## Completion Audit");
    expect(remediationMarkdown).toContain("All production-plus gates passed.");
  });

  it("writes completion audit gaps for non-production dry-run evidence", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-persona-dry-audit-"));

    const { result, artifacts } = runPersonaGate(
      parseRunnerArgs(["--dry-run", "--run-id", "dry-audit-run", "--output-dir", outDir]),
    );
    const remediation = JSON.parse(readFileSync(artifacts.remediationPath, "utf-8"));

    expect(result.verdict).toBe("failed");
    expect(remediation.completionAudit).toMatchObject({
      objective: "拟人化测试超过生产级",
      status: "not_achieved",
      verdict: "failed",
    });
    expect(remediation.completionAudit.missingGateIds).toEqual(
      expect.arrayContaining(["real_browser_application", "model_token_billing_readback"]),
    );
    expect(remediation.implementationPlan).toMatchObject({
      status: "needs_work",
      sourceVerdict: "failed",
      ungrouped: [],
    });
    expect(remediation.implementationPlan.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "runtime_environment",
          status: "blocked",
          gates: expect.arrayContaining([
            expect.objectContaining({ id: "real_browser_application" }),
          ]),
        }),
        expect.objectContaining({
          id: "readback_traceability",
          status: "blocked",
          gates: expect.arrayContaining([
            expect.objectContaining({ id: "model_token_billing_readback" }),
          ]),
        }),
        expect.objectContaining({
          id: "openclaw_local_surfaces",
          status: "blocked",
          gates: expect.arrayContaining([
            expect.objectContaining({ id: "api_management_model_pricing_page" }),
            expect.objectContaining({ id: "billing_page_model_metering" }),
          ]),
        }),
      ]),
    );
    expect(remediation.implementationPlan.nextCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("aics-production-plus-readiness.mjs"),
        expect.stringContaining("aics-final-manifest.mjs --validate"),
        expect.stringContaining("aics-production-plus-orchestrator.mjs"),
        expect.stringContaining("--seed-file"),
        expect.stringContaining("--probe-endpoints"),
      ]),
    );
    expect(remediation.implementationPlan.nextCommands.join("\n")).not.toContain(
      "--api-seed --production-plus-final",
    );
    expect(remediation.nextCommandPath).toContain("--seed-file");
    expect(remediation.nextCommandPath).not.toContain("--api-seed");
    const remediationMarkdown = readFileSync(artifacts.remediationMarkdownPath, "utf-8");
    expect(remediationMarkdown).toContain("- status: `not_achieved`");
    expect(remediationMarkdown).toContain("## Implementation Plan");
    expect(remediationMarkdown).toContain("## Next Commands");
    expect(remediationMarkdown).toContain("aics-final-manifest.mjs --validate");
    expect(remediationMarkdown).toContain("--seed-file");
  });

  it("audits a complete production-plus run directory", () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-completion-audit-complete-"));
    writeCompletionAuditRun(outDir);

    const audit = runCompletionAudit({ runDir: outDir });

    expect(audit.status).toBe("complete");
    expect(audit.failedCheckIds).toEqual([]);
    expect(audit.checks.every((check: { status: string }) => check.status === "passed")).toBe(true);
    expect(renderCompletionAuditMarkdown(audit)).toContain("production-plus completion audit");
  });

  it("fails completion audit when persona artifacts are missing", () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-completion-audit-missing-artifact-"));
    writeCompletionAuditRun(outDir);
    rmSync(join(outDir, "persona-evidence", "actions.ndjson"));

    const audit = runCompletionAudit({ runDir: outDir });

    expect(audit.status).toBe("incomplete");
    expect(audit.failedCheckIds).toEqual(
      expect.arrayContaining(["persona_evidence", "persona_artifacts"]),
    );
    expect(audit.missingArtifacts).toContain("persona-evidence/actions.ndjson");
  });

  it("fails completion audit when final manifest does not match raw evidence readback", () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-completion-audit-manifest-mismatch-"));
    writeCompletionAuditRun(outDir);
    const manifestPath = join(outDir, "final-manifest.resolved.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.roleListingId = "different_role_listing";
    manifest.modelTokenBilling.costCny = 999;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const audit = runCompletionAudit({ runDir: outDir });
    const manifestCheck = audit.checks.find((item: { id: string }) => item.id === "final_manifest");

    expect(audit.status).toBe("incomplete");
    expect(audit.failedCheckIds).toContain("final_manifest");
    expect(manifestCheck).toMatchObject({
      status: "failed",
      evidence: {
        idMismatches: expect.arrayContaining(["roleListingId"]),
        billingMismatches: expect.arrayContaining(["costCny"]),
      },
    });
  });

  it("fails completion audit when run ids or timestamps do not describe one coherent run", () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-completion-audit-run-metadata-"));
    writeCompletionAuditRun(outDir);
    const rawEvidencePath = join(outDir, "persona-evidence", "persona-evidence.json");
    const rawEvidence = JSON.parse(readFileSync(rawEvidencePath, "utf-8"));
    rawEvidence.runId = "different-run";
    rawEvidence.endedAt = "2026-06-16T00:00:00.000Z";
    rawEvidence.startedAt = "2026-06-16T01:00:00.000Z";
    writeFileSync(rawEvidencePath, `${JSON.stringify(rawEvidence, null, 2)}\n`);

    const audit = runCompletionAudit({ runDir: outDir });
    const metadataCheck = audit.checks.find((item: { id: string }) => item.id === "run_metadata");

    expect(audit.status).toBe("incomplete");
    expect(audit.failedCheckIds).toContain("run_metadata");
    expect(metadataCheck).toMatchObject({
      status: "failed",
      evidence: {
        validationStatus: "valid",
        uniqueRunIds: expect.arrayContaining(["completion-audit-run", "different-run"]),
        timestampErrors: expect.arrayContaining(["rawEvidence.ended_before_started"]),
      },
    });
  });

  it("fails completion audit when top-level gate evidence is older than raw evidence", () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-completion-audit-run-metadata-time-order-"));
    writeCompletionAuditRun(outDir);
    const topEvidencePath = join(outDir, "evidence.json");
    const topEvidence = JSON.parse(readFileSync(topEvidencePath, "utf-8"));
    topEvidence.startedAt = "2026-06-16T00:00:02.000Z";
    topEvidence.endedAt = "2026-06-16T00:00:00.500Z";
    writeFileSync(topEvidencePath, `${JSON.stringify(topEvidence, null, 2)}\n`);

    const audit = runCompletionAudit({ runDir: outDir });
    const metadataCheck = audit.checks.find((item: { id: string }) => item.id === "run_metadata");

    expect(audit.status).toBe("incomplete");
    expect(audit.failedCheckIds).toContain("run_metadata");
    expect(metadataCheck).toMatchObject({
      status: "failed",
      evidence: {
        timestampErrors: expect.arrayContaining([
          "topEvidence.startedAt_mismatch",
          "topEvidence.ended_before_started",
          "topEvidence.ended_before_rawEvidence_ended",
        ]),
      },
    });
  });

  it("fails completion audit when run metadata validation artifact is missing or invalid", () => {
    const missingDir = mkdtempSync(join(tmpdir(), "aics-completion-audit-run-metadata-missing-"));
    writeCompletionAuditRun(missingDir);
    rmSync(join(missingDir, "run-metadata.validation.json"));

    const missingAudit = runCompletionAudit({ runDir: missingDir });
    expect(missingAudit.status).toBe("incomplete");
    expect(missingAudit.failedCheckIds).toContain("run_metadata");
    expect(
      missingAudit.checks.find((item: { id: string }) => item.id === "run_metadata"),
    ).toMatchObject({
      evidence: { missingArtifacts: expect.arrayContaining(["run-metadata.validation.json"]) },
    });

    const invalidDir = mkdtempSync(join(tmpdir(), "aics-completion-audit-run-metadata-invalid-"));
    writeCompletionAuditRun(invalidDir);
    writeFileSync(
      join(invalidDir, "run-metadata.validation.json"),
      `${JSON.stringify(
        {
          status: "invalid",
          mismatches: [{ artifact: "seed", expected: "completion-audit-run", actual: "other-run" }],
          errors: ["seed runId other-run does not match current runId completion-audit-run"],
        },
        null,
        2,
      )}\n`,
    );

    const invalidAudit = runCompletionAudit({ runDir: invalidDir });
    const metadataCheck = invalidAudit.checks.find(
      (item: { id: string }) => item.id === "run_metadata",
    );
    expect(invalidAudit.status).toBe("incomplete");
    expect(invalidAudit.failedCheckIds).toContain("run_metadata");
    expect(metadataCheck).toMatchObject({
      evidence: {
        validationStatus: "invalid",
        validationMismatchCount: 1,
      },
    });
    const markdown = renderCompletionAuditMarkdown(invalidAudit);
    expect(markdown).not.toContain("[object Object]");
    expect(markdown).toContain('"artifact":"seed"');
  });

  it("fails completion audit when readiness is blocked or the final gate failed", () => {
    const blockedReadinessDir = mkdtempSync(
      join(tmpdir(), "aics-completion-audit-readiness-blocked-"),
    );
    writeCompletionAuditRun(blockedReadinessDir, { readinessStatus: "blocked" });

    const blockedReadinessAudit = runCompletionAudit({ runDir: blockedReadinessDir });

    expect(blockedReadinessAudit.status).toBe("incomplete");
    expect(blockedReadinessAudit.failedCheckIds).toContain("readiness");

    const failedGateDir = mkdtempSync(join(tmpdir(), "aics-completion-audit-failed-gate-"));
    writeCompletionAuditRun(failedGateDir, { evidence: dryRunEvidence() });

    const failedGateAudit = runCompletionAudit({ runDir: failedGateDir });

    expect(failedGateAudit.status).toBe("incomplete");
    expect(failedGateAudit.failedCheckIds).toEqual(
      expect.arrayContaining(["persona_evidence", "final_gate"]),
    );
  });

  it("runs the no-key gate regression suite", () => {
    expect(runGateRegression().complete.verdict).toBe("production_plus_passed");
  });

  it("fails production-plus when model token billing readback is missing", () => {
    const evidence = completeSyntheticEvidence();
    delete (evidence as { modelTokenBilling?: unknown }).modelTokenBilling;
    evidence.finalProbes.apiMeteringReadback = false;

    const result = evaluateProductionPlusEvidence(evidence);

    expect(result.verdict).toBe("failed");
    const gate = result.gates.find(
      (item: { id: string }) => item.id === "model_token_billing_readback",
    );
    expect(gate?.status).toBe("failed");
    expect(gate?.missingModelTokenBillingProbes).toContain("apiMeteringReadback");
  });

  it("fails production-plus when OpenClaw main chat evidence is only a loose status", () => {
    const evidence = completeSyntheticEvidence();
    evidence.openclawMainChat = { status: "provider-config-blocked" };

    const result = evaluateProductionPlusEvidence(evidence);

    expect(result.verdict).toBe("failed");
    const gate = result.gates.find((item: { id: string }) => item.id === "openclaw_main_chat_path");
    expect(gate?.status).toBe("failed");
    expect(gate?.openclawMainChat).toEqual({ status: "provider-config-blocked" });
  });

  it("fails production-plus when persona action trace is missing", () => {
    const evidence = completeSyntheticEvidence();
    evidence.proof.actionCount = 0;
    evidence.proof.actionTrace = [];

    const result = evaluateProductionPlusEvidence(evidence);

    expect(result.verdict).toBe("failed");
    const gate = result.gates.find((item: { id: string }) => item.id === "persona_action_trace");
    expect(gate?.status).toBe("failed");
    expect(gate?.missingActionTracePersonas).toEqual(expect.arrayContaining(STANDARD_PERSONAS));
  });

  it("fails production-plus when actions artifact does not cover the same personas", () => {
    const dir = mkdtempSync(join(tmpdir(), "aics-persona-bad-actions-artifact-"));
    const evidence = completeSyntheticEvidence();
    const evidencePath = writeEvidence(dir, evidence);
    writeFileSync(
      join(dir, "actions.ndjson"),
      evidence.proof.actionTrace
        .map((action: Record<string, unknown>) =>
          JSON.stringify({ ...action, persona: "developer" }),
        )
        .join("\n") + "\n",
    );

    const result = evaluateProductionPlusEvidence(evidence, { evidencePath });

    expect(result.verdict).toBe("failed");
    const gate = result.gates.find((item: { id: string }) => item.id === "persona_action_trace");
    expect(gate?.status).toBe("failed");
    expect(gate?.missingActionTracePersonas).toEqual([]);
    expect(gate?.missingActionArtifactPersonas).toContain("admin_reviewer");
  });

  it("does not accept final manifest model billing as runtime readback evidence", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-playwright-no-billing-readback-"));
    const config = buildPlaywrightConfig({
      seed: {
        ids: {
          rolePackageId: "pkg_123",
          rolePackageVersion: "1.0.0",
          roleListingId: "role_123",
          reviewId: "review_123",
          entitlementId: "ent_123",
          executionId: "exec_123",
          auditRecordId: "audit_123",
          ledgerEntryId: "ledger_123",
        },
      },
      baseUrl: "http://cloud.test",
      openclawUrl: "http://openclaw.test",
      productionPlusFinal: true,
      finalManifest: finalManifest(),
    });
    config.personas[0]!.actions = [
      { type: "click", selector: '[data-testid="aics-vendor-role-packages"]' },
      {
        type: "fill",
        selector: '[data-testid="aics-vendor-package-title"]',
        value: "confidential package draft",
      },
      { type: "waitForURL", url: "http://cloud.test/vendor/dijie" },
    ];

    const evidence = await collectPlaywrightEvidence(config, {
      playwright: fakePlaywright({ apiConnectionsJson: null }),
      out: join(outDir, "persona-evidence.json"),
    });
    const result = evaluateProductionPlusEvidence(evidence, {
      evidencePath: join(outDir, "persona-evidence.json"),
    });

    expect(evidence.modelTokenBilling).toBeNull();
    expect(result.verdict).toBe("failed");
    expect(
      result.gates.find((item: { id: string }) => item.id === "model_token_billing_readback")
        ?.status,
    ).toBe("failed");
  });

  it("checks readiness without exposing token values", () => {
    const readiness = evaluateReadiness({
      DIJIE_CLOUD_BASE_URL: "http://127.0.0.1:3000",
      OPENCLAW_LOCAL_URL: "http://127.0.0.1:4000",
      DIJIE_INTERNAL_BRIDGE_BEARER: "secret-token",
      DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM:
        "-----BEGIN PUBLIC KEY-----\\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALocalTestOnlyPersonaReadinessKey\\n-----END PUBLIC KEY-----",
      DIJIE_VENDOR_ACCESS_TOKEN: "vendor-token",
      DIJIE_ADMIN_ACCESS_TOKEN: "admin-token",
      DIJIE_BUYER_ACCESS_TOKEN: "buyer-token",
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.blockedChecks).toEqual([]);
    expect(readiness.nextRequiredEnv).toEqual([]);
    expect(readiness.operatorSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "运行最终验收",
          status: "ready",
          action: expect.stringContaining("production_plus_passed"),
        }),
      ]),
    );
    expect(readiness.operatorChecklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "运行最终验收",
          status: "ready",
          commandHint: expect.stringContaining("aics-production-plus-readiness.mjs"),
        }),
      ]),
    );
    expect(JSON.stringify(readiness)).not.toContain("secret-token");
    expect(JSON.stringify(readiness)).not.toContain("vendor-token");
  });

  it("hydrates production-plus readiness from API management config without exposing secrets", () => {
    const config = {
      secrets: {
        providers: {},
      },
      apiConnections: {
        entries: {
          "marketplace-dijie-cloud-bridge": {
            kind: "marketplace",
            provider: "dijie-cloud-bridge",
            baseUrl: "https://cloud.example/private",
            authMode: "plaintext",
            secret: "cloud-secret-token",
            enabled: true,
          },
        },
      },
      plugins: {
        entries: {
          aics: {
            config: {
              cloudApiVariablesSyncBearer: "bridge-secret-token",
              executionTokenPublicKeyPem:
                "-----BEGIN PUBLIC KEY-----\\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALocalTestOnlyPersonaReadinessKey\\n-----END PUBLIC KEY-----",
            },
          },
        },
      },
    };

    const hydrated = hydrateReadinessEnvFromConfig(
      { OPENCLAW_LOCAL_URL: "http://127.0.0.1:4000" },
      { config, configPath: "/tmp/openclaw.json" },
    );
    const readiness = evaluateReadiness(
      { OPENCLAW_LOCAL_URL: "http://127.0.0.1:4000" },
      { hydratedEnv: hydrated },
    );
    const readinessText = JSON.stringify(readiness);

    expect(readiness.status).toBe("ready");
    expect(readiness.configHydration).toEqual({
      configPath: "/tmp/openclaw.json",
      hydratedEnv: [
        "DIJIE_CLOUD_BASE_URL",
        "DIJIE_CLOUD_ACCESS_TOKEN",
        "DIJIE_INTERNAL_BRIDGE_BEARER",
        "DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM",
      ],
    });
    expect(readinessText).not.toContain("cloud-secret-token");
    expect(readinessText).not.toContain("bridge-secret-token");
    expect(readinessText).not.toContain("cloud.example/private");
  });

  it("blocks readiness for invalid URLs or public key PEM without exposing values", () => {
    const readiness = evaluateReadiness({
      DIJIE_CLOUD_BASE_URL: "not-a-url",
      OPENCLAW_LOCAL_URL: "ftp://127.0.0.1:4000",
      DIJIE_INTERNAL_BRIDGE_BEARER: "secret-token",
      DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM: "not a pem",
      DIJIE_CLOUD_ACCESS_TOKEN: "cloud-token",
    });

    const readinessText = JSON.stringify(readiness);
    expect(readiness.status).toBe("blocked");
    expect(readiness.nextRequiredEnv).toEqual(
      expect.arrayContaining([
        "DIJIE_CLOUD_BASE_URL",
        "OPENCLAW_LOCAL_URL",
        "DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM",
      ]),
    );
    expect(readiness.blockedChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "DIJIE_CLOUD_BASE_URL",
          reason: "must_be_http_or_https_url",
        }),
        expect.objectContaining({
          label: "OPENCLAW_LOCAL_URL",
          reason: "must_be_http_or_https_url",
        }),
      ]),
    );
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "DIJIE_CLOUD_BASE_URL",
          status: "blocked",
          reason: "must_be_http_or_https_url",
        }),
        expect.objectContaining({
          name: "OPENCLAW_LOCAL_URL",
          status: "blocked",
          reason: "must_be_http_or_https_url",
        }),
        expect.objectContaining({
          name: "DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM",
          status: "blocked",
          reason: "must_be_public_key_pem",
        }),
      ]),
    );
    expect(readiness.operatorChecklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "1. 连接两个地址",
          status: "blocked",
          requiredInputs: expect.arrayContaining(["DIJIE_CLOUD_BASE_URL", "OPENCLAW_LOCAL_URL"]),
          requiredInputLabels: expect.arrayContaining([
            "云端商城 API 地址",
            "本地 OpenClaw UI 地址",
          ]),
          commandHint: expect.stringContaining("aics-production-plus-readiness.mjs"),
          secretHandling: expect.stringContaining("不记录密钥值"),
        }),
        expect.objectContaining({
          label: "2. 准备执行通行证",
          requiredInputLabels: expect.arrayContaining(["执行令牌公钥"]),
        }),
      ]),
    );
    expect(readinessText).not.toContain("not-a-url");
    expect(readinessText).not.toContain("ftp://127.0.0.1:4000");
    expect(readinessText).not.toContain("not a pem");
    expect(readinessText).not.toContain("secret-token");
    expect(readinessText).not.toContain("cloud-token");
  });

  it("renders a safe readiness env template without copying current secret values", () => {
    const readiness = evaluateReadiness({
      DIJIE_CLOUD_BASE_URL: "https://private-cloud.example/tenant/acme",
      OPENCLAW_LOCAL_URL: "http://127.0.0.1:5173/private-local",
      DIJIE_INTERNAL_BRIDGE_BEARER: "secret-token",
      DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM: "not a pem",
      DIJIE_VENDOR_ACCESS_TOKEN: "vendor-token",
    });

    const template = renderReadinessEnvTemplate(readiness);
    expect(template).toContain('export DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM="<public-key-pem>"');
    expect(template).toContain('export DIJIE_ADMIN_ACCESS_TOKEN="<admin-actor-access-token>"');
    expect(template).toContain('export DIJIE_BUYER_ACCESS_TOKEN="<buyer-actor-access-token>"');
    expect(template).toContain(
      'export DIJIE_CLOUD_ACCESS_TOKEN="<optional-shared-cloud-access-token>"',
    );
    expect(template).not.toContain("secret-token");
    expect(template).not.toContain("vendor-token");
    expect(template).not.toContain("private-cloud.example");
    expect(template).not.toContain("private-local");
    expect(template).not.toContain("not a pem");
  });

  it("checks endpoint reachability readiness without exposing URLs or token values", async () => {
    const env = {
      DIJIE_CLOUD_BASE_URL: "http://cloud.test/private-path",
      OPENCLAW_LOCAL_URL: "http://openclaw.test/local-path",
      DIJIE_INTERNAL_BRIDGE_BEARER: "secret-token",
      DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM:
        "-----BEGIN PUBLIC KEY-----\\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALocalTestOnlyPersonaReadinessKey\\n-----END PUBLIC KEY-----",
      DIJIE_VENDOR_ACCESS_TOKEN: "vendor-token",
      DIJIE_ADMIN_ACCESS_TOKEN: "admin-token",
      DIJIE_BUYER_ACCESS_TOKEN: "buyer-token",
    };

    const ready = await evaluateReadinessWithEndpointProbes(env, {
      endpointProbeResults: {
        DIJIE_CLOUD_BASE_URL: { status: "passed", statusCode: 200 },
        OPENCLAW_LOCAL_URL: { status: "passed", statusCode: 204 },
      },
    });
    expect(ready.status).toBe("ready");
    expect(ready.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "DIJIE_CLOUD_BASE_URL reachable",
          status: "passed",
          statusCode: 200,
        }),
        expect.objectContaining({
          name: "OPENCLAW_LOCAL_URL reachable",
          status: "passed",
          statusCode: 204,
        }),
      ]),
    );

    const blocked = await evaluateReadinessWithEndpointProbes(env, {
      endpointProbeResults: {
        DIJIE_CLOUD_BASE_URL: { status: "passed", statusCode: 200 },
        OPENCLAW_LOCAL_URL: { status: "blocked", reason: "endpoint_unreachable" },
      },
    });
    const readinessText = JSON.stringify(blocked);
    expect(blocked.status).toBe("blocked");
    expect(blocked.nextRequiredEnv).toEqual([]);
    expect(blocked.nextRequiredServices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "OPENCLAW_LOCAL_URL reachable",
          reason: "endpoint_unreachable",
          requiredConfig: ["OPENCLAW_LOCAL_URL"],
        }),
      ]),
    );
    expect(blocked.blockedChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "OPENCLAW_LOCAL_URL reachable",
          reason: "endpoint_unreachable",
        }),
      ]),
    );
    expect(blocked.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "OPENCLAW_LOCAL_URL reachable",
          status: "blocked",
          reason: "endpoint_unreachable",
        }),
      ]),
    );
    expect(blocked.operatorChecklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "1. 启动或修复服务",
          status: "blocked",
          requiredInputs: expect.arrayContaining(["OPENCLAW_LOCAL_URL"]),
          requiredInputLabels: expect.arrayContaining(["本地 OpenClaw UI 地址"]),
        }),
      ]),
    );
    expect(readinessText).not.toContain("cloud.test/private-path");
    expect(readinessText).not.toContain("openclaw.test/local-path");
    expect(readinessText).not.toContain("secret-token");
    expect(readinessText).not.toContain("vendor-token");

    const blockedMarkdown = renderReadinessMarkdown(blocked);
    expect(blockedMarkdown).toContain("## 真人准备清单");
    expect(blockedMarkdown).toContain("启动或修复服务");
    expect(blockedMarkdown).toContain("跑最终真人验收");
    expect(blockedMarkdown).toContain("## 当前不可达服务");
    expect(blockedMarkdown).toContain("OPENCLAW_LOCAL_URL reachable：endpoint_unreachable");
    expect(blockedMarkdown).toContain("## 可执行检查清单");
    expect(blockedMarkdown).toContain("需要：本地 OpenClaw UI 地址");
    expect(blockedMarkdown).toContain(
      "复查命令：`node scripts/persona/aics-production-plus-readiness.mjs --probe-endpoints",
    );
    expect(blockedMarkdown).toContain("## Required Service");
    expect(blockedMarkdown).toContain("- OPENCLAW_LOCAL_URL reachable");
    expect(blockedMarkdown).toContain("## Required Environment");
    expect(blockedMarkdown).toContain("- No missing environment variable detected");
    expect(blockedMarkdown).toContain("## Next Commands");
    expect(blockedMarkdown).toContain("aics-production-plus-orchestrator.mjs");
    expect(blockedMarkdown).toContain("--seed-file");
    expect(blockedMarkdown).toContain("## Secret Handling");
    expect(blockedMarkdown).not.toContain("secret-token");
    expect(blockedMarkdown).not.toContain("vendor-token");
    expect(blockedMarkdown).not.toContain("cloud.test/private-path");
    expect(blockedMarkdown).not.toContain("openclaw.test/local-path");
  });

  it("blocks readiness for invalid or non-production evidence without exposing evidence content", () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), "aics-readiness-evidence-"));
    const invalidEvidencePath = join(evidenceDir, "invalid-evidence.json");
    writeFileSync(
      invalidEvidencePath,
      `${JSON.stringify({
        source: "dry-run",
        proof: { privateBody: "Bearer token-that-must-not-leak-from-evidence" },
      })}\n`,
    );

    const invalid = evaluateReadiness({}, { evidence: invalidEvidencePath });
    const invalidCheck = invalid.checks.find(
      (check: { path?: string }) => check.path === invalidEvidencePath,
    ) as { status: string; reason?: string; schemaErrors?: string[] };
    const invalidText = JSON.stringify(invalid);

    expect(invalid.status).toBe("blocked");
    expect(invalidCheck).toMatchObject({
      status: "blocked",
      reason: "schema_invalid",
    });
    expect(invalidCheck.schemaErrors).toEqual(expect.arrayContaining(["schemaVersion must be 2"]));
    expect(invalidText).not.toContain("token-that-must-not-leak-from-evidence");

    const dryEvidencePath = join(evidenceDir, "dry-evidence.json");
    writeFileSync(dryEvidencePath, `${JSON.stringify(dryRunEvidence(), null, 2)}\n`);
    const dry = evaluateReadiness(
      {
        DIJIE_CLOUD_BASE_URL: "http://127.0.0.1:3000",
        OPENCLAW_LOCAL_URL: "http://127.0.0.1:4000",
        DIJIE_INTERNAL_BRIDGE_BEARER: "secret-token",
        DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM:
          "-----BEGIN PUBLIC KEY-----\\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALocalTestOnlyPersonaReadinessKey\\n-----END PUBLIC KEY-----",
        DIJIE_CLOUD_ACCESS_TOKEN: "cloud-token",
      },
      { evidence: dryEvidencePath },
    );
    const dryCheck = dry.checks.find(
      (check: { path?: string }) => check.path === dryEvidencePath,
    ) as { status: string; reason?: string; failedGateIds?: string[] };

    expect(dry.status).toBe("blocked");
    expect(dryCheck).toMatchObject({
      status: "blocked",
      reason: "production_plus_failed",
    });
    expect(dryCheck.failedGateIds).toEqual(expect.arrayContaining(["real_browser_application"]));
    expect(JSON.stringify(dry)).not.toContain("secret-token");
    expect(JSON.stringify(dry)).not.toContain("cloud-token");
  });

  it("builds a six-persona Playwright readiness config without raw tokens", () => {
    const config = buildPlaywrightConfig({
      seed: {
        ids: { roleListingId: "role_123", executionId: "exec_123", ledgerEntryId: "ledger_123" },
      },
    });

    expect(config.personas.map((persona: { name: string }) => persona.name)).toEqual([
      "developer",
      "admin_reviewer",
      "buyer_storefront",
      "user_center",
      "openclaw_local_operator",
      "ledger_receivables_reader",
    ]);
    expect(config.gaps).toContain(
      "generated readiness scaffold; add final manifest before claiming production-plus",
    );
    expect(JSON.stringify(config)).toContain("DIJIE_VENDOR_ACCESS_TOKEN");
    expect(JSON.stringify(config)).toContain("DIJIE_INTERNAL_BRIDGE_BEARER");
    expect(config.openclawMainChatProbe).toMatchObject({
      url: "/chat",
      selector: '[data-testid="main-chat"]',
      expectedText: "OpenClaw",
    });
    expect(config.requiredIds).toMatchObject({
      roleListingId: "role_123",
      executionId: "exec_123",
      ledgerEntryId: "ledger_123",
    });
    expect(config.localPageProbes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "openclaw_api_management_model_pricing",
          path: "api_management_model_pricing",
          url: "/api-management",
          selector: '[data-testid="openclaw-api-management"]',
          expectedText: "API 管理",
          expectedTexts: expect.arrayContaining([
            "API 管理",
            "模型定价",
            "输入 Token 单价",
            "输出 Token 单价",
            "手动输入模型 ID",
            "模型验证",
          ]),
        }),
        expect.objectContaining({
          name: "openclaw_billing_model_metering",
          path: "billing_model_metering",
          url: "/usage",
          selector: '[data-testid="openclaw-billing-model-metering"]',
          expectedText: "模型 Token 费用读回",
          expectedTexts: ["模型 Token 费用读回", "岗位执行", "gpt-5.5", "¥0.03"],
        }),
      ]),
    );
    expect(config.localPageProbes).toHaveLength(2);
    expect(JSON.stringify(config)).not.toContain("vendor-token");
  });

  it("rejects production-plus final configs without full manifest coverage", () => {
    expect(() =>
      buildPlaywrightConfig({
        seed: { ids: { roleListingId: "role_123" } },
        productionPlusFinal: true,
        finalManifest: { productionPlusFinal: true, coverage: {} },
      }),
    ).toThrow("missing coverage:");
  });

  it("generates and validates final manifests from seed ids", () => {
    const ids = Object.fromEntries(REQUIRED_IDS.map((key) => [key, `${key}_seed`]));
    const manifest = buildFinalManifest({
      seed: { ids },
      runId: "manifest-run",
    });

    expect(manifest.productionPlusFinal).toBe(true);
    expect(manifest.roleListingId).toBe("roleListingId_seed");
    expect(validateFinalManifest(manifest, { ids }).status).toBe("valid");
    expect(
      validateFinalManifest({ ...manifest, executionId: "<executionId>" }).missingIds,
    ).toContain("executionId");
  });

  it("rejects final manifests that do not match seed ids for any required readback id", () => {
    const ids = Object.fromEntries(REQUIRED_IDS.map((key) => [key, `${key}_seed`]));
    const manifest = buildFinalManifest({ seed: { ids }, runId: "manifest-run" });

    expect(() =>
      buildPlaywrightConfig({
        seed: { ids },
        productionPlusFinal: true,
        finalManifest: { ...manifest, rolePackageId: "different-package" },
      }),
    ).toThrow("manifest rolePackageId does not match seed");
  });

  it("requires stable data selectors and no placeholders in final Playwright configs", () => {
    const ids = Object.fromEntries(REQUIRED_IDS.map((key) => [key, `${key}_seed`]));
    const manifest = buildFinalManifest({ seed: { ids }, runId: "selector-run" });
    const config = buildPlaywrightConfig({
      seed: { ids },
      productionPlusFinal: true,
      finalManifest: manifest,
    });

    expect(validateProductionPlusSelectorContract(config)).toEqual([]);

    expect(
      config.personas.every(
        (persona: { actions?: unknown[] }) =>
          Array.isArray(persona.actions) && persona.actions.length > 0,
      ),
    ).toBe(true);

    const fragileConfig = {
      ...config,
      personas: config.personas.map(
        (persona: { name: string; positive: unknown[]; actions?: unknown[]; url?: string }) =>
          persona.name === "developer"
            ? {
                ...persona,
                url: "/vendor/dijie/<roleListingId>",
                positive: [
                  { name: "developer: fragile text only", selector: ".card", mustContain: "岗位" },
                ],
                actions: [{ type: "click", selector: ".fragile-action" }],
              }
            : persona,
      ),
    };
    expect(validateProductionPlusSelectorContract(fragileConfig)).toEqual(
      expect.arrayContaining([
        "developer: positive assertions require at least one stable data-* selector",
        "developer: action selector must be a stable data-* selector",
        "developer: actions require at least one stable data-* selector",
        "developer: final config must not contain <placeholder> values",
      ]),
    );
  });

  it("reports missing final persona selectors and passes when source roots cover them", () => {
    const missingDir = mkdtempSync(join(tmpdir(), "aics-selector-missing-"));
    const missingReport = buildSelectorCoverageReport({ cwd: missingDir, sourceRoots: ["."] });

    expect(missingReport.status).toBe("missing");
    expect(missingReport.missingSelectorCount).toBeGreaterThan(0);
    expect(
      missingReport.selectors.some(
        (entry: { id: string; status: string }) =>
          entry.id === "aics-vendor-role-packages" && entry.status === "missing",
      ),
    ).toBe(true);
    expect(
      missingReport.selectors.some(
        (entry: { id: string; kind: string; status: string }) =>
          entry.id === "aics-vendor-role-packages" &&
          entry.kind === "action" &&
          entry.status === "missing",
      ),
    ).toBe(true);

    const coveredDir = mkdtempSync(join(tmpdir(), "aics-selector-covered-"));
    const selectorIds = missingReport.selectors.map((entry: { id: string }) => entry.id);
    writeFileSync(
      join(coveredDir, "selectors.tsx"),
      selectorIds.map((id: string) => `<div data-testid="${id}" />`).join("\n"),
    );

    const coveredReport = buildSelectorCoverageReport({ cwd: coveredDir, sourceRoots: ["."] });
    expect(coveredReport.status).toBe("covered");
    expect(coveredReport.missingSelectorCount).toBe(0);
  });

  it("collects Playwright persona evidence with screenshots and API id captures", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-playwright-evidence-"));
    const config = buildPlaywrightConfig({
      seed: {
        ids: {
          roleListingId: "role_123",
          entitlementId: "ent_123",
          executionId: "exec_123",
          ledgerEntryId: "ledger_123",
        },
      },
      baseUrl: "http://cloud.test",
      openclawUrl: "http://openclaw.test",
      productionPlusFinal: true,
      finalManifest: finalManifest(),
    });
    config.personas[0]!.actions = [
      { type: "click", selector: '[data-testid="aics-vendor-role-packages"]' },
      {
        type: "fill",
        selector: '[data-testid="aics-vendor-package-title"]',
        value: "confidential package draft",
      },
      { type: "waitForURL", url: "http://cloud.test/vendor/dijie" },
    ];

    const evidence = await collectPlaywrightEvidence(config, {
      playwright: fakePlaywright({
        networkUrl: "http://cloud.test/vendor/dijie/role-listings",
      }),
      out: join(outDir, "persona-evidence.json"),
    });

    expect(evidence.realBrowser).toBe(true);
    expect(evidence.realApplication).toBe(true);
    expect(
      evidence.personas.every((persona: { status: string }) => persona.status === "passed"),
    ).toBe(true);
    const expectedScreenshotCount =
      STANDARD_PERSONAS.length + 1 + (config.localPageProbes?.length ?? 0);
    expect(evidence.proof.screenshotCount).toBeGreaterThanOrEqual(expectedScreenshotCount);
    expect(
      readdirSync(join(outDir, "screenshots")).filter((name) => name.endsWith(".png")),
    ).toHaveLength(evidence.proof.screenshotCount);
    expect(evidence.proof.apiCheckCount).toBeGreaterThanOrEqual(6);
    for (const idKey of REQUIRED_IDS) {
      expect(evidence.ids[idKey]).toBeTruthy();
      expect(evidence.proof.capturedIdFields).toContain(idKey);
    }
    const evidenceGate = evaluateProductionPlusEvidence(evidence, {
      evidencePath: join(outDir, "persona-evidence.json"),
    });
    expect(
      evidenceGate.gates.filter((gate: { status: string }) => gate.status !== "passed"),
    ).toEqual([]);
    expect(evidenceGate.verdict).toBe("production_plus_passed");
    expect(evidence.ids.auditRecordId).toBe("audit_123");
    expect(evidence.ids.ledgerEntryId).toBe("ledger_123");
    expect(evidence.openclawMainChat).toMatchObject({
      status: "passed",
      source: "playwright",
      path: "main_chat",
      assertion: {
        selector: '[data-testid="main-chat"]',
        expectedText: "OpenClaw",
        status: "passed",
      },
    });
    expect(evidence.modelTokenBilling).toMatchObject({
      source: "api_readback",
      apiConnectionId: "model-openai",
      provider: "openai",
      model: "gpt-5.5",
      costCny: 0.03648,
      byConsumer: {
        role_execution: {
          totalTokens: 1900,
          costCny: 0.03008,
        },
        local_dialog: {
          totalTokens: 500,
          costCny: 0.0064,
        },
      },
    });
    expect(evidence.localPageProbes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "openclaw_api_management_model_pricing",
          path: "api_management_model_pricing",
          status: "passed",
          source: "playwright",
          assertion: expect.objectContaining({
            selector: '[data-testid="openclaw-api-management"]',
            expectedText: "API 管理",
            expectedTexts: expect.arrayContaining([
              "API 管理",
              "模型定价",
              "输入 Token 单价",
              "输出 Token 单价",
              "手动输入模型 ID",
              "模型验证",
            ]),
            status: "passed",
          }),
        }),
        expect.objectContaining({
          name: "openclaw_billing_model_metering",
          path: "billing_model_metering",
          status: "passed",
          source: "playwright",
          assertion: expect.objectContaining({
            selector: '[data-testid="openclaw-billing-model-metering"]',
            expectedText: "模型 Token 费用读回",
            expectedTexts: ["模型 Token 费用读回", "岗位执行", "gpt-5.5", "¥0.03"],
            status: "passed",
          }),
        }),
      ]),
    );
    expect(evidence.localPageProbes).toHaveLength(2);
    expect(evidence.proof.consoleEventCount).toBe(6);
    expect(evidence.proof.networkEventCount).toBe(6);
    const expectedActionCount = config.personas.reduce(
      (sum: number, persona: { actions?: unknown[] }) => sum + (persona.actions?.length ?? 0),
      0,
    );
    expect(evidence.proof.actionCount).toBe(expectedActionCount);
    expect(evidence.proof.failedActionCount).toBe(0);
    expect(evidence.proof.actionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          persona: "developer",
          type: "click",
          selector: '[data-testid="aics-vendor-role-packages"]',
          status: "passed",
        }),
        expect.objectContaining({
          persona: "developer",
          type: "fill",
          selector: '[data-testid="aics-vendor-package-title"]',
          valueLength: "confidential package draft".length,
          status: "passed",
        }),
      ]),
    );
    expect(JSON.stringify(evidence.proof.actionTrace)).not.toContain("confidential package draft");
    expect(evidence.proof.artifacts.actions).toBe("actions.ndjson");
    expect(evidence.proof.artifacts.console).toBe("console.ndjson");
    expect(evidence.proof.artifacts.networkSummary).toBe("network-summary.ndjson");
    expect(existsSync(join(outDir, "actions.ndjson"))).toBe(true);
    expect(existsSync(join(outDir, "console.ndjson"))).toBe(true);
    expect(existsSync(join(outDir, "network-summary.ndjson"))).toBe(true);
    expect(readFileSync(join(outDir, "actions.ndjson"), "utf-8")).toContain('"type":"fill"');
    expect(readFileSync(join(outDir, "actions.ndjson"), "utf-8")).not.toContain(
      "confidential package draft",
    );
    expect(readFileSync(join(outDir, "console.ndjson"), "utf-8")).toContain(
      "developer page loaded",
    );
    const networkSummary = readFileSync(join(outDir, "network-summary.ndjson"), "utf-8");
    expect(networkSummary).toContain("http://cloud.test/vendor/dijie/role-listings");
    expect(networkSummary).not.toContain("secret1234567890");
  });

  it("preserves local OpenClaw basePath when collecting API billing readback evidence", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-playwright-basepath-"));
    const fetchedUrls: string[] = [];
    const visitedUrls: string[] = [];
    const config = buildPlaywrightConfig({
      seed: {
        ids: {
          roleListingId: "role_123",
          entitlementId: "ent_123",
          executionId: "exec_123",
          ledgerEntryId: "ledger_123",
        },
      },
      baseUrl: "http://cloud.test",
      openclawUrl: "http://openclaw.test/openclaw",
      productionPlusFinal: true,
      finalManifest: finalManifest(),
    });

    await collectPlaywrightEvidence(config, {
      playwright: fakePlaywright({ fetchedUrls, visitedUrls }),
      out: join(outDir, "persona-evidence.json"),
    });

    expect(fetchedUrls).toContain("http://openclaw.test/openclaw/aics/api-connections/read-model");
    expect(fetchedUrls).not.toContain("http://openclaw.test/aics/api-connections/read-model");
    expect(visitedUrls).toContain("http://openclaw.test/openclaw/aics");
    expect(visitedUrls).toContain("http://openclaw.test/openclaw/chat");
    expect(visitedUrls).toContain("http://openclaw.test/openclaw/api-management");
    expect(visitedUrls).toContain("http://openclaw.test/openclaw/usage");
  });

  it("fails the production-plus gate when runtime page evidence leaks secrets", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-playwright-secret-evidence-"));
    const config = buildPlaywrightConfig({
      seed: {
        ids: {
          rolePackageId: "pkg_123",
          rolePackageVersion: "1.0.0",
          roleListingId: "role_123",
          reviewId: "review_123",
          entitlementId: "ent_123",
          executionId: "exec_123",
          auditRecordId: "audit_123",
          ledgerEntryId: "ledger_123",
        },
      },
      baseUrl: "http://cloud.test",
      openclawUrl: "http://openclaw.test",
      productionPlusFinal: true,
      finalManifest: finalManifest(),
    });
    const rawSecret = "Bearer secret-token-that-must-not-be-written";

    const evidence = await collectPlaywrightEvidence(config, {
      playwright: fakePlaywright({ bodyText: `OpenClaw 岗位 审核 执行 账本 ${rawSecret}` }),
      out: join(outDir, "persona-evidence.json"),
    });
    const gate = evaluateProductionPlusEvidence(evidence, {
      evidencePath: join(outDir, "persona-evidence.json"),
    });

    expect(evidence.secretScan.leakCount).toBeGreaterThan(0);
    expect(JSON.stringify(evidence)).not.toContain(rawSecret);
    expect(gate.verdict).toBe("failed");
    const securityGate = gate.gates.find((item: { id: string }) => item.id === "security_no_leaks");
    expect(securityGate?.status).toBe("failed");
    expect(securityGate?.collectorLeakCount).toBeGreaterThan(0);
    expect(JSON.stringify(securityGate?.collectorSurfaces)).toContain("Bearer [redacted]");
    expect(JSON.stringify(securityGate?.collectorSurfaces)).not.toContain(rawSecret);
  });

  it("blocks Playwright evidence collection when the browser runtime is unavailable", async () => {
    const config = buildPlaywrightConfig({
      baseUrl: "http://cloud.test",
      openclawUrl: "http://openclaw.test",
    });

    const evidence = await collectPlaywrightEvidence(config, { playwright: null });

    expect(validatePersonaEvidenceSchema(evidence)).toEqual([]);
    expect(evidence.realBrowser).toBe(false);
    expect(
      evidence.personas.every((persona: { status: string }) => persona.status === "blocked"),
    ).toBe(true);
    expect(evidence.gaps).toContain("Playwright is not available.");
  });

  it("orchestrator stops at readiness and still writes remediation when env is missing", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-orchestrator-blocked-"));

    const result = await runProductionPlusOrchestrator(
      parseOrchestratorArgs(["--api-seed", "--run-id", "blocked-run", "--output-dir", outDir]),
      { env: {} },
    );

    expect(result.stage).toBe("readiness_blocked");
    expect(result.gate.result.verdict).toBe("failed");
    expect(readFileSync(result.gate.artifacts.remediationMarkdownPath, "utf-8")).toContain(
      "real_browser_application",
    );
    expect(
      JSON.parse(readFileSync(join(outDir, "readiness", "readiness.json"), "utf-8")).status,
    ).toBe("blocked");
    expect(result.completionAudit.audit.status).toBe("incomplete");
    expect(existsSync(result.completionAudit.artifacts.jsonPath)).toBe(true);
    expect(
      JSON.parse(readFileSync(result.completionAudit.artifacts.jsonPath, "utf-8")).failedCheckIds,
    ).toContain("readiness");
  });

  it("orchestrator stops before readiness when final persona selectors are not present in source", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-orchestrator-selector-missing-"));
    const sourceDir = mkdtempSync(join(tmpdir(), "aics-selector-empty-"));
    const seedPath = join(outDir, "seed.json");
    const manifestPath = join(outDir, "final-manifest.json");
    writeFileSync(
      seedPath,
      `${JSON.stringify({
        ids: {
          rolePackageId: "pkg_123",
          rolePackageVersion: "1.0.0",
          roleListingId: "role_123",
          reviewId: "review_123",
          entitlementId: "ent_123",
          executionId: "exec_123",
          auditRecordId: "audit_123",
          ledgerEntryId: "ledger_123",
        },
      })}\n`,
    );
    writeFileSync(manifestPath, `${JSON.stringify(finalManifest())}\n`);

    const result = await runProductionPlusOrchestrator(
      parseOrchestratorArgs([
        "--seed-file",
        seedPath,
        "--production-plus-final",
        "--final-manifest",
        manifestPath,
        "--selector-source-root",
        sourceDir,
        "--run-id",
        "selector-missing-run",
        "--output-dir",
        outDir,
      ]),
      { env: {} },
    );

    expect(result.stage).toBe("selector_coverage_missing");
    expect(result.selectorCoverage.status).toBe("missing");
    expect(result.selectorCoverage.missingSelectorCount).toBeGreaterThan(0);
    expect(
      JSON.parse(readFileSync(join(outDir, "selector-coverage", "selector-coverage.json"), "utf-8"))
        .status,
    ).toBe("missing");
    expect(result.completionAudit.audit.status).toBe("incomplete");
    expect(
      JSON.parse(readFileSync(result.completionAudit.artifacts.jsonPath, "utf-8")).failedCheckIds,
    ).toContain("selector_coverage");
  });

  it("does not let production-plus final runs bypass readiness with --skip-preflight", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-orchestrator-final-readiness-required-"));
    const sourceDir = writeSelectorSourceFixture(
      mkdtempSync(join(tmpdir(), "aics-selector-covered-")),
    );
    const seedPath = join(outDir, "seed.json");
    const manifestPath = join(outDir, "final-manifest.json");
    writeFileSync(
      seedPath,
      `${JSON.stringify({
        ids: {
          rolePackageId: "pkg_123",
          rolePackageVersion: "1.0.0",
          roleListingId: "role_123",
          reviewId: "review_123",
          entitlementId: "ent_123",
          executionId: "exec_123",
          auditRecordId: "audit_123",
          ledgerEntryId: "ledger_123",
        },
      })}\n`,
    );
    writeFileSync(manifestPath, `${JSON.stringify(finalManifest())}\n`);

    const result = await runProductionPlusOrchestrator(
      parseOrchestratorArgs([
        "--seed-file",
        seedPath,
        "--production-plus-final",
        "--final-manifest",
        manifestPath,
        "--base-url",
        "http://cloud.test",
        "--openclaw-url",
        "http://openclaw.test",
        "--selector-source-root",
        sourceDir,
        "--run-id",
        "final-readiness-required-run",
        "--output-dir",
        outDir,
      ]),
      { env: {} },
    );

    expect(result.stage).toBe("readiness_blocked");
    expect(result.gate.result.verdict).toBe("failed");
    expect(
      JSON.parse(readFileSync(join(outDir, "readiness", "readiness.json"), "utf-8")).status,
    ).toBe("blocked");
    expect(result.completionAudit.audit.status).toBe("incomplete");
  });

  it("forces endpoint probes for production-plus final runs even when the CLI flag is omitted", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-orchestrator-final-forced-probe-"));
    const sourceDir = writeSelectorSourceFixture(
      mkdtempSync(join(tmpdir(), "aics-selector-covered-")),
    );
    const seedPath = join(outDir, "seed.json");
    const manifestPath = join(outDir, "final-manifest.json");
    writeFileSync(
      seedPath,
      `${JSON.stringify({
        ids: {
          rolePackageId: "pkg_123",
          rolePackageVersion: "1.0.0",
          roleListingId: "role_123",
          reviewId: "review_123",
          entitlementId: "ent_123",
          executionId: "exec_123",
          auditRecordId: "audit_123",
          ledgerEntryId: "ledger_123",
        },
      })}\n`,
    );
    writeFileSync(manifestPath, `${JSON.stringify(finalManifest())}\n`);

    const result = await runProductionPlusOrchestrator(
      parseOrchestratorArgs([
        "--seed-file",
        seedPath,
        "--production-plus-final",
        "--final-manifest",
        manifestPath,
        "--base-url",
        "http://cloud.test",
        "--openclaw-url",
        "http://openclaw.test",
        "--selector-source-root",
        sourceDir,
        "--skip-playwright",
        "--run-id",
        "final-forced-probe-run",
        "--output-dir",
        outDir,
      ]),
      {
        env: readyProductionPlusEnv(),
        endpointProbeResults: {
          DIJIE_CLOUD_BASE_URL: { status: "passed", statusCode: 200 },
          OPENCLAW_LOCAL_URL: { status: "blocked", reason: "endpoint_unreachable" },
        },
      },
    );

    expect(result.stage).toBe("readiness_blocked");
    const readiness = JSON.parse(
      readFileSync(join(outDir, "readiness", "readiness.json"), "utf-8"),
    );
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "DIJIE_CLOUD_BASE_URL reachable", status: "passed" }),
        expect.objectContaining({
          name: "OPENCLAW_LOCAL_URL reachable",
          status: "blocked",
          reason: "endpoint_unreachable",
        }),
      ]),
    );
    expect(result.completionAudit.audit.failedCheckIds).toContain("readiness");
  });

  it("stops production-plus final runs before readiness when seed or manifest runId mismatches", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-orchestrator-run-metadata-invalid-"));
    const seedPath = join(outDir, "seed.json");
    const manifestPath = join(outDir, "final-manifest.json");
    const ids = {
      rolePackageId: "pkg_123",
      rolePackageVersion: "1.0.0",
      roleListingId: "role_123",
      reviewId: "review_123",
      entitlementId: "ent_123",
      executionId: "exec_123",
      auditRecordId: "audit_123",
      ledgerEntryId: "ledger_123",
    };
    writeFileSync(seedPath, `${JSON.stringify({ ids, runId: "different-seed-run" })}\n`);
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...finalManifest(), runId: "different-manifest-run" })}\n`,
    );

    const result = await runProductionPlusOrchestrator(
      parseOrchestratorArgs([
        "--seed-file",
        seedPath,
        "--production-plus-final",
        "--final-manifest",
        manifestPath,
        "--run-id",
        "current-run",
        "--output-dir",
        outDir,
      ]),
      { env: readyProductionPlusEnv() },
    );

    expect(result.stage).toBe("run_metadata_invalid");
    expect(result.runMetadataValidation).toMatchObject({
      status: "invalid",
      mismatches: expect.arrayContaining([
        expect.objectContaining({ artifact: "seed", actual: "different-seed-run" }),
        expect.objectContaining({ artifact: "finalManifest", actual: "different-manifest-run" }),
      ]),
    });
    expect(
      JSON.parse(readFileSync(join(outDir, "run-metadata.validation.json"), "utf-8")).status,
    ).toBe("invalid");
    expect(result.completionAudit.audit.status).toBe("incomplete");
  });

  it("does not let scaffold API seeds create a production-plus final manifest", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-orchestrator-scaffold-final-invalid-"));
    const result = await runProductionPlusOrchestrator(
      parseOrchestratorArgs([
        "--api-seed",
        "--write-final-manifest",
        join(outDir, "final-manifest.json"),
        "--production-plus-final",
        "--final-manifest",
        join(outDir, "final-manifest.json"),
        "--run-id",
        "scaffold-final-invalid-run",
        "--output-dir",
        outDir,
      ]),
      { env: {} },
    );

    expect(buildApiSeed("scaffold-final-invalid-run").ids).toEqual({});
    expect(result.stage).toBe("final_manifest_invalid");
    expect(result.finalManifestValidation.missingIds).toEqual(REQUIRED_IDS);
    expect(result.gate.result.verdict).toBe("failed");
    expect(result.completionAudit.audit.status).toBe("incomplete");
    expect(
      JSON.parse(readFileSync(result.completionAudit.artifacts.jsonPath, "utf-8")).failedCheckIds,
    ).toContain("playwright_config");
  });

  it("orchestrator can run seed, final config, Playwright evidence, and gate end-to-end", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-orchestrator-pass-"));
    const sourceDir = writeSelectorSourceFixture(
      mkdtempSync(join(tmpdir(), "aics-selector-covered-")),
    );
    const seedPath = join(outDir, "seed.json");
    const manifestPath = join(outDir, "final-manifest.json");
    writeFileSync(
      seedPath,
      `${JSON.stringify({
        ids: {
          rolePackageId: "pkg_123",
          rolePackageVersion: "1.0.0",
          roleListingId: "role_123",
          reviewId: "review_123",
          entitlementId: "ent_123",
          executionId: "exec_123",
          auditRecordId: "audit_123",
          ledgerEntryId: "ledger_123",
        },
      })}\n`,
    );
    writeFileSync(manifestPath, `${JSON.stringify(finalManifest())}\n`);

    const result = await runProductionPlusOrchestrator(
      parseOrchestratorArgs([
        "--seed-file",
        seedPath,
        "--production-plus-final",
        "--probe-endpoints",
        "--final-manifest",
        manifestPath,
        "--base-url",
        "http://cloud.test",
        "--openclaw-url",
        "http://openclaw.test",
        "--selector-source-root",
        sourceDir,
        "--run-id",
        "passing-run",
        "--output-dir",
        outDir,
      ]),
      {
        playwright: fakePlaywright(),
        env: {
          DIJIE_CLOUD_BASE_URL: "http://cloud.test",
          OPENCLAW_LOCAL_URL: "http://openclaw.test",
          DIJIE_INTERNAL_BRIDGE_BEARER: "bridge-token",
          DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM:
            "-----BEGIN PUBLIC KEY-----\\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALocalTestOnlyPersonaReadinessKey\\n-----END PUBLIC KEY-----",
          DIJIE_VENDOR_ACCESS_TOKEN: "vendor-token",
          DIJIE_ADMIN_ACCESS_TOKEN: "admin-token",
          DIJIE_BUYER_ACCESS_TOKEN: "buyer-token",
        },
        endpointProbeResults: {
          DIJIE_CLOUD_BASE_URL: { status: "passed", statusCode: 200 },
          OPENCLAW_LOCAL_URL: { status: "passed", statusCode: 200 },
        },
      },
    );

    expect(result.stage).toBe("gate");
    expect(result.gate.result.verdict).toBe("production_plus_passed");
    expect(JSON.parse(readFileSync(result.gate.artifacts.evidencePath, "utf-8")).verdict).toBe(
      "production_plus_passed",
    );
    expect(result.completionAudit.audit.status).toBe("complete");
    expect(existsSync(result.completionAudit.artifacts.jsonPath)).toBe(true);
    expect(readFileSync(result.completionAudit.artifacts.markdownPath, "utf-8")).toContain(
      "`remediation_contract` | PASS",
    );
  });

  it("orchestrator can write a final manifest from the seed before running the gate", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-orchestrator-manifest-"));
    const seedPath = join(outDir, "seed.json");
    const manifestPath = join(outDir, "generated-final-manifest.json");
    const ids = Object.fromEntries(REQUIRED_IDS.map((key) => [key, `${key}_seed`]));
    writeFileSync(seedPath, `${JSON.stringify({ ids })}\n`);

    const result = await runProductionPlusOrchestrator(
      parseOrchestratorArgs([
        "--seed-file",
        seedPath,
        "--write-final-manifest",
        manifestPath,
        "--skip-preflight",
        "--skip-playwright",
        "--run-id",
        "manifest-run",
        "--output-dir",
        outDir,
      ]),
    );

    expect(result.finalManifestPath).toBe(manifestPath);
    expect(JSON.parse(readFileSync(manifestPath, "utf-8")).coverage.screenshots).toBe(true);
    expect(JSON.parse(readFileSync(manifestPath, "utf-8")).coverage.apiMeteringReadback).toBe(true);
    expect(JSON.parse(readFileSync(manifestPath, "utf-8")).modelTokenBilling.costCny).toBe(0.03648);
    expect(
      JSON.parse(readFileSync(join(outDir, "final-manifest.validation.json"), "utf-8")).status,
    ).toBe("valid");
  });

  it("orchestrator stops before readiness when generated final manifest is invalid", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-orchestrator-invalid-manifest-"));
    const seedPath = join(outDir, "seed.json");
    const manifestPath = join(outDir, "generated-final-manifest.json");
    writeFileSync(seedPath, `${JSON.stringify({ ids: { roleListingId: "role_123" } })}\n`);

    const result = await runProductionPlusOrchestrator(
      parseOrchestratorArgs([
        "--seed-file",
        seedPath,
        "--write-final-manifest",
        manifestPath,
        "--skip-preflight",
        "--skip-playwright",
        "--run-id",
        "invalid-manifest-run",
        "--output-dir",
        outDir,
      ]),
    );

    expect(result.stage).toBe("final_manifest_invalid");
    expect(result.gate.result.verdict).toBe("failed");
    expect(result.finalManifestValidation.status).toBe("invalid");
    expect(result.finalManifestValidation.missingIds).toContain("rolePackageId");
  });

  it("passes completion audit only when final artifacts and remediation contract are complete", () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-completion-audit-pass-"));
    writeCompletionAuditRun(outDir);

    const audit = runCompletionAudit({ runDir: outDir });

    expect(audit.status).toBe("complete");
    expect(audit.failedCheckIds).toEqual([]);
    expect(audit.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "final_gate", status: "passed" }),
        expect.objectContaining({ id: "remediation_contract", status: "passed" }),
      ]),
    );
    expect(renderCompletionAuditMarkdown(audit)).toContain("`remediation_contract` | PASS");
  });

  it("fails completion audit when remediation lacks the implementation plan contract", () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-completion-audit-no-plan-"));
    writeCompletionAuditRun(outDir);
    const remediationPath = join(outDir, "remediation.json");
    const remediation = JSON.parse(readFileSync(remediationPath, "utf-8"));
    delete remediation.implementationPlan;
    writeFileSync(remediationPath, `${JSON.stringify(remediation, null, 2)}\n`);

    const audit = runCompletionAudit({ runDir: outDir });
    const remediationCheck = audit.checks.find(
      (item: { id: string }) => item.id === "remediation_contract",
    );

    expect(audit.status).toBe("incomplete");
    expect(audit.failedCheckIds).toContain("remediation_contract");
    expect(remediationCheck).toMatchObject({
      status: "failed",
      evidence: {
        implementationPlanStatus: undefined,
      },
    });
  });

  it("fails completion audit when remediation still has missing production-plus gates", () => {
    const outDir = mkdtempSync(join(tmpdir(), "aics-completion-audit-missing-gates-"));
    writeCompletionAuditRun(outDir);
    const remediationPath = join(outDir, "remediation.json");
    const remediation = JSON.parse(readFileSync(remediationPath, "utf-8"));
    remediation.completionAudit.status = "not_achieved";
    remediation.completionAudit.missingGateIds = ["real_browser_application"];
    remediation.implementationPlan.status = "needs_work";
    remediation.implementationPlan.groups[0].status = "blocked";
    remediation.implementationPlan.groups[0].gates = [
      { id: "real_browser_application", summary: "missing", remediation: "run real browser" },
    ];
    writeFileSync(remediationPath, `${JSON.stringify(remediation, null, 2)}\n`);

    const audit = runCompletionAudit({ runDir: outDir });
    const remediationCheck = audit.checks.find(
      (item: { id: string }) => item.id === "remediation_contract",
    );

    expect(audit.status).toBe("incomplete");
    expect(remediationCheck).toMatchObject({
      id: "remediation_contract",
      status: "failed",
      evidence: {
        completionAuditStatus: "not_achieved",
        missingGateCount: 1,
        implementationPlanStatus: "needs_work",
        blockedGroupCount: 1,
      },
    });
  });
});
