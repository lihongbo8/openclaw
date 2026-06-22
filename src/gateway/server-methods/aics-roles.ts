import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { repairRoleInstancesDb } from "../../aics-main-flow/db.js";
import {
  createZeroPriceLocalRoleEntitlement,
  getLocalRoleListing,
  listLocalMarketplaceRoles,
} from "../../aics-main-flow/local-role-marketplace.js";
import { buildMyRolesReadModel } from "../../aics-main-flow/my-roles-read-model.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveAicsCloudConnectionFromApiConnections } from "./aics-api-connections.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function respondError(respond: RespondFn, error: unknown): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)),
  );
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pluginAicsConfig(config: OpenClawConfig): Record<string, unknown> {
  const value = config.plugins?.entries?.aics?.config;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pluginAicsString(config: OpenClawConfig, key: string): string | undefined {
  return stringParam(pluginAicsConfig(config), key);
}

async function resolveDijieCloud(params: {
  config: OpenClawConfig;
  request: Record<string, unknown>;
}): Promise<{
  cloudBaseUrl?: string;
  cloudAccessToken?: string;
  deviceId?: string;
  workspaceRef?: string;
}> {
  const apiConnection = await resolveAicsCloudConnectionFromApiConnections(params.config);
  const cloudBaseUrl =
    stringParam(params.request, "cloud_base_url") ??
    stringParam(params.request, "cloudBaseUrl") ??
    apiConnection.cloudBaseUrl ??
    pluginAicsString(params.config, "cloudBaseUrl");
  const cloudAccessToken =
    stringParam(params.request, "cloud_access_token") ??
    stringParam(params.request, "cloudAccessToken") ??
    apiConnection.cloudAccessToken ??
    pluginAicsString(params.config, "cloudAccessToken");
  return {
    cloudBaseUrl,
    cloudAccessToken,
    deviceId:
      stringParam(params.request, "device_id") ??
      stringParam(params.request, "deviceId") ??
      pluginAicsString(params.config, "defaultDeviceId"),
    workspaceRef:
      stringParam(params.request, "workspace_ref") ??
      stringParam(params.request, "workspaceRef") ??
      pluginAicsString(params.config, "defaultWorkspaceRef"),
  };
}

async function fetchDijieJson(params: {
  cloudBaseUrl: string;
  cloudAccessToken: string;
  path: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  query?: Record<string, string | undefined>;
}): Promise<{ status: number; payload: Record<string, unknown> }> {
  const url = new URL(params.path, params.cloudBaseUrl);
  for (const [key, value] of Object.entries(params.query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: params.method ?? "GET",
    headers: {
      authorization: `Bearer ${params.cloudAccessToken}`,
      "content-type": "application/json",
    },
    ...(params.body ? { body: JSON.stringify(params.body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const parsed = (await response.json().catch(() => ({}))) as unknown;
  const payload =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  if (!response.ok || payload.ok === false) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : `迭界AI云端请求失败（${response.status}）。`;
    return {
      status: response.status,
      payload: { ok: false, error: message },
    };
  }
  return { status: response.status, payload };
}

function missingCloudConfigPayload() {
  return {
    ok: false,
    error: "请先在 API 管理填写并同步迭界AI云端连接。",
    roles: [],
  };
}

function localAccountId(request: Record<string, unknown>): string {
  return (
    stringParam(request, "account_id") ??
    stringParam(request, "accountId") ??
    stringParam(request, "workspace_ref") ??
    stringParam(request, "workspaceRef") ??
    "local-admin"
  );
}

function includeUnauthorizedRoles(request: Record<string, unknown>): boolean {
  return request.includeUnauthorized === true || request.include_unauthorized === true;
}

function localRolesSummary(roles: Array<{ entitlementId?: string }>) {
  const authorized = roles.filter((role) => Boolean(role.entitlementId)).length;
  return {
    total: roles.length,
    authorized,
    unauthorized: roles.length - authorized,
  };
}

export const aicsRolesHandlers: GatewayRequestHandlers = {
  "dijie.marketplace.roles.list": async ({ params, context, respond }) => {
    try {
      const request =
        params && typeof params === "object" && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {};
      const cloud = await resolveDijieCloud({
        config: context.getRuntimeConfig(),
        request,
      });
      if (!cloud.cloudBaseUrl || !cloud.cloudAccessToken) {
        const roles = listLocalMarketplaceRoles({
          accountId: localAccountId(request),
          includeUnauthorized: includeUnauthorizedRoles(request),
        });
        const localSummary = localRolesSummary(roles);
        respond(true, {
          ok: true,
          mode: "local",
          roles,
          localSummary,
          summary: localSummary.authorized
            ? "已读取本地正式授权岗位。"
            : includeUnauthorizedRoles(request) && localSummary.unauthorized
              ? "本地存在已上架但未授权的岗位商品。"
              : "本地暂无已授权岗位。",
        });
        return;
      }
      const result = await fetchDijieJson({
        cloudBaseUrl: cloud.cloudBaseUrl,
        cloudAccessToken: cloud.cloudAccessToken,
        path: "/dijie/my-roles",
        query: {
          deviceId: cloud.deviceId,
          workspaceRef: cloud.workspaceRef,
        },
      });
      const localRoles = listLocalMarketplaceRoles({
        accountId: localAccountId(request),
        includeUnauthorized: includeUnauthorizedRoles(request),
      });
      const localSummary = localRolesSummary(localRoles);
      respond(true, {
        ...result.payload,
        httpStatus: result.status,
        localSummary,
        roles: [
          ...localRoles,
          ...(Array.isArray(result.payload.roles) ? result.payload.roles : []),
        ],
      });
    } catch (error) {
      respond(true, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        roles: [],
      });
    }
  },

  "dijie.roleAuthorization.create": async ({ params, context, respond }) => {
    try {
      const request =
        params && typeof params === "object" && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {};
      const roleListingId =
        stringParam(request, "role_listing_id") ?? stringParam(request, "roleListingId");
      if (!roleListingId) {
        respond(true, { ok: false, error: "缺少 roleListingId。" });
        return;
      }
      const localListing = getLocalRoleListing(roleListingId);
      if (localListing) {
        if (localListing.authorizationFeeCents !== 0) {
          respond(true, {
            ok: false,
            mode: "local",
            status: "blocked",
            roleListingId,
            authorizationFeeCents: localListing.authorizationFeeCents,
            blockedReasons: ["该岗位不是 0 元授权岗位，不能走本地 0 元授权。"],
            error: "该岗位不是 0 元授权岗位，不能走本地 0 元授权。",
            nextAction: "请走正式付费/checkout 授权链路，或联系审核中心调整岗位价格。",
          });
          return;
        }
        const entitlement = createZeroPriceLocalRoleEntitlement({
          roleListingId,
          accountId: localAccountId(request),
        });
        respond(true, {
          ok: true,
          mode: "local",
          roleListingId,
          entitlementId: entitlement.entitlementId,
          entitlement,
        });
        return;
      }
      const cloud = await resolveDijieCloud({
        config: context.getRuntimeConfig(),
        request,
      });
      if (!cloud.cloudBaseUrl || !cloud.cloudAccessToken) {
        respond(true, {
          ...missingCloudConfigPayload(),
          error: "本地没有找到该岗位商品；如需云端授权，请先在 API 管理填写并同步迭界AI云端连接。",
        });
        return;
      }
      const result = await fetchDijieJson({
        cloudBaseUrl: cloud.cloudBaseUrl,
        cloudAccessToken: cloud.cloudAccessToken,
        path: "/dijie/authorizations",
        method: "POST",
        body: { roleListingId },
      });
      respond(true, {
        ...result.payload,
        httpStatus: result.status,
      });
    } catch (error) {
      respond(true, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  "aics.roles.mine.readModel.get": ({ params, respond }) => {
    try {
      const includeArchived = params.includeArchived === true;
      const includeUnauthorized = includeUnauthorizedRoles(
        params && typeof params === "object" && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {},
      );
      const includeRecentRuns = params.includeRecentRuns !== false;
      const includeArtifacts = params.includeArtifacts !== false;
      const maxRecentRuns = typeof params.maxRecentRuns === "number" ? params.maxRecentRuns : 20;
      const maxRecentArtifacts =
        typeof params.maxRecentArtifacts === "number" ? params.maxRecentArtifacts : 12;

      const readModel = buildMyRolesReadModel({
        marketplaceRoles: listLocalMarketplaceRoles({
          accountId: "local-admin",
          includeUnauthorized,
        }),
        includeArchived,
        includeRecentRuns,
        includeArtifacts,
        maxRecentRuns,
        maxRecentArtifacts,
      });

      respond(true, readModel);
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.roles.instanceStore.repair": ({ respond }) => {
    try {
      const repair = repairRoleInstancesDb();
      const readModel = buildMyRolesReadModel({
        marketplaceRoles: listLocalMarketplaceRoles({
          accountId: "local-admin",
          includeUnauthorized: false,
        }),
      });
      respond(true, {
        ...repair,
        readModel,
        message: repair.backupPaths.length
          ? "已备份不可读的运行历史库，并新建干净的运行历史库。"
          : "运行历史库已重新初始化。",
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
};
