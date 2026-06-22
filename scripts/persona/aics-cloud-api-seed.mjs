#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isCli } from "./aics-persona-runner.mjs";

const DEFAULT_FIXTURE_PATH = "/private/tmp/aics293-local-smoke.json";
const DEFAULT_CATEGORY_REF = "category:marketplace_ops_diagnosis@1";
const DEFAULT_CATEGORY_NAME = "商城运营诊断";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function stringField(record, field) {
  const value = record?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nowRunId() {
  return `aics-cloud-api-seed-${Date.now()}`;
}

function redact(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted-jwt]")
    .replace(
      /\b(token|secret|api[_-]?key|authorization)\b\s*[:=]\s*["']?[^"',}\s]+/giu,
      "$1=[redacted]",
    );
}

function token(fixture, key) {
  const value = fixture?.[key]?.token;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`fixture ${key}.token is required`);
  }
  return value.trim();
}

function rolePackageFiles({
  rolePackageId,
  rolePackageVersion,
  roleTitle,
  categoryRef,
  categoryName,
}) {
  const manifest = {
    manifestVersion: 1,
    rolePackageId,
    version: rolePackageVersion,
    name: roleTitle,
    entrypoint: "role_package/manifest.json",
    permissions: [
      "marketplace.read",
      "gateway.role_read_model",
      "ledger.summary.read",
      "audit.record",
      "document.write",
      "human.confirm",
      "model.chat.analysis",
    ],
    requiredCapabilities: [
      "marketplace.read",
      "gateway.role_read_model",
      "ledger.summary.read",
      "audit.record",
      "document.write",
      "human.confirm",
      "model.chat.analysis",
    ],
    categoryRef,
    categoryName,
    files: [
      "role_package/manifest.json",
      "role_package/listing.md",
      "role_package/README.md",
      "role_package/standards.md",
      "role_package/cadence.md",
      "role_package/validation.md",
    ],
  };

  return [
    { path: "role_package/manifest.json", content: JSON.stringify(manifest, null, 2) },
    {
      path: "role_package/listing.md",
      content: `# ${roleTitle}\n\n面向岗位商城运营人员，读取岗位供给、开通转化、执行成功率、能力路由阻塞、费用摘要和审计记录，输出运营诊断和调度建议。\n`,
    },
    {
      path: "role_package/README.md",
      content: `# ${roleTitle}\n\n这个岗位只读取云端商城和本地 Gateway 的聚合投影，不读取 raw ledger、不直连平台数据库、不绕过调度执行 TaskPackage。\n`,
    },
    {
      path: "role_package/standards.md",
      content:
        "# 交付标准\n\n输出应包含岗位供给观察、开通转化归因、能力路由阻塞、执行成功率、费用摘要、审计摘要、目标建议和调度建议。\n",
    },
    {
      path: "role_package/cadence.md",
      content:
        "# 运行节奏\n\n适用于岗位上新、开通转化异常、执行失败集中出现、能力路由阻塞、费用审计需要复盘时运行。\n",
    },
    {
      path: "role_package/validation.md",
      content:
        "# 验收\n\n通过标准：诊断结论可由运营人员直接执行；费用、开通、执行和审计事实必须来自云端或本地 Gateway readback；风险项必须人工确认。\n",
    },
  ];
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.sellerId ? { "x-seller-id": options.sellerId } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let payload = null;
  const text = await response.text();
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok || payload?.ok === false) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed (${response.status}): ${redact(JSON.stringify(payload))}`,
    );
  }
  return payload;
}

function parseArgs(argv) {
  const args = {
    fixture: DEFAULT_FIXTURE_PATH,
    runId: nowRunId(),
    baseUrl: process.env.DIJIE_CLOUD_BASE_URL || "http://127.0.0.1:9000",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--base-url") args.baseUrl = argv[++i];
    else if (arg === "--run-id") args.runId = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.out) throw new Error("--out is required");
  return args;
}

export async function buildCloudApiSeed(args) {
  const fixture = readJson(args.fixture);
  const baseUrl = args.baseUrl.replace(/\/+$/u, "");
  const vendorToken = token(fixture, "vendor");
  const adminToken = token(fixture, "admin");
  const buyerToken = token(fixture, "buyer");
  const sellerId = stringField(fixture.vendor, "sellerId");
  const runSlug = args.runId.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(-48);
  const rolePackageId = `codex-production-plus-${runSlug}`;
  const rolePackageVersion = "0.1.0";
  const roleTitle = `通用执行引擎验收岗位 ${runSlug}`;
  const categoryRef = process.env.DIJIE_ROLE_CATEGORY_REF || DEFAULT_CATEGORY_REF;
  const categoryName = process.env.DIJIE_ROLE_CATEGORY_NAME || DEFAULT_CATEGORY_NAME;
  const legacyRoleProductId = stringField(fixture, "legacyRoleProductId");

  const upload = await request(baseUrl, "/vendor/dijie/role-packages", {
    method: "POST",
    token: vendorToken,
    sellerId,
    body: {
      files: rolePackageFiles({
        rolePackageId,
        rolePackageVersion,
        roleTitle,
        categoryRef,
        categoryName,
      }),
    },
  });
  const packageId = upload.package?.packageId ?? rolePackageId;
  const packageVersion = upload.package?.packageVersion ?? rolePackageVersion;

  const created = await request(baseUrl, "/vendor/dijie/role-listings", {
    method: "POST",
    token: vendorToken,
    sellerId,
    body: {
      packageId,
      packageVersion,
      title: roleTitle,
      subtitle: "给真人运营人员使用的通用执行引擎验收岗位",
      description:
        "用于生产级闭环验收：岗位包上架、审核、购买者授权、云端执行、结果读回、审计和账本读回。",
      usageInstructions:
        "客户结果：得到可执行的运营诊断报告、问题清单、调度建议、风险摘要和可下载复盘文件。输入资料：岗位商品、订单、开通、执行、能力路由、费用和审计摘要。每日任务：检查新上架岗位、开通转化、执行失败和费用异常，输出当天问题清单和处理建议。每周任务：汇总高频失败原因、重点岗位优化建议、能力路由阻塞和费用趋势，输出周复盘。每月任务：输出月度运营诊断、品类能力缺口、预算复盘和下一月调度计划。验收标准：报告必须能被运营人员直接执行，问题、目标、动作和风险都能追溯到读回事实。失败边界：资料缺失、能力未开通、执行节点不可用或风险过高时必须标记失败并等待人工确认。",
      category: categoryName,
      categoryRef,
      pricing: {
        kind: "one_time_authorization",
        authorizationFeeCents: 0,
        currency: "CNY",
        platformFeeBps: 0,
        developerReceivableBps: 10000,
        developerReceivableCents: 0,
      },
      roleTokenPricing: {
        currency: "CNY",
        inputTokenCentsPerMillion: 120,
        outputTokenCentsPerMillion: 360,
        platformFeeBps: 0,
        developerReceivableBps: 10000,
      },
      confirmationPoints: 1,
    },
  });
  const roleListingId = created.roleListingId;
  if (!roleListingId) throw new Error("role listing create did not return roleListingId");

  const submitted = await request(
    baseUrl,
    `/vendor/dijie/role-listings/${encodeURIComponent(roleListingId)}/submit-review`,
    {
      method: "POST",
      token: vendorToken,
      sellerId,
    },
  );
  const reviewId =
    submitted.reviewId || submitted.review?.id || submitted.listing?.reviewId || roleListingId;

  await request(baseUrl, `/admin/dijie/reviews/${encodeURIComponent(reviewId)}/evaluations`, {
    method: "POST",
    token: adminToken,
    body: {
      roleStandardDecision: "pass",
      safetyComplianceDecision: "pass",
      pricingReasonabilityDecision: "pass",
      summary: "通用执行引擎生产级验收岗位：标准、安全和价格评估通过。",
    },
  });

  const finalized = await request(
    baseUrl,
    `/admin/dijie/reviews/${encodeURIComponent(reviewId)}/finalize`,
    {
      method: "POST",
      token: adminToken,
      body: {
        finalResult: "approved",
        summary: "通用执行引擎生产级验收岗位批准上架。",
      },
    },
  );
  const finalizedReviewId = finalized.reviewId || reviewId;

  await request(
    baseUrl,
    `/vendor/dijie/role-listings/${encodeURIComponent(roleListingId)}/publish`,
    {
      method: "POST",
      token: vendorToken,
      sellerId,
    },
  );

  const authorization = await request(baseUrl, "/dijie/authorizations", {
    method: "POST",
    token: buyerToken,
    body: { roleListingId },
  });
  const entitlementId = authorization.entitlementId;
  if (!entitlementId) throw new Error("authorization did not return entitlementId");

  const execution = await request(baseUrl, "/dijie/executions", {
    method: "POST",
    token: buyerToken,
    body: {
      roleListingId,
      entitlementId,
      confirmCost: true,
      confirmHumanCheckpoints: true,
      taskText:
        "请基于岗位商城运营数据，输出一份真人运营可以直接使用的诊断报告，包含问题清单、目标建议、调度建议、风险摘要和下一步动作。",
    },
  });
  const executionId = execution.executionId;
  const auditRecordId = execution.auditRecordId;
  if (!executionId || !auditRecordId)
    throw new Error("execution did not return executionId and auditRecordId");

  const executionReadback = await request(
    baseUrl,
    `/dijie/executions/${encodeURIComponent(executionId)}`,
    {
      token: buyerToken,
    },
  );
  const ledger = await request(baseUrl, "/dijie/ledger/entries", {
    token: buyerToken,
  });
  const ledgerEntry = (Array.isArray(ledger.entries) ? ledger.entries : []).find(
    (entry) => entry?.executionId === executionId || entry?.execution_id === executionId,
  );
  const ledgerEntryId = ledgerEntry?.id;
  if (!ledgerEntryId) throw new Error("ledger readback did not include an execution ledger entry");

  return {
    schemaVersion: 1,
    runId: args.runId,
    generatedAt: new Date().toISOString(),
    source: "dijie-cloud-api-seed",
    baseUrl,
    ids: {
      rolePackageId: packageId,
      rolePackageVersion: packageVersion,
      roleListingId,
      reviewId: finalizedReviewId,
      entitlementId,
      executionId,
      auditRecordId,
      ledgerEntryId,
      ...(legacyRoleProductId ? { legacyRoleProductId } : {}),
    },
    readback: {
      uploadOk: upload.ok === true,
      listingCreated: created.ok === true,
      reviewSubmitted: submitted.ok === true,
      reviewFinalized: finalized.ok === true,
      authorizationStatus: authorization.entitlement?.status ?? null,
      executionStatus: execution.status ?? execution.execution?.status ?? null,
      executionReadbackStatus:
        executionReadback.execution?.status ?? executionReadback.status ?? null,
      artifactCount: Array.isArray(execution.artifacts) ? execution.artifacts.length : 0,
      ledgerEntryId,
    },
    gaps: [],
  };
}

if (isCli(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const seed = await buildCloudApiSeed(args);
    writeJson(resolve(args.out), seed);
    console.log(`cloud api seed: ${resolve(args.out)}`);
    console.log(`runId: ${seed.runId}`);
    console.log(`roleListingId: ${seed.ids.roleListingId}`);
    console.log(`executionId: ${seed.ids.executionId}`);
    console.log(`ledgerEntryId: ${seed.ids.ledgerEntryId}`);
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
