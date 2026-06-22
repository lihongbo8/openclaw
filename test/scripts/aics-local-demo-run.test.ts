import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHuman, runLocalDemoRoleTask } from "../../scripts/aics-local-demo-run.js";
import { runLocalDemoVerify } from "../../scripts/aics-local-demo-verify.js";
import {
  closeMemoryDb,
  closePipelineDb,
  closeRoleInstancesDb,
} from "../../src/aics-main-flow/db.js";

const seedScriptPath = path.resolve("scripts/aics-local-demo-seed.ts");
const VALID_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-aics-demo-run-"));
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

function setProcessEnv(params: { stateDir: string; homeDir: string; configPath: string }) {
  vi.stubEnv("HOME", params.homeDir);
  vi.stubEnv("OPENCLAW_CONFIG_PATH", params.configPath);
  vi.stubEnv("OPENCLAW_STATE_DIR", params.stateDir);
  vi.stubEnv("OPENCLAW_TEST_FAST", "1");
}

function runSeed(params: { stateDir: string; homeDir: string; configPath: string }) {
  const result = spawnSync(process.execPath, ["--import", "tsx", seedScriptPath], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: envFor(params),
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function writeRoleExecutionModelConfig(params: { configPath: string; secretPath: string }) {
  fs.writeFileSync(
    params.secretPath,
    JSON.stringify({
      deepseek: "sk-local-demo-run-test",
      openai: "sk-openai-local-demo-run-test",
    }),
    "utf8",
  );
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
              consumers: ["model"],
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
            "model-openai-image": {
              id: "model-openai-image",
              name: "OpenAI 图片",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/openai" },
              consumers: ["image", "role_execution"],
              metadata: {
                defaultModel: "gpt-image-1",
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
  closePipelineDb();
  closeRoleInstancesDb();
  closeMemoryDb();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("scripts/aics-local-demo-run", () => {
  it("renders completed human output with execution evidence and verify next step", () => {
    const output = renderHuman({
      ok: true,
      status: "completed",
      executionId: "exec-local-demo-run-test",
      auditUpload: { auditRecordId: "local_audit_exec-local-demo-run-test" },
      billingSummary: {
        ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-run-test",
      },
      roleResult: {
        artifactRefs: [
          "artifact:role-result:exec-local-demo-run-test:summary",
          "audit:local_audit_exec-local-demo-run-test",
        ],
        executionEvidence: {
          costSummary: {
            totalCostCents: 0,
            ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-run-test",
          },
          humanConfirmationRef: "human:confirm:dispatch-marketplace-ops:exec-local-demo-run-test",
          businessDeliverables: marketplaceOpsBusinessDeliverables(),
          modelUsage: { totalTokens: 0, costCents: 0 },
        },
      },
      executionEvidenceReadback: { ok: true },
    });

    expect(output).toContain("本地 demo 执行完成，岗位闭环已完成。");
    expect(output).toContain("执行证据：");
    expect(output).toContain("executionId：exec-local-demo-run-test");
    expect(output).toContain(
      "ledgerRef：ledger:role_execution:entitlement:exec-local-demo-run-test",
    );
    expect(output).toContain("业务产物：artifact:role-result:exec-local-demo-run-test:summary");
    expect(output).toContain("costSummary：已读回");
    expect(output).toContain(
      "humanConfirmationRef：human:confirm:dispatch-marketplace-ops:exec-local-demo-run-test",
    );
    expect(output).toContain("businessDeliverables：商城运营诊断报告、岗位供给分析、授权转化分析");
    expect(output).toContain("modelUsage：0 Token · ¥0.00");
    expect(output).toContain(
      "证据读回：审计、账本、业务产物、商城运营业务明细、费用摘要、人工确认和模型费用证据已读回",
    );
    expect(output).toContain("npm run aics:local-demo:verify -- --require-executed");
  });

  it("renders completed human output when the execution did not call a model", () => {
    const output = renderHuman({
      ok: true,
      status: "completed",
      executionId: "exec-local-demo-run-test",
      auditUpload: { auditRecordId: "local_audit_exec-local-demo-run-test" },
      billingSummary: {
        ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-run-test",
      },
      roleResult: {
        artifactRefs: [
          "artifact:role-result:exec-local-demo-run-test:summary",
          "audit:local_audit_exec-local-demo-run-test",
        ],
        executionEvidence: {
          costSummary: {
            totalCostCents: 0,
            ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-run-test",
          },
          humanConfirmationRef: "human:confirm:dispatch-marketplace-ops:exec-local-demo-run-test",
          businessDeliverables: marketplaceOpsBusinessDeliverables(),
          modelUsageNotApplicable: true,
          modelUsageNotApplicableReason: "本次文件打包由本地工具完成，未调用模型。",
        },
      },
      executionEvidenceReadback: { ok: true },
    });

    expect(output).toContain("本地 demo 执行完成，岗位闭环已完成。");
    expect(output).toContain(
      "modelUsage：本次未调用模型 · 本次文件打包由本地工具完成，未调用模型。",
    );
    expect(output).toContain(
      "证据读回：审计、账本、业务产物、商城运营业务明细、费用摘要、人工确认和模型费用证据已读回",
    );
  });

  it("renders product artifact names for non-programmer local demo verification", () => {
    const output = renderHuman({
      ok: true,
      status: "completed",
      executionId: "exec-local-demo-run-test",
      auditUpload: { auditRecordId: "local_audit_exec-local-demo-run-test" },
      billingSummary: {
        ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-run-test",
      },
      roleResult: {
        artifactRefs: [
          "/tmp/openclaw/exec-local-demo-run-test/hero.png",
          "/tmp/openclaw/exec-local-demo-run-test/detail.html",
          "/tmp/openclaw/exec-local-demo-run-test/execution-summary.json",
          "/tmp/openclaw/exec-local-demo-run-test/artifact-manifest.json",
          "/tmp/openclaw/exec-local-demo-run-test/artifacts.zip",
          "audit:local_audit_exec-local-demo-run-test",
        ],
        executionEvidence: {
          costSummary: {
            totalCostCents: 0,
            ledgerRef: "ledger:role_execution:entitlement:exec-local-demo-run-test",
          },
          humanConfirmationRef: "human:confirm:dispatch-marketplace-ops:exec-local-demo-run-test",
          businessDeliverables: marketplaceOpsBusinessDeliverables(),
          modelUsage: { totalTokens: 0, costCents: 0 },
        },
      },
      executionEvidenceReadback: { ok: true },
    });

    expect(output).toContain(
      "业务产物：图片 hero.png、详情页 detail.html、执行摘要 execution-summary.json、产物清单 artifact-manifest.json、打包文件 artifacts.zip",
    );
  });

  it("refuses to run without explicit real API cost confirmation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runLocalDemoRoleTask(["--json"]);
    const output = renderHuman(result);

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReasons: [expect.stringContaining("--confirm-real-api-cost")],
    });
    expect(output).toContain("本地 demo 执行阻塞");
    expect(output).toContain("确认会调用真实模型 API 并可能产生费用");
    expect(output).toContain("npm run aics:local-demo:run -- --confirm-real-api-cost");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs the prepared local demo in local rehearsal mode without an external image API", async () => {
    const { stateDir, homeDir, configPath } = makeRoot();
    runSeed({ stateDir, homeDir, configPath });
    setProcessEnv({ stateDir, homeDir, configPath });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const runResult = await runLocalDemoRoleTask(["--local-rehearsal", "--json"]);

    expect(runResult).toMatchObject({
      ok: true,
      status: "completed",
      mode: "local",
      executionEvidenceReadback: {
        ok: true,
        status: "found",
      },
      closedLoopReadiness: {
        ok: true,
        status: "ready",
        mode: "local",
        context: {
          localRehearsal: true,
          categoryCapabilityId: "category:marketplace-ops-local@1",
        },
      },
    });
    expect(runResult.roleResult).toMatchObject({
      outcome: "succeeded",
      artifactRefs: expect.arrayContaining([
        expect.stringMatching(/hero\.png$/u),
        expect.stringMatching(/detail\.html$/u),
        expect.stringMatching(/artifact-manifest\.json$/u),
      ]),
      executionEvidence: expect.objectContaining({
        categoryCapabilityId: "category:marketplace-ops-local@1",
        modelUsageNotApplicable: true,
        modelUsageNotApplicableReason: expect.stringContaining("未调用外部模型 API"),
      }),
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const verifyResult = await runLocalDemoVerify([
      "--json",
      "--no-live",
      "--local-rehearsal",
      "--require-executed",
    ]);
    expect(verifyResult).toMatchObject({
      ok: true,
      status: "ready",
      executed: true,
      chainEvidence: {
        categoryCapabilityId: "category:marketplace-ops-local@1",
        modelUsageNotApplicableReason: expect.stringContaining("未调用外部模型 API"),
      },
    });
  });

  it("runs the prepared local demo with a mocked image API and verifies audit-ledger readback", async () => {
    const { root, stateDir, homeDir, configPath } = makeRoot();
    writeRoleExecutionModelConfig({
      configPath,
      secretPath: path.join(root, "api-secrets.json"),
    });
    runSeed({ stateDir, homeDir, configPath });
    setProcessEnv({ stateDir, homeDir, configPath });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/images/generations");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer sk-openai-local-demo-run-test",
      );
      return new Response(
        JSON.stringify({
          data: [{ b64_json: VALID_PNG_BASE64 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const runResult = await runLocalDemoRoleTask(["--confirm-real-api-cost", "--json"]);

    expect(runResult).toMatchObject({
      ok: true,
      status: "completed",
      mode: "local",
      auditUpload: {
        source: "local",
        billingSummary: {
          authorizationFeeCents: 0,
          executionFeeCents: 0,
          source: "local_zero_price",
        },
      },
      executionEvidenceReadback: {
        ok: true,
        status: "found",
        audit: {
          executionId: expect.any(String),
        },
        ledger: {
          executionId: expect.any(String),
        },
      },
      closedLoopReadiness: {
        ok: true,
        status: "ready",
        mode: "local",
        context: {
          executionId: expect.any(String),
          modelUsage: expect.objectContaining({
            totalTokens: 0,
          }),
        },
      },
    });
    expect(runResult.closedLoopReadiness).toMatchObject({
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "localEvidenceReadback", status: "pass" }),
      ]),
    });
    expect(runResult.roleResult).toMatchObject({
      outcome: "succeeded",
      summary: expect.stringContaining("已生成可交付业务产物"),
      artifactRefs: expect.arrayContaining([
        expect.stringMatching(/artifact-manifest\.json$/u),
        expect.stringMatching(/detail\.html$/u),
        expect.stringMatching(/hero\.png$/u),
      ]),
      executionEvidence: expect.objectContaining({
        ledgerRef: expect.stringMatching(/^ledger:role_execution:/u),
        modelUsage: expect.objectContaining({
          totalTokens: 0,
        }),
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
      }),
    });
    expect(runResult.auditUpload).toMatchObject({
      auditRecordId: expect.stringMatching(/^local_audit_/u),
    });
    expect(runResult.billingSummary).toMatchObject({
      ledgerRef: expect.stringMatching(/^ledger:role_execution:/u),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const verifyResult = await runLocalDemoVerify(["--json", "--no-live", "--require-executed"]);
    expect(verifyResult).toMatchObject({
      ok: true,
      status: "ready",
      mode: "local",
      executed: true,
      requireExecuted: true,
      context: {
        executionId: String(runResult.executionId),
        modelUsage: expect.objectContaining({
          totalTokens: 0,
        }),
      },
    });
    expect(verifyResult.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "localEvidenceReadback", status: "pass" }),
      ]),
    );

    const duplicateRun = await runLocalDemoRoleTask(["--confirm-real-api-cost", "--json"]);
    expect(duplicateRun).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReasons: [
        "该派发单已经执行完成并生成结果，不能重复运行。需要重新执行时请先由任务调度生成新的派发单。",
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
