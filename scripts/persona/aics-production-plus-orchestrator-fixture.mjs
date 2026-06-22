#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isCli } from "./aics-persona-runner.mjs";
import {
  parseOrchestratorArgs,
  runProductionPlusOrchestrator,
} from "./aics-production-plus-orchestrator.mjs";

const DEFAULT_FIXTURE_PATH = "/private/tmp/aics293-local-smoke.json";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function parseArgs(argv) {
  const fixtureIndex = argv.indexOf("--fixture");
  const fixture = fixtureIndex >= 0 ? argv[fixtureIndex + 1] : DEFAULT_FIXTURE_PATH;
  const orchestratorArgv =
    fixtureIndex >= 0
      ? argv.filter((_, index) => index !== fixtureIndex && index !== fixtureIndex + 1)
      : argv;
  return {
    fixture,
    orchestratorArgs: parseOrchestratorArgs(orchestratorArgv),
  };
}

function applyFixtureEnv(fixture) {
  const pairs = [
    ["DIJIE_VENDOR_ACCESS_TOKEN", fixture.vendor?.token],
    ["DIJIE_ADMIN_ACCESS_TOKEN", fixture.admin?.token],
    ["DIJIE_BUYER_ACCESS_TOKEN", fixture.buyer?.token],
    ["DIJIE_VENDOR_SELLER_ID", fixture.vendor?.sellerId],
  ];
  for (const [name, value] of pairs) {
    if (typeof value === "string" && value.trim()) process.env[name] = value.trim();
  }
}

if (isCli(import.meta.url)) {
  try {
    const { fixture, orchestratorArgs } = parseArgs(process.argv.slice(2));
    applyFixtureEnv(readJson(fixture));
    const result = await runProductionPlusOrchestrator(orchestratorArgs);
    console.log(`stage: ${result.stage}`);
    console.log(`output: ${result.outputDir}`);
    if (result.seedPath) console.log(`seed: ${result.seedPath}`);
    if (result.resolvedSeedPath) console.log(`resolved seed: ${result.resolvedSeedPath}`);
    if (result.finalManifestPath)
      console.log(`final manifest: ${resolve(result.finalManifestPath)}`);
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
