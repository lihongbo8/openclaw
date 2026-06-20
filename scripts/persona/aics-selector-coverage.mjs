#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { buildPlaywrightConfig } from "./aics-build-playwright-config.mjs";
import { buildFinalManifest } from "./aics-final-manifest.mjs";
import { isCli } from "./aics-persona-runner.mjs";

const DEFAULT_SOURCE_ROOTS = [
  "ui/src",
  "../dijie-b2c-marketplace-storefront/src",
  "../dijie-role-marketplace/apps",
  "../dijie-role-marketplace/packages",
];

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".html",
  ".vue",
  ".svelte",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fileExtension(path) {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index) : "";
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (current) => {
    const stat = statSync(current);
    if (stat.isDirectory()) {
      const name = current.split(/[\\/]/u).at(-1);
      if (["node_modules", ".next", "dist", "build", ".git", ".turbo", "coverage"].includes(name))
        return;
      for (const entry of readdirSync(current)) visit(join(current, entry));
      return;
    }
    if (stat.isFile() && SOURCE_EXTENSIONS.has(fileExtension(current))) files.push(current);
  };
  visit(root);
  return files;
}

function selectorId(selector) {
  const match = /^\[(?:data-testid|data-aics-persona|data-aics-e2e)=["']([^"']+)["']\]$/u.exec(
    selector ?? "",
  );
  return match?.[1] ?? null;
}

function extractRequiredSelectors(config) {
  const selectors = [];
  const mainChatSelector = selectorId(config.openclawMainChatProbe?.selector);
  if (mainChatSelector) {
    selectors.push({
      persona: "openclaw_main_chat",
      kind: "probe",
      selector: config.openclawMainChatProbe.selector,
      id: mainChatSelector,
      assertionName: "openclaw_main_chat: main chat probe",
    });
  }
  for (const persona of config.personas ?? []) {
    for (const kind of ["positive", "negative"]) {
      for (const assertion of persona[kind] ?? []) {
        const id = selectorId(assertion.selector);
        if (!id) continue;
        selectors.push({
          persona: persona.name,
          kind,
          selector: assertion.selector,
          id,
          assertionName: assertion.name,
        });
      }
    }
    for (const [index, action] of (persona.actions ?? []).entries()) {
      const id = selectorId(action.selector);
      if (!id) continue;
      selectors.push({
        persona: persona.name,
        kind: "action",
        selector: action.selector,
        id,
        assertionName: `${persona.name}: action ${index + 1}`,
      });
    }
  }
  return selectors;
}

function sourceMatches(files, id) {
  const matches = [];
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    if (!content.includes(id)) continue;
    matches.push(file);
  }
  return matches;
}

function buildSeedFromManifest(manifest) {
  return {
    ids: {
      rolePackageId: manifest.rolePackageId,
      rolePackageVersion: manifest.rolePackageVersion,
      roleListingId: manifest.roleListingId,
      reviewId: manifest.reviewId,
      entitlementId: manifest.entitlementId,
      executionId: manifest.executionId,
      auditRecordId: manifest.auditRecordId,
      ledgerEntryId: manifest.ledgerEntryId,
    },
  };
}

function defaultFinalManifest() {
  const seed = {
    ids: {
      rolePackageId: "pkg_selector_contract",
      rolePackageVersion: "1.0.0",
      roleListingId: "role_selector_contract",
      reviewId: "review_selector_contract",
      entitlementId: "ent_selector_contract",
      executionId: "exec_selector_contract",
      auditRecordId: "audit_selector_contract",
      ledgerEntryId: "ledger_selector_contract",
    },
  };
  return buildFinalManifest({ seed, runId: "selector-contract" });
}

export function buildSelectorCoverageReport(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const manifest = options.finalManifest ?? defaultFinalManifest();
  const config =
    options.config ??
    buildPlaywrightConfig({
      seed: buildSeedFromManifest(manifest),
      productionPlusFinal: true,
      finalManifest: manifest,
    });
  const sourceRoots = (options.sourceRoots ?? DEFAULT_SOURCE_ROOTS).map((root) =>
    resolve(cwd, root),
  );
  const files = sourceRoots.flatMap(walkFiles);
  const requiredSelectors = extractRequiredSelectors(config);
  const selectors = requiredSelectors.map((entry) => {
    const matches = sourceMatches(files, entry.id);
    return {
      ...entry,
      status: matches.length ? "covered" : "missing",
      matches: matches.map((file) => relative(cwd, file)),
    };
  });
  const missing = selectors.filter((entry) => entry.status === "missing");
  return {
    status: missing.length ? "missing" : "covered",
    generatedAt: new Date().toISOString(),
    sourceRoots: sourceRoots.map((root) => relative(cwd, root)),
    scannedFileCount: files.length,
    requiredSelectorCount: requiredSelectors.length,
    coveredSelectorCount: selectors.length - missing.length,
    missingSelectorCount: missing.length,
    selectors,
  };
}

export function renderSelectorCoverageMarkdown(report) {
  return [
    "# AICS persona selector coverage",
    "",
    `- status: \`${report.status}\``,
    `- scanned files: \`${report.scannedFileCount}\``,
    `- required selectors: \`${report.requiredSelectorCount}\``,
    `- covered selectors: \`${report.coveredSelectorCount}\``,
    `- missing selectors: \`${report.missingSelectorCount}\``,
    "",
    "## Selectors",
    "",
    ...report.selectors.map(
      (entry) =>
        `- ${entry.status === "covered" ? "PASS" : "MISSING"} \`${entry.id}\` (${entry.persona}/${entry.kind})${entry.matches.length ? ` -> ${entry.matches.join(", ")}` : ""}`,
    ),
    "",
  ].join("\n");
}

export function parseSelectorCoverageArgs(argv) {
  const args = { sourceRoots: [], strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--markdown") args.markdown = argv[++i];
    else if (arg === "--source-root") args.sourceRoots.push(argv[++i]);
    else if (arg === "--final-manifest") args.finalManifest = argv[++i];
    else if (arg === "--strict") args.strict = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function runSelectorCoverage(args = {}) {
  const finalManifest = args.finalManifest ? readJson(args.finalManifest) : undefined;
  const report = buildSelectorCoverageReport({
    finalManifest,
    ...(args.sourceRoots?.length ? { sourceRoots: args.sourceRoots } : {}),
  });
  if (args.out) writeJson(resolve(args.out), report);
  if (args.markdown) {
    mkdirSync(dirname(resolve(args.markdown)), { recursive: true });
    writeFileSync(resolve(args.markdown), renderSelectorCoverageMarkdown(report));
  }
  return report;
}

if (isCli(import.meta.url)) {
  try {
    const args = parseSelectorCoverageArgs(process.argv.slice(2));
    const report = runSelectorCoverage(args);
    console.log(`selector coverage: ${report.status}`);
    console.log(
      `required=${report.requiredSelectorCount} covered=${report.coveredSelectorCount} missing=${report.missingSelectorCount}`,
    );
    process.exitCode = args.strict && report.status !== "covered" ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
