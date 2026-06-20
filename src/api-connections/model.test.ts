import { describe, expect, it } from "vitest";
import { materializeApiConnectionToConfig } from "./materializer.js";
import { createApiConnectionsReadModel, normalizeApiConnectionEntry } from "./model.js";

describe("api connections read model", () => {
  it("defaults created entries to SecretRef", () => {
    const entry = normalizeApiConnectionEntry({
      name: "OpenAI",
      kind: "model",
      provider: "openai",
      consumers: ["model"],
    });

    expect(entry.authMode).toBe("secret_ref");
    expect(entry.secret).toEqual({ source: "env", provider: "default", id: "OPENAI_API_KEY" });
  });

  it("redacts plaintext in the read model and blocks protected tool/skill plaintext", () => {
    const readModel = createApiConnectionsReadModel({
      apiConnections: {
        entries: {
          brave: normalizeApiConnectionEntry({
            name: "Brave Search",
            kind: "tool_skill",
            provider: "brave-search",
            secret: "plain-key",
            consumers: ["skill"],
            configBindings: [{ path: "skills.entries.brave-search.apiKey" }],
          }),
        },
      },
    });

    expect(readModel.entries[0]?.secret).toEqual({ mode: "plaintext", status: "configured" });
    expect(
      readModel.riskReport.items.some((item) => item.code === "high_risk_plaintext_secret"),
    ).toBe(true);
  });

  it("normalizes legacy model consumers to model-token scopes", () => {
    const readModel = createApiConnectionsReadModel({
      apiConnections: {
        entries: {
          deepseek: normalizeApiConnectionEntry({
            name: "DeepSeek",
            kind: "model",
            provider: "deepseek",
            secret: "plain-key",
            consumers: ["model", "local_dialog", "marketplace", "tool", "skill"],
            configBindings: [{ path: "models.providers.deepseek" }],
          }),
        },
      },
    });

    expect(readModel.entries[0]?.consumers).toEqual(["model", "local_dialog"]);
    expect(
      readModel.riskReport.items.some((item) => item.code === "high_risk_plaintext_secret"),
    ).toBe(false);
    expect(readModel.riskReport.items.some((item) => item.code === "missing_marketplace_api")).toBe(
      true,
    );
  });

  it("blocks unresolved SecretRef entries", () => {
    const readModel = createApiConnectionsReadModel(
      {
        apiConnections: {
          entries: {
            openai: normalizeApiConnectionEntry({
              name: "OpenAI",
              kind: "model",
              provider: "openai",
              consumers: ["model"],
              configBindings: [{ path: "models.providers.openai.apiKey" }],
            }),
          },
        },
      },
      {},
    );

    expect(readModel.entries[0]?.status).toBe("blocked");
    expect(readModel.riskReport.items.some((item) => item.code === "unresolved_secret_ref")).toBe(
      true,
    );
  });

  it("keeps OAuth model entries available without requiring an API key secret", () => {
    const entry = normalizeApiConnectionEntry({
      name: "OpenAI OAuth",
      kind: "model",
      provider: "openai",
      authMode: "oauth",
      consumers: ["model", "local_dialog"],
      configBindings: [{ path: "models.providers.openai" }],
    });
    const readModel = createApiConnectionsReadModel({
      apiConnections: { entries: { [entry.id]: entry } },
    });

    expect(entry.authMode).toBe("oauth");
    expect(entry.secret).toBeUndefined();
    expect(readModel.entries[0]?.secret).toEqual({ mode: "oauth", status: "configured" });
    expect(readModel.entries[0]?.status).toBe("available");
    expect(readModel.riskReport.items.some((item) => item.code === "missing_secret_ref")).toBe(
      false,
    );
    expect(readModel.riskReport.items.some((item) => item.code === "unresolved_secret_ref")).toBe(
      false,
    );
  });

  it("reports missing model provider scope instead of requiring a dispatch API", () => {
    const readModel = createApiConnectionsReadModel({
      apiConnections: {
        entries: {
          marketplace: normalizeApiConnectionEntry({
            name: "迭界AI云端",
            kind: "marketplace",
            provider: "dijie-cloud-bridge",
            authMode: "oauth",
            consumers: ["marketplace"],
            configBindings: [{ path: "plugins.entries.aics.config.cloudBaseUrl" }],
          }),
        },
      },
    });

    expect(readModel.riskReport.items.some((item) => item.code === "missing_dispatch_api")).toBe(
      false,
    );
    const missingModelRisk = readModel.riskReport.items.find(
      (item) => item.code === "missing_model_provider",
    );
    expect(missingModelRisk?.severity).toBe("blocking");
    expect(missingModelRisk?.consumerScope).toContain("local_dialog");
    expect(missingModelRisk?.consumerScope).toContain("role_execution");
    expect(missingModelRisk?.consumerScope).toContain("image");
  });

  it("does not report model provider gaps when one model API covers all token consumers", () => {
    const modelConsumers = [
      "model",
      "local_dialog",
      "operations_backend",
      "build_session",
      "buyer_storefront",
      "user_center",
      "developer_center",
      "ai_review",
      "role_execution",
      "image",
      "media_model",
    ] as const;
    const readModel = createApiConnectionsReadModel({
      apiConnections: {
        entries: {
          openai: normalizeApiConnectionEntry({
            name: "OpenAI OAuth",
            kind: "model",
            provider: "openai",
            authMode: "oauth",
            consumers: [...modelConsumers],
            configBindings: [{ path: "models.providers.openai" }],
          }),
          marketplace: normalizeApiConnectionEntry({
            name: "迭界AI云端",
            kind: "marketplace",
            provider: "dijie-cloud-bridge",
            authMode: "oauth",
            consumers: ["marketplace"],
            configBindings: [{ path: "plugins.entries.aics.config.cloudBaseUrl" }],
          }),
        },
      },
    });

    expect(readModel.riskReport.items.some((item) => item.code === "missing_model_provider")).toBe(
      false,
    );
    expect(readModel.riskReport.items.some((item) => item.code === "missing_dispatch_api")).toBe(
      false,
    );
  });
});

describe("api connections materializer", () => {
  it("materializes model APIs into provider runtime config", () => {
    const entry = normalizeApiConnectionEntry({
      name: "OpenAI",
      kind: "model",
      provider: "openai",
      baseUrl: "https://api.openai.test/v1",
      consumers: ["model"],
      metadata: {
        defaultModel: "gpt-4.1-mini",
        availableModels: ["gpt-4.1", "gpt-4.1-mini"],
      },
    });
    const result = materializeApiConnectionToConfig({
      apiConnections: { entries: { [entry.id]: entry } },
    });

    expect(result.changedPaths).toEqual(["models.providers.openai"]);
    expect(result.config.models?.providers?.openai?.apiKey).toEqual({
      source: "env",
      provider: "default",
      id: "OPENAI_API_KEY",
    });
    expect(result.config.models?.providers?.openai?.baseUrl).toBe("https://api.openai.test/v1");
    expect(result.config.models?.providers?.openai?.models.map((model) => model.id)).toEqual([
      "gpt-4.1-mini",
      "gpt-4.1",
    ]);
    expect(result.config.apiConnections?.entries?.[entry.id]?.configBindings).toEqual([
      expect.objectContaining({ path: "models.providers.openai", owner: "apiConnections" }),
    ]);
  });

  it("overwrites stale plaintext model keys with API-managed SecretRefs", () => {
    const secretRef = { source: "env" as const, provider: "default", id: "DEEPSEEK_API_KEY" };
    const entry = normalizeApiConnectionEntry({
      name: "DeepSeek",
      kind: "model",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      authMode: "secret_ref",
      secret: secretRef,
      consumers: ["model", "local_dialog", "role_execution"],
      metadata: {
        defaultModel: "deepseek-chat",
        availableModels: ["deepseek-chat"],
      },
    });

    const result = materializeApiConnectionToConfig({
      models: {
        providers: {
          deepseek: {
            auth: "api-key",
            apiKey: "sk-legacy-plaintext",
            baseUrl: "https://old-deepseek.test",
            models: [],
          },
        },
      },
      apiConnections: { entries: { [entry.id]: entry } },
    });

    expect(result.changedPaths).toEqual(["models.providers.deepseek"]);
    expect(result.config.models?.providers?.deepseek?.apiKey).toEqual(secretRef);
    expect(JSON.stringify(result.config.models?.providers?.deepseek)).not.toContain(
      "sk-legacy-plaintext",
    );
  });

  it("materializes OAuth model APIs without keeping stale API keys", () => {
    const entry = normalizeApiConnectionEntry({
      name: "OpenAI OAuth",
      kind: "model",
      provider: "openai",
      authMode: "oauth",
      baseUrl: "https://api.openai.com/v1",
      consumers: ["model", "local_dialog"],
      metadata: {
        defaultModel: "gpt-5.5",
        availableModels: ["gpt-5.5"],
      },
    });
    const result = materializeApiConnectionToConfig({
      models: {
        providers: {
          openai: {
            auth: "api-key",
            apiKey: { source: "env", provider: "default", id: "STALE_OPENAI_API_KEY" },
            baseUrl: "https://old-openai.test/v1",
            models: [],
          },
        },
      },
      apiConnections: { entries: { [entry.id]: entry } },
    });

    expect(result.changedPaths).toEqual(["models.providers.openai"]);
    expect(result.config.models?.providers?.openai?.auth).toBe("oauth");
    expect(result.config.models?.providers?.openai).not.toHaveProperty("apiKey");
    expect(result.config.models?.providers?.openai?.baseUrl).toBe("https://api.openai.com/v1");
    expect(result.config.models?.providers?.openai?.models.map((model) => model.id)).toEqual([
      "gpt-5.5",
    ]);
  });

  it("materializes the Dijie cloud bridge into AICS plugin runtime config", () => {
    const entry = normalizeApiConnectionEntry({
      name: "迭界AI云端",
      kind: "marketplace",
      provider: "dijie-cloud-bridge",
      baseUrl: "https://dijie-cloud.test",
      secret: { source: "env", provider: "default", id: "DIJIE_CLOUD_ACCESS_TOKEN" },
      consumers: ["marketplace", "dispatch"],
      configBindings: [{ path: "plugins.entries.aics.config.cloudBaseUrl" }],
    });
    const result = materializeApiConnectionToConfig({
      apiConnections: { entries: { [entry.id]: entry } },
    });

    expect(result.config.plugins?.entries?.aics).toMatchObject({
      enabled: true,
      config: {
        cloudBaseUrl: "https://dijie-cloud.test",
        cloudHealthPath: "/dijie/gateway/health",
        cloudApiVariablesSyncBearer: {
          source: "env",
          provider: "default",
          id: "DIJIE_INTERNAL_BRIDGE_BEARER",
        },
        cloudAccessToken: { source: "env", provider: "default", id: "DIJIE_CLOUD_ACCESS_TOKEN" },
        cloudExecutionTokenPath: "/dijie/execution-token",
        cloudExecutionReadPath: "/dijie/executions",
        cloudMarketplaceInstalledRolesPath: "/dijie/my-roles",
        cloudAuthorizationPath: "/dijie/authorizations",
        cloudAuditPath: "/dijie/audit",
        cloudAuditUploadEnabled: true,
        cloudAuditUploadRequired: true,
      },
    });
    expect(result.changedPaths).toContain("plugins.entries.aics.config.cloudAccessToken");
    expect(result.changedPaths).toContain("plugins.entries.aics.config.cloudAuditUploadRequired");
  });

  it("deleting a connection is separate from materialized user config", () => {
    const result = materializeApiConnectionToConfig({
      models: {
        providers: {
          openai: {
            apiKey: { source: "env", provider: "default", id: "USER_OPENAI_API_KEY" },
            baseUrl: "https://api.openai.test/v1",
            models: [],
          },
        },
      },
      apiConnections: { entries: {} },
    });

    expect(result.config.models?.providers?.openai?.apiKey).toEqual({
      source: "env",
      provider: "default",
      id: "USER_OPENAI_API_KEY",
    });
    expect(result.changedPaths).toEqual([]);
  });

  it("materializes the cloud marketplace connection into the AICS plugin bridge", () => {
    const entry = normalizeApiConnectionEntry({
      name: "迭界AI本地开发云端",
      kind: "marketplace",
      provider: "cloud-marketplace",
      baseUrl: "http://127.0.0.1:9000",
      secret: "buyer-cloud-token",
      consumers: ["marketplace"],
      configBindings: [{ path: "cloudMarketplace.apiKey" }],
      metadata: {
        dijie: {
          roleListingId: "djrole_marketplace_ops",
          entitlementId: "djent_marketplace_ops",
          deviceId: "smoke-device",
          workspaceRef: "smoke-workspace",
          localGatewayId: "smoke-gateway",
        },
      },
    });

    const result = materializeApiConnectionToConfig({
      plugins: {
        entries: {
          aics: {
            config: {
              defaultDeviceId: "existing-device",
            },
          },
        },
      },
      apiConnections: { entries: { [entry.id]: entry } },
    });

    const aicsConfig = result.config.plugins?.entries?.aics?.config;
    expect(aicsConfig?.cloudBaseUrl).toBe("http://127.0.0.1:9000");
    expect(aicsConfig?.cloudHealthPath).toBe("/dijie/gateway/health");
    expect(aicsConfig?.cloudAccessToken).toBe("buyer-cloud-token");
    expect(aicsConfig?.defaultDeviceId).toBe("existing-device");
    expect(aicsConfig?.defaultWorkspaceRef).toBe("smoke-workspace");
    expect(aicsConfig?.defaultLocalGatewayId).toBe("smoke-gateway");
    expect(aicsConfig?.defaultRoleListingId).toBe("djrole_marketplace_ops");
    expect(aicsConfig?.defaultEntitlementId).toBe("djent_marketplace_ops");
    expect(aicsConfig?.cloudAuditUploadEnabled).toBe(true);
    expect(result.config).not.toHaveProperty("cloudMarketplace");
    expect(result.changedPaths).toContain("plugins.entries.aics.config.cloudAccessToken");
    expect(result.changedPaths).toContain("plugins.entries.aics.config.cloudBaseUrl");
  });
});
