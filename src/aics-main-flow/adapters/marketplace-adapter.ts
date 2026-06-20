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
  /** 自定义路径，便于对接云端版本演进 */
  paths?: Partial<MarketplaceAdapterPaths>;
};

export type MarketplaceAdapterPaths = {
  roles: string;
  myRoles: string;
  ledgerEntries: string;
  auditQueue: string;
  capabilities: string;
  uniqueCapabilityRequests: string;
  businessSummary: string;
  dispatcherRoleReadModel: string;
  apiHealth: string;
};

const DEFAULT_MARKETPLACE_PATHS: MarketplaceAdapterPaths = {
  roles: "/dijie/roles",
  myRoles: "/dijie/my-roles",
  ledgerEntries: "/dijie/ledger/entries",
  auditQueue: "/dijie/audit/queue",
  capabilities: "/dijie/capabilities",
  uniqueCapabilityRequests: "/dijie/unique-capability-requests",
  businessSummary: "/dijie/business-summary",
  dispatcherRoleReadModel: "/dijie/gateway/roles/read-model",
  apiHealth: "/dijie/api-health",
};

function dispatcherRoleEntitlementStatus(role: {
  entitlementStatus?: string;
  entitlement?: { status?: string };
}): string | undefined {
  return role.entitlementStatus ?? role.entitlement?.status;
}

/**
 * 从岗位市场 API 采集内部经营数据的适配器。
 *
 * 采集内容（仅事实，不做归因）：
 * - 岗位商品 / 审核 / 能力 / 授权 / 可调用状态
 * - 业务摘要 / API 健康 / 调度可用岗位
 * - 最近执行和账本摘要
 */
export function createMarketplaceAdapter(config: MarketplaceAdapterConfig): ObservationAdapter {
  const fetchFn = config.fetchFn ?? fetch;
  const sourceType = "marketplace_api";
  const paths = { ...DEFAULT_MARKETPLACE_PATHS, ...config.paths };

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
        // 1. 岗位商品统计：云端公开/受控商品事实
        const rolesRes = await fetchJson(fetchFn, config.baseUrl, paths.roles, headers);
        if (rolesRes.ok) {
          const data = (await rolesRes.json()) as {
            roles?: Array<{
              id: string;
              title: string;
              status: string;
              reviewStatus?: string;
              callable?: boolean;
              category?: string;
            }>;
          };
          const roles = data.roles ?? [];
          const publishedRoles = roles.filter((r) => r.status === "published");
          const reviewBlocked = roles.filter((r) =>
            ["blocked", "rejected", "pending"].includes(r.reviewStatus ?? ""),
          );
          const callableRoles = roles.filter((r) => r.callable === true);
          signals.push({
            id: "published-role-count",
            title: "已发布岗位数量",
            summary: `当前已发布岗位 ${publishedRoles.length} 个（总共 ${roles.length} 个岗位商品）`,
            evidenceRefs: ["marketplace-roles-endpoint"],
          });
          signals.push({
            id: "marketplace-callable-role-count",
            title: "云端可调用岗位数量",
            summary: `云端岗位商城返回 ${callableRoles.length} 个可调用岗位，${reviewBlocked.length} 个岗位存在审核 pending/rejected/blocked 状态`,
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
            const myRolesRes = await fetchJson(fetchFn, config.baseUrl, paths.myRoles, headers);
            if (myRolesRes.ok) {
              const data = (await myRolesRes.json()) as {
                roles?: Array<{
                  role?: { title?: string };
                  title?: string;
                  authorizedAt?: string;
                  status?: string;
                }>;
              };
              const myRoles = data.roles ?? [];
              const active = myRoles.filter((item) =>
                ["authorized", "active", undefined].includes(item.status),
              );
              signals.push({
                id: "authorized-role-count",
                title: "已授权岗位数量",
                summary: `当前账号已授权 ${myRoles.length} 个岗位，其中 ${active.length} 个处于 active/authorized 状态`,
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
            const ledgerRes = await fetchJson(
              fetchFn,
              config.baseUrl,
              paths.ledgerEntries,
              headers,
            );
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

          await collectOptionalReadModel({
            fetchFn,
            baseUrl: config.baseUrl,
            headers,
            path: paths.capabilities,
            evidenceId: "marketplace-capabilities-endpoint",
            evidenceLabel: "GET capabilities 返回的能力目录数据",
            evidenceRefs,
            signals,
            parse: (data: {
              capabilities?: Array<{ id?: string; category?: string; status?: string }>;
            }) => {
              const capabilities = data.capabilities ?? [];
              const approved = capabilities.filter((item) => item.status === "approved");
              return {
                id: "marketplace-capability-count",
                title: "云端能力目录状态",
                summary: `云端能力目录返回 ${capabilities.length} 个能力，其中 ${approved.length} 个已 approved`,
              };
            },
          });

          await collectOptionalReadModel({
            fetchFn,
            baseUrl: config.baseUrl,
            headers,
            path: paths.auditQueue,
            evidenceId: "marketplace-audit-queue-endpoint",
            evidenceLabel: "GET audit queue 返回的审核队列数据",
            evidenceRefs,
            signals,
            parse: (data: { items?: unknown[]; queue?: unknown[]; pending?: unknown[] }) => {
              const items = data.items ?? data.queue ?? data.pending ?? [];
              return {
                id: "marketplace-audit-queue",
                title: "云端审核队列",
                summary: `云端审核队列当前返回 ${items.length} 个待处理项`,
              };
            },
          });

          await collectOptionalReadModel({
            fetchFn,
            baseUrl: config.baseUrl,
            headers,
            path: paths.uniqueCapabilityRequests,
            evidenceId: "marketplace-unique-capability-requests-endpoint",
            evidenceLabel: "GET unique capability requests 返回的独特能力申请数据",
            evidenceRefs,
            signals,
            parse: (data: {
              requests?: Array<{ status?: string }>;
              items?: Array<{ status?: string }>;
            }) => {
              const requests = data.requests ?? data.items ?? [];
              const pending = requests.filter((item) => item.status === "pending");
              return {
                id: "marketplace-unique-capability-requests",
                title: "独特能力申请",
                summary: `云端返回 ${requests.length} 个独特能力申请，其中 ${pending.length} 个 pending`,
              };
            },
          });

          await collectOptionalReadModel({
            fetchFn,
            baseUrl: config.baseUrl,
            headers,
            path: paths.businessSummary,
            evidenceId: "marketplace-business-summary-endpoint",
            evidenceLabel: "GET business summary 返回的经营摘要",
            evidenceRefs,
            signals,
            parse: (data: {
              roleCount?: number;
              authorizedCount?: number;
              blockedCount?: number;
              executionCount?: number;
              failedCount?: number;
            }) => ({
              id: "marketplace-business-summary",
              title: "云端经营概括",
              summary: `经营摘要：岗位 ${data.roleCount ?? 0} 个，授权 ${data.authorizedCount ?? 0} 个，执行 ${data.executionCount ?? 0} 次，失败 ${data.failedCount ?? 0} 次，阻塞 ${data.blockedCount ?? 0} 个`,
            }),
          });

          await collectOptionalReadModel({
            fetchFn,
            baseUrl: config.baseUrl,
            headers,
            path: paths.dispatcherRoleReadModel,
            evidenceId: "marketplace-dispatcher-role-read-model-endpoint",
            evidenceLabel: "GET dispatcher role read model 返回的调度岗位投影",
            evidenceRefs,
            signals,
            parse: (data: {
              roles?: Array<{
                callable?: boolean;
                blockedReason?: string;
                entitlementStatus?: string;
              }>;
              readModel?: {
                roles?: Array<{
                  callable?: boolean;
                  blockedReason?: string;
                  entitlement?: { status?: string };
                }>;
              };
            }) => {
              const roles = data.roles ?? data.readModel?.roles ?? [];
              const callable = roles.filter((item) => item.callable === true);
              const blocked = roles.filter((item) => item.blockedReason);
              const authorized = roles.filter(
                (item) => dispatcherRoleEntitlementStatus(item) === "authorized",
              );
              return {
                id: "marketplace-dispatcher-role-read-model",
                title: "调度可用岗位投影",
                summary: `调度投影返回 ${roles.length} 个岗位，${callable.length} 个可调用，${authorized.length} 个已授权，${blocked.length} 个有 blocked reason`,
              };
            },
          });

          await collectOptionalReadModel({
            fetchFn,
            baseUrl: config.baseUrl,
            headers,
            path: paths.apiHealth,
            evidenceId: "marketplace-api-health-endpoint",
            evidenceLabel: "GET api health 返回的云端 API 健康状态",
            evidenceRefs,
            signals,
            parse: (data: { status?: string; ok?: boolean; blockedReasons?: string[] }) => ({
              id: "marketplace-api-health",
              title: "迭界AI云端 API 健康状态",
              summary: `云端 API 状态 ${data.status ?? (data.ok === false ? "unhealthy" : "healthy")}，blocked reason ${data.blockedReasons?.length ?? 0} 个`,
            }),
          });
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

async function fetchJson(
  fetchFn: typeof fetch,
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
): Promise<Response> {
  return fetchFn(new URL(path, ensureTrailingSlash(baseUrl)).toString(), {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function collectOptionalReadModel<TData>(params: {
  fetchFn: typeof fetch;
  baseUrl: string;
  path: string;
  headers: Record<string, string>;
  evidenceId: string;
  evidenceLabel: string;
  evidenceRefs: AdapterFetchResult["evidenceRefs"];
  signals: AdapterFetchResult["signals"];
  parse(data: TData): { id: string; title: string; summary: string } | null;
}): Promise<void> {
  try {
    const res = await fetchJson(params.fetchFn, params.baseUrl, params.path, params.headers);
    if (!res.ok) return;
    const data = (await res.json()) as TData;
    const signal = params.parse(data);
    const collectedAt = Date.now();
    params.evidenceRefs.push({
      id: params.evidenceId,
      sourceId: "marketplace-business-data",
      sourceType: "marketplace_api",
      label: params.evidenceLabel,
      confidence: "medium",
      freshness: "fresh",
      collectedAt,
    });
    if (signal) {
      params.signals.push({ ...signal, evidenceRefs: [params.evidenceId] });
    }
  } catch {
    // 可选 read model 不阻断主观察包。缺口会由 API health / 总体采集失败呈现。
  }
}
