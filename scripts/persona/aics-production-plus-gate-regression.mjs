#!/usr/bin/env node

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REQUIRED_IDS,
  STANDARD_PERSONAS,
  evaluateProductionPlusEvidence,
  isCli,
} from "./aics-persona-runner.mjs";

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000000000000000000049454e44ae426082",
  "hex",
);

export function completeSyntheticEvidence() {
  const ids = Object.fromEntries(REQUIRED_IDS.map((id) => [id, `${id}_synthetic`]));
  const actionTrace = STANDARD_PERSONAS.map((name, index) => ({
    persona: name,
    order: index + 1,
    type: "click",
    selector: `[data-testid="${name}-synthetic-action"]`,
    status: "passed",
  }));
  return {
    schemaVersion: 2,
    source: "playwright",
    realBrowser: true,
    realApplication: true,
    startedAt: "2026-06-16T00:00:00.000Z",
    endedAt: "2026-06-16T00:01:00.000Z",
    freshApiSeed: true,
    personas: STANDARD_PERSONAS.map((name) => ({ name, status: "passed" })),
    positive: STANDARD_PERSONAS.map((name) => ({
      name: `${name}: positive path passed`,
      status: "passed",
    })),
    negative: STANDARD_PERSONAS.map((name) => ({
      name: `${name}: negative path rejected`,
      status: "passed",
    })),
    proof: {
      browserName: "chromium",
      screenshotCount: 1,
      actionCount: actionTrace.length,
      failedActionCount: 0,
      actionTrace,
      consoleEventCount: 0,
      networkEventCount: 0,
      artifacts: {
        screenshotsDir: "screenshots",
        actions: "actions.ndjson",
        console: "console.ndjson",
        networkSummary: "network-summary.ndjson",
      },
      apiChecks: STANDARD_PERSONAS.map((name) => ({
        name: `${name}: negative API rejected`,
        kind: "negative",
        status: "passed",
        persona: name,
      })),
    },
    ids,
    finalProbes: {
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
      source: "api_readback",
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
    openclawMainChat: {
      status: "provider-config-blocked",
      source: "api_readback",
      path: "main_chat",
      blockedReason: {
        code: "provider_config_missing",
        stage: "main_chat",
      },
    },
    localPageProbes: [
      {
        name: "openclaw_api_management_model_pricing",
        path: "api_management_model_pricing",
        status: "passed",
        source: "playwright",
        assertion: {
          selector: '[data-testid="openclaw-api-management"]',
          expectedText: "API 管理",
          expectedTexts: [
            "API 管理",
            "模型定价",
            "输入 Token 单价",
            "输出 Token 单价",
            "手动输入模型 ID",
            "模型验证",
            "提供给",
            "API 列表与计量",
          ],
          status: "passed",
        },
      },
      {
        name: "openclaw_billing_model_metering",
        path: "billing_model_metering",
        status: "passed",
        source: "playwright",
        assertion: {
          selector: '[data-testid="openclaw-billing-model-metering"]',
          expectedText: "模型 Token 费用读回",
          expectedTexts: ["模型 Token 费用读回", "岗位执行", "gpt-5.5", "¥0.03"],
          status: "passed",
        },
      },
    ],
    consoleErrorCount: 0,
    network5xxCount: 0,
    secretScan: { leakCount: 0 },
    gaps: [],
  };
}

function writeEvidenceWithScreenshot(dir, evidence, screenshotBytes = PNG_BYTES) {
  mkdirSync(join(dir, "screenshots"), { recursive: true });
  writeFileSync(join(dir, "persona-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(join(dir, "screenshots", "shot.png"), screenshotBytes);
  writeFileSync(
    join(dir, "actions.ndjson"),
    (evidence.proof?.actionTrace ?? []).map((action) => JSON.stringify(action)).join("\n") +
      (evidence.proof?.actionTrace?.length ? "\n" : ""),
  );
  writeFileSync(join(dir, "console.ndjson"), "");
  writeFileSync(join(dir, "network-summary.ndjson"), "");
  return join(dir, "persona-evidence.json");
}

export function runGateRegression() {
  const root = mkdtempSync(join(tmpdir(), "aics-production-plus-gate-"));
  const completeDir = join(root, "complete");
  const completePath = writeEvidenceWithScreenshot(completeDir, completeSyntheticEvidence());
  const complete = evaluateProductionPlusEvidence(completeSyntheticEvidence(), {
    evidencePath: completePath,
  });
  if (complete.verdict !== "production_plus_passed") {
    throw new Error(
      `complete synthetic evidence should pass: ${JSON.stringify(complete.gates, null, 2)}`,
    );
  }

  const noScreenshot = evaluateProductionPlusEvidence(completeSyntheticEvidence());
  if (noScreenshot.verdict === "production_plus_passed") {
    throw new Error("evidence without screenshot artifact must fail");
  }

  const invalidDir = join(root, "invalid-png");
  const invalidPath = writeEvidenceWithScreenshot(
    invalidDir,
    completeSyntheticEvidence(),
    Buffer.from("not-png"),
  );
  const invalidPng = evaluateProductionPlusEvidence(completeSyntheticEvidence(), {
    evidencePath: invalidPath,
  });
  if (invalidPng.verdict === "production_plus_passed") {
    throw new Error("invalid PNG artifact must fail");
  }

  const missingConsoleDir = join(root, "missing-console-artifacts");
  mkdirSync(join(missingConsoleDir, "screenshots"), { recursive: true });
  writeFileSync(
    join(missingConsoleDir, "persona-evidence.json"),
    `${JSON.stringify(completeSyntheticEvidence(), null, 2)}\n`,
  );
  writeFileSync(join(missingConsoleDir, "screenshots", "shot.png"), PNG_BYTES);
  const missingConsoleArtifacts = evaluateProductionPlusEvidence(completeSyntheticEvidence(), {
    evidencePath: join(missingConsoleDir, "persona-evidence.json"),
  });
  if (missingConsoleArtifacts.verdict === "production_plus_passed") {
    throw new Error("missing console/network artifacts must fail");
  }

  const missingBillingEvidence = completeSyntheticEvidence();
  delete missingBillingEvidence.modelTokenBilling;
  missingBillingEvidence.finalProbes.apiMeteringReadback = false;
  const missingBilling = evaluateProductionPlusEvidence(missingBillingEvidence, {
    evidencePath: completePath,
  });
  if (missingBilling.verdict === "production_plus_passed") {
    throw new Error("missing model token billing readback must fail");
  }

  const looseMainChatEvidence = completeSyntheticEvidence();
  looseMainChatEvidence.openclawMainChat = { status: "provider-config-blocked" };
  const looseMainChat = evaluateProductionPlusEvidence(looseMainChatEvidence, {
    evidencePath: completePath,
  });
  if (looseMainChat.verdict === "production_plus_passed") {
    throw new Error("loose OpenClaw main chat status must fail");
  }

  const missingActionsEvidence = completeSyntheticEvidence();
  missingActionsEvidence.proof.actionCount = 0;
  missingActionsEvidence.proof.actionTrace = [];
  const missingActionsDir = join(root, "missing-actions");
  const missingActionsPath = writeEvidenceWithScreenshot(missingActionsDir, missingActionsEvidence);
  const missingActions = evaluateProductionPlusEvidence(missingActionsEvidence, {
    evidencePath: missingActionsPath,
  });
  if (missingActions.verdict === "production_plus_passed") {
    throw new Error("missing persona action trace must fail");
  }

  const fake = evaluateProductionPlusEvidence(
    {
      ...completeSyntheticEvidence(),
      source: "dry-run",
      realBrowser: false,
      realApplication: false,
    },
    { evidencePath: completePath },
  );
  if (fake.verdict === "production_plus_passed") {
    throw new Error("fake browser evidence must fail");
  }
  return {
    root,
    complete,
    noScreenshot,
    invalidPng,
    missingConsoleArtifacts,
    missingBilling,
    looseMainChat,
    missingActions,
    fake,
  };
}

if (isCli(import.meta.url)) {
  try {
    const result = runGateRegression();
    console.log(`gate regression passed: ${result.root}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
