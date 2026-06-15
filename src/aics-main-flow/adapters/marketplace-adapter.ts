import type { ObservationAdapter, AdapterFetchResult } from "./types.js";

/**
 * Marketplace API 适配器配置
 */
export type MarketplaceAdapterConfig = {
  /** Marketplace API base URL */
  baseUrl: string;
  /** 访问令牌 */
  accessToken?: string;
  /** fetch 实现（依赖注入，便于测试） */
  fetchFn?: typeof fetch;
};

/**
 * 从岗位市场 API 采集内部经营数据的适配器。
 *
 * 采集内容（仅事实，不做归因）：
 * - 已发布岗位总数
 * - 授权总数
 * - 最近执行统计（成功/失败/阻塞）
 * - 费用摘要
 */
export function createMarketplaceAdapter(config: MarketplaceAdapterConfig): ObservationAdapter {
  const fetchFn = config.fetchFn ?? fetch;
  const sourceType = "marketplace_api";

  return {
    id: "marketplace-business-data",
    label: "岗位市场经营数据",
    sourceType,
    defaultConfidence: "medium",

    async fetch(): Promise<AdapterFetchResult> {
      const evidenceRefs: AdapterFetchResult["evidenceRefs"] = [];
      const signals: AdapterFetchResult["signals"] = [];
      const collectedAt = Date.now();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (config.accessToken) {
        headers["Authorization"] = `Bearer ${config.accessToken}`;
      }

      try {
        // 1. 已发布岗位统计
        const rolesRes = await fetchFn(`${config.baseUrl}/dijie/roles`, {
          headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (rolesRes.ok) {
          const data = (await rolesRes.json()) as {
            roles?: Array<{ id: string; title: string; status: string }>;
          };
          const roles = data.roles ?? [];
          const publishedRoles = roles.filter((r) => r.status === "published");
          signals.push({
            id: "published-role-count",
            title: "已发布岗位数量",
            summary: `当前已发布岗位 ${publishedRoles.length} 个（总共 ${roles.length} 个岗位商品）`,
            evidenceRefs: ["marketplace-roles-endpoint"],
          });
          evidenceRefs.push({
            id: "marketplace-roles-endpoint",
            sourceId: "marketplace-business-data",
            sourceType,
            label: "GET /dijie/roles 返回的已发布岗位数据",
            confidence: "medium",
            freshness: "fresh",
            collectedAt,
          });
        }

        // 2. 尝试读取授权和执行统计（需要更高权限，优雅降级）
        if (config.accessToken) {
          try {
            const myRolesRes = await fetchFn(`${config.baseUrl}/dijie/my-roles`, {
              headers,
              signal: AbortSignal.timeout(10_000),
            });
            if (myRolesRes.ok) {
              const data = (await myRolesRes.json()) as {
                roles?: Array<{ role: { title: string }; authorizedAt?: string }>;
              };
              const myRoles = data.roles ?? [];
              signals.push({
                id: "authorized-role-count",
                title: "已授权岗位数量",
                summary: `当前账号已授权 ${myRoles.length} 个岗位`,
                evidenceRefs: ["marketplace-my-roles-endpoint"],
              });
              evidenceRefs.push({
                id: "marketplace-my-roles-endpoint",
                sourceId: "marketplace-business-data",
                sourceType,
                label: "GET /dijie/my-roles 返回的授权数据",
                confidence: "medium",
                freshness: "fresh",
                collectedAt,
              });
            }
          } catch {
            // 授权接口可能不可用，这不是适配器失败
          }

          try {
            const ledgerRes = await fetchFn(`${config.baseUrl}/dijie/ledger/entries`, {
              headers,
              signal: AbortSignal.timeout(10_000),
            });
            if (ledgerRes.ok) {
              const data = (await ledgerRes.json()) as {
                entries?: Array<{
                  usage_kind: string;
                  gross_amount_cents: number;
                  created_at: string;
                }>;
              };
              const entries = data.entries ?? [];
              const execEntries = entries.filter(
                (e) => e.usage_kind === "execution" || e.usage_kind === "role_execution",
              );
              signals.push({
                id: "recent-execution-stats",
                title: "近期执行统计",
                summary: `最近共 ${entries.length} 条费用记录，其中 ${execEntries.length} 条为岗位执行`,
                evidenceRefs: ["marketplace-ledger-endpoint"],
              });
              evidenceRefs.push({
                id: "marketplace-ledger-endpoint",
                sourceId: "marketplace-business-data",
                sourceType,
                label: "GET /dijie/ledger/entries 返回的费用数据",
                confidence: "medium",
                freshness: "fresh",
                collectedAt,
              });
            }
          } catch {
            // 账本接口可能不可用
          }
        }
      } catch (err) {
        return {
          sourceId: "marketplace-business-data",
          sourceType,
          signals: [],
          evidenceRefs: [],
          freshness: "unknown",
          collectedAt,
          error: err instanceof Error ? err.message : "Marketplace API unreachable",
        };
      }

      return {
        sourceId: "marketplace-business-data",
        sourceType,
        signals,
        evidenceRefs,
        freshness: "fresh",
        collectedAt,
      };
    },
  };
}
