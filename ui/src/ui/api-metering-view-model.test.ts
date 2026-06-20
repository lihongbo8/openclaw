import { describe, expect, it } from "vitest";
import { createApiMeteringViewModel } from "./api-metering-view-model.ts";
import type { SessionsUsageResult } from "./types.ts";

describe("api metering view model", () => {
  it("separates settlement readback from live session metering while keeping one budget algorithm", () => {
    const entries = [
      {
        id: "model-openai",
        name: "OpenAI",
        kind: "model",
        provider: "openai",
        consumers: ["model", "role_execution", "developer_center"],
        metadata: {
          defaultModel: "codex-bengalfox",
          availableModels: ["codex-bengalfox"],
          pricing: {
            currency: "CNY",
            unit: "1M_tokens",
            inputCnyPerMillion: 8,
            outputCnyPerMillion: 32,
          },
          budget: { currency: "CNY", period: "day", dailyCny: 0.03 },
          metering: {
            calls: 1,
            inputTokens: 1000,
            outputTokens: 500,
            totalTokens: 1500,
            cloudLedgerSync: {
              status: "pending",
              target: "dijie_ai_cloud",
              usageRef: "ui_role_execution:task-1",
              message: "待同步：迭界AI云端服务 Token 或 Base URL 未配置。",
              updatedAt: "2026-06-18T00:00:00.000Z",
              pendingUsageRefs: ["ui_role_execution:task-1"],
            },
            byConsumer: {
              role_execution: {
                calls: 1,
                inputTokens: 1000,
                outputTokens: 500,
                totalTokens: 1500,
                lastUsageRef: "ui_role_execution:task-1",
              },
            },
          },
        },
      },
    ];
    const usageResult = {
      updatedAt: Date.now(),
      startDate: "2026-06-16",
      endDate: "2026-06-16",
      sessions: [
        {
          key: "developer-center:role-builder",
          label: "开发者中心岗位包助手",
          channel: "developer_center",
          origin: { surface: "developer_center", label: "开发者中心" },
          usage: {
            modelUsage: [
              {
                provider: "openai",
                model: "codex-bengalfox",
                count: 1,
                totals: {
                  input: 500,
                  output: 500,
                  totalTokens: 1000,
                },
              },
            ],
          },
        },
      ],
      totals: {},
      aggregates: {
        messages: {},
        tools: {},
        byModel: [
          {
            provider: "openai",
            model: "codex-bengalfox",
            count: 1,
            totals: {
              input: 500,
              output: 500,
              totalTokens: 1000,
            },
          },
        ],
        byProvider: [],
        byAgent: [],
        byChannel: [],
        daily: [],
      },
    } as unknown as SessionsUsageResult;

    const settlementView = createApiMeteringViewModel({
      entries,
      usageResult,
      includeSessionUsage: false,
    });
    const liveView = createApiMeteringViewModel({
      entries,
      usageResult,
      includeSessionUsage: true,
    });

    expect(settlementView.modelTotals.totalTokens).toBe(1500);
    expect(settlementView.modelTotals.costCny).toBeCloseTo(0.024, 6);
    expect(settlementView.budgetRows[0]).toMatchObject({
      currentCostCny: 0.024,
      budgetLimitCny: 0.03,
      status: "ok",
    });
    expect(settlementView.consumerTotals).toEqual([
      expect.objectContaining({
        consumer: "role_execution",
        totals: expect.objectContaining({ totalTokens: 1500, costCny: 0.024 }),
      }),
    ]);
    expect(settlementView.ledgerSyncRows).toEqual([
      expect.objectContaining({
        entryLabel: "OpenAI",
        status: "pending",
        usageRef: "ui_role_execution:task-1",
        pendingUsageRefs: ["ui_role_execution:task-1"],
      }),
    ]);

    expect(liveView.modelTotals.totalTokens).toBe(2500);
    expect(liveView.modelTotals.costCny).toBeCloseTo(0.044, 6);
    expect(liveView.budgetRows[0]?.status).toBe("exceeded");
    expect(liveView.consumerTotals).toEqual([
      expect.objectContaining({
        consumer: "role_execution",
        totals: expect.objectContaining({ totalTokens: 1500, costCny: 0.024 }),
      }),
      expect.objectContaining({
        consumer: "developer_center",
        totals: expect.objectContaining({ totalTokens: 1000, costCny: 0.02 }),
      }),
    ]);
  });

  it("uses backend billing attribution readback for role execution cost evidence", () => {
    const view = createApiMeteringViewModel({
      readModel: {
        entries: [],
        billingAttribution: {
          roleExecution: {
            status: "pending_sync",
            ledgerConsumer: "role_execution",
            calls: 1,
            inputTokens: 500,
            outputTokens: 250,
            totalTokens: 750,
            costCny: 0.01,
            lastUsageRef: "exec-marketplace-ops",
            lastUsageAt: "2026-06-20T08:05:00.000Z",
            providerEntryIds: ["model-deepseek"],
            cloudLedgerSync: {
              status: "pending",
              message: "待同步：迭界AI云端账本暂不可达。",
              pendingUsageRefs: ["exec-marketplace-ops"],
              lastError: "ECONNREFUSED",
              updatedAt: "2026-06-20T08:05:01.000Z",
            },
            requiredEvidenceFields: [
              "accountId",
              "billingAccountId",
              "roleListingId",
              "entitlementId",
              "executionId",
              "apiKey/provider/model",
              "consumer=role_execution",
              "ledgerRef/auditRecordId",
            ],
          },
        },
      },
      includeSessionUsage: false,
    });

    expect(view.roleExecutionBilling).toMatchObject({
      status: "pending_sync",
      ledgerConsumer: "role_execution",
      calls: 1,
      totalTokens: 750,
      costCny: 0.01,
      providerEntryIds: ["model-deepseek"],
      cloudLedgerSync: {
        status: "pending",
        pendingUsageRefs: ["exec-marketplace-ops"],
        lastError: "ECONNREFUSED",
      },
      requiredEvidenceFields: expect.arrayContaining([
        "accountId",
        "executionId",
        "apiKey/provider/model",
        "consumer=role_execution",
      ]),
    });
    expect(view.ledgerSyncRows).toEqual([
      expect.objectContaining({
        entryLabel: "岗位执行费用",
        status: "pending",
        usageRef: "exec-marketplace-ops",
        pendingUsageRefs: ["exec-marketplace-ops"],
      }),
    ]);
  });
});
