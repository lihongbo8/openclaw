import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";
import { createConfigWriteSnapshot } from "./config.test-helpers.js";

const readConfigFileSnapshotForWriteMock = vi.fn();
const validateConfigObjectWithPluginsMock = vi.fn();
const commitGatewayConfigWriteMock = vi.fn();
const queueFollowUpMock = vi.fn();

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    readConfigFileSnapshotForWrite: readConfigFileSnapshotForWriteMock,
    validateConfigObjectWithPlugins: validateConfigObjectWithPluginsMock,
  };
});

vi.mock("./config-write-flow.js", () => ({
  commitGatewayConfigWrite: commitGatewayConfigWriteMock,
}));

const { coreGatewayHandlers } = await import("../server-methods.js");
const { recordModelUsageToApiMetering } = await import("./aics-api-metering.js");

let currentConfig: OpenClawConfig;

function cloneConfig(config: OpenClawConfig): OpenClawConfig {
  return structuredClone(config) as OpenClawConfig;
}

beforeEach(() => {
  currentConfig = {};
  vi.clearAllMocks();
  validateConfigObjectWithPluginsMock.mockImplementation((config: OpenClawConfig) => ({
    ok: true,
    config,
  }));
  readConfigFileSnapshotForWriteMock.mockImplementation(async () =>
    createConfigWriteSnapshot(cloneConfig(currentConfig)),
  );
  commitGatewayConfigWriteMock.mockImplementation(
    async ({ nextConfig }: { nextConfig: OpenClawConfig }) => {
      currentConfig = cloneConfig(nextConfig);
      return {
        config: cloneConfig(currentConfig),
        queueFollowUp: queueFollowUpMock,
      };
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function callOperationsModelRun(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const respond = vi.fn();
  const handler = coreGatewayHandlers["aics.mainFlow.operationsModel.run"];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: {
      type: "req",
      id: "req-aics-main-flow-ops-model",
      method: "aics.mainFlow.operationsModel.run",
      params,
    },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {
      getRuntimeConfig: () => currentConfig,
    },
  } as never);
  expect(respond).toHaveBeenCalled();
  const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
  if (!ok) {
    throw new Error(JSON.stringify(error ?? payload));
  }
  return payload as Record<string, unknown>;
}

describe("aics main flow operations backend API metering", () => {
  it("runs operations backend model calls through API Management and records token cost", async () => {
    await withStateDirEnv("aics-main-flow-ops-api-", async ({ tempRoot }) => {
      const secretPath = path.join(tempRoot, "api-secrets.json");
      await fs.writeFile(secretPath, JSON.stringify({ deepseek: "sk-ops-backend-test" }), "utf8");
      currentConfig = {
        secrets: {
          providers: {
            "api-test": {
              source: "file",
              path: secretPath,
              mode: "json",
              allowInsecurePath: true,
            },
          },
        },
        apiConnections: {
          entries: {
            "model-deepseek": {
              id: "model-deepseek",
              name: "DeepSeek",
              kind: "model",
              provider: "deepseek",
              baseUrl: "https://api.deepseek.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/deepseek" },
              consumers: ["model", "operations_backend"],
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
      };
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(_url)).toBe("https://api.deepseek.com/v1/chat/completions");
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer sk-ops-backend-test",
        );
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ model: "deepseek-chat" });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "经营后台建议优先修复岗位授权转化漏斗。" } }],
            usage: { prompt_tokens: 800, completion_tokens: 200, total_tokens: 1000 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await callOperationsModelRun({
        prompt: "汇总岗位商城经营后台下一步动作",
        executionId: "operations_backend:summary-1",
      });

      expect(result).toMatchObject({
        ok: true,
        content: "经营后台建议优先修复岗位授权转化漏斗。",
        executionId: "operations_backend:summary-1",
        selectedModelRef: {
          entryId: "model-deepseek",
          provider: "deepseek",
          model: "deepseek-chat",
        },
        apiMetering: {
          entryId: "model-deepseek",
          costCny: expect.closeTo(0.00002, 8),
        },
      });
      const metering = currentConfig.apiConnections?.entries?.["model-deepseek"]?.metadata
        ?.metering as Record<string, unknown> | undefined;
      expect(metering).toEqual(
        expect.objectContaining({
          calls: 1,
          totalTokens: 1000,
          costCny: expect.closeTo(0.00002, 8),
        }),
      );
      expect((metering?.byConsumer as Record<string, unknown>)?.operations_backend).toEqual(
        expect.objectContaining({
          calls: 1,
          totalTokens: 1000,
          costCny: expect.closeTo(0.00002, 8),
          lastUsageRef: "operations_backend:summary-1",
        }),
      );
    });
  });

  it("syncs role execution metering to cloud ledger with role attribution and developer receivables", async () => {
    await withStateDirEnv("aics-role-execution-metering-cloud-", async ({ tempRoot }) => {
      const secretPath = path.join(tempRoot, "api-secrets.json");
      await fs.writeFile(
        secretPath,
        JSON.stringify({
          deepseek: "sk-role-execution-test",
          cloud: "bridge-token",
        }),
        "utf8",
      );
      currentConfig = {
        secrets: {
          providers: {
            "api-test": {
              source: "file",
              path: secretPath,
              mode: "json",
              allowInsecurePath: true,
            },
          },
        },
        apiConnections: {
          entries: {
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
                  inputCnyPerMillion: 10,
                  outputCnyPerMillion: 20,
                },
              },
            },
            "dijie-cloud": {
              id: "dijie-cloud",
              name: "迭界AI云端",
              kind: "marketplace",
              provider: "dijie-cloud-bridge",
              baseUrl: "https://cloud.example.test",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/cloud" },
              consumers: ["marketplace"],
            },
          },
        },
      };
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(_url)).toBe("https://cloud.example.test/dijie/ledger/entries");
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer bridge-token");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          accountId: "acct-admin",
          billingAccountId: "billing-admin",
          source: "role_usage",
          usageKind: "model_tokens",
          surface: "openclaw_local",
          mode: "user",
          grossAmountCents: 1,
          platformReceivableCents: 0,
          developerReceivableCents: 1,
          modelProvider: "deepseek",
          modelId: "deepseek-chat",
          roleListingId: "role-marketplace-ops",
          entitlementId: "entitlement-marketplace-ops",
          executionId: "exec-marketplace-ops",
          developerRef: "developer-platform-admin",
        });
        expect(body.subject).toMatchObject({
          consumer: "role_execution",
          apiConnectionEntryId: "model-deepseek",
          usageRef: "exec-marketplace-ops",
          executionId: "exec-marketplace-ops",
          roleListingId: "role-marketplace-ops",
          entitlementId: "entitlement-marketplace-ops",
          ledgerRef: "ledger:role_execution:entitlement-marketplace-ops:exec-marketplace-ops",
          auditRecordId: "audit-marketplace-ops",
          apiKeyRef: "file:api-test:/deepseek",
        });
        return new Response(JSON.stringify({ ok: true, ledgerEntry: { id: "ledger-cloud-1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await recordModelUsageToApiMetering({
        context: {} as never,
        consumer: "role_execution",
        executionId: "exec-marketplace-ops",
        modelUsage: {
          provider: "deepseek",
          model: "deepseek-chat",
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
        },
        attribution: {
          accountId: "acct-admin",
          billingAccountId: "billing-admin",
          roleListingId: "role-marketplace-ops",
          entitlementId: "entitlement-marketplace-ops",
          executionId: "exec-marketplace-ops",
          developerRef: "developer-platform-admin",
          ledgerRef: "ledger:role_execution:entitlement-marketplace-ops:exec-marketplace-ops",
          auditRecordId: "audit-marketplace-ops",
        },
      });

      expect(result).toMatchObject({
        entryId: "model-deepseek",
        costCny: 0.01,
        cloudLedgerSync: {
          status: "synced",
          cloudRef: "ledger-cloud-1",
        },
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      const metering = currentConfig.apiConnections?.entries?.["model-deepseek"]?.metadata
        ?.metering as Record<string, unknown> | undefined;
      expect((metering?.byConsumer as Record<string, unknown>)?.role_execution).toMatchObject({
        calls: 1,
        totalTokens: 750,
        costCny: 0.01,
        lastUsageRef: "exec-marketplace-ops",
      });
    });
  });
});
