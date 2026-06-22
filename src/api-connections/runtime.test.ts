import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  resolveApiModelRuntimeForConsumer,
  toOpenAICompatibleChatCompletionsUrl,
} from "./runtime.js";

describe("api connection model runtime", () => {
  it("resolves BuildSession model runtime from a SecretRef provider binding", async () => {
    const config: OpenClawConfig = {
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
            consumers: ["model", "build_session"],
            metadata: { defaultModel: "deepseek-v4-flash" },
          },
        },
      },
    };

    const binding = await resolveApiModelRuntimeForConsumer(config, {
      consumer: "build_session",
      env: { DEEPSEEK_API_KEY: "sk-test" } as NodeJS.ProcessEnv,
    });

    expect(binding).toMatchObject({
      entryId: "model-deepseek",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      modelRef: "deepseek/deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      authMode: "secret_ref",
      secretSource: "secret_ref",
    });
    expect(binding?.apiKey).toBe("sk-test");
  });

  it("rejects OAuth bindings for local server-side model calls", async () => {
    const config: OpenClawConfig = {
      apiConnections: {
        entries: {
          "model-openai": {
            id: "model-openai",
            name: "OpenAI",
            kind: "model",
            provider: "openai",
            authMode: "oauth",
            consumers: ["build_session"],
            metadata: { defaultModel: "gpt-5.5" },
          },
        },
      },
    };

    await expect(
      resolveApiModelRuntimeForConsumer(config, { consumer: "build_session" }),
    ).rejects.toThrow("OAuth/云端授权不能直接用于本地服务端模型调用");
  });

  it("falls back to another role execution model when an OAuth binding is not locally callable", async () => {
    const config: OpenClawConfig = {
      apiConnections: {
        entries: {
          "model-openai": {
            id: "model-openai",
            name: "OpenAI",
            kind: "model",
            provider: "openai",
            authMode: "oauth",
            consumers: ["model", "role_execution"],
            metadata: { defaultModel: "gpt-5.5" },
          },
          "model-deepseek": {
            id: "model-deepseek",
            name: "DeepSeek",
            kind: "model",
            provider: "deepseek",
            baseUrl: "https://api.deepseek.com",
            authMode: "secret_ref",
            secret: { source: "env", provider: "default", id: "DEEPSEEK_API_KEY" },
            consumers: ["model", "role_execution"],
            metadata: { defaultModel: "deepseek-v4-flash" },
          },
        },
      },
    };

    const binding = await resolveApiModelRuntimeForConsumer(config, {
      consumer: "role_execution",
      env: { DEEPSEEK_API_KEY: "sk-test" } as NodeJS.ProcessEnv,
    });

    expect(binding).toMatchObject({
      entryId: "model-deepseek",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      modelRef: "deepseek/deepseek-v4-flash",
      authMode: "secret_ref",
    });
  });

  it("normalizes OpenAI-compatible chat completions URLs", () => {
    expect(toOpenAICompatibleChatCompletionsUrl("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
    expect(toOpenAICompatibleChatCompletionsUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });
});
