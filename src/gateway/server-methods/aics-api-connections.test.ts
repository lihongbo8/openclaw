import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_CONNECTION_CONSUMERS } from "../../config/api-connection-consumers.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
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

const { resolveLeastPrivilegeOperatorScopesForMethod } = await import("../method-scopes.js");
const { coreGatewayHandlers } = await import("../server-methods.js");

let currentConfig: OpenClawConfig;
const originalDeepseekApiKey = process.env.DEEPSEEK_API_KEY;
const originalDijieCloudAccessToken = process.env.DIJIE_CLOUD_ACCESS_TOKEN;

function cloneConfig(config: OpenClawConfig): OpenClawConfig {
  return structuredClone(config) as OpenClawConfig;
}

async function callApiConnectionsHandler<T>(method: string, params: unknown): Promise<T> {
  const respond = vi.fn();
  const handler = coreGatewayHandlers[method];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: { type: "req", id: `req-${method}`, method, params },
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
  return payload as T;
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

afterEach(async () => {
  if (originalDeepseekApiKey === undefined) {
    delete process.env.DEEPSEEK_API_KEY;
  } else {
    process.env.DEEPSEEK_API_KEY = originalDeepseekApiKey;
  }
  if (originalDijieCloudAccessToken === undefined) {
    delete process.env.DIJIE_CLOUD_ACCESS_TOKEN;
  } else {
    process.env.DIJIE_CLOUD_ACCESS_TOKEN = originalDijieCloudAccessToken;
  }
  await fs.rm("/tmp/secrets/api-connections.json", { force: true });
  vi.unstubAllGlobals();
});

function expectNoEmptyModelProviderBaseUrl(config: OpenClawConfig): void {
  for (const [providerId, provider] of Object.entries(config.models?.providers ?? {})) {
    expect(provider.baseUrl, `${providerId}.baseUrl should not be an empty string`).not.toBe("");
  }
}

describe("aics api connections gateway consumers", () => {
  it("accepts all model-token usage scopes saved from API management", () => {
    expect([...API_CONNECTION_CONSUMERS]).toEqual(
      expect.arrayContaining([
        "model",
        "local_dialog",
        "operations_backend",
        "build_session",
        "buyer_storefront",
        "user_center",
        "developer_center",
        "role_execution",
        "ai_review",
        "image",
        "media_model",
      ]),
    );
  });

  it("registers a write-scoped model usage metering method for all model consumers", () => {
    expect(coreGatewayHandlers["aics.apiConnections.modelUsage.record"]).toBeTypeOf("function");
    expect(
      resolveLeastPrivilegeOperatorScopesForMethod("aics.apiConnections.modelUsage.record"),
    ).toEqual(["operator.write"]);
  });

  it("registers a write-scoped API connection test method because it can persist model validation state", () => {
    expect(coreGatewayHandlers["aics.apiConnections.entry.test"]).toBeTypeOf("function");
    expect(resolveLeastPrivilegeOperatorScopesForMethod("aics.apiConnections.entry.test")).toEqual([
      "operator.write",
    ]);
  });

  it("registers a write-scoped cloud variable sync method because it can persist sync state", () => {
    expect(coreGatewayHandlers["aics.apiConnections.entry.syncCloudVariables"]).toBeTypeOf(
      "function",
    );
    expect(
      resolveLeastPrivilegeOperatorScopesForMethod("aics.apiConnections.entry.syncCloudVariables"),
    ).toEqual(["operator.write"]);
  });

  it("normalizes stale empty model provider baseUrl values before saving API entries", async () => {
    currentConfig = {
      models: {
        providers: {
          openai: { baseUrl: "", models: [] } as never,
          deepseek: { baseUrl: "", models: [] } as never,
        },
      },
    };
    validateConfigObjectWithPluginsMock.mockImplementation((config: OpenClawConfig) => {
      expectNoEmptyModelProviderBaseUrl(config);
      return { ok: true, config };
    });

    await callApiConnectionsHandler<{
      ok: boolean;
      readModel: { entries: Array<{ id: string; provider: string }> };
    }>("aics.apiConnections.entry.create", {
      name: "OpenAI",
      kind: "model",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      authMode: "plaintext",
      secret: "sk-test",
      consumers: ["model", "local_dialog"],
      bindingPath: "models.providers.openai",
      metadata: {
        defaultModel: "gpt-5.5",
        availableModels: ["gpt-5.5"],
        pricing: {
          currency: "CNY",
          unit: "1M_tokens",
          inputCnyPerMillion: 8,
          outputCnyPerMillion: 32,
        },
      },
    });

    expect(currentConfig.models?.providers?.openai?.baseUrl).toBe("https://api.openai.com/v1");
    expect(currentConfig.models?.providers?.deepseek?.baseUrl).toBe("https://api.deepseek.com");
    expect(currentConfig.apiConnections?.entries?.["model-openai"]?.baseUrl).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("rejects plaintext secrets for marketplace and dispatch API connections", async () => {
    await expect(
      callApiConnectionsHandler("aics.apiConnections.entry.create", {
        name: "Dijie Cloud Bridge",
        kind: "marketplace",
        provider: "dijie-cloud-bridge",
        baseUrl: "http://127.0.0.1:9000",
        authMode: "plaintext",
        secret: "plain-cloud-token",
        consumers: ["marketplace"],
        bindingPath: "plugins.entries.aics.config.cloudAccessToken",
      }),
    ).rejects.toThrow("商城/调度能力不能保存明文密钥");

    await expect(
      callApiConnectionsHandler("aics.apiConnections.entry.create", {
        name: "Dispatch API",
        kind: "custom",
        provider: "dispatch-api",
        authMode: "plaintext",
        secret: "plain-dispatch-token",
        consumers: ["dispatch"],
        bindingPath: "plugins.entries.aics.config.dispatchToken",
      }),
    ).rejects.toThrow("商城/调度能力不能保存明文密钥");
  });

  it("allows SecretRef-backed marketplace connections", async () => {
    const result = await callApiConnectionsHandler<{
      ok: boolean;
      readModel: {
        entries: Array<{
          id: string;
          provider: string;
          secret: { mode: string };
          consumers?: string[];
        }>;
      };
    }>("aics.apiConnections.entry.create", {
      name: "Dijie Cloud Bridge",
      kind: "marketplace",
      provider: "dijie-cloud-bridge",
      baseUrl: "http://127.0.0.1:9000",
      authMode: "secret_ref",
      secret: { source: "env", provider: "default", id: "DIJIE_CLOUD_ACCESS_TOKEN" },
      consumers: [
        "marketplace",
        "operations_backend",
        "buyer_storefront",
        "user_center",
        "developer_center",
        "role_execution",
      ],
      bindingPath: "plugins.entries.aics.config.cloudAccessToken",
    });

    expect(result.ok).toBe(true);
    expect(result.readModel.entries[0]?.secret.mode).toBe("secret_ref");
    expect(result.readModel.entries[0]?.consumers).toEqual([
      "marketplace",
      "operations_backend",
      "buyer_storefront",
      "user_center",
      "developer_center",
      "role_execution",
    ]);
  });

  it("materializes a locally managed Dijie cloud token into the AICS runtime config", async () => {
    await callApiConnectionsHandler("aics.apiConnections.entry.create", {
      name: "迭界AI云端",
      kind: "marketplace",
      provider: "dijie-cloud-bridge",
      baseUrl: "http://127.0.0.1:9000",
      authMode: "secret_ref",
      managedSecretValue: "cloud-service-token",
      consumers: ["marketplace"],
      bindingPath: "plugins.entries.aics.config.cloudAccessToken",
    });

    const result = await callApiConnectionsHandler<{
      ok: boolean;
      readModel: {
        entries: Array<{
          id: string;
          configBindings?: Array<{ path: string; materializedAt?: string }>;
        }>;
      };
    }>("aics.apiConnections.entry.materialize", {
      id: "marketplace-dijie-cloud-bridge",
    });

    expect(result.ok).toBe(true);
    expect(currentConfig.plugins?.entries?.aics?.enabled).toBe(true);
    expect(currentConfig.plugins?.entries?.aics?.config?.cloudBaseUrl).toBe(
      "http://127.0.0.1:9000",
    );
    expect(currentConfig.plugins?.entries?.aics?.config?.cloudAccessToken).toEqual({
      source: "file",
      provider: "api-connections",
      id: "/entries/marketplace-dijie-cloud-bridge/secret",
    });
    expect(currentConfig.plugins?.entries?.aics?.config?.cloudApiVariablesSyncPath).toBe(
      "/dijie/api-variables/sync",
    );
    expect(currentConfig.plugins?.entries?.aics?.config?.cloudApiVariablesSyncBearer).toEqual({
      source: "env",
      provider: "default",
      id: "DIJIE_INTERNAL_BRIDGE_BEARER",
    });
    expect(JSON.stringify(currentConfig)).not.toContain("cloud-service-token");
    expect(
      result.readModel.entries.find((entry) => entry.id === "marketplace-dijie-cloud-bridge")
        ?.configBindings,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "plugins.entries.aics.config.cloudAccessToken",
          materializedAt: expect.any(String),
        }),
        expect.objectContaining({
          path: "plugins.entries.aics.config.cloudBaseUrl",
          materializedAt: expect.any(String),
        }),
      ]),
    );
  });

  it("stores pasted API keys in the local managed secret file and exposes only a file SecretRef", async () => {
    const result = await callApiConnectionsHandler<{
      ok: boolean;
      readModel: {
        entries: Array<{
          id: string;
          provider: string;
          secret: { mode: string; source?: string; provider?: string; status: string };
          risks: Array<{ code: string }>;
        }>;
      };
    }>("aics.apiConnections.entry.create", {
      name: "DeepSeek",
      kind: "model",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      authMode: "secret_ref",
      managedSecretValue: "sk-managed-deepseek-test",
      consumers: ["model", "local_dialog", "role_execution"],
      bindingPath: "models.providers.deepseek",
      metadata: {
        defaultModel: "deepseek-chat",
        availableModels: ["deepseek-chat"],
        pricing: {
          currency: "CNY",
          unit: "1M_tokens",
          inputCnyPerMillion: 0.02,
          outputCnyPerMillion: 0.02,
        },
      },
    });

    const storedSecret = currentConfig.apiConnections?.entries?.["model-deepseek"]?.secret;
    expect(storedSecret).toEqual({
      source: "file",
      provider: "api-connections",
      id: "/entries/model-deepseek/secret",
    });
    expect(JSON.stringify(currentConfig)).not.toContain("sk-managed-deepseek-test");
    expect(currentConfig.secrets?.providers?.["api-connections"]).toEqual(
      expect.objectContaining({
        source: "file",
        path: "/tmp/secrets/api-connections.json",
        mode: "json",
      }),
    );
    await expect(fs.readFile("/tmp/secrets/api-connections.json", "utf8")).resolves.toContain(
      "sk-managed-deepseek-test",
    );
    const entry = result.readModel.entries.find((candidate) => candidate.id === "model-deepseek");
    expect(entry?.secret).toEqual(
      expect.objectContaining({
        mode: "secret_ref",
        source: "file",
        provider: "api-connections",
        status: "configured",
      }),
    );
    expect(entry?.risks.map((risk) => risk.code)).not.toContain("unresolved_secret_ref");
  });

  it("removes the local managed secret when a managed API connection is deleted", async () => {
    await callApiConnectionsHandler("aics.apiConnections.entry.create", {
      name: "DeepSeek",
      kind: "model",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      authMode: "secret_ref",
      managedSecretValue: "sk-managed-delete-test",
      consumers: ["model", "local_dialog"],
      bindingPath: "models.providers.deepseek",
      metadata: {
        defaultModel: "deepseek-chat",
        availableModels: ["deepseek-chat"],
        pricing: {
          currency: "CNY",
          unit: "1M_tokens",
          inputCnyPerMillion: 0.02,
          outputCnyPerMillion: 0.02,
        },
      },
    });
    await expect(fs.readFile("/tmp/secrets/api-connections.json", "utf8")).resolves.toContain(
      "sk-managed-delete-test",
    );
    await callApiConnectionsHandler("aics.apiConnections.entry.materialize", {
      id: "model-deepseek",
    });
    expect(currentConfig.models?.providers?.deepseek).toEqual(
      expect.objectContaining({
        auth: "api-key",
        apiKey: {
          source: "file",
          provider: "api-connections",
          id: "/entries/model-deepseek/secret",
        },
      }),
    );

    await callApiConnectionsHandler("aics.apiConnections.entry.delete", { id: "model-deepseek" });

    expect(currentConfig.apiConnections?.entries?.["model-deepseek"]).toBeUndefined();
    expect(currentConfig.models?.providers?.deepseek).toBeUndefined();
    const secretFile = await fs.readFile("/tmp/secrets/api-connections.json", "utf8");
    expect(secretFile).not.toContain("sk-managed-delete-test");
    expect(JSON.parse(secretFile).entries).not.toHaveProperty("model-deepseek");
  });

  it("persists a saved model API through materialization and token fee readback", async () => {
    const createResult = await callApiConnectionsHandler<{
      ok: boolean;
      readModel: { entries: Array<{ id: string; provider: string }> };
    }>("aics.apiConnections.entry.create", {
      name: "OpenAI",
      kind: "model",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      authMode: "plaintext",
      secret: "sk-test",
      consumers: ["model", "local_dialog", "role_execution"],
      bindingPath: "models.providers.openai",
      metadata: {
        defaultModel: "codex-bengalfox",
        availableModels: ["gpt-5.5", "codex-bengalfox"],
        pricing: {
          currency: "CNY",
          unit: "1M_tokens",
          inputCnyPerMillion: 8,
          outputCnyPerMillion: 32,
        },
        budget: {
          currency: "CNY",
          period: "day",
          dailyCny: 0.01,
        },
      },
    });

    expect(createResult.ok).toBe(true);
    expect(createResult.readModel.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "model-openai", provider: "openai" })]),
    );

    await callApiConnectionsHandler("aics.apiConnections.entry.materialize", {
      id: "model-openai",
    });
    expect(
      (
        currentConfig.models?.providers?.openai as
          | { auth?: string; apiKey?: string; models?: Array<{ id?: string }> }
          | undefined
      )?.auth,
    ).toBe("api-key");
    expect(
      (
        currentConfig.models?.providers?.openai as
          | { auth?: string; apiKey?: string; models?: Array<{ id?: string }> }
          | undefined
      )?.models,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "codex-bengalfox" }),
        expect.objectContaining({ id: "gpt-5.5" }),
      ]),
    );

    const usageResult = await callApiConnectionsHandler<{
      ok: boolean;
      apiMetering: {
        entryId: string;
        consumer: string;
        costCny: number;
        usageRef: string;
      };
      readModel: {
        entries: Array<{
          id: string;
          metadata?: Record<string, unknown>;
        }>;
      };
    }>("aics.apiConnections.modelUsage.record", {
      consumer: "role_execution",
      usageRef: "ui_role_execution:task-1",
      provider: "openai",
      model: "codex-bengalfox",
      inputTokens: 1280,
      outputTokens: 620,
      totalTokens: 1900,
    });

    expect(usageResult.ok).toBe(true);
    expect(usageResult.apiMetering).toMatchObject({
      entryId: "model-openai",
      consumer: "role_execution",
      usageRef: "ui_role_execution:task-1",
    });
    expect(usageResult.apiMetering.costCny).toBeCloseTo(0.03008, 5);

    const readback = await callApiConnectionsHandler<{
      entries: Array<{
        id: string;
        metadata?: {
          metering?: {
            calls?: number;
            totalTokens?: number;
            costCny?: number;
            byConsumer?: Record<
              string,
              { calls?: number; totalTokens?: number; costCny?: number; lastUsageRef?: string }
            >;
            cloudLedgerSync?: {
              status?: string;
              usageRef?: string;
              pendingUsageRefs?: string[];
            };
          };
        };
      }>;
    }>("aics.apiConnections.readModel.get", {});
    const entry = readback.entries.find((candidate) => candidate.id === "model-openai");
    expect(entry?.metadata?.metering).toEqual(
      expect.objectContaining({
        calls: 1,
        totalTokens: 1900,
        costCny: expect.closeTo(0.03008, 5),
      }),
    );
    expect(entry?.metadata?.metering?.byConsumer?.role_execution).toEqual(
      expect.objectContaining({
        calls: 1,
        totalTokens: 1900,
        costCny: expect.closeTo(0.03008, 5),
        lastUsageRef: "ui_role_execution:task-1",
      }),
    );
    expect(entry?.metadata?.metering?.cloudLedgerSync).toEqual(
      expect.objectContaining({
        status: "pending",
        usageRef: "ui_role_execution:task-1",
        pendingUsageRefs: ["ui_role_execution:task-1"],
      }),
    );
    expect(queueFollowUpMock).toHaveBeenCalled();
  });

  it("syncs recorded model token usage to the Dijie cloud ledger when the bridge is connected", async () => {
    process.env.DIJIE_CLOUD_ACCESS_TOKEN = "bridge-token";
    currentConfig = {
      apiConnections: {
        entries: {
          "model-deepseek": {
            id: "model-deepseek",
            name: "DeepSeek",
            kind: "model",
            provider: "deepseek",
            baseUrl: "https://api.deepseek.com",
            authMode: "secret_ref",
            secret: { source: "env", provider: "default", id: "DEEPSEEK_API_KEY" },
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
          "marketplace-dijie-cloud-bridge": {
            id: "marketplace-dijie-cloud-bridge",
            name: "迭界AI云端",
            kind: "marketplace",
            provider: "dijie-cloud-bridge",
            baseUrl: "https://cloud.example.test",
            authMode: "secret_ref",
            secret: { source: "env", provider: "default", id: "DIJIE_CLOUD_ACCESS_TOKEN" },
            consumers: ["marketplace"],
          },
        },
      },
    };
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://cloud.example.test/dijie/ledger/entries");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer bridge-token");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        source: "role_usage",
        usageKind: "model_tokens",
        surface: "openclaw_local",
        modelProvider: "deepseek",
        modelId: "deepseek-chat",
        executionId: "role_execution:cloud-ledger-1",
      });
      return new Response(
        JSON.stringify({
          ok: true,
          cloudRef: "dijie_cloud_ledger:djledger_1",
          ledgerEntry: { id: "djledger_1" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const usageResult = await callApiConnectionsHandler<{
      ok: boolean;
      apiMetering: {
        entryId: string;
        cloudLedgerSync?: { status?: string; cloudRef?: string };
      };
    }>("aics.apiConnections.modelUsage.record", {
      consumer: "role_execution",
      usageRef: "role_execution:cloud-ledger-1",
      provider: "deepseek",
      model: "deepseek-chat",
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
    });

    expect(usageResult.ok).toBe(true);
    expect(usageResult.apiMetering.cloudLedgerSync).toMatchObject({
      status: "synced",
      cloudRef: "dijie_cloud_ledger:djledger_1",
    });
    const metering = currentConfig.apiConnections?.entries?.["model-deepseek"]?.metadata
      ?.metering as Record<string, unknown> | undefined;
    expect(metering?.cloudLedgerSync).toEqual(
      expect.objectContaining({
        status: "synced",
        usageRef: "role_execution:cloud-ledger-1",
        pendingUsageRefs: [],
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records a blocked cloud variable sync when Dijie cloud is not connected", async () => {
    await callApiConnectionsHandler("aics.apiConnections.entry.create", {
      name: "DeepSeek",
      kind: "model",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      authMode: "plaintext",
      secret: "sk-deepseek-test",
      consumers: ["local_dialog", "buyer_storefront", "user_center"],
      bindingPath: "models.providers.deepseek",
      metadata: {
        defaultModel: "deepseek-chat",
        availableModels: ["deepseek-chat"],
        pricing: {
          currency: "CNY",
          unit: "1M_tokens",
          inputCnyPerMillion: 0.02,
          outputCnyPerMillion: 0.02,
        },
      },
    });

    const result = await callApiConnectionsHandler<{
      ok: boolean;
      cloudVariableSync: { status: string; message: string; variableName: string };
      readModel: { entries: Array<{ id: string; metadata?: Record<string, unknown> }> };
    }>("aics.apiConnections.entry.syncCloudVariables", { id: "model-deepseek" });

    expect(result.ok).toBe(false);
    expect(result.cloudVariableSync).toEqual(
      expect.objectContaining({
        status: "blocked",
        variableName: "DEEPSEEK_API_KEY",
      }),
    );
    expect(result.cloudVariableSync.message).toContain("请先接入迭界AI云端");
    expect(
      currentConfig.apiConnections?.entries?.["model-deepseek"]?.metadata?.cloudVariableSync,
    ).toEqual(expect.objectContaining({ status: "blocked" }));
    expect(queueFollowUpMock).not.toHaveBeenCalled();
  });

  it("syncs cloud model consumers to the Dijie cloud variable endpoint", async () => {
    currentConfig = {
      plugins: {
        entries: {
          aics: {
            enabled: true,
            config: {
              cloudBaseUrl: "https://cloud.test",
              cloudAccessToken: "cloud-service-token",
              cloudApiVariablesSyncBearer: "internal-sync-token",
            },
          },
        },
      },
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ cloudRef: "cloud-variable:deepseek" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callApiConnectionsHandler("aics.apiConnections.entry.create", {
      name: "DeepSeek",
      kind: "model",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      authMode: "plaintext",
      secret: "sk-deepseek-test",
      consumers: ["local_dialog", "buyer_storefront", "developer_center", "ai_review"],
      bindingPath: "models.providers.deepseek",
      metadata: {
        defaultModel: "deepseek-chat",
        availableModels: ["deepseek-chat"],
        pricing: {
          currency: "CNY",
          unit: "1M_tokens",
          inputCnyPerMillion: 0.02,
          outputCnyPerMillion: 0.02,
        },
      },
    });

    const result = await callApiConnectionsHandler<{
      ok: boolean;
      cloudVariableSync: { status: string; cloudRef?: string; consumers: string[] };
    }>("aics.apiConnections.entry.syncCloudVariables", { id: "model-deepseek" });

    expect(result.ok).toBe(true);
    expect(result.cloudVariableSync).toEqual(
      expect.objectContaining({
        status: "synced",
        cloudRef: "cloud-variable:deepseek",
        consumers: ["buyer_storefront", "developer_center"],
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://cloud.test/dijie/api-variables/sync");
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer internal-sync-token",
    );
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        provider: "deepseek",
        variableName: "DEEPSEEK_API_KEY",
        value: "sk-deepseek-test",
        consumers: ["buyer_storefront", "developer_center"],
        pricing: {
          currency: "CNY",
          unit: "1M_tokens",
          inputCnyPerMillion: 0.02,
          outputCnyPerMillion: 0.02,
        },
      }),
    );
    expect(
      currentConfig.apiConnections?.entries?.["model-deepseek"]?.metadata?.cloudVariableSync,
    ).toEqual(expect.objectContaining({ status: "synced", cloudRef: "cloud-variable:deepseek" }));
  });

  it("prefers the API-managed Dijie cloud connection over stale plugin cloud settings", async () => {
    currentConfig = {
      plugins: {
        entries: {
          aics: {
            enabled: true,
            config: {
              cloudBaseUrl: "http://localhost:9000",
              cloudAccessToken: "stale-local-token",
              cloudApiVariablesSyncBearer: "internal-sync-token",
            },
          },
        },
      },
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ cloudRef: "cloud-variable:deepseek" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callApiConnectionsHandler("aics.apiConnections.entry.create", {
      name: "迭界AI云端",
      kind: "marketplace",
      provider: "dijie-cloud-bridge",
      baseUrl: "http://127.0.0.1:9000",
      authMode: "secret_ref",
      managedSecretValue: "cloud-service-token",
      consumers: ["marketplace"],
      bindingPath: "plugins.entries.aics.config.cloudAccessToken",
    });
    await callApiConnectionsHandler("aics.apiConnections.entry.create", {
      name: "DeepSeek",
      kind: "model",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      authMode: "secret_ref",
      managedSecretValue: "sk-deepseek-test",
      consumers: ["buyer_storefront", "user_center", "developer_center"],
      bindingPath: "models.providers.deepseek",
      metadata: {
        defaultModel: "deepseek-v4-flash",
        availableModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
        pricing: {
          currency: "CNY",
          unit: "1M_tokens",
          inputCnyPerMillion: 0.02,
          outputCnyPerMillion: 0.02,
        },
      },
    });

    const result = await callApiConnectionsHandler<{
      ok: boolean;
      cloudVariableSync: { status: string; cloudRef?: string };
    }>("aics.apiConnections.entry.syncCloudVariables", { id: "model-deepseek" });

    expect(result.ok).toBe(true);
    expect(result.cloudVariableSync.status).toBe("synced");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:9000/dijie/api-variables/sync");
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer internal-sync-token",
    );
  });

  it("explains that a 401 cloud variable sync failure is an internal bridge bearer mismatch", async () => {
    currentConfig = {
      plugins: {
        entries: {
          aics: {
            enabled: true,
            config: {
              cloudBaseUrl: "https://cloud.test",
              cloudAccessToken: "account-access-token",
              cloudApiVariablesSyncBearer: "wrong-internal-token",
            },
          },
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: "Invalid Dijie cloud bridge bearer." }), {
            status: 401,
            statusText: "Unauthorized",
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await callApiConnectionsHandler("aics.apiConnections.entry.create", {
      name: "DeepSeek",
      kind: "model",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      authMode: "plaintext",
      secret: "sk-deepseek-test",
      consumers: ["buyer_storefront", "user_center", "developer_center"],
      bindingPath: "models.providers.deepseek",
      metadata: {
        defaultModel: "deepseek-chat",
        availableModels: ["deepseek-chat"],
      },
    });

    const result = await callApiConnectionsHandler<{
      ok: boolean;
      cloudVariableSync: { status: string; message: string; httpStatus?: number };
    }>("aics.apiConnections.entry.syncCloudVariables", { id: "model-deepseek" });

    expect(result.ok).toBe(false);
    expect(result.cloudVariableSync).toEqual(
      expect.objectContaining({
        status: "failed",
        httpStatus: 401,
      }),
    );
    expect(result.cloudVariableSync.message).toContain("内部桥接 Bearer");
    expect(result.cloudVariableSync.message).toContain("账号访问 Token");
  });

  it("blocks OAuth model providers from exporting a cloud API key variable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await callApiConnectionsHandler("aics.apiConnections.entry.create", {
      name: "OpenAI",
      kind: "model",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      authMode: "oauth",
      consumers: ["buyer_storefront", "user_center", "developer_center"],
      bindingPath: "models.providers.openai",
      metadata: {
        defaultModel: "gpt-5.5",
        availableModels: ["gpt-5.5"],
        pricing: {
          currency: "CNY",
          unit: "1M_tokens",
          inputCnyPerMillion: 8,
          outputCnyPerMillion: 32,
        },
      },
    });

    const result = await callApiConnectionsHandler<{
      ok: boolean;
      cloudVariableSync: { status: string; message: string };
      readModel: {
        entries: Array<{ id: string; risks?: Array<{ code: string; severity: string }> }>;
      };
    }>("aics.apiConnections.entry.syncCloudVariables", { id: "model-openai" });

    expect(result.ok).toBe(false);
    expect(result.cloudVariableSync.status).toBe("blocked");
    expect(result.cloudVariableSync.message).toContain("OAuth 模型授权不能导出 API Key");
    expect(result.readModel.entries.find((entry) => entry.id === "model-openai")?.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "oauth_cloud_scope_not_exportable",
          severity: "warning",
        }),
      ]),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tests a SecretRef-backed DeepSeek provider through the read-only models endpoint", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-deepseek-test";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callApiConnectionsHandler("aics.apiConnections.entry.create", {
      name: "DeepSeek",
      kind: "model",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      authMode: "secret_ref",
      secret: { source: "env", provider: "default", id: "DEEPSEEK_API_KEY" },
      consumers: ["model", "local_dialog", "role_execution"],
      bindingPath: "models.providers.deepseek",
      metadata: {
        defaultModel: "deepseek-chat",
        availableModels: ["deepseek-chat"],
        pricing: {
          currency: "CNY",
          unit: "1M_tokens",
          inputCnyPerMillion: 0.02,
          outputCnyPerMillion: 0.02,
        },
      },
    });

    const result = await callApiConnectionsHandler<{
      ok: boolean;
      connectionTest: { status: string; message: string };
      readModel: { entries: Array<{ id: string; metadata?: Record<string, unknown> }> };
    }>("aics.apiConnections.entry.test", { id: "model-deepseek" });

    expect(result.ok).toBe(true);
    expect(result.connectionTest.status).toBe("passed");
    expect(result.connectionTest.message).toContain("未发起模型生成，不产生 Token");
    expect(result.connectionTest.message).toContain("默认模型已切到 deepseek-v4-flash");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.deepseek.com/models");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-deepseek-test");
    const returnedEntry = result.readModel.entries.find((entry) => entry.id === "model-deepseek");
    const validation = returnedEntry?.metadata?.modelValidation as
      | Record<string, unknown>
      | undefined;
    expect(validation).toEqual(
      expect.objectContaining({
        status: "provider_verified",
        source: "provider_models_endpoint",
        observedModelCount: 2,
        observedModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
      }),
    );
    expect(returnedEntry?.metadata?.availableModels).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
    expect(returnedEntry?.metadata?.defaultModel).toBe("deepseek-v4-flash");
    expect(
      currentConfig.apiConnections?.entries?.["model-deepseek"]?.metadata?.modelValidation,
    ).toEqual(
      expect.objectContaining({
        status: "provider_verified",
        source: "provider_models_endpoint",
        observedModelCount: 2,
        observedModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
      }),
    );
    expect(currentConfig.apiConnections?.entries?.["model-deepseek"]?.metadata?.defaultModel).toBe(
      "deepseek-v4-flash",
    );
    expect(
      currentConfig.apiConnections?.entries?.["model-deepseek"]?.metadata?.availableModels,
    ).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(commitGatewayConfigWriteMock.mock.calls.at(-1)?.[0]?.afterWrite).toEqual({
      mode: "none",
      reason: "api connection test metadata only",
    });
    expect(queueFollowUpMock).not.toHaveBeenCalled();
  });

  it("tests an OpenAI-compatible plaintext provider without calling model generation", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ id: "gpt-5.5" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callApiConnectionsHandler("aics.apiConnections.entry.create", {
      name: "OpenAI",
      kind: "model",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      authMode: "plaintext",
      secret: "sk-openai-test",
      consumers: ["model", "local_dialog"],
      bindingPath: "models.providers.openai",
      metadata: {
        defaultModel: "gpt-5.5",
        availableModels: ["gpt-5.5"],
        pricing: {
          currency: "CNY",
          unit: "1M_tokens",
          inputCnyPerMillion: 8,
          outputCnyPerMillion: 32,
        },
      },
    });

    const result = await callApiConnectionsHandler<{
      ok: boolean;
      connectionTest: { status: string; message: string };
    }>("aics.apiConnections.entry.test", { id: "model-openai" });

    expect(result.ok).toBe(true);
    expect(result.connectionTest.message).toContain("读取到 1 个模型");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/models");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-openai-test");
    expect(queueFollowUpMock).not.toHaveBeenCalled();
  });

  it("reports model directory failures without marking the provider verified", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "bad key" } }), {
          status: 401,
          statusText: "Unauthorized",
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callApiConnectionsHandler("aics.apiConnections.entry.create", {
      name: "DeepSeek",
      kind: "model",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      authMode: "plaintext",
      secret: "sk-bad",
      consumers: ["model", "local_dialog"],
      bindingPath: "models.providers.deepseek",
      metadata: {
        defaultModel: "deepseek-chat",
        availableModels: ["deepseek-chat"],
        pricing: {
          currency: "CNY",
          unit: "1M_tokens",
          inputCnyPerMillion: 0.02,
          outputCnyPerMillion: 0.02,
        },
      },
    });

    const result = await callApiConnectionsHandler<{
      ok: boolean;
      connectionTest: { status: string; message: string };
    }>("aics.apiConnections.entry.test", { id: "model-deepseek" });

    expect(result.ok).toBe(false);
    expect(result.connectionTest.status).toBe("failed");
    expect(result.connectionTest.message).toContain("401 Unauthorized");
    expect(
      (
        currentConfig.apiConnections?.entries?.["model-deepseek"]?.metadata?.modelValidation as
          | Record<string, unknown>
          | undefined
      )?.status,
    ).not.toBe("provider_verified");
  });
});
