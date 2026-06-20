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
});
