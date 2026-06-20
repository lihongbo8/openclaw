#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { validateFinalManifest } from "./aics-final-manifest.mjs";
import { isCli, REQUIRED_IDS, STANDARD_PERSONAS } from "./aics-persona-runner.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function id(seed, key) {
  return seed?.ids?.[key] ?? seed?.[key] ?? "";
}

function envBearer(name) {
  return { env: name, prefix: "Bearer " };
}

function envValue(name, fallback = "") {
  return { env: name, fallback };
}

function browserAuthCookie(tokenEnv) {
  return [{ name: "_medusa_jwt", value: { env: tokenEnv }, path: "/" }];
}

const FINAL_PERSONA_SELECTORS = {
  developer: {
    positive: '[data-testid="aics-vendor-role-packages"]',
    negative: '[data-testid="aics-vendor-package-security"]',
  },
  admin_reviewer: {
    positive: '[data-testid="aics-admin-review-console"]',
    negative: '[data-testid="aics-admin-unapproved-listing-gate"]',
  },
  buyer_storefront: {
    positive: '[data-testid="dijie-role-detail-page"]',
    negative: '[data-testid="dijie-role-category-gate"]',
  },
  user_center: {
    positive: '[data-testid="aics-user-execution-detail"]',
    negative: '[data-testid="aics-user-unauthorized-execution-gate"]',
  },
  openclaw_local_operator: {
    positive: '[data-testid="openclaw-aics-local-operator"]',
    negative: '[data-testid="openclaw-aics-execution-token-gate"]',
  },
  ledger_receivables_reader: {
    positive: '[data-testid="aics-ledger-readback"]',
    negative: '[data-testid="aics-receivables-cross-actor-gate"]',
  },
};

function selectorFor(persona, kind) {
  return FINAL_PERSONA_SELECTORS[persona]?.[kind];
}

function personaActions(persona) {
  return [{ type: "click", selector: selectorFor(persona, "positive") }];
}

function stableSelector(selector) {
  return /^\[(?:data-testid|data-aics-persona|data-aics-e2e)=["'][a-z0-9_.:-]+["']\]$/u.test(
    selector ?? "",
  );
}

function containsPlaceholder(value) {
  if (typeof value === "string") return /<[^>]+>/u.test(value);
  if (Array.isArray(value)) return value.some(containsPlaceholder);
  if (value && typeof value === "object") return Object.values(value).some(containsPlaceholder);
  return false;
}

export function validateProductionPlusSelectorContract(config) {
  const errors = [];
  for (const personaName of STANDARD_PERSONAS) {
    const persona = config.personas?.find((item) => item?.name === personaName);
    if (!persona) {
      errors.push(`${personaName}: persona is missing`);
      continue;
    }
    for (const kind of ["positive", "negative"]) {
      const assertions = Array.isArray(persona[kind]) ? persona[kind] : [];
      const hasStableSelector = assertions.some((assertion) => stableSelector(assertion?.selector));
      if (!hasStableSelector) {
        errors.push(
          `${personaName}: ${kind} assertions require at least one stable data-* selector`,
        );
      }
    }
    const actions = Array.isArray(persona.actions) ? persona.actions : [];
    const selectorActions = actions.filter((action) => typeof action?.selector === "string");
    if (!selectorActions.some((action) => stableSelector(action.selector))) {
      errors.push(`${personaName}: actions require at least one stable data-* selector`);
    }
    for (const action of selectorActions) {
      if (!stableSelector(action.selector)) {
        errors.push(`${personaName}: action selector must be a stable data-* selector`);
      }
    }
    if (
      containsPlaceholder(persona.url) ||
      containsPlaceholder(persona.actions) ||
      containsPlaceholder(persona.apiChecks)
    ) {
      errors.push(`${personaName}: final config must not contain <placeholder> values`);
    }
  }
  return errors;
}

export function parseBuildConfigArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--seed") args.seed = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--base-url") args.baseUrl = argv[++i];
    else if (arg === "--vendor-url") args.vendorUrl = argv[++i];
    else if (arg === "--admin-url") args.adminUrl = argv[++i];
    else if (arg === "--storefront-url") args.storefrontUrl = argv[++i];
    else if (arg === "--storefront-locale") args.storefrontLocale = argv[++i];
    else if (arg === "--openclaw-url") args.openclawUrl = argv[++i];
    else if (arg === "--run-id") args.runId = argv[++i];
    else if (arg === "--production-plus-final") args.productionPlusFinal = true;
    else if (arg === "--final-manifest") args.finalManifest = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.out) throw new Error("--out is required");
  if (args.productionPlusFinal && !args.finalManifest) {
    throw new Error("--production-plus-final requires --final-manifest");
  }
  return args;
}

function assertFinalManifest(seed, manifest) {
  const validation = validateFinalManifest(manifest, seed);
  if (validation.status !== "valid") throw new Error(validation.errors.join("; "));
}

function apiCheck(name, persona, kind, url, expectedStatus, tokenEnv, extra = {}) {
  return {
    name: `${persona}: ${name}`,
    persona,
    kind,
    url,
    expectedStatus,
    headers: tokenEnv ? { Authorization: envBearer(tokenEnv) } : {},
    ...extra,
  };
}

export function buildPlaywrightConfig({
  seed = {},
  baseUrl,
  vendorUrl,
  adminUrl,
  storefrontUrl,
  storefrontLocale,
  openclawUrl,
  runId,
  productionPlusFinal = false,
  finalManifest = null,
} = {}) {
  if (productionPlusFinal) assertFinalManifest(seed, finalManifest);
  const resolvedRunId = runId ?? finalManifest?.runId ?? seed?.runId ?? "";
  const roleListingId = id(seed, "roleListingId") || "<roleListingId>";
  const executionId = id(seed, "executionId") || "<executionId>";
  const ledgerEntryId = id(seed, "ledgerEntryId") || "<ledgerEntryId>";
  const adminProductId =
    id(seed, "adminProductId") || id(seed, "productId") || id(seed, "legacyRoleProductId") || "";
  const requiredIds = Object.fromEntries(
    REQUIRED_IDS.map((key) => [key, id(seed, key) || finalManifest?.[key] || ""]).filter(
      ([, value]) => typeof value === "string" && value.trim() && !containsPlaceholder(value),
    ),
  );
  const cloudBaseUrl = baseUrl ?? { env: "DIJIE_CLOUD_BASE_URL" };
  const vendorBaseUrl =
    vendorUrl ?? envValue("DIJIE_VENDOR_FRONTEND_URL", "http://127.0.0.1:7001/seller");
  const adminBaseUrl =
    adminUrl ?? envValue("DIJIE_ADMIN_FRONTEND_URL", "http://127.0.0.1:7000/dashboard");
  const storefrontBaseUrl =
    storefrontUrl ?? envValue("DIJIE_STOREFRONT_URL", "http://127.0.0.1:3036");
  const localBaseUrl = openclawUrl ?? { env: "OPENCLAW_LOCAL_URL" };
  const resolvedStorefrontLocale = storefrontLocale ?? process.env.AICS_STOREFRONT_LOCALE ?? "us";
  const readinessGap = productionPlusFinal
    ? []
    : ["generated readiness scaffold; add final manifest before claiming production-plus"];

  const config = {
    schemaVersion: 1,
    headless: true,
    timeoutMs: 15_000,
    ...(resolvedRunId ? { runId: resolvedRunId } : {}),
    baseUrl: cloudBaseUrl,
    apiBaseUrl: cloudBaseUrl,
    vendorBaseUrl,
    adminBaseUrl,
    storefrontBaseUrl,
    openclawBaseUrl: localBaseUrl,
    productionPlusFinal,
    requiredIds,
    finalProbes: productionPlusFinal ? finalManifest.coverage : {},
    modelTokenBillingExpected: productionPlusFinal ? finalManifest.modelTokenBilling : null,
    freshApiSeed: productionPlusFinal,
    openclawMainChatProbe: {
      baseUrl: localBaseUrl,
      url: "/chat",
      selector: '[data-testid="main-chat"]',
      expectedText: "OpenClaw",
      extraHTTPHeaders: { Authorization: envBearer("DIJIE_INTERNAL_BRIDGE_BEARER") },
    },
    localPageProbes: [
      {
        name: "openclaw_api_management_model_pricing",
        path: "api_management_model_pricing",
        baseUrl: localBaseUrl,
        url: "/api-management",
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
        extraHTTPHeaders: { Authorization: envBearer("DIJIE_INTERNAL_BRIDGE_BEARER") },
      },
      {
        name: "openclaw_billing_model_metering",
        path: "billing_model_metering",
        baseUrl: localBaseUrl,
        url: "/usage",
        selector: '[data-testid="openclaw-billing-model-metering"]',
        expectedText: "模型 Token 费用读回",
        expectedTexts: ["模型 Token 费用读回", "岗位执行", "gpt-5.5", "¥0.03"],
        extraHTTPHeaders: { Authorization: envBearer("DIJIE_INTERNAL_BRIDGE_BEARER") },
      },
    ],
    gaps: readinessGap,
    personas: [
      {
        name: "developer",
        baseUrl: vendorBaseUrl,
        url: "/products/create",
        apiBaseUrl: cloudBaseUrl,
        extraHTTPHeaders: {
          Authorization: envBearer("DIJIE_VENDOR_ACCESS_TOKEN"),
          "x-seller-id": { env: "DIJIE_VENDOR_SELLER_ID" },
        },
        actions: personaActions("developer"),
        positive: [
          {
            name: "developer: vendor package flow visible",
            selector: selectorFor("developer", "positive"),
            mustContain: "岗位",
          },
        ],
        negative: [
          {
            name: "developer: secret package rejected",
            selector: selectorFor("developer", "negative"),
            mustNotContain: "Bearer ",
          },
        ],
        apiChecks: [
          apiCheck(
            "partial draft submit is rejected",
            "developer",
            "negative",
            "/vendor/dijie/role-packages",
            [400, 401, 403, 409],
            "DIJIE_VENDOR_ACCESS_TOKEN",
            {
              method: "POST",
              headers: {
                Authorization: envBearer("DIJIE_VENDOR_ACCESS_TOKEN"),
                "x-seller-id": { env: "DIJIE_VENDOR_SELLER_ID" },
              },
              body: { files: [] },
            },
          ),
        ],
      },
      {
        name: "admin_reviewer",
        baseUrl: adminBaseUrl,
        url: "/",
        apiBaseUrl: cloudBaseUrl,
        extraHTTPHeaders: { Authorization: envBearer("DIJIE_ADMIN_ACCESS_TOKEN") },
        actions: [
          ...(adminProductId
            ? [{ type: "navigateSpa", path: `/dashboard/products/${adminProductId}`, ms: 500 }]
            : []),
          ...personaActions("admin_reviewer"),
        ],
        positive: [
          {
            name: "admin_reviewer: review console visible",
            selector: selectorFor("admin_reviewer", "positive"),
            mustContain: "审核",
          },
        ],
        negative: [
          {
            name: "admin_reviewer: unapproved listing not published",
            selector: selectorFor("admin_reviewer", "negative"),
            mustNotContain: "Bearer ",
          },
        ],
        apiChecks: [
          apiCheck(
            "unapproved publish is rejected",
            "admin_reviewer",
            "negative",
            `/admin/dijie/role-listings/${roleListingId}/publish`,
            [400, 401, 403, 409],
            "DIJIE_ADMIN_ACCESS_TOKEN",
            { method: "POST" },
          ),
        ],
      },
      {
        name: "buyer_storefront",
        baseUrl: storefrontBaseUrl,
        url: `/${resolvedStorefrontLocale}/roles/${roleListingId}`,
        apiBaseUrl: cloudBaseUrl,
        cookies: browserAuthCookie("DIJIE_BUYER_ACCESS_TOKEN"),
        extraHTTPHeaders: { Authorization: envBearer("DIJIE_BUYER_ACCESS_TOKEN") },
        actions: personaActions("buyer_storefront"),
        positive: [
          {
            name: "buyer_storefront: published role page visible",
            selector: selectorFor("buyer_storefront", "positive"),
            mustContain: "岗位",
          },
        ],
        negative: [
          {
            name: "buyer_storefront: page hides secrets",
            selector: selectorFor("buyer_storefront", "negative"),
            mustNotContain: "Bearer ",
          },
        ],
        apiChecks: [
          apiCheck(
            "anonymous authorization is rejected",
            "buyer_storefront",
            "negative",
            "/dijie/authorizations",
            [401, 403],
            null,
            { method: "POST", headers: { Authorization: "" } },
          ),
        ],
      },
      {
        name: "user_center",
        baseUrl: storefrontBaseUrl,
        url: `/${resolvedStorefrontLocale}/user/executions/${executionId}`,
        apiBaseUrl: cloudBaseUrl,
        cookies: browserAuthCookie("DIJIE_BUYER_ACCESS_TOKEN"),
        extraHTTPHeaders: { Authorization: envBearer("DIJIE_BUYER_ACCESS_TOKEN") },
        actions: personaActions("user_center"),
        positive: [
          {
            name: "user_center: execution readback visible",
            selector: selectorFor("user_center", "positive"),
            mustContain: "执行",
          },
        ],
        negative: [
          {
            name: "user_center: unauthorized execution blocked",
            selector: selectorFor("user_center", "negative"),
            mustNotContain: "Bearer ",
          },
        ],
        apiChecks: [
          apiCheck(
            "execution readback captures audit id",
            "user_center",
            "positive",
            `/dijie/executions/${executionId}`,
            [200],
            "DIJIE_BUYER_ACCESS_TOKEN",
            { capture: { auditRecordId: "auditRecordId" } },
          ),
          apiCheck(
            "execution without confirmation is rejected",
            "user_center",
            "negative",
            "/dijie/executions",
            [400, 401, 403],
            "DIJIE_BUYER_ACCESS_TOKEN",
            { method: "POST" },
          ),
        ],
      },
      {
        name: "openclaw_local_operator",
        baseUrl: localBaseUrl,
        url: "/aics",
        extraHTTPHeaders: { Authorization: envBearer("DIJIE_INTERNAL_BRIDGE_BEARER") },
        actions: personaActions("openclaw_local_operator"),
        positive: [
          {
            name: "openclaw_local_operator: local app visible",
            selector: selectorFor("openclaw_local_operator", "positive"),
            mustContain: "OpenClaw",
          },
        ],
        negative: [
          {
            name: "openclaw_local_operator: missing execution token blocked",
            selector: selectorFor("openclaw_local_operator", "negative"),
            mustNotContain: "Bearer ",
          },
        ],
        apiChecks: [
          apiCheck(
            "audit upload without execution bearer is rejected",
            "openclaw_local_operator",
            "negative",
            "/dijie/audit",
            [401, 403],
            "DIJIE_INTERNAL_BRIDGE_BEARER",
            { baseUrl: cloudBaseUrl, method: "POST" },
          ),
          apiCheck(
            "model token billing readback",
            "openclaw_local_operator",
            "positive",
            "/aics/api-connections/read-model",
            [200],
            "DIJIE_INTERNAL_BRIDGE_BEARER",
            { baseUrl: localBaseUrl, captureModelTokenBilling: true },
          ),
        ],
      },
      {
        name: "ledger_receivables_reader",
        baseUrl: storefrontBaseUrl,
        url: `/${resolvedStorefrontLocale}/user/orders`,
        apiBaseUrl: cloudBaseUrl,
        cookies: browserAuthCookie("DIJIE_BUYER_ACCESS_TOKEN"),
        extraHTTPHeaders: { Authorization: envBearer("DIJIE_BUYER_ACCESS_TOKEN") },
        actions: personaActions("ledger_receivables_reader"),
        positive: [
          {
            name: "ledger_receivables_reader: ledger readback visible",
            selector: selectorFor("ledger_receivables_reader", "positive"),
            mustContain: "账本",
          },
        ],
        negative: [
          {
            name: "ledger_receivables_reader: cross actor readback rejected",
            selector: selectorFor("ledger_receivables_reader", "negative"),
            mustNotContain: "Bearer ",
          },
        ],
        apiChecks: [
          apiCheck(
            "role usage ledger entries readback",
            "ledger_receivables_reader",
            "positive",
            "/dijie/ledger/entries",
            [200],
            "DIJIE_BUYER_ACCESS_TOKEN",
          ),
          apiCheck(
            "buyer cannot read vendor receivables",
            "ledger_receivables_reader",
            "negative",
            "/vendor/dijie/receivables",
            [401, 403],
            "DIJIE_BUYER_ACCESS_TOKEN",
          ),
        ],
      },
    ],
  };
  if (productionPlusFinal) {
    const selectorErrors = validateProductionPlusSelectorContract(config);
    if (selectorErrors.length)
      throw new Error(`invalid production-plus selector contract: ${selectorErrors.join("; ")}`);
  }
  return config;
}

export function runBuildPlaywrightConfig(args) {
  const seed = args.seed ? readJson(args.seed) : {};
  const finalManifest = args.finalManifest ? readJson(args.finalManifest) : null;
  const config = buildPlaywrightConfig({
    seed,
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
  writeJson(resolve(args.out), config);
  return config;
}

if (isCli(import.meta.url)) {
  try {
    const args = parseBuildConfigArgs(process.argv.slice(2));
    runBuildPlaywrightConfig(args);
    console.log(`playwright config: ${resolve(args.out)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
