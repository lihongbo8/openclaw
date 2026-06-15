import type { ObservationAdapter, AdapterFetchResult } from "./types.js";

/**
 * Gateway 岗位视图适配器配置
 */
export type GatewayAdapterConfig = {
  /** Marketplace API base URL */
  baseUrl: string;
  /** 访问令牌（需要本地主系统数据权限） */
  accessToken?: string;
  /** fetch 实现 */
  fetchFn?: typeof fetch;
};

/**
 * 从 Gateway 安全读模型采集可调度岗位视图的适配器。
 *
 * 根据系统合同，该视图只返回已发布岗位的可调用摘要、授权状态、
 * 计费快照、使用摘要占位和审核信号。不返回岗位包正文、工具实现、
 * 密钥、本地路径、订单钱包原始事实或 raw metadata。
 */
export function createGatewayAdapter(config: GatewayAdapterConfig): ObservationAdapter {
  const fetchFn = config.fetchFn ?? fetch;
  const sourceType = "dijie_gateway_read_model";

  return {
    id: "gateway-role-read-model",
    label: "Gateway 可调度岗位视图",
    sourceType,
    defaultConfidence: "high",

    async fetch(): Promise<AdapterFetchResult> {
      const collectedAt = Date.now();
      const signals: AdapterFetchResult["signals"] = [];
      const evidenceRefs: AdapterFetchResult["evidenceRefs"] = [];

      if (!config.accessToken) {
        return {
          sourceId: "gateway-role-read-model",
          sourceType,
          signals: [],
          evidenceRefs: [],
          freshness: "unknown",
          collectedAt,
          error: "需要本地主系统数据权限的 access token",
        };
      }

      try {
        const res = await fetchFn(`${config.baseUrl}/dijie/gateway/roles/read-model`, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.accessToken}`,
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          return {
            sourceId: "gateway-role-read-model",
            sourceType,
            signals: [],
            evidenceRefs: [],
            freshness: "unknown",
            collectedAt,
            error: `Gateway read-model returned HTTP ${res.status}`,
          };
        }

        const data = (await res.json()) as {
          roles?: Array<{
            roleListingId: string;
            title: string;
            entitlementStatus?: string;
            pricing?: { authorizationFeeCents?: number };
            callable?: boolean;
          }>;
        };
        const roles = data.roles ?? [];
        const callableRoles = roles.filter((r) => r.callable !== false);
        const authorizedRoles = roles.filter((r) => r.entitlementStatus === "authorized");

        signals.push({
          id: "gateway-callable-roles",
          title: "可调度岗位数量",
          summary: `Gateway 视图显示 ${callableRoles.length} 个可调用岗位（总共 ${roles.length} 个已发布岗位）`,
          evidenceRefs: ["gateway-read-model-endpoint"],
        });

        if (authorizedRoles.length > 0) {
          signals.push({
            id: "gateway-authorized-roles",
            title: "已授权可调度岗位",
            summary: `${authorizedRoles.length} 个岗位已有有效授权：${authorizedRoles.map((r) => r.title).join("、")}`,
            evidenceRefs: ["gateway-read-model-endpoint"],
          });
        }

        evidenceRefs.push({
          id: "gateway-read-model-endpoint",
          sourceId: "gateway-role-read-model",
          sourceType,
          label: `GET /dijie/gateway/roles/read-model 返回 ${roles.length} 个岗位`,
          confidence: "high",
          freshness: "fresh",
          collectedAt,
        });
      } catch (err) {
        return {
          sourceId: "gateway-role-read-model",
          sourceType,
          signals: [],
          evidenceRefs: [],
          freshness: "unknown",
          collectedAt,
          error: err instanceof Error ? err.message : "Gateway unreachable",
        };
      }

      return {
        sourceId: "gateway-role-read-model",
        sourceType,
        signals,
        evidenceRefs,
        freshness: "fresh",
        collectedAt,
      };
    },
  };
}
