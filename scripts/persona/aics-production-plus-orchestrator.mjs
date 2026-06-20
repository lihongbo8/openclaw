#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildPlaywrightConfig } from "./aics-build-playwright-config.mjs";
import { buildFinalManifest, validateFinalManifest } from "./aics-final-manifest.mjs";
import { buildApiSeed, isCli, runPersonaGate } from "./aics-persona-runner.mjs";
import { runPlaywrightPersona } from "./aics-playwright-persona.mjs";
import {
  renderCompletionAuditMarkdown,
  runCompletionAudit,
} from "./aics-production-plus-completion-audit.mjs";
import {
  evaluateReadiness,
  evaluateReadinessWithEndpointProbes,
  renderReadinessMarkdown,
} from "./aics-production-plus-readiness.mjs";
import {
  buildSelectorCoverageReport,
  renderSelectorCoverageMarkdown,
} from "./aics-selector-coverage.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function withRunId(value, runId) {
  return value?.runId ? value : { ...value, runId };
}

function validateInputRunMetadata({ runId, seed, finalManifest } = {}) {
  const mismatches = [
    ...(seed?.runId && seed.runId !== runId
      ? [{ artifact: "seed", expected: runId, actual: seed.runId }]
      : []),
    ...(finalManifest?.runId && finalManifest.runId !== runId
      ? [{ artifact: "finalManifest", expected: runId, actual: finalManifest.runId }]
      : []),
  ];
  return {
    status: mismatches.length === 0 ? "valid" : "invalid",
    mismatches,
    errors: mismatches.map(
      (item) =>
        `${item.artifact} runId ${item.actual} does not match current runId ${item.expected}`,
    ),
  };
}

function writeReadiness(outputDir, readiness) {
  const readinessDir = join(outputDir, "readiness");
  const jsonPath = join(readinessDir, "readiness.json");
  const markdownPath = join(readinessDir, "readiness.md");
  writeJson(jsonPath, readiness);
  writeFileSync(markdownPath, renderReadinessMarkdown(readiness));
  return { jsonPath, markdownPath };
}

function writeSelectorCoverage(outputDir, report) {
  const selectorDir = join(outputDir, "selector-coverage");
  const jsonPath = join(selectorDir, "selector-coverage.json");
  const markdownPath = join(selectorDir, "selector-coverage.md");
  writeJson(jsonPath, report);
  writeFileSync(markdownPath, renderSelectorCoverageMarkdown(report));
  return { jsonPath, markdownPath };
}

function writeCompletionAudit(outputDir) {
  const audit = runCompletionAudit({ runDir: outputDir });
  const jsonPath = join(outputDir, "completion-audit.json");
  const markdownPath = join(outputDir, "completion-audit.md");
  writeJson(jsonPath, audit);
  writeFileSync(markdownPath, renderCompletionAuditMarkdown(audit));
  return { audit, artifacts: { jsonPath, markdownPath } };
}

function withCompletionAudit(result) {
  return {
    ...result,
    completionAudit: writeCompletionAudit(result.outputDir),
  };
}

export function parseOrchestratorArgs(argv) {
  const args = {
    apiSeed: false,
    skipPreflight: false,
    skipPlaywright: false,
    productionPlusFinal: false,
    selectorSourceRoots: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--api-seed") args.apiSeed = true;
    else if (arg === "--seed-file") args.seedFile = argv[++i];
    else if (arg === "--persona-evidence") args.personaEvidence = argv[++i];
    else if (arg === "--output-dir") args.outputDir = argv[++i];
    else if (arg === "--run-id") args.runId = argv[++i];
    else if (arg === "--skip-preflight") args.skipPreflight = true;
    else if (arg === "--skip-playwright") args.skipPlaywright = true;
    else if (arg === "--base-url") args.baseUrl = argv[++i];
    else if (arg === "--vendor-url") args.vendorUrl = argv[++i];
    else if (arg === "--admin-url") args.adminUrl = argv[++i];
    else if (arg === "--storefront-url") args.storefrontUrl = argv[++i];
    else if (arg === "--storefront-locale") args.storefrontLocale = argv[++i];
    else if (arg === "--openclaw-url") args.openclawUrl = argv[++i];
    else if (arg === "--production-plus-final") args.productionPlusFinal = true;
    else if (arg === "--probe-endpoints") args.probeEndpoints = true;
    else if (arg === "--final-manifest") args.finalManifest = argv[++i];
    else if (arg === "--write-final-manifest") args.writeFinalManifest = argv[++i];
    else if (arg === "--selector-source-root") args.selectorSourceRoots.push(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const runId = args.runId ?? `aics-persona-${Date.now()}`;
  return {
    ...args,
    runId,
    outputDir: args.outputDir ?? `docs/aics-persona-runs/${runId}`,
  };
}

function resolveSeed(args) {
  if (args.seedFile) {
    return { seed: readJson(args.seedFile), seedPath: resolve(args.seedFile) };
  }
  if (!args.apiSeed) return { seed: {}, seedPath: undefined };
  const seed = buildApiSeed(args.runId);
  const seedPath = resolve(args.outputDir, "api-seed.json");
  writeJson(seedPath, seed);
  return { seed, seedPath };
}

function runGateFromEvidence(args, personaEvidence, seedPath) {
  return runPersonaGate({
    runId: args.runId,
    outputDir: args.outputDir,
    personaEvidence,
    ...(seedPath ? { apiSeedFile: seedPath } : {}),
  });
}

export async function runProductionPlusOrchestrator(args, options = {}) {
  const outputDir = resolve(args.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const skipPreflight =
    args.skipPreflight === true &&
    (!args.productionPlusFinal || options.allowProductionPlusSkipPreflight === true);
  const shouldProbeEndpoints = args.probeEndpoints === true || args.productionPlusFinal === true;
  const { seed, seedPath } = resolveSeed({ ...args, outputDir });
  const resolvedSeed = withRunId(seed, args.runId);
  const resolvedSeedPath = join(outputDir, "resolved-seed.json");
  writeJson(resolvedSeedPath, resolvedSeed);
  let finalManifestPath = args.finalManifest ? resolve(args.finalManifest) : undefined;
  let resolvedFinalManifest;
  let finalManifestValidation;
  if (args.writeFinalManifest) {
    const manifest = buildFinalManifest({ seed: resolvedSeed, runId: args.runId });
    finalManifestPath = resolve(args.writeFinalManifest);
    writeJson(finalManifestPath, manifest);
    resolvedFinalManifest = manifest;
    finalManifestValidation = validateFinalManifest(resolvedFinalManifest, resolvedSeed);
    writeJson(join(outputDir, "final-manifest.validation.json"), finalManifestValidation);
  } else if (finalManifestPath) {
    resolvedFinalManifest = withRunId(readJson(finalManifestPath), args.runId);
    finalManifestValidation = validateFinalManifest(resolvedFinalManifest, resolvedSeed);
    writeJson(join(outputDir, "final-manifest.validation.json"), finalManifestValidation);
  }

  if (resolvedFinalManifest) {
    writeJson(join(outputDir, "final-manifest.resolved.json"), resolvedFinalManifest);
  }

  const runMetadataValidation = validateInputRunMetadata({
    runId: args.runId,
    seed,
    finalManifest: resolvedFinalManifest,
  });
  writeJson(join(outputDir, "run-metadata.validation.json"), runMetadataValidation);

  if (
    runMetadataValidation.status === "invalid" &&
    (args.productionPlusFinal || args.writeFinalManifest)
  ) {
    const gate = runPersonaGate({
      runId: args.runId,
      outputDir,
      dryRun: true,
      apiSeedFile: resolvedSeedPath,
    });
    return withCompletionAudit({
      stage: "run_metadata_invalid",
      runId: args.runId,
      outputDir,
      seedPath,
      resolvedSeedPath,
      finalManifestPath,
      runMetadataValidation,
      finalManifestValidation,
      gate,
    });
  }

  if (
    finalManifestValidation?.status === "invalid" &&
    (args.productionPlusFinal || args.writeFinalManifest)
  ) {
    const gate = runPersonaGate({
      runId: args.runId,
      outputDir,
      dryRun: true,
      apiSeedFile: resolvedSeedPath,
    });
    return withCompletionAudit({
      stage: "final_manifest_invalid",
      runId: args.runId,
      outputDir,
      seedPath,
      resolvedSeedPath,
      finalManifestPath,
      finalManifestValidation,
      gate,
    });
  }

  const finalManifest = resolvedFinalManifest ?? null;
  let playwrightConfig;
  let playwrightConfigPath;
  if (args.productionPlusFinal) {
    playwrightConfig = buildPlaywrightConfig({
      seed: resolvedSeed,
      baseUrl: args.baseUrl,
      vendorUrl: args.vendorUrl,
      adminUrl: args.adminUrl,
      storefrontUrl: args.storefrontUrl,
      storefrontLocale: args.storefrontLocale,
      openclawUrl: args.openclawUrl,
      runId: args.runId,
      productionPlusFinal: true,
      finalManifest,
    });
    const selectorCoverage = buildSelectorCoverageReport({
      config: playwrightConfig,
      ...(args.selectorSourceRoots.length ? { sourceRoots: args.selectorSourceRoots } : {}),
    });
    const selectorCoverageArtifacts = writeSelectorCoverage(outputDir, selectorCoverage);
    if (selectorCoverage.status !== "covered") {
      const gate = runPersonaGate({
        runId: args.runId,
        outputDir,
        dryRun: true,
        apiSeedFile: resolvedSeedPath,
      });
      return withCompletionAudit({
        stage: "selector_coverage_missing",
        runId: args.runId,
        outputDir,
        seedPath,
        resolvedSeedPath,
        finalManifestPath,
        selectorCoverage,
        selectorCoverageArtifacts,
        gate,
      });
    }
  }

  if (args.personaEvidence) {
    const gate = runGateFromEvidence(
      { ...args, outputDir },
      resolve(args.personaEvidence),
      resolvedSeedPath,
    );
    const completionAudit = writeCompletionAudit(outputDir);
    return {
      stage: "gate",
      runId: args.runId,
      outputDir,
      seedPath: resolvedSeedPath,
      resolvedSeedPath,
      finalManifestPath,
      personaEvidencePath: resolve(args.personaEvidence),
      gate,
      completionAudit,
    };
  }

  if (!skipPreflight) {
    const readiness = shouldProbeEndpoints
      ? await evaluateReadinessWithEndpointProbes(options.env ?? process.env, {
          endpointProbeResults: options.endpointProbeResults,
          fetchFn: options.fetchFn,
        })
      : evaluateReadiness(options.env ?? process.env);
    const readinessArtifacts = writeReadiness(outputDir, readiness);
    if (readiness.status !== "ready") {
      const gate = runPersonaGate({
        runId: args.runId,
        outputDir,
        dryRun: true,
        apiSeedFile: resolvedSeedPath,
      });
      return withCompletionAudit({
        stage: "readiness_blocked",
        runId: args.runId,
        outputDir,
        seedPath,
        resolvedSeedPath,
        finalManifestPath,
        readiness,
        readinessArtifacts,
        gate,
      });
    }
  }

  if (args.skipPlaywright) {
    const gate = runPersonaGate({
      runId: args.runId,
      outputDir,
      dryRun: true,
      apiSeedFile: resolvedSeedPath,
    });
    return withCompletionAudit({
      stage: "playwright_skipped",
      runId: args.runId,
      outputDir,
      seedPath,
      resolvedSeedPath,
      finalManifestPath,
      gate,
    });
  }

  playwrightConfig ??= buildPlaywrightConfig({
    seed: resolvedSeed,
    baseUrl: args.baseUrl,
    vendorUrl: args.vendorUrl,
    adminUrl: args.adminUrl,
    storefrontUrl: args.storefrontUrl,
    storefrontLocale: args.storefrontLocale,
    openclawUrl: args.openclawUrl,
    runId: args.runId,
    productionPlusFinal: args.productionPlusFinal,
    finalManifest,
  });
  playwrightConfigPath = join(outputDir, "playwright-config.json");
  writeJson(playwrightConfigPath, playwrightConfig);

  const personaEvidencePath = join(outputDir, "persona-evidence", "persona-evidence.json");
  await runPlaywrightPersona(
    {
      config: playwrightConfigPath,
      out: personaEvidencePath,
    },
    Object.prototype.hasOwnProperty.call(options, "playwright")
      ? { playwright: options.playwright }
      : {},
  );
  const gate = runGateFromEvidence({ ...args, outputDir }, personaEvidencePath, resolvedSeedPath);
  const completionAudit = writeCompletionAudit(outputDir);
  return {
    stage: "gate",
    runId: args.runId,
    outputDir,
    seedPath: resolvedSeedPath,
    resolvedSeedPath,
    finalManifestPath,
    playwrightConfigPath,
    personaEvidencePath,
    gate,
    completionAudit,
  };
}

if (isCli(import.meta.url)) {
  try {
    const args = parseOrchestratorArgs(process.argv.slice(2));
    const result = await runProductionPlusOrchestrator(args);
    console.log(`stage: ${result.stage}`);
    console.log(`output: ${result.outputDir}`);
    if (result.seedPath) console.log(`seed: ${result.seedPath}`);
    if (result.resolvedSeedPath) console.log(`resolved seed: ${result.resolvedSeedPath}`);
    if (result.finalManifestPath) console.log(`final manifest: ${result.finalManifestPath}`);
    if (result.playwrightConfigPath)
      console.log(`playwright config: ${result.playwrightConfigPath}`);
    if (result.personaEvidencePath) console.log(`persona evidence: ${result.personaEvidencePath}`);
    console.log(`verdict: ${result.gate.result.verdict}`);
    if (result.completionAudit) {
      console.log(`completion audit: ${result.completionAudit.audit.status}`);
      console.log(`completion audit report: ${result.completionAudit.artifacts.markdownPath}`);
    }
    console.log(`remediation: ${result.gate.artifacts.remediationMarkdownPath}`);
    process.exitCode =
      result.gate.result.verdict === "production_plus_passed" &&
      (!result.completionAudit || result.completionAudit.audit.status === "complete")
        ? 0
        : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
