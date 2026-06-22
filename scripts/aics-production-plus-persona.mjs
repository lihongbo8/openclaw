#!/usr/bin/env node

import { isCli, parseRunnerArgs, runPersonaGate } from "./persona/aics-persona-runner.mjs";

export { parseRunnerArgs, runPersonaGate };

if (isCli(import.meta.url)) {
  try {
    const { result, artifacts } = runPersonaGate(parseRunnerArgs(process.argv.slice(2)));
    console.log(`verdict: ${result.verdict}`);
    console.log(`evidence: ${artifacts.evidencePath}`);
    console.log(`remediation: ${artifacts.remediationMarkdownPath}`);
    process.exitCode = result.verdict === "production_plus_passed" ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
