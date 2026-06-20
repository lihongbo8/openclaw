import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  applyModelUsageToApiConnectionMetering,
  resolveApiModelRefForConsumer,
} from "./metering.js";

describe("api connection model usage metering", () => {
  it("records role execution token usage and calculates CNY cost from model pricing", () => {
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
            configBindings: [{ path: "models.providers.openai" }],
            metadata: {
              defaultModel: "gpt-5.5",
              pricing: {
                currency: "CNY",
                unit: "1M_tokens",
                inputCnyPerMillion: 8,
                outputCnyPerMillion: 32,
              },
              metering: {
                calls: 1,
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
                costCny: 0.0024,
              },
            },
          },
        },
      },
    };

    const result = applyModelUsageToApiConnectionMetering(config, {
      consumer: "role_execution",
      executionId: "ui_role_execution:task-1",
      modelUsage: {
        provider: "openai",
        inputTokens: 1280,
        outputTokens: 620,
        totalTokens: 1900,
        costCents: 0,
      },
    });

    expect(result?.entryId).toBe("model-openai");
    expect(result?.costCny).toBeCloseTo(0.03008, 6);
    const metering = result?.config.apiConnections?.entries?.["model-openai"]?.metadata
      ?.metering as Record<string, unknown>;
    expect(metering).toMatchObject({
      calls: 2,
      inputTokens: 1380,
      outputTokens: 670,
      totalTokens: 2050,
    });
    expect(metering.costCny).toBeCloseTo(0.03248, 6);
    expect((metering.byConsumer as Record<string, unknown>).role_execution).toMatchObject({
      calls: 1,
      inputTokens: 1280,
      outputTokens: 620,
      totalTokens: 1900,
      lastUsageRef: "ui_role_execution:task-1",
    });
  });

  it("prefers actual costCents when execution evidence already has cost", () => {
    const config: OpenClawConfig = {
      apiConnections: {
        entries: {
          "model-openai": {
            id: "model-openai",
            name: "OpenAI",
            kind: "model",
            provider: "openai",
            consumers: ["role_execution"],
            metadata: {
              pricing: {
                inputCnyPerMillion: 8,
                outputCnyPerMillion: 32,
              },
            },
          },
        },
      },
    };

    const result = applyModelUsageToApiConnectionMetering(config, {
      consumer: "role_execution",
      executionId: "exec-paid",
      modelUsage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        costCents: 123,
      },
    });

    expect(result?.costCny).toBe(1.23);
    const metering = result?.config.apiConnections?.entries?.["model-openai"]?.metadata
      ?.metering as Record<string, unknown>;
    expect(metering.costCny).toBe(1.23);
  });

  it("attributes model token cost to dialog, tool, and Skill consumers", () => {
    const config: OpenClawConfig = {
      apiConnections: {
        entries: {
          "model-openai": {
            id: "model-openai",
            name: "OpenAI",
            kind: "model",
            provider: "openai",
            consumers: ["model", "local_dialog", "tool", "skill"],
            metadata: {
              pricing: {
                inputCnyPerMillion: 10,
                outputCnyPerMillion: 40,
              },
            },
          },
        },
      },
    };

    const dialog = applyModelUsageToApiConnectionMetering(config, {
      consumer: "local_dialog",
      executionId: "chat:main:turn-1",
      modelUsage: { provider: "openai", inputTokens: 1_000, outputTokens: 500 },
    });
    const tool = applyModelUsageToApiConnectionMetering(dialog!.config, {
      consumer: "tool",
      executionId: "tool:image-analysis:call-1",
      modelUsage: { provider: "openai", inputTokens: 300, outputTokens: 200 },
    });
    const skill = applyModelUsageToApiConnectionMetering(tool!.config, {
      consumer: "skill",
      executionId: "skill:listing-copy:run-1",
      modelUsage: { provider: "openai", inputTokens: 600, outputTokens: 100 },
    });

    const metering = skill?.config.apiConnections?.entries?.["model-openai"]?.metadata
      ?.metering as Record<string, unknown>;
    expect(metering).toMatchObject({
      calls: 3,
      inputTokens: 1_900,
      outputTokens: 800,
      totalTokens: 2_700,
    });
    expect(metering.costCny).toBeCloseTo(0.051, 6);
    const byConsumer = metering.byConsumer as Record<string, Record<string, unknown>>;
    expect(byConsumer).toMatchObject({
      local_dialog: {
        calls: 1,
        totalTokens: 1_500,
        lastUsageRef: "chat:main:turn-1",
      },
      tool: {
        calls: 1,
        totalTokens: 500,
        lastUsageRef: "tool:image-analysis:call-1",
      },
      skill: {
        calls: 1,
        totalTokens: 700,
        lastUsageRef: "skill:listing-copy:run-1",
      },
    });
    expect(byConsumer.local_dialog?.costCny as number).toBeCloseTo(0.03, 6);
    expect(byConsumer.tool?.costCny as number).toBeCloseTo(0.011, 6);
    expect(byConsumer.skill?.costCny as number).toBeCloseTo(0.01, 6);
  });

  it("does not create metering when no model provider is configured", () => {
    const result = applyModelUsageToApiConnectionMetering(
      { apiConnections: { entries: {} } },
      {
        consumer: "role_execution",
        executionId: "exec-no-provider",
        modelUsage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
      },
    );

    expect(result).toBeNull();
  });

  it("does not double count an already-recorded usage ref", () => {
    const config: OpenClawConfig = {
      apiConnections: {
        entries: {
          "model-openai": {
            id: "model-openai",
            name: "OpenAI",
            kind: "model",
            provider: "openai",
            consumers: ["local_dialog"],
            metadata: {
              pricing: {
                inputCnyPerMillion: 8,
                outputCnyPerMillion: 32,
              },
              metering: {
                calls: 1,
                inputTokens: 1000,
                outputTokens: 200,
                totalTokens: 1200,
                costCny: 0.0144,
                lastUsageRef: "build_session:another-run",
                recordedUsageRefs: ["chat:agent-main-main:session-1"],
              },
            },
          },
        },
      },
    };

    const result = applyModelUsageToApiConnectionMetering(config, {
      consumer: "local_dialog",
      executionId: "chat:agent-main-main:session-1",
      modelUsage: { provider: "openai", inputTokens: 1000, outputTokens: 200 },
    });

    expect(result).toMatchObject({
      entryId: "model-openai",
      costCny: 0,
      deduped: true,
    });
    expect(result?.config).toBe(config);
  });

  it("resolves the role execution model from API management default model", () => {
    const config: OpenClawConfig = {
      apiConnections: {
        entries: {
          "model-openai": {
            id: "model-openai",
            name: "OpenAI",
            kind: "model",
            provider: "openai",
            consumers: ["model", "local_dialog"],
            metadata: { defaultModel: "gpt-5.5" },
          },
          "model-deepseek": {
            id: "model-deepseek",
            name: "DeepSeek",
            kind: "model",
            provider: "deepseek",
            consumers: ["model", "role_execution"],
            metadata: {
              defaultModel: "deepseek-v4-flash",
              availableModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
            },
          },
        },
      },
    };

    expect(resolveApiModelRefForConsumer(config, { consumer: "role_execution" })).toEqual({
      entryId: "model-deepseek",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      modelRef: "deepseek/deepseek-v4-flash",
    });
  });

  it("falls back to the configured generic model pool for a missing consumer-specific scope", () => {
    const config: OpenClawConfig = {
      apiConnections: {
        entries: {
          "model-deepseek": {
            id: "model-deepseek",
            name: "DeepSeek",
            kind: "model",
            provider: "deepseek",
            consumers: ["model"],
            metadata: { availableModels: ["deepseek-v4-pro"] },
          },
        },
      },
    };

    expect(resolveApiModelRefForConsumer(config, { consumer: "role_execution" })).toEqual({
      entryId: "model-deepseek",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      modelRef: "deepseek/deepseek-v4-pro",
    });
  });
});
