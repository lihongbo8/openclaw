import { describe, expect, it } from "vitest";
import type { ObservationAdapter } from "./adapters/types.js";
import type { ObservationToolStep } from "./generic-observation-engine.js";
import { createObservationAdapterCollector } from "./observation-adapter-collector.js";

const step: ObservationToolStep = {
  id: "step-external",
  toolType: "external_web_fetch",
  toolName: "外部产品观察",
  purpose: "采集外部产品信息",
  input: { sourceId: "external-info" },
  expectedOutput: "外部事实",
  riskLevel: "medium",
  allowedSideEffects: "none",
  status: "pending",
};

describe("observation adapter collector", () => {
  it("converts adapter signals into raw tool evidence", async () => {
    const adapter: ObservationAdapter = {
      id: "external-info-observation",
      label: "外部产品技术风险观察",
      sourceType: "external_info",
      defaultConfidence: "medium",
      async fetch() {
        return {
          sourceId: "external-info-observation",
          sourceType: "external_info",
          collectedAt: Date.parse("2026-06-20T03:00:00.000Z"),
          freshness: "fresh",
          signals: [
            {
              id: "external-model-update",
              title: "外部模型能力变化",
              summary: "外部来源显示模型工具调用能力有更新。",
              evidenceRefs: ["external-info:models"],
            },
          ],
          evidenceRefs: [
            {
              id: "external-info:models",
              sourceId: "external-info-observation",
              sourceType: "external_info",
              label: "模型 changelog",
              confidence: "medium",
              freshness: "fresh",
              collectedAt: Date.parse("2026-06-20T03:00:00.000Z"),
              recordId: "https://example.com/changelog",
            },
          ],
        };
      },
    };

    await expect(
      createObservationAdapterCollector({ adapter, toolPlanId: "plan-1" })(step),
    ).resolves.toMatchObject({
      toolPlanId: "plan-1",
      toolStepId: "step-external",
      toolType: "external_web_fetch",
      toolName: "外部产品观察",
      rawOutputRef: "https://example.com/changelog",
      rawSummary: "外部模型能力变化：外部来源显示模型工具调用能力有更新。",
      success: true,
    });
  });

  it("keeps adapter failures as failed raw evidence", async () => {
    const adapter: ObservationAdapter = {
      id: "external-info-observation",
      label: "外部产品技术风险观察",
      sourceType: "external_info",
      defaultConfidence: "medium",
      async fetch() {
        return {
          sourceId: "external-info-observation",
          sourceType: "external_info",
          collectedAt: Date.parse("2026-06-20T03:10:00.000Z"),
          freshness: "unknown",
          signals: [],
          evidenceRefs: [],
          error: "HTTP 403",
        };
      },
    };

    await expect(
      createObservationAdapterCollector({ adapter, toolPlanId: "plan-1" })(step),
    ).resolves.toMatchObject({
      success: false,
      error: "HTTP 403",
      rawSummary: "external-info-observation 采集失败：HTTP 403",
    });
  });
});
