#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isCli, REQUIRED_IDS } from "./aics-persona-runner.mjs";

export const REQUIRED_FINAL_COVERAGE = [
  "freshApiSeed",
  "developerPackageSubmit",
  "adminReviewPublish",
  "buyerAuthorizationOrCheckout",
  "userCenterCloudExecution",
  "openclawLocalSync",
  "openclawLocalExecution",
  "auditUpload",
  "ledgerReadback",
  "receivablesReadback",
  "crossActorNegatives",
  "apiIdCapture",
  "screenshots",
  "apiModelPricing",
  "apiMeteringReadback",
  "apiUsageAttribution",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function seedId(seed, key) {
  return seed?.ids?.[key] ?? seed?.[key] ?? "";
}

export function buildFinalManifest({ seed = {}, runId } = {}) {
  const ids = Object.fromEntries(REQUIRED_IDS.map((key) => [key, seedId(seed, key) || `<${key}>`]));
  return {
    productionPlusFinal: true,
    generatedAt: new Date().toISOString(),
    ...(runId ? { runId } : {}),
    ...ids,
    coverage: Object.fromEntries(REQUIRED_FINAL_COVERAGE.map((key) => [key, true])),
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
    notes: [
      "Generated scaffold: replace placeholder ids with fresh readback ids before claiming production-plus.",
      "This manifest is a declaration of final probe coverage; the gate still requires real Playwright evidence and id readback.",
    ],
  };
}

export function validateFinalManifest(manifest, seed = {}) {
  const missingCoverage = REQUIRED_FINAL_COVERAGE.filter(
    (key) => manifest?.coverage?.[key] !== true,
  );
  const missingIds = REQUIRED_IDS.filter((key) => {
    const value = manifest?.[key];
    return typeof value !== "string" || !value.trim() || /^<.*>$/.test(value.trim());
  });
  const idMismatches = REQUIRED_IDS.filter((key) => {
    const value = seedId(seed, key);
    return value && manifest?.[key] && manifest[key] !== value;
  });
  const billing = manifest?.modelTokenBilling;
  const roleExecution =
    billing?.byConsumer && typeof billing.byConsumer === "object"
      ? billing.byConsumer.role_execution
      : null;
  const hasAdditionalConsumer =
    billing?.byConsumer && typeof billing.byConsumer === "object"
      ? Object.entries(billing.byConsumer).some(([consumer, value]) => {
          if (consumer === "role_execution" || !value || typeof value !== "object") return false;
          return Number(value.totalTokens) > 0 && Number(value.costCny) > 0;
        })
      : false;
  const billingErrors =
    billing?.status === "passed" &&
    typeof billing?.apiConnectionId === "string" &&
    typeof billing?.provider === "string" &&
    typeof billing?.model === "string" &&
    Number(billing?.inputTokens) > 0 &&
    Number(billing?.outputTokens) > 0 &&
    Number(billing?.totalTokens) > 0 &&
    Number(billing?.costCny) > 0 &&
    Number(roleExecution?.totalTokens) > 0 &&
    Number(roleExecution?.costCny) > 0 &&
    hasAdditionalConsumer
      ? []
      : [
          "modelTokenBilling must include passed pricing, usage, cost, role_execution attribution, and at least one additional consumer attribution",
        ];
  const errors = [
    ...(manifest?.productionPlusFinal === true ? [] : ["productionPlusFinal must be true"]),
    ...missingCoverage.map((key) => `missing coverage: ${key}`),
    ...missingIds.map((key) => `missing manifest id: ${key}`),
    ...idMismatches.map((key) => `manifest ${key} does not match seed`),
    ...billingErrors,
  ];
  return {
    status: errors.length === 0 ? "valid" : "invalid",
    errors,
    missingCoverage,
    missingIds,
    idMismatches,
    billingErrors,
  };
}

export function parseFinalManifestArgs(argv) {
  const args = { validate: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--seed") args.seed = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--run-id") args.runId = argv[++i];
    else if (arg === "--manifest") args.manifest = argv[++i];
    else if (arg === "--validate") args.validate = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.validate && !args.manifest) throw new Error("--validate requires --manifest");
  if (!args.validate && !args.out) throw new Error("--out is required");
  return args;
}

export function runFinalManifest(args) {
  const seed = args.seed ? readJson(args.seed) : {};
  if (args.validate) {
    const manifest = readJson(args.manifest);
    return {
      validation: validateFinalManifest(manifest, seed),
      manifestPath: resolve(args.manifest),
    };
  }
  const manifest = buildFinalManifest({ seed, runId: args.runId });
  writeJson(resolve(args.out), manifest);
  return {
    manifest,
    manifestPath: resolve(args.out),
    validation: validateFinalManifest(manifest, seed),
  };
}

if (isCli(import.meta.url)) {
  try {
    const args = parseFinalManifestArgs(process.argv.slice(2));
    const result = runFinalManifest(args);
    if (result.manifestPath) console.log(`final manifest: ${result.manifestPath}`);
    if (result.validation) {
      console.log(`status: ${result.validation.status}`);
      for (const error of result.validation.errors) console.log(`- ${error}`);
      process.exitCode = args.validate && result.validation.status !== "valid" ? 1 : 0;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
