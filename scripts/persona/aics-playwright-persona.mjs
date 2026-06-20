#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isCli } from "./aics-persona-runner.mjs";

const CAPTURE_ID_ALLOWLIST = new Set([
  "rolePackageId",
  "rolePackageVersion",
  "roleListingId",
  "reviewId",
  "orderId",
  "entitlementId",
  "executionId",
  "auditRecordId",
  "ledgerEntryId",
]);

const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/i,
  /\b(?:token|secret|api[_-]?key)\b\s*[:=]\s*["']?[^"'\s]{8,}/i,
  /\/Users\/[^\s"'`]+|\/home\/[^\s"'`]+/i,
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeNdjson(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url);
}

function envValue(value) {
  if (typeof value === "string") return value;
  if (value?.env) {
    const raw = process.env[value.env] ?? value.fallback ?? "";
    if (!raw) return "";
    return `${value.prefix ?? ""}${raw}${value.suffix ?? ""}`;
  }
  return "";
}

function resolveHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, envValue(value)]));
}

function resolveCookies(cookies = [], targetUrl) {
  return asArray(cookies)
    .map((cookie) => {
      const record = asRecord(cookie);
      const name = envValue(record.name);
      const value = envValue(record.value);
      if (!name || !value) return null;
      const url = envValue(record.url) || (!record.domain ? targetUrl : "");
      return {
        name,
        value,
        ...(url
          ? { url }
          : {
              domain: envValue(record.domain),
              path: envValue(record.path) || "/",
            }),
        ...(record.expires ? { expires: Number(record.expires) } : {}),
        ...(record.httpOnly !== undefined ? { httpOnly: Boolean(record.httpOnly) } : {}),
        ...(record.secure !== undefined ? { secure: Boolean(record.secure) } : {}),
        ...(record.sameSite ? { sameSite: envValue(record.sameSite) } : {}),
      };
    })
    .filter(Boolean);
}

function resolveBaseUrl(value) {
  return envValue(value);
}

function joinUrlPreservingBasePath(base, url) {
  if (isHttpUrl(url)) return url;
  if (!base) return url;
  const baseUrl = new URL(base);
  const rawUrl = String(url ?? "/");
  if (rawUrl.startsWith("/")) {
    const basePath = baseUrl.pathname.replace(/\/+$/u, "");
    baseUrl.pathname = `${basePath}${rawUrl}`.replace(/\/{2,}/gu, "/") || "/";
    baseUrl.search = "";
    baseUrl.hash = "";
    return baseUrl.toString();
  }
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return new URL(rawUrl, normalizedBase).toString();
}

function resolveUrl(config, persona) {
  const base = resolveBaseUrl(persona.baseUrl ?? config.baseUrl);
  const url = persona.url ?? "/";
  if (!base) return url;
  return joinUrlPreservingBasePath(base, url);
}

function resolveApiBaseUrl(config, persona, check) {
  return resolveBaseUrl(
    check.baseUrl ??
      check.apiBaseUrl ??
      persona.apiBaseUrl ??
      persona.baseUrl ??
      config.apiBaseUrl ??
      config.baseUrl,
  );
}

function sanitizeUrl(url) {
  return String(url).replace(/([?&](?:token|key|secret|bearer)=)[^&]+/gi, "$1[redacted]");
}

function createSecretScan() {
  return {
    leakCount: 0,
    surfaces: {},
  };
}

function redactSecretSample(text) {
  return String(text)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "sk-[redacted]")
    .replace(/\b(token|secret|api[_-]?key)\b\s*[:=]\s*["']?[^"'\s]{8,}/gi, "$1=[redacted]")
    .replace(/\/Users\/[^\s"'`]+|\/home\/[^\s"'`]+/gi, "[local-path]");
}

function recordSecretScanHits(scan, surface, ...values) {
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    for (const pattern of SECRET_PATTERNS) {
      if (!pattern.test(value)) continue;
      scan.leakCount += 1;
      scan.surfaces[surface] ??= [];
      if (scan.surfaces[surface].length < 3) {
        scan.surfaces[surface].push(redactSecretSample(value.slice(0, 160)));
      }
      break;
    }
  }
}

function makeBlockedEvidence(config, reason) {
  const personas = asArray(config.personas).map((persona) => ({
    name: persona.name,
    status: "blocked",
    reason,
  }));
  return {
    schemaVersion: 2,
    ...(config.runId ? { runId: config.runId } : {}),
    source: "playwright",
    realBrowser: false,
    realApplication: false,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    personas,
    positive: [],
    negative: [],
    proof: {
      generatedBy: "aics-playwright-persona",
      screenshotCount: 0,
      pageProbeCount: 0,
      actionCount: 0,
      failedActionCount: 0,
      actionTrace: [],
      apiCheckCount: 0,
      apiChecks: [],
      capturedIdFields: [],
    },
    ids: {},
    finalProbes: config.finalProbes ?? {},
    modelTokenBilling: null,
    openclawMainChat: {
      status: "blocked",
      source: "missing",
      path: "main_chat",
      blockedReason: {
        code: "playwright_unavailable",
        stage: "main_chat",
      },
    },
    localPageProbes: [],
    secretScan: { leakCount: 0, surfaces: {} },
    gaps: [reason, ...asArray(config.gaps)],
  };
}

function textMatches(text, expected) {
  return typeof expected === "string" ? text.includes(expected) : false;
}

function assertionResult(personaName, assertion, passed) {
  return {
    name: assertion.name ?? `${personaName}: assertion`,
    persona: personaName,
    status: passed ? "passed" : "failed",
  };
}

function actionTraceEntry(personaName, action, order) {
  return {
    ts: new Date().toISOString(),
    persona: personaName,
    order,
    type: action.type ?? "unknown",
    ...(action.selector ? { selector: action.selector } : {}),
    ...(action.url ? { url: sanitizeUrl(action.url) } : {}),
    ...(action.key ? { key: action.key } : {}),
    ...(action.type === "fill" ? { valueLength: String(action.value ?? "").length } : {}),
    ...(action.type === "selectOption" ? { valueProvided: action.value !== undefined } : {}),
    ...(action.type === "wait" ? { ms: Number(action.ms ?? 250) } : {}),
  };
}

async function runActions(page, personaName, actions = []) {
  const trace = [];
  for (const [index, action] of actions.entries()) {
    const entry = actionTraceEntry(personaName, action, index + 1);
    try {
      if (action.type === "click") await page.click(action.selector, action.options ?? {});
      else if (action.type === "fill") await page.fill(action.selector, action.value ?? "");
      else if (action.type === "check") await page.check(action.selector, action.options ?? {});
      else if (action.type === "uncheck") await page.uncheck(action.selector, action.options ?? {});
      else if (action.type === "press") await page.press(action.selector, action.key);
      else if (action.type === "selectOption")
        await page.selectOption(action.selector, action.value);
      else if (action.type === "navigateSpa") {
        await page.evaluate(
          (path) => {
            window.history.pushState({}, "", path);
            window.dispatchEvent(new PopStateEvent("popstate"));
          },
          action.path ?? action.url ?? "/",
        );
        await page.waitForTimeout(Number(action.ms ?? 250));
      } else if (action.type === "waitForSelector")
        await page.waitForSelector(action.selector, action.options ?? {});
      else if (action.type === "waitForURL")
        await page.waitForURL(action.url, action.options ?? {});
      else if (action.type === "wait") await page.waitForTimeout(Number(action.ms ?? 250));
      else throw new Error(`Unsupported action type: ${action.type}`);
      trace.push({ ...entry, status: "passed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const redactedMessage = redactSecretSample(message);
      trace.push({ ...entry, status: "failed", error: redactedMessage });
      const actionError = new Error(redactedMessage);
      actionError.actionTrace = trace;
      throw actionError;
    }
  }
  return trace;
}

async function runAssertions(page, personaName, assertions = [], pageText = "") {
  const results = [];
  for (const assertion of assertions) {
    let passed = true;
    if (assertion.selector) {
      const match = await page.locator(assertion.selector).count();
      passed = match > 0;
    }
    if (assertion.mustContain) passed = passed && textMatches(pageText, assertion.mustContain);
    if (assertion.mustNotContain)
      passed = passed && !textMatches(pageText, assertion.mustNotContain);
    results.push(assertionResult(personaName, assertion, passed));
  }
  return results;
}

function expectedStatusMatches(expected, actual) {
  const values = Array.isArray(expected) ? expected : [expected ?? 200];
  return values.includes(actual);
}

function captureIds(target, body, capture = {}) {
  if (!body || typeof body !== "object") return;
  for (const [idKey, path] of Object.entries(capture)) {
    if (!CAPTURE_ID_ALLOWLIST.has(idKey)) continue;
    const value = String(path)
      .split(".")
      .reduce((current, segment) => current?.[segment], body);
    if (typeof value === "string" && value.trim()) target[idKey] = value.trim();
  }
}

function initialIdsFromConfig(config) {
  const ids = {};
  for (const [idKey, value] of Object.entries(asRecord(config.requiredIds))) {
    if (!CAPTURE_ID_ALLOWLIST.has(idKey)) continue;
    if (typeof value === "string" && value.trim() && !/<[^>]+>/u.test(value)) {
      ids[idKey] = value.trim();
    }
  }
  return ids;
}

function entriesFromApiConnectionsReadback(body) {
  const root = asRecord(body?.readModel ?? body?.apiConnections ?? body);
  if (Array.isArray(root.entries)) return root.entries;
  const groups = asRecord(root.groups);
  return Object.values(groups).flatMap((group) => (Array.isArray(group) ? group : []));
}

function normalizeModelTokenBillingReadback(body, expected = null) {
  const expectedRecord = asRecord(expected);
  const expectedProvider = String(expectedRecord.provider ?? "").trim();
  const expectedModel = String(expectedRecord.model ?? "").trim();
  const entries = entriesFromApiConnectionsReadback(body);
  const modelEntries = entries.filter((entry) => {
    const record = asRecord(entry);
    if (record.kind !== "model") return false;
    if (expectedProvider && record.provider !== expectedProvider) return false;
    const metadata = asRecord(record.metadata);
    if (expectedModel && metadata.defaultModel !== expectedModel) return false;
    return true;
  });
  const entry =
    modelEntries.find((candidate) => {
      const metadata = asRecord(asRecord(candidate).metadata);
      const metering = asRecord(metadata.metering ?? metadata.usage);
      const byConsumer = asRecord(metering.byConsumer);
      const roleExecution = asRecord(byConsumer.role_execution);
      return finiteNumber(roleExecution.totalTokens) > 0 && finiteNumber(roleExecution.costCny) > 0;
    }) ?? modelEntries[0];
  if (!entry) return null;

  const record = asRecord(entry);
  const metadata = asRecord(record.metadata);
  const pricing = asRecord(metadata.pricing);
  const metering = asRecord(metadata.metering ?? metadata.usage);
  const byConsumer = asRecord(metering.byConsumer);
  const roleExecution = asRecord(byConsumer.role_execution);
  const normalizedByConsumer = Object.fromEntries(
    Object.entries(byConsumer).map(([consumer, value]) => {
      const record = asRecord(value);
      return [
        consumer,
        {
          calls: finiteNumber(record.calls),
          inputTokens: finiteNumber(record.inputTokens),
          outputTokens: finiteNumber(record.outputTokens),
          totalTokens: finiteNumber(record.totalTokens),
          costCny: finiteNumber(record.costCny),
        },
      ];
    }),
  );
  if (!normalizedByConsumer.role_execution) {
    normalizedByConsumer.role_execution = {
      calls: finiteNumber(roleExecution.calls),
      inputTokens: finiteNumber(roleExecution.inputTokens),
      outputTokens: finiteNumber(roleExecution.outputTokens),
      totalTokens: finiteNumber(roleExecution.totalTokens),
      costCny: finiteNumber(roleExecution.costCny),
    };
  }
  return {
    source: "api_readback",
    status: "passed",
    apiConnectionId: String(record.id ?? ""),
    provider: String(record.provider ?? ""),
    model: String(metadata.defaultModel ?? ""),
    pricing,
    inputTokens: finiteNumber(metering.inputTokens),
    outputTokens: finiteNumber(metering.outputTokens),
    totalTokens: finiteNumber(metering.totalTokens),
    costCny: finiteNumber(metering.costCny),
    byConsumer: normalizedByConsumer,
  };
}

async function runApiChecks(context, config, persona, ids, secretScan) {
  const results = [];
  let modelTokenBilling = null;
  for (const check of asArray(persona.apiChecks)) {
    if (!check || typeof check !== "object") continue;
    const url = joinUrlPreservingBasePath(
      resolveApiBaseUrl(config, persona, check),
      check.url ?? "/",
    );
    recordSecretScanHits(secretScan, `${persona.name}:api-url`, url);
    const response = await context.request.fetch(url, {
      method: check.method ?? "GET",
      headers: resolveHeaders(check.headers ?? persona.extraHTTPHeaders ?? {}),
      data: check.body,
    });
    const status = response.status();
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (json) recordSecretScanHits(secretScan, `${persona.name}:api-json`, JSON.stringify(json));
    const passed = expectedStatusMatches(check.expectedStatus, status);
    if (passed) captureIds(ids, json, check.capture);
    if (passed && check.captureModelTokenBilling === true) {
      modelTokenBilling = normalizeModelTokenBillingReadback(
        json,
        config.modelTokenBillingExpected,
      );
    }
    results.push({
      name: check.name,
      persona: check.persona ?? persona.name,
      kind: check.kind ?? "positive",
      method: check.method ?? "GET",
      url: sanitizeUrl(url),
      expectedStatus: check.expectedStatus ?? 200,
      status,
      passed,
    });
  }
  return { results, modelTokenBilling };
}

async function collectOpenclawMainChatProbe(browser, config, secretScan, screenshotDir) {
  const probe = asRecord(config.openclawMainChatProbe);
  if (!probe.url) {
    return {
      result: {
        status: "failed",
        source: "missing",
        path: "main_chat",
        blockedReason: { code: "main_chat_probe_missing", stage: "main_chat" },
      },
      screenshotCount: 0,
    };
  }
  const targetUrl = resolveUrl(config, {
    baseUrl: probe.baseUrl ?? config.openclawBaseUrl ?? config.baseUrl,
    url: probe.url,
  });
  recordSecretScanHits(secretScan, "openclaw_main_chat:url", targetUrl);
  if (!isHttpUrl(targetUrl)) {
    return {
      result: {
        status: "failed",
        source: "playwright",
        path: "main_chat",
        url: sanitizeUrl(targetUrl),
        blockedReason: { code: "main_chat_url_not_http", stage: "main_chat" },
      },
      screenshotCount: 0,
    };
  }
  const context = await browser.newContext({
    extraHTTPHeaders: resolveHeaders(probe.extraHTTPHeaders ?? {}),
    viewport: probe.viewport,
    ignoreHTTPSErrors: probe.ignoreHTTPSErrors,
  });
  const page = await context.newPage();
  try {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: probe.timeoutMs ?? config.timeoutMs ?? 15_000,
    });
    const pageText = (await page.textContent("body")) ?? "";
    recordSecretScanHits(secretScan, "openclaw_main_chat:page", pageText);
    const selector = typeof probe.selector === "string" ? probe.selector : undefined;
    const selectorMatched = selector ? (await page.locator(selector).count()) > 0 : true;
    const expectedText = typeof probe.expectedText === "string" ? probe.expectedText : undefined;
    const textMatched = expectedText ? textMatches(pageText, expectedText) : true;
    let screenshotWritten = 0;
    if (screenshotDir) {
      await page.screenshot({
        path: join(screenshotDir, "openclaw-main-chat.png"),
        fullPage: true,
      });
      screenshotWritten = 1;
    }
    return {
      result: {
        status: selectorMatched && textMatched ? "passed" : "failed",
        source: "playwright",
        path: "main_chat",
        url: sanitizeUrl(targetUrl),
        assertion: {
          ...(selector ? { selector } : {}),
          ...(expectedText ? { expectedText } : {}),
          status: selectorMatched && textMatched ? "passed" : "failed",
        },
      },
      screenshotCount: screenshotWritten,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordSecretScanHits(secretScan, "openclaw_main_chat:error", message);
    return {
      result: {
        status: "failed",
        source: "playwright",
        path: "main_chat",
        url: sanitizeUrl(targetUrl),
        blockedReason: {
          code: "main_chat_probe_failed",
          stage: "main_chat",
          message: redactSecretSample(message),
        },
      },
      screenshotCount: 0,
    };
  } finally {
    await context.close?.();
  }
}

async function collectLocalPageProbes(browser, config, secretScan, screenshotDir) {
  const results = [];
  let screenshotCount = 0;
  for (const rawProbe of asArray(config.localPageProbes)) {
    const probe = asRecord(rawProbe);
    const name = String(probe.name ?? probe.path ?? "local_page_probe");
    const path = String(probe.path ?? name);
    const targetUrl = resolveUrl(config, {
      baseUrl: probe.baseUrl ?? config.openclawBaseUrl ?? config.baseUrl,
      url: probe.url ?? "/",
    });
    recordSecretScanHits(secretScan, `${name}:url`, targetUrl);
    if (!isHttpUrl(targetUrl)) {
      results.push({
        name,
        path,
        status: "failed",
        source: "playwright",
        url: sanitizeUrl(targetUrl),
        blockedReason: { code: "local_page_probe_url_not_http", stage: path },
      });
      continue;
    }
    const context = await browser.newContext({
      extraHTTPHeaders: resolveHeaders(probe.extraHTTPHeaders ?? {}),
      viewport: probe.viewport,
      ignoreHTTPSErrors: probe.ignoreHTTPSErrors,
    });
    const page = await context.newPage();
    try {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: probe.timeoutMs ?? config.timeoutMs ?? 15_000,
      });
      const pageText = (await page.textContent("body")) ?? "";
      recordSecretScanHits(secretScan, `${name}:page`, pageText);
      const selector = typeof probe.selector === "string" ? probe.selector : undefined;
      const selectorMatched = selector ? (await page.locator(selector).count()) > 0 : true;
      const expectedText = typeof probe.expectedText === "string" ? probe.expectedText : undefined;
      const expectedTexts = asArray(probe.expectedTexts).filter(
        (item) => typeof item === "string" && item.trim(),
      );
      const textMatched = [...(expectedText ? [expectedText] : []), ...expectedTexts].every(
        (item) => textMatches(pageText, item),
      );
      let screenshotName;
      if (screenshotDir) {
        screenshotName = `${name}.png`.replace(/[^a-z0-9_.-]+/gi, "-");
        await page.screenshot({ path: join(screenshotDir, screenshotName), fullPage: true });
        screenshotCount += 1;
      }
      results.push({
        name,
        path,
        status: selectorMatched && textMatched ? "passed" : "failed",
        source: "playwright",
        url: sanitizeUrl(targetUrl),
        assertion: {
          ...(selector ? { selector } : {}),
          ...(expectedText ? { expectedText } : {}),
          ...(expectedTexts.length ? { expectedTexts } : {}),
          status: selectorMatched && textMatched ? "passed" : "failed",
        },
        ...(screenshotName ? { screenshot: screenshotName } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordSecretScanHits(secretScan, `${name}:error`, message);
      results.push({
        name,
        path,
        status: "failed",
        source: "playwright",
        url: sanitizeUrl(targetUrl),
        blockedReason: {
          code: "local_page_probe_failed",
          stage: path,
          message: redactSecretSample(message),
        },
      });
    } finally {
      await context.close?.();
    }
  }
  return { results, screenshotCount };
}

export function parsePlaywrightPersonaArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") args.config = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.config) throw new Error("--config is required");
  if (!args.out) throw new Error("--out is required");
  return args;
}

export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    return null;
  }
}

export async function collectPlaywrightEvidence(config, options = {}) {
  const playwright = Object.prototype.hasOwnProperty.call(options, "playwright")
    ? options.playwright
    : await loadPlaywright();
  if (!playwright?.chromium) return makeBlockedEvidence(config, "Playwright is not available.");
  const out = options.out ? resolve(options.out) : null;
  const evidenceDir = out ? dirname(out) : null;
  const screenshotDir = out ? join(dirname(out), "screenshots") : null;
  const consolePath = evidenceDir ? join(evidenceDir, "console.ndjson") : null;
  const networkSummaryPath = evidenceDir ? join(evidenceDir, "network-summary.ndjson") : null;
  const actionTracePath = evidenceDir ? join(evidenceDir, "actions.ndjson") : null;
  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const browser = await playwright.chromium.launch({
    headless: config.headless !== false,
    timeout: config.timeoutMs ?? 15_000,
  });
  const personas = [];
  const positive = [];
  const negative = [];
  const apiChecks = [];
  const ids = initialIdsFromConfig(config);
  const gaps = [...asArray(config.gaps)];
  const capturedIdFields = new Set(Object.keys(ids));
  let modelTokenBilling = null;
  let screenshotCount = 0;
  let pageProbeCount = 0;
  let consoleErrorCount = 0;
  let network5xxCount = 0;
  let realApplication = false;
  let openclawMainChat = null;
  let localPageProbes = [];
  const secretScan = createSecretScan();
  const consoleEvents = [];
  const networkEvents = [];
  const actionTrace = [];

  try {
    for (const persona of asArray(config.personas)) {
      const targetUrl = resolveUrl(config, persona);
      recordSecretScanHits(secretScan, `${persona.name}:url`, targetUrl);
      realApplication = realApplication || isHttpUrl(targetUrl);
      const context = await browser.newContext({
        storageState: persona.storageState,
        extraHTTPHeaders: resolveHeaders({
          ...(config.extraHTTPHeaders ?? {}),
          ...(persona.extraHTTPHeaders ?? {}),
        }),
        viewport: persona.viewport,
        ignoreHTTPSErrors: persona.ignoreHTTPSErrors,
      });
      const cookies = resolveCookies(persona.cookies, targetUrl);
      if (cookies.length) await context.addCookies(cookies);
      const page = await context.newPage();
      page.on?.("console", (message) => {
        const type = message.type?.() ?? "unknown";
        const text = message.text?.() ?? "";
        recordSecretScanHits(secretScan, `${persona.name}:console`, text);
        consoleEvents.push({
          ts: new Date().toISOString(),
          persona: persona.name,
          type,
          text: redactSecretSample(text),
        });
        if (type === "error") consoleErrorCount += 1;
      });
      page.on?.("response", (response) => {
        const status = response?.status?.() ?? 0;
        const rawUrl = response?.url?.() ?? "";
        recordSecretScanHits(secretScan, `${persona.name}:network-url`, rawUrl);
        networkEvents.push({
          ts: new Date().toISOString(),
          persona: persona.name,
          status,
          url: sanitizeUrl(rawUrl),
          ok: status > 0 && status < 500,
        });
        if (status >= 500) network5xxCount += 1;
      });
      let status = "passed";
      let reason = null;
      try {
        if (!isHttpUrl(targetUrl)) {
          status = "blocked";
          reason = `persona URL is not an http(s) application URL: ${targetUrl}`;
          gaps.push(reason);
        } else {
          await page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: persona.timeoutMs ?? config.timeoutMs ?? 15_000,
          });
          try {
            const personaActionTrace = await runActions(page, persona.name, persona.actions);
            actionTrace.push(...personaActionTrace);
          } catch (error) {
            if (Array.isArray(error?.actionTrace)) actionTrace.push(...error.actionTrace);
            throw error;
          }
          const pageText = (await page.textContent("body")) ?? "";
          recordSecretScanHits(secretScan, `${persona.name}:page`, pageText);
          const positiveResults = await runAssertions(
            page,
            persona.name,
            persona.positive,
            pageText,
          );
          const negativeResults = await runAssertions(
            page,
            persona.name,
            persona.negative,
            pageText,
          );
          positive.push(...positiveResults);
          negative.push(...negativeResults);
          const { results: apiResults, modelTokenBilling: billingReadback } = await runApiChecks(
            context,
            config,
            persona,
            ids,
            secretScan,
          );
          apiChecks.push(...apiResults);
          if (billingReadback) modelTokenBilling = billingReadback;
          for (const key of Object.keys(ids)) capturedIdFields.add(key);
          if ([...positiveResults, ...negativeResults].some((item) => item.status !== "passed"))
            status = "failed";
          if (apiResults.some((item) => !item.passed)) status = "failed";
          if (screenshotDir) {
            await page.screenshot({
              path: join(screenshotDir, `${persona.name}.png`),
              fullPage: true,
            });
            screenshotCount += 1;
          }
          pageProbeCount += 1;
        }
      } catch (error) {
        status = "failed";
        reason = error instanceof Error ? error.message : String(error);
        recordSecretScanHits(secretScan, `${persona.name}:error`, reason);
        gaps.push(`${persona.name}: ${reason}`);
      } finally {
        await context.close?.();
      }
      personas.push({ name: persona.name, status, ...(reason ? { reason } : {}) });
    }
    const mainChatProbe = await collectOpenclawMainChatProbe(
      browser,
      config,
      secretScan,
      screenshotDir,
    );
    openclawMainChat = mainChatProbe.result;
    screenshotCount += mainChatProbe.screenshotCount;
    const localProbeResult = await collectLocalPageProbes(
      browser,
      config,
      secretScan,
      screenshotDir,
    );
    localPageProbes = localProbeResult.results;
    screenshotCount += localProbeResult.screenshotCount;
    pageProbeCount += localProbeResult.results.length;
  } finally {
    await browser.close?.();
  }

  if (consolePath) writeNdjson(consolePath, consoleEvents);
  if (networkSummaryPath) writeNdjson(networkSummaryPath, networkEvents);
  if (actionTracePath) writeNdjson(actionTracePath, actionTrace);

  return {
    schemaVersion: 2,
    ...(config.runId ? { runId: config.runId } : {}),
    source: "playwright",
    realBrowser: true,
    realApplication,
    startedAt,
    endedAt: new Date().toISOString(),
    freshApiSeed: config.freshApiSeed === true,
    finalProbes: config.finalProbes ?? {},
    modelTokenBilling,
    openclawMainChat: openclawMainChat ?? {
      status: "failed",
      source: "missing",
      path: "main_chat",
    },
    localPageProbes,
    personas,
    positive,
    negative,
    ids,
    proof: {
      generatedBy: "aics-playwright-persona",
      browserName: "chromium",
      personaNames: personas.map((persona) => persona.name),
      pageProbeCount,
      actionCount: actionTrace.length,
      failedActionCount: actionTrace.filter((action) => action.status === "failed").length,
      actionTrace,
      screenshotCount,
      apiCheckCount: apiChecks.length,
      apiChecks,
      capturedIdFields: Array.from(capturedIdFields).sort(),
      consoleErrorCount,
      network5xxCount,
      consoleEventCount: consoleEvents.length,
      networkEventCount: networkEvents.length,
      artifacts: {
        screenshotsDir: "screenshots",
        console: "console.ndjson",
        networkSummary: "network-summary.ndjson",
        actions: "actions.ndjson",
      },
    },
    consoleErrorCount,
    network5xxCount,
    secretScan,
    gaps,
  };
}

export async function runPlaywrightPersona(args, options = {}) {
  const config = readJson(args.config);
  const evidence = await collectPlaywrightEvidence(config, { ...options, out: args.out });
  writeJson(resolve(args.out), evidence);
  return evidence;
}

if (isCli(import.meta.url)) {
  try {
    const args = parsePlaywrightPersonaArgs(process.argv.slice(2));
    const evidence = await runPlaywrightPersona(args);
    console.log(`persona evidence: ${resolve(args.out)}`);
    console.log(
      `personas: ${asArray(evidence.personas)
        .map((persona) => `${persona.name}:${persona.status}`)
        .join(", ")}`,
    );
    process.exitCode =
      evidence.personas?.every((persona) => persona.status === "passed") &&
      evidence.secretScan?.leakCount === 0
        ? 0
        : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
