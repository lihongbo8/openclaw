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

  it("redacts plaintext in the read model and marks it risky", () => {
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
    expect(readModel.riskReport.items.some((item) => item.code === "plaintext_secret")).toBe(true);
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
});

describe("api connections materializer", () => {
  it("materializes bound API secrets and endpoints into runtime config paths", () => {
    const entry = normalizeApiConnectionEntry({
      name: "OpenAI",
      kind: "model",
      provider: "openai",
      baseUrl: "https://api.openai.test/v1",
      consumers: ["model"],
      configBindings: [
        { path: "models.providers.openai.apiKey" },
        { path: "models.providers.openai.baseUrl" },
      ],
    });
    const result = materializeApiConnectionToConfig({
      apiConnections: { entries: { [entry.id]: entry } },
    });

    expect(result.changedPaths).toEqual([
      "models.providers.openai.apiKey",
      "models.providers.openai.baseUrl",
    ]);
    expect(result.config.models?.providers?.openai?.apiKey).toEqual({
      source: "env",
      provider: "default",
      id: "OPENAI_API_KEY",
    });
    expect(result.config.models?.providers?.openai?.baseUrl).toBe("https://api.openai.test/v1");
  });

  it("materializes the Dijie cloud bridge into AICS plugin runtime config", () => {
    const entry = normalizeApiConnectionEntry({
      name: "迭界岗位商城云端桥",
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
      name: "云端商城 API",
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
