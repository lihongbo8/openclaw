import type { ObservationAdapter, AdapterFetchResult, SourceConfidence } from "./types.js";

export type ExternalInfoSource = {
  id: string;
  label: string;
  url: string;
  kind: "product_competitor" | "technology_tool_model" | "risk_policy" | "capability_library";
  confidence?: SourceConfidence;
};

export type ExternalInfoAdapterConfig = {
  sources: ExternalInfoSource[];
  fetchFn?: typeof fetch;
};

/**
 * 从外部产品、技术、工具、模型、风险和可吸收能力来源采集事实。
 *
 * 该适配器只读取用户配置的 URL，不做搜索引擎泛爬，也不输出归因结论。
 * 生产部署时可把 sources 指向云端知识库、RSS、公开 changelog、竞品状态页或内部采集网关。
 */
export function createExternalInfoAdapter(config: ExternalInfoAdapterConfig): ObservationAdapter {
  const fetchFn = config.fetchFn ?? fetch;
  const sourceType = "external_info";

  return {
    id: "external-info-observation",
    label: "外部产品技术风险观察",
    sourceType,
    defaultConfidence: "medium",

    async fetch(): Promise<AdapterFetchResult> {
      const collectedAt = Date.now();
      const signals: AdapterFetchResult["signals"] = [];
      const evidenceRefs: AdapterFetchResult["evidenceRefs"] = [];
      const failures: string[] = [];

      for (const source of config.sources) {
        try {
          const res = await fetchFn(source.url, {
            headers: { Accept: "application/json, text/plain, text/html;q=0.9, */*;q=0.1" },
            signal: AbortSignal.timeout(12_000),
          });
          if (!res.ok) {
            failures.push(`${source.id}: HTTP ${res.status}`);
            continue;
          }

          const contentType = res.headers.get("content-type") ?? "";
          const body = await res.text();
          const extracted = extractExternalSummary(body, contentType);
          const evidenceId = `external-info:${source.id}`;
          evidenceRefs.push({
            id: evidenceId,
            sourceId: "external-info-observation",
            sourceType,
            label: `${source.label} (${source.url})`,
            confidence: source.confidence ?? "medium",
            freshness: "fresh",
            collectedAt,
            recordId: source.url,
          });
          signals.push({
            id: `external-${source.kind}:${source.id}`,
            title: `${externalKindLabel(source.kind)}：${source.label}`,
            summary: extracted,
            evidenceRefs: [evidenceId],
          });
        } catch (error) {
          failures.push(`${source.id}: ${error instanceof Error ? error.message : "unknown"}`);
        }
      }

      if (failures.length > 0) {
        const evidenceId = "external-info-failures";
        evidenceRefs.push({
          id: evidenceId,
          sourceId: "external-info-observation",
          sourceType,
          label: `外部来源采集失败 ${failures.length} 个`,
          confidence: "low",
          freshness: signals.length > 0 ? "stale" : "unknown",
          collectedAt,
        });
        signals.push({
          id: "external-info-collection-failures",
          title: "外部信息采集失败",
          summary: failures.join("；"),
          evidenceRefs: [evidenceId],
        });
      }

      return {
        sourceId: "external-info-observation",
        sourceType,
        signals,
        evidenceRefs,
        freshness: signals.length > 0 ? "fresh" : "unknown",
        collectedAt,
        ...(failures.length > 0 ? { error: failures.join("; ") } : {}),
      };
    },
  };
}

function externalKindLabel(kind: ExternalInfoSource["kind"]): string {
  switch (kind) {
    case "product_competitor":
      return "外部产品/竞品";
    case "technology_tool_model":
      return "外部技术/工具/模型";
    case "risk_policy":
      return "外部风险";
    case "capability_library":
      return "可吸收能力库";
  }
}

function extractExternalSummary(body: string, contentType: string): string {
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(body) as unknown;
      return summarizeJson(parsed);
    } catch {
      return compactText(body);
    }
  }

  const title = body.match(/<title[^>]*>(.*?)<\/title>/is)?.[1];
  const description = body.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i,
  )?.[1];
  const h1 = body.match(/<h1[^>]*>(.*?)<\/h1>/is)?.[1];
  const parts = [title, h1, description].filter(Boolean).map((part) => stripTags(part ?? ""));
  if (parts.length > 0) {
    return compactText(parts.join("。"));
  }
  return compactText(stripTags(body));
}

function summarizeJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `外部来源返回 ${value.length} 条记录：${compactText(JSON.stringify(value.slice(0, 3)))}`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const title = firstString(record, ["title", "name", "summary", "status"]);
    const counts = Object.entries(record)
      .filter(([, item]) => typeof item === "number")
      .slice(0, 5)
      .map(([key, item]) => `${key}=${item}`)
      .join("，");
    return compactText(
      [title, counts || JSON.stringify(record).slice(0, 500)].filter(Boolean).join("。"),
    );
  }
  return compactText(String(value ?? ""));
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function stripTags(value: string): string {
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function compactText(value: string): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > 500 ? `${compacted.slice(0, 497)}...` : compacted;
}
