import { describe, expect, it } from "vitest";
import { createExternalInfoAdapter } from "./external-info-adapter.js";

describe("createExternalInfoAdapter", () => {
  it("collects configured external JSON and HTML sources as observation evidence", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/model-status")) {
        return new Response(JSON.stringify({ title: "模型工具状态", availableModels: 12 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/competitor")) {
        return new Response(
          '<html><head><title>竞品岗位市场</title><meta name="description" content="支持安装、测试和调用岗位"></head><body><h1>Agent Marketplace</h1></body></html>',
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return new Response("missing", { status: 404 });
    };

    const adapter = createExternalInfoAdapter({
      fetchFn,
      sources: [
        {
          id: "model-status",
          label: "模型工具状态页",
          url: "https://external.example.test/model-status",
          kind: "technology_tool_model",
        },
        {
          id: "competitor",
          label: "竞品岗位市场",
          url: "https://external.example.test/competitor",
          kind: "product_competitor",
        },
      ],
    });

    const result = await adapter.fetch();

    expect(result.error).toBeUndefined();
    expect(result.signals).toHaveLength(2);
    expect(result.signals[0].title).toContain("外部技术/工具/模型");
    expect(result.signals[1].summary).toContain("竞品岗位市场");
    expect(result.evidenceRefs.every((evidence) => evidence.recordId?.startsWith("https://"))).toBe(
      true,
    );
  });

  it("keeps failed external sources visible instead of pretending success", async () => {
    const adapter = createExternalInfoAdapter({
      fetchFn: async () => new Response("blocked", { status: 403 }),
      sources: [
        {
          id: "risk-feed",
          label: "风险来源",
          url: "https://external.example.test/risk",
          kind: "risk_policy",
        },
      ],
    });

    const result = await adapter.fetch();

    expect(result.error).toContain("risk-feed");
    expect(result.signals.some((signal) => signal.id === "external-info-collection-failures")).toBe(
      true,
    );
  });
});
