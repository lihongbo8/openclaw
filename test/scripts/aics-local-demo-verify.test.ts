import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireNodeSqlite } from "../../src/infra/node-sqlite.js";

const seedScriptPath = path.resolve("scripts/aics-local-demo-seed.ts");
const verifyScriptPath = path.resolve("scripts/aics-local-demo-verify.ts");

const roots: string[] = [];

function marketplaceOpsBusinessDeliverables() {
  return [
    { label: "商城运营诊断报告", summary: "已生成本轮岗位商城运营诊断。" },
    { label: "岗位供给分析", summary: "已汇总岗位商品供给与品类覆盖。" },
    { label: "授权转化分析", summary: "已分析 0 元授权转化状态。" },
    { label: "执行成功率分析", summary: "已分析本地执行成功率。" },
    { label: "阻塞原因分析", summary: "已列出能力、授权、审计和账本阻塞。" },
    { label: "日/周/月运营建议", summary: "已给出日、周、月运营动作。" },
    { label: "下一步调度建议", summary: "已给出后续调度建议。" },
    { label: "审计摘要", summary: "已读回审计摘要。" },
    { label: "账本摘要", summary: "已读回账本摘要。" },
  ];
}

function makeRoot(): { root: string; stateDir: string; homeDir: string; configPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-aics-demo-verify-"));
  roots.push(root);
  const stateDir = path.join(root, "state");
  const homeDir = path.join(root, "home");
  const configPath = path.join(stateDir, "openclaw.json");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(configPath, "{}\n", "utf8");
  return { root, stateDir, homeDir, configPath };
}

function envFor(params: { stateDir: string; homeDir: string; configPath: string }) {
  return {
    ...process.env,
    HOME: params.homeDir,
    OPENCLAW_CONFIG_PATH: params.configPath,
    OPENCLAW_STATE_DIR: params.stateDir,
    OPENCLAW_TEST_FAST: "1",
  };
}

function runNodeScript(params: {
  scriptPath: string;
  argv?: string[];
  stateDir: string;
  homeDir: string;
  configPath: string;
}) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", params.scriptPath, ...(params.argv ?? [])],
    {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: envFor(params),
    },
  );
}

function runSeed(params: { stateDir: string; homeDir: string; configPath: string }) {
  const result = runNodeScript({ ...params, scriptPath: seedScriptPath });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function markSeededDemoExecuted(params: { stateDir: string; seed: Record<string, unknown> }) {
  const sqlite = requireNodeSqlite();
  const db = new sqlite.DatabaseSync(path.join(params.stateDir, "aics-pipeline.db"));
  try {
    const executionId = "exec-local-demo-verify-test";
    const roleListingId = String(params.seed.roleListingId);
    const entitlementId = String(params.seed.entitlementId);
    const taskPackageId = String(params.seed.taskPackageId);
    const dispatchToRoleRequestId = String(params.seed.dispatchToRoleRequestId);
    const auditRecordId = `local_audit_${executionId}`;
    const ledgerRef = `ledger:role_execution:${entitlementId}:${executionId}`;
    const now = Date.now();
    db.prepare(
      "INSERT INTO role_results(id,status,task_package_id,dispatch_to_role_request_id,outcome,summary,artifact_refs,execution_evidence,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      executionId,
      "completed",
      taskPackageId,
      dispatchToRoleRequestId,
      "succeeded",
      "商城运营诊断已完成，审计和账本可读回。",
      JSON.stringify([`artifact:role-result:${executionId}:summary`, `audit:${auditRecordId}`]),
      JSON.stringify({
        ledgerRef,
        costSummary: {
          authorizationFeeCents: 0,
          executionFeeCents: 0,
          modelUsageCostCents: 0,
          totalCostCents: 0,
          source: "local_zero_price",
          ledgerRef,
        },
        humanConfirmationRef: `human:confirm:${dispatchToRoleRequestId}:${executionId}`,
        businessDeliverables: marketplaceOpsBusinessDeliverables(),
        modelUsage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          costCents: 0,
        },
      }),
      now,
      now,
      JSON.stringify([]),
    );
    db.prepare(
      "INSERT INTO local_role_ledger_entries(ledger_ref,execution_id,role_listing_id,entitlement_id,authorization_fee_cents,execution_fee_cents,source,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      ledgerRef,
      executionId,
      roleListingId,
      entitlementId,
      0,
      0,
      "local_zero_price",
      "posted",
      now,
    );
    db.prepare(
      "INSERT INTO local_role_execution_audits(audit_record_id,execution_id,role_listing_id,entitlement_id,status,summary,ledger_ref,billing_summary,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      auditRecordId,
      executionId,
      roleListingId,
      entitlementId,
      "completed",
      "商城运营诊断已完成，审计和账本可读回。",
      ledgerRef,
      JSON.stringify({
        ledgerRef,
        authorizationFeeCents: 0,
        executionFeeCents: 0,
        source: "local_zero_price",
      }),
      now,
    );
  } finally {
    db.close();
  }
}

function runVerify(params: {
  argv?: string[];
  stateDir: string;
  homeDir: string;
  configPath: string;
}) {
  const result = runNodeScript({
    ...params,
    scriptPath: verifyScriptPath,
    argv: ["--json", ...(params.argv ?? [])],
  });
  const payload = JSON.parse(result.stdout || "{}") as Record<string, unknown>;
  return { result, payload };
}

function writeRoleExecutionModelConfig(params: { configPath: string; secretPath: string }) {
  fs.writeFileSync(params.secretPath, JSON.stringify({ deepseek: "sk-local-demo-test" }), "utf8");
  fs.writeFileSync(
    params.configPath,
    JSON.stringify(
      {
        secrets: {
          providers: {
            "api-test": {
              source: "file",
              path: params.secretPath,
              mode: "json",
              allowInsecurePath: true,
            },
          },
        },
        apiConnections: {
          entries: {
            "marketplace-dijie-cloud-bridge": {
              id: "marketplace-dijie-cloud-bridge",
              name: "迭界AI云端",
              kind: "marketplace",
              provider: "dijie-cloud-bridge",
              baseUrl: "http://127.0.0.1:9000",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/cloud" },
              consumers: ["marketplace", "role_execution"],
            },
            "model-deepseek": {
              id: "model-deepseek",
              name: "DeepSeek",
              kind: "model",
              provider: "deepseek",
              baseUrl: "https://api.deepseek.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/deepseek" },
              consumers: ["model", "role_execution"],
              metadata: {
                defaultModel: "deepseek-chat",
                pricing: {
                  currency: "CNY",
                  unit: "1M_tokens",
                  inputCnyPerMillion: 0.02,
                  outputCnyPerMillion: 0.02,
                },
              },
            },
          },
        },
        plugins: {
          entries: {
            aics: {
              enabled: true,
              config: {
                cloudBaseUrl: "http://127.0.0.1:9000",
                cloudAccessToken: { source: "file", provider: "api-test", id: "/cloud" },
                defaultDeviceId: "device-localhost-bridge",
                defaultWorkspaceRef: "workspace-localhost-bridge",
                defaultLocalGatewayId: "gateway-localhost-bridge",
              },
            },
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("scripts/aics-local-demo-verify", () => {
  it("renders completed human output with execution evidence", async () => {
    const { renderHuman } = await import("../../scripts/aics-local-demo-verify.ts");

    const output = renderHuman({
      ok: true,
      status: "ready",
      mode: "local",
      executed: true,
      requireExecuted: true,
      checks: [
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          status: "pass",
          message:
            "本地执行结果、业务产物、审计记录、账本记录，以及模型费用证据或未调用模型说明均可读回。",
        },
      ],
      skippedChecks: [],
      nextActions: [],
      context: {
        roleListingId: "local_rolelisting_marketplace_ops",
        entitlementId: "local_entitlement_marketplace_ops",
        taskPackageId: "task-package-marketplace-ops",
        dispatchToRoleRequestId: "dispatch-marketplace-ops",
        categoryCapabilityId: "category:marketplace-ops-local@1",
        requiredCapabilityRefs: ["marketplace-ops-local"],
        executionId: "exec-local-demo-verify-test",
        auditRecordId: "local_audit_exec-local-demo-verify-test",
        ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-verify-test",
        artifactRefs: [
          "artifact:role-result:exec-local-demo-verify-test:summary",
          "audit:local_audit_exec-local-demo-verify-test",
        ],
        modelUsage: {
          totalTokens: 15,
          costCents: 0,
        },
        costSummary: {
          totalCostCents: 0,
          ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-verify-test",
        },
        humanConfirmationRef: "human:confirm:dispatch-marketplace-ops:exec-local-demo-verify-test",
        businessDeliverables: marketplaceOpsBusinessDeliverables(),
      },
      chainEvidence: {
        mode: "local",
        rolePrepared: true,
        authorized: true,
        dispatchReady: true,
        evidenceReadback: true,
        modelUsageReadback: true,
        roleListingId: "local_rolelisting_marketplace_ops",
        entitlementId: "local_entitlement_marketplace_ops",
        taskPackageId: "task-package-marketplace-ops",
        dispatchToRoleRequestId: "dispatch-marketplace-ops",
        categoryCapabilityId: "category:marketplace-ops-local@1",
        requiredCapabilityRefs: ["marketplace-ops-local"],
        executionId: "exec-local-demo-verify-test",
        auditRecordId: "local_audit_exec-local-demo-verify-test",
        ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-verify-test",
        modelUsage: {
          totalTokens: 15,
          costCents: 0,
        },
        costSummary: {
          totalCostCents: 0,
          ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-verify-test",
        },
        humanConfirmationRef: "human:confirm:dispatch-marketplace-ops:exec-local-demo-verify-test",
        costSummaryReadback: true,
        humanConfirmationReadback: true,
        businessDeliverables: marketplaceOpsBusinessDeliverables(),
        businessDeliverablesReadback: true,
        artifactRefs: [
          "artifact:role-result:exec-local-demo-verify-test:summary",
          "audit:local_audit_exec-local-demo-verify-test",
        ],
        businessArtifactRefs: ["artifact:role-result:exec-local-demo-verify-test:summary"],
        rolesCount: 1,
        authorizedRolesCount: 1,
        roleReviewsCount: 1,
        categoryCapabilityRequestsCount: 1,
      },
    });

    expect(output).toContain("本地 demo 验收状态：已完成");
    expect(output).toContain("真人验收摘要：");
    expect(output).toContain("岗位授权：已授权");
    expect(output).toContain("品类能力：已绑定");
    expect(output).toContain("执行队列：已派发");
    expect(output).toContain("审计记录：已读回");
    expect(output).toContain("账本记录：已读回");
    expect(output).toContain("费用摘要：已读回");
    expect(output).toContain(
      "人工确认：human:confirm:dispatch-marketplace-ops:exec-local-demo-verify-test",
    );
    expect(output).toContain("业务明细：商城运营诊断报告、岗位供给分析、授权转化分析");
    expect(output).toContain("技术证据：");
    expect(output).toContain("roleListingId：local_rolelisting_marketplace_ops");
    expect(output).toContain("categoryCapabilityId：category:marketplace-ops-local@1");
    expect(output).toContain("requiredCapabilityRefs：marketplace-ops-local");
    expect(output).toContain("业务产物：artifact:role-result:exec-local-demo-verify-test:summary");
    expect(output).not.toContain("业务产物摘要");
    expect(output).toContain("云端 SaaS 最终验收：未执行（本地版可跳过）");
    expect(output).toContain("云端必须结果：production_plus_passed");
    expect(output).toContain("真人准备清单：");
    expect(output).toContain("连接真实云端商城");
    expect(output).toContain("需要准备：DIJIE_CLOUD_BASE_URL");
    expect(output).toContain("aics-production-plus-readiness.mjs");
    expect(output).toContain("aics-production-plus-orchestrator.mjs");
    expect(output).toContain("本地岗位闭环已完成");
    expect(output).toContain(
      "执行结果、审计记录、账本记录、业务产物、商城运营业务明细、费用摘要、人工确认，以及模型费用证据或未调用模型说明均已读回",
    );
    expect(output).toContain("executionId：exec-local-demo-verify-test");
    expect(output).toContain("modelUsage：15 Token · ¥0.00");
    expect(output).toContain(
      "ledgerRef：ledger:role_execution:entitlement:exec-local-demo-verify-test",
    );
    expect(output).not.toContain(
      "artifactRefs：artifact:role-result:exec-local-demo-verify-test:summary",
    );
  });

  it("renders completed human output when model usage is not applicable", async () => {
    const { renderHuman } = await import("../../scripts/aics-local-demo-verify.ts");

    const output = renderHuman({
      ok: true,
      status: "ready",
      mode: "local",
      executed: true,
      requireExecuted: true,
      checks: [
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          status: "pass",
          message:
            "本地执行结果、业务产物、审计记录、账本记录，以及模型费用证据或未调用模型说明均可读回。",
        },
      ],
      skippedChecks: [],
      nextActions: [],
      context: {
        roleListingId: "local_rolelisting_marketplace_ops",
        entitlementId: "local_entitlement_marketplace_ops",
        taskPackageId: "task-package-marketplace-ops",
        dispatchToRoleRequestId: "dispatch-marketplace-ops",
        requiredCapabilityRefs: ["marketplace-ops-local"],
        executionId: "exec-local-demo-verify-test",
        auditRecordId: "local_audit_exec-local-demo-verify-test",
        ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-verify-test",
        artifactRefs: [
          "artifact:role-result:exec-local-demo-verify-test:summary",
          "audit:local_audit_exec-local-demo-verify-test",
        ],
        modelUsageNotApplicableReason: "本次文件打包由本地工具完成，未调用模型。",
        costSummary: {
          totalCostCents: 0,
          ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-verify-test",
        },
        humanConfirmationRef: "human:confirm:dispatch-marketplace-ops:exec-local-demo-verify-test",
        businessDeliverables: marketplaceOpsBusinessDeliverables(),
      },
      chainEvidence: {
        mode: "local",
        rolePrepared: true,
        authorized: true,
        dispatchReady: true,
        evidenceReadback: true,
        modelUsageReadback: true,
        roleListingId: "local_rolelisting_marketplace_ops",
        entitlementId: "local_entitlement_marketplace_ops",
        taskPackageId: "task-package-marketplace-ops",
        dispatchToRoleRequestId: "dispatch-marketplace-ops",
        categoryCapabilityId: null,
        requiredCapabilityRefs: ["marketplace-ops-local"],
        executionId: "exec-local-demo-verify-test",
        auditRecordId: "local_audit_exec-local-demo-verify-test",
        ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-verify-test",
        modelUsage: null,
        modelUsageNotApplicableReason: "本次文件打包由本地工具完成，未调用模型。",
        costSummary: {
          totalCostCents: 0,
          ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-verify-test",
        },
        humanConfirmationRef: "human:confirm:dispatch-marketplace-ops:exec-local-demo-verify-test",
        costSummaryReadback: true,
        humanConfirmationReadback: true,
        businessDeliverables: marketplaceOpsBusinessDeliverables(),
        businessDeliverablesReadback: true,
        artifactRefs: [
          "artifact:role-result:exec-local-demo-verify-test:summary",
          "audit:local_audit_exec-local-demo-verify-test",
        ],
        businessArtifactRefs: ["artifact:role-result:exec-local-demo-verify-test:summary"],
        rolesCount: 1,
        authorizedRolesCount: 1,
        roleReviewsCount: 1,
        categoryCapabilityRequestsCount: 1,
      },
    });

    expect(output).toContain("本地 demo 验收状态：已完成");
    expect(output).toContain("本地岗位闭环已完成");
    expect(output).toContain("品类能力：本地能力已覆盖（marketplace-ops-local）");
    expect(output).not.toContain("品类能力：缺失");
    expect(output).toContain(
      "modelUsage：本次未调用模型 · 本次文件打包由本地工具完成，未调用模型。",
    );
  });

  it("renders product artifact names for non-programmer verification output", async () => {
    const { renderHuman } = await import("../../scripts/aics-local-demo-verify.ts");
    const businessArtifactRefs = [
      "/tmp/openclaw/exec-local-demo-verify-test/hero.png",
      "/tmp/openclaw/exec-local-demo-verify-test/detail.html",
      "/tmp/openclaw/exec-local-demo-verify-test/execution-summary.json",
      "/tmp/openclaw/exec-local-demo-verify-test/artifact-manifest.json",
      "/tmp/openclaw/exec-local-demo-verify-test/artifacts.zip",
    ];

    const output = renderHuman({
      ok: true,
      status: "ready",
      mode: "local",
      executed: true,
      requireExecuted: true,
      checks: [],
      skippedChecks: [],
      nextActions: [],
      context: {
        artifactRefs: businessArtifactRefs,
      },
      chainEvidence: {
        mode: "local",
        rolePrepared: true,
        authorized: true,
        dispatchReady: true,
        evidenceReadback: true,
        modelUsageReadback: true,
        roleListingId: "local_rolelisting_marketplace_ops",
        entitlementId: "local_entitlement_marketplace_ops",
        taskPackageId: "task-package-marketplace-ops",
        dispatchToRoleRequestId: "dispatch-marketplace-ops",
        executionId: "exec-local-demo-verify-test",
        auditRecordId: "local_audit_exec-local-demo-verify-test",
        ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-verify-test",
        modelUsage: { totalTokens: 15, costCents: 0 },
        modelUsageNotApplicableReason: null,
        costSummary: {
          totalCostCents: 0,
          ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-verify-test",
        },
        humanConfirmationRef: "human:confirm:dispatch-marketplace-ops:exec-local-demo-verify-test",
        costSummaryReadback: true,
        humanConfirmationReadback: true,
        businessDeliverables: marketplaceOpsBusinessDeliverables(),
        businessDeliverablesReadback: true,
        artifactRefs: businessArtifactRefs,
        businessArtifactRefs,
        rolesCount: 1,
        authorizedRolesCount: 1,
        roleReviewsCount: 1,
        categoryCapabilityRequestsCount: 1,
      },
    });

    expect(output).toContain(
      "业务成果：图片 hero.png、详情页 detail.html、执行摘要 execution-summary.json、产物清单 artifact-manifest.json、打包文件 artifacts.zip",
    );
    expect(output).toContain(
      "业务产物：图片 hero.png、详情页 detail.html、执行摘要 execution-summary.json、产物清单 artifact-manifest.json、打包文件 artifacts.zip",
    );
  });

  it("forces local readiness mode even when stale cloud bridge settings exist", async () => {
    const { stateDir, homeDir, configPath } = makeRoot();
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    const previousHome = process.env.HOME;
    const previousConfigPath = process.env.OPENCLAW_CONFIG_PATH;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    const fetchMock = vi.fn(async () => {
      throw new Error("cloud should not be called by local verifier");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { callClosedLoopReadiness } = await import("../../scripts/aics-local-demo-verify.ts");

    try {
      const readiness = await callClosedLoopReadiness(
        {
          plugins: {
            entries: {
              aics: {
                config: {
                  cloudBaseUrl: "https://stale-cloud-token.test",
                  cloudAccessToken: "stale-token",
                  defaultDeviceId: "device-local",
                  defaultWorkspaceRef: "workspace-local",
                  defaultLocalGatewayId: "gateway-local",
                },
              },
            },
          },
        } as never,
        { cloud: false, json: true, live: true, requireExecuted: false },
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(readiness).toMatchObject({
        mode: "local",
        context: { cloudBaseUrl: null },
      });
    } finally {
      if (previousStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = previousStateDir;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousConfigPath === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
      else process.env.OPENCLAW_CONFIG_PATH = previousConfigPath;
      vi.unstubAllGlobals();
    }
  });

  it("reports actionable blockers before the local demo has been prepared", () => {
    const { stateDir, homeDir, configPath } = makeRoot();

    const { result, payload } = runVerify({ stateDir, homeDir, configPath });

    expect(result.status).toBe(1);
    expect(payload).toMatchObject({
      ok: false,
      status: "blocked",
      mode: "local",
      executed: false,
    });
    expect(payload.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "roleExecutionModel",
          action: expect.stringContaining("API 管理"),
        }),
        expect.objectContaining({
          id: "localAuthorizedRole",
          action: expect.stringContaining("费用与授权"),
        }),
      ]),
    );
  });

  it("writes a machine-readable blocked manifest when readiness times out", () => {
    const { root, stateDir, homeDir, configPath } = makeRoot();
    const manifestPath = path.join(root, "timeout-acceptance-manifest.json");

    const { result, payload } = runVerify({
      stateDir,
      homeDir,
      configPath,
      argv: ["--timeout-ms", "500", "--output", manifestPath],
    });

    expect(result.status).toBe(1);
    expect(payload).toMatchObject({
      ok: false,
      status: "blocked",
      mode: "local",
      context: {
        timedOut: true,
        timeoutMs: 500,
      },
    });
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      ok: false,
      status: "blocked",
      context: {
        timedOut: true,
        timeoutMs: 500,
      },
    });
  });

  it("does not count audit-only execution evidence as completed", async () => {
    const { summarize } = await import("../../scripts/aics-local-demo-verify.ts");

    const summary = summarize(
      {
        mode: "local",
        checks: [
          {
            id: "localRolePreparation",
            label: "本地岗位准备",
            status: "pass",
            message: "已找到本地岗位。",
          },
          {
            id: "localAuthorizedRole",
            label: "本地已授权岗位",
            status: "pass",
            message: "已授权。",
          },
          {
            id: "localExecutionQueue",
            label: "本地执行队列",
            status: "pass",
            message: "已执行。",
          },
          {
            id: "localEvidenceReadback",
            label: "本地审计账本读回",
            status: "blocked",
            message: "岗位已执行，但本地业务产物、审计、账本或模型费用证据缺失。",
          },
        ],
        nextActions: [],
        context: {
          roleListingId: "local_rolelisting_marketplace_ops",
          entitlementId: "local_entitlement_marketplace_ops",
          taskPackageId: "task-package-marketplace-ops",
          dispatchToRoleRequestId: "dispatch-marketplace-ops",
          executionId: "exec-audit-only",
          auditRecordId: "local_audit_exec-audit-only",
          ledgerRef: "ledger:role_execution:entitlement:exec-audit-only",
          artifactRefs: ["audit:local_audit_exec-audit-only"],
          rolesCount: 1,
          authorizedRolesCount: 1,
          roleReviewsCount: 1,
          categoryCapabilityRequestsCount: 1,
        },
      },
      { cloud: false, json: true, requireExecuted: true },
    );

    expect(summary).toMatchObject({
      ok: false,
      status: "blocked",
      executed: false,
      chainEvidence: {
        evidenceReadback: false,
        modelUsageReadback: false,
        executionId: "exec-audit-only",
        auditRecordId: "local_audit_exec-audit-only",
        ledgerRef: "ledger:role_execution:entitlement:exec-audit-only",
        modelUsage: null,
        artifactRefs: ["audit:local_audit_exec-audit-only"],
        businessArtifactRefs: [],
      },
    });
  });

  it("distinguishes ready-to-run from fully executed audit-ledger readback", async () => {
    const { renderHuman } = await import("../../scripts/aics-local-demo-verify.ts");
    const { root, stateDir, homeDir, configPath } = makeRoot();
    writeRoleExecutionModelConfig({
      configPath,
      secretPath: path.join(root, "api-secrets.json"),
    });
    const seeded = runSeed({ stateDir, homeDir, configPath });
    expect(seeded).toMatchObject({ ok: true, taskCreated: true });

    const readyToRun = runVerify({ stateDir, homeDir, configPath });
    expect(readyToRun.result.status).toBe(0);
    expect(readyToRun.payload).toMatchObject({
      ok: true,
      status: "ready",
      mode: "local",
      executed: false,
      chainEvidence: {
        rolePrepared: true,
        authorized: true,
        dispatchReady: true,
        evidenceReadback: false,
        roleListingId: String(seeded.roleListingId),
        entitlementId: String(seeded.entitlementId),
        taskPackageId: String(seeded.taskPackageId),
        dispatchToRoleRequestId: String(seeded.dispatchToRoleRequestId),
      },
    });
    expect(readyToRun.payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "roleExecutionModel", status: "pass" }),
        expect.objectContaining({ id: "localAuthorizedRole", status: "pass" }),
        expect.objectContaining({ id: "localExecutionQueue", status: "pass" }),
        expect.objectContaining({ id: "localEvidenceReadback", status: "skipped" }),
      ]),
    );
    expect(readyToRun.payload.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "localEvidenceReadback",
          message: expect.stringContaining("还没有真实执行结果"),
          action: expect.stringContaining("岗位执行页"),
        }),
      ]),
    );
    expect(String(readyToRun.payload.nextActions[0]?.action ?? "")).toContain(
      "npm run aics:local-demo:run -- --confirm-real-api-cost",
    );
    expect(readyToRun.payload.nextActions).toHaveLength(1);

    const fullGate = runVerify({
      stateDir,
      homeDir,
      configPath,
      argv: ["--require-executed"],
    });
    expect(fullGate.result.status).toBe(1);
    expect(fullGate.payload).toMatchObject({
      ok: false,
      status: "blocked",
      mode: "local",
      executed: false,
      requireExecuted: true,
    });
    expect(fullGate.payload.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "localEvidenceReadback",
          action: expect.stringContaining("岗位执行页"),
        }),
      ]),
    );
    expect(String(fullGate.payload.nextActions[0]?.action ?? "")).toContain("真实 API 费用提示");
    expect(String(fullGate.payload.nextActions[0]?.action ?? "")).toContain(
      "npm run aics:local-demo:run -- --confirm-real-api-cost",
    );
    expect(String(fullGate.payload.nextActions[0]?.action ?? "")).toContain(
      "npm run aics:local-demo:verify -- --require-executed",
    );
    expect(fullGate.payload.nextActions).toHaveLength(1);
    const fullGateHumanOutput = renderHuman(fullGate.payload as Parameters<typeof renderHuman>[0]);
    expect(fullGateHumanOutput).toContain("本地 demo 验收状态：阻塞");
    expect(fullGateHumanOutput).toContain("命令行验收");
    expect(fullGateHumanOutput).toContain("npm run aics:local-demo:run -- --confirm-real-api-cost");
    expect(fullGateHumanOutput).toContain("npm run aics:local-demo:verify -- --require-executed");

    markSeededDemoExecuted({ stateDir, seed: seeded });
    const executedGate = runVerify({
      stateDir,
      homeDir,
      configPath,
      argv: ["--require-executed"],
    });
    expect(executedGate.result.status).toBe(0);
    expect(executedGate.payload).toMatchObject({
      ok: true,
      status: "ready",
      mode: "local",
      executed: true,
      requireExecuted: true,
      productionFinalGate: {
        status: "not_evaluated",
        requiredVerdict: "production_plus_passed",
        operatorChecklist: expect.arrayContaining([
          expect.objectContaining({
            label: "连接真实云端商城",
            requiredInput: "DIJIE_CLOUD_BASE_URL",
          }),
        ]),
        requiredInputs: expect.arrayContaining(["DIJIE_CLOUD_BASE_URL", "OPENCLAW_LOCAL_URL"]),
        readinessCommand: expect.stringContaining("aics-production-plus-readiness.mjs"),
        finalCommand: expect.stringContaining("aics-production-plus-orchestrator.mjs"),
      },
      chainEvidence: {
        rolePrepared: true,
        authorized: true,
        dispatchReady: true,
        evidenceReadback: true,
        modelUsageReadback: true,
        roleListingId: String(seeded.roleListingId),
        entitlementId: String(seeded.entitlementId),
        taskPackageId: String(seeded.taskPackageId),
        dispatchToRoleRequestId: String(seeded.dispatchToRoleRequestId),
        executionId: "exec-local-demo-verify-test",
        auditRecordId: "local_audit_exec-local-demo-verify-test",
        ledgerRef: String(
          `ledger:role_execution:${String(seeded.entitlementId)}:exec-local-demo-verify-test`,
        ),
        modelUsage: {
          totalTokens: 15,
          costCents: 0,
        },
        businessDeliverables: expect.arrayContaining([
          expect.objectContaining({ label: "商城运营诊断报告" }),
          expect.objectContaining({ label: "岗位供给分析" }),
          expect.objectContaining({ label: "授权转化分析" }),
          expect.objectContaining({ label: "执行成功率分析" }),
          expect.objectContaining({ label: "阻塞原因分析" }),
          expect.objectContaining({ label: "日/周/月运营建议" }),
          expect.objectContaining({ label: "下一步调度建议" }),
          expect.objectContaining({ label: "审计摘要" }),
          expect.objectContaining({ label: "账本摘要" }),
        ]),
        businessDeliverablesReadback: true,
        businessArtifactRefs: ["artifact:role-result:exec-local-demo-verify-test:summary"],
      },
      context: {
        executionId: "exec-local-demo-verify-test",
        auditRecordId: "local_audit_exec-local-demo-verify-test",
        ledgerRef: String(
          `ledger:role_execution:${String(seeded.entitlementId)}:exec-local-demo-verify-test`,
        ),
        executionSummary: "商城运营诊断已完成，审计和账本可读回。",
        artifactRefs: expect.arrayContaining([
          "artifact:role-result:exec-local-demo-verify-test:summary",
          "audit:local_audit_exec-local-demo-verify-test",
        ]),
        modelUsage: expect.objectContaining({
          totalTokens: 15,
          costCents: 0,
        }),
        businessDeliverables: expect.arrayContaining([
          expect.objectContaining({ label: "商城运营诊断报告" }),
          expect.objectContaining({ label: "账本摘要" }),
        ]),
      },
    });
    expect(executedGate.payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "localEvidenceReadback", status: "pass" }),
      ]),
    );

    const manifestPath = path.join(root, "local-acceptance-manifest.json");
    const manifestGate = runVerify({
      stateDir,
      homeDir,
      configPath,
      argv: ["--require-executed", "--output", manifestPath],
    });
    expect(manifestGate.result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      ok: true,
      status: "ready",
      mode: "local",
      executed: true,
      chainEvidence: {
        executionId: "exec-local-demo-verify-test",
        auditRecordId: "local_audit_exec-local-demo-verify-test",
      },
      productionFinalGate: {
        requiredVerdict: "production_plus_passed",
      },
    });
  });
});
