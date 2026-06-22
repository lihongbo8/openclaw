import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { canExecRequestNode } from "../../agents/exec-defaults.js";
import {
  approveCategoryCapabilityReview,
  approveRolePreListingReview,
  approveToolSkillReview,
  bindRolePreListingReviewCategory,
  createCategoryCapabilityRequest,
  createRoleCapabilityAnalysis,
  getCategoryCapabilityReview,
  getCategoryCapabilityReviewEvents,
  getRolePreListingReview,
  getRolePreListingReviewEvents,
  getToolSkillReview,
  getToolSkillReviewEvents,
  listCategoryCapabilityReviewPage,
  listRolePreListingReviewPage,
  listToolSkillReviews,
  rejectCategoryCapabilityReview,
  rejectRolePreListingReview,
  rejectToolSkillReview,
  requestCategoryCapabilityChanges,
  requestRolePreListingChanges,
  requestToolSkillChanges,
  runRolePreListingValidation,
  runToolSkillValidation,
  syncCategoryCapabilityReviewToCloud,
} from "../../aics-main-flow/role-pre-listing-review.js";
import type { CategoryCapabilityRoleMaterials } from "../../aics-main-flow/role-pre-listing-review.js";
import { createApiConnectionsReadModel } from "../../api-connections/model.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { buildWorkspaceSkillStatus } from "../../skills/discovery/status.js";
import { getRemoteSkillEligibility } from "../../skills/runtime/remote.js";
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

function requireString(params: Record<string, unknown>, key: string): string {
  const value = stringParam(params, key);
  if (!value) throw new Error(`missing required string param: ${key}`);
  return value;
}

function stringArrayParam(params: Record<string, unknown>, key: string): string[] {
  const value = params[key];
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim())
    : [];
}

function numberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function reviewListParams(params: Record<string, unknown>) {
  return {
    page: numberParam(params, "page"),
    pageSize: numberParam(params, "pageSize"),
    filter: stringParam(params, "filter"),
    search: stringParam(params, "search"),
    sort: stringParam(params, "sort"),
  };
}

function recordParam(
  params: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = params[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function roleMaterialsParam(
  params: Record<string, unknown>,
): CategoryCapabilityRoleMaterials | undefined {
  const raw = recordParam(params, "roleMaterials");
  if (!raw) return undefined;
  return {
    roleTitle: stringParam(raw, "roleTitle"),
    roleDescription: stringParam(raw, "roleDescription"),
    targetUser: stringParam(raw, "targetUser"),
    targetCategory: stringParam(raw, "targetCategory"),
    requiredCapabilities: stringArrayParam(raw, "requiredCapabilities"),
    sopFlow: stringParam(raw, "sopFlow"),
    dailyPlan: stringParam(raw, "dailyPlan"),
    weeklyPlan: stringParam(raw, "weeklyPlan"),
    monthlyPlan: stringParam(raw, "monthlyPlan"),
    inputOutput: stringParam(raw, "inputOutput"),
    riskBoundaries: stringArrayParam(raw, "riskBoundaries"),
  };
}

export type AicsSupportContact = {
  displayName: string;
  wechatId: string;
  audience: "developer" | "user" | "system_developer" | "all";
  purpose: string;
  serviceHours?: string;
  note?: string;
};

function defaultLocalSupportContact(): AicsSupportContact {
  return {
    displayName: "系统开发者",
    wechatId: "待配置",
    audience: "all",
    purpose: "岗位开发、品类能力、审核、授权或执行卡住时联系。",
    note: "请在 AICS 插件配置的 supportContact 中填写真实加群信息或微信号。",
  };
}

function supportContactFromConfig(config: OpenClawConfig): AicsSupportContact {
  const plugins = config.plugins as
    | {
        entries?: {
          aics?: {
            config?: {
              supportContact?: unknown;
            };
          };
        };
      }
    | undefined;
  const raw = plugins?.entries?.aics?.config?.supportContact;
  if (!raw || typeof raw !== "object") return defaultLocalSupportContact();
  const value = raw as Record<string, unknown>;
  const wechatId = typeof value.wechatId === "string" ? value.wechatId.trim() : "";
  if (!wechatId) return defaultLocalSupportContact();
  const audience =
    value.audience === "developer" ||
    value.audience === "user" ||
    value.audience === "system_developer" ||
    value.audience === "all"
      ? value.audience
      : "all";
  const optionalString = (key: string) =>
    typeof value[key] === "string" && value[key].trim() ? value[key].trim() : undefined;
  return {
    displayName: optionalString("displayName") ?? "系统开发者",
    wechatId,
    audience,
    purpose: optionalString("purpose") ?? "岗位开发、审核、授权或执行卡住时联系。",
    serviceHours: optionalString("serviceHours"),
    note: optionalString("note"),
  };
}

function buildToolSkillValidationEvidence(config: OpenClawConfig) {
  const agentId = resolveDefaultAgentId(config);
  const workspaceDir = resolveAgentWorkspaceDir(config, agentId);
  return {
    apiConnections: createApiConnectionsReadModel(config),
    skillsReport: buildWorkspaceSkillStatus(workspaceDir, {
      config,
      agentId,
      eligibility: {
        remote: getRemoteSkillEligibility({
          advertiseExecNode: canExecRequestNode({ cfg: config, agentId }),
        }),
      },
    }),
  };
}

export async function aicsCloudConfig(config: OpenClawConfig): Promise<{
  cloudBaseUrl?: string;
  cloudAccessToken?: string;
}> {
  const apiConnectionConfig = await resolveAicsCloudConnectionFromApiConnections(config);
  const plugins = config.plugins as
    | {
        entries?: {
          aics?: {
            config?: {
              cloudBaseUrl?: unknown;
              cloudAccessToken?: unknown;
            };
          };
        };
      }
    | undefined;
  const aics = plugins?.entries?.aics?.config;
  return {
    cloudBaseUrl:
      apiConnectionConfig.cloudBaseUrl ??
      (typeof aics?.cloudBaseUrl === "string" ? aics.cloudBaseUrl : undefined),
    cloudAccessToken:
      apiConnectionConfig.cloudAccessToken ??
      (typeof aics?.cloudAccessToken === "string" ? aics.cloudAccessToken : undefined),
  };
}

export const aicsRolePreListingReviewHandlers: GatewayRequestHandlers = {
  "aics.supportContact.get": ({ context, respond }) => {
    try {
      respond(true, { supportContact: supportContactFromConfig(context.getRuntimeConfig()) });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.roleCapabilityAnalysis.create": ({ params, respond }) => {
    try {
      respond(true, {
        analysis: createRoleCapabilityAnalysis({
          rolePackageId: stringParam(params, "rolePackageId"),
          listingDraftId: stringParam(params, "listingDraftId") ?? null,
          developerId: stringParam(params, "developerId"),
          roleTitle: requireString(params, "roleTitle"),
          roleDescription: stringParam(params, "roleDescription"),
          targetUser: stringParam(params, "targetUser"),
          requiredCapabilities: stringArrayParam(params, "requiredCapabilities"),
          sopFlow: stringParam(params, "sopFlow"),
          dailyPlan: stringParam(params, "dailyPlan"),
          weeklyPlan: stringParam(params, "weeklyPlan"),
          monthlyPlan: stringParam(params, "monthlyPlan"),
          inputOutput: stringParam(params, "inputOutput"),
          riskBoundaries: stringArrayParam(params, "riskBoundaries"),
        }),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.categoryCapabilityRequest.create": ({ params, respond }) => {
    try {
      respond(true, {
        review: createCategoryCapabilityRequest({
          requestId: stringParam(params, "requestId"),
          rolePackageId: stringParam(params, "rolePackageId"),
          listingDraftId: stringParam(params, "listingDraftId") ?? null,
          developerId: stringParam(params, "developerId"),
          title: requireString(params, "title"),
          categoryName: stringParam(params, "categoryName") ?? stringParam(params, "category"),
          categoryRef: stringParam(params, "categoryRef") ?? stringParam(params, "capabilityRef"),
          roleDescription: stringParam(params, "roleDescription"),
          targetUser: stringParam(params, "targetUser"),
          roleMaterials: roleMaterialsParam(params),
          requiredCapabilities: stringArrayParam(params, "requiredCapabilities"),
          inputOutput: stringParam(params, "inputOutput"),
          toolSkillRequirements: stringArrayParam(params, "toolSkillRequirements"),
          riskBoundaries: stringArrayParam(params, "riskBoundaries"),
          reason: stringParam(params, "reason"),
        }),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.categoryCapabilityReview.list": ({ params, respond }) => {
    try {
      respond(true, listCategoryCapabilityReviewPage(reviewListParams(params) as never));
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.categoryCapabilityReview.get": ({ params, respond }) => {
    try {
      const reviewId = requireString(params, "reviewId");
      const review = getCategoryCapabilityReview(reviewId);
      if (!review) throw new Error(`CategoryCapabilityReview not found: ${reviewId}`);
      respond(true, { review });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.categoryCapabilityReview.events": ({ params, respond }) => {
    try {
      respond(true, {
        events: getCategoryCapabilityReviewEvents(requireString(params, "reviewId")),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.categoryCapabilityReview.approve": ({ params, respond }) => {
    try {
      respond(true, {
        review: approveCategoryCapabilityReview(
          requireString(params, "reviewId"),
          stringParam(params, "decision"),
        ),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.categoryCapabilityReview.reject": ({ params, respond }) => {
    try {
      respond(true, {
        review: rejectCategoryCapabilityReview(
          requireString(params, "reviewId"),
          stringParam(params, "decision"),
        ),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.categoryCapabilityReview.requestChanges": ({ params, respond }) => {
    try {
      respond(true, {
        review: requestCategoryCapabilityChanges(
          requireString(params, "reviewId"),
          stringParam(params, "decision"),
        ),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.categoryCapabilityReview.syncToCloud": async ({ params, context, respond }) => {
    try {
      const cloud = await aicsCloudConfig(context.getRuntimeConfig());
      const result = await syncCategoryCapabilityReviewToCloud(
        requireString(params, "reviewId"),
        cloud,
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.categoryCapabilityReview.activateLocal": async ({ params, context, respond }) => {
    try {
      const cloud = await aicsCloudConfig(context.getRuntimeConfig());
      const result = await syncCategoryCapabilityReviewToCloud(
        requireString(params, "reviewId"),
        cloud,
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.rolePreListingReview.list": ({ params, respond }) => {
    try {
      respond(true, listRolePreListingReviewPage(reviewListParams(params) as never));
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.rolePreListingReview.get": ({ params, respond }) => {
    try {
      const reviewId = requireString(params, "reviewId");
      const review = getRolePreListingReview(reviewId);
      if (!review) throw new Error(`RolePreListingReview not found: ${reviewId}`);
      respond(true, { review });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.rolePreListingReview.events": ({ params, respond }) => {
    try {
      respond(true, { events: getRolePreListingReviewEvents(requireString(params, "reviewId")) });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.rolePreListingReview.runValidation": ({ params, respond }) => {
    try {
      respond(true, { review: runRolePreListingValidation(requireString(params, "reviewId")) });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.rolePreListingReview.bindCategory": ({ params, respond }) => {
    try {
      respond(
        true,
        bindRolePreListingReviewCategory(
          requireString(params, "reviewId"),
          requireString(params, "categoryCapabilityReviewId"),
        ),
      );
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.rolePreListingReview.requestChanges": ({ params, respond }) => {
    try {
      respond(true, {
        review: requestRolePreListingChanges(
          requireString(params, "reviewId"),
          stringParam(params, "decision"),
        ),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.rolePreListingReview.reject": ({ params, respond }) => {
    try {
      respond(true, {
        review: rejectRolePreListingReview(
          requireString(params, "reviewId"),
          stringParam(params, "decision"),
        ),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.rolePreListingReview.approve": ({ params, respond }) => {
    try {
      respond(true, {
        review: approveRolePreListingReview(
          requireString(params, "reviewId"),
          stringParam(params, "decision"),
        ),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.toolSkillReview.list": ({ respond }) => {
    try {
      respond(true, { reviews: listToolSkillReviews() });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.toolSkillReview.get": ({ params, respond }) => {
    try {
      const reviewId = requireString(params, "reviewId");
      const review = getToolSkillReview(reviewId);
      if (!review) throw new Error(`ToolSkillReview not found: ${reviewId}`);
      respond(true, { review });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.toolSkillReview.events": ({ params, respond }) => {
    try {
      respond(true, { events: getToolSkillReviewEvents(requireString(params, "reviewId")) });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.toolSkillReview.runValidation": ({ params, context, respond }) => {
    try {
      respond(true, {
        review: runToolSkillValidation(
          requireString(params, "reviewId"),
          buildToolSkillValidationEvidence(context.getRuntimeConfig()),
        ),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.toolSkillReview.requestChanges": ({ params, respond }) => {
    try {
      respond(true, {
        review: requestToolSkillChanges(
          requireString(params, "reviewId"),
          stringParam(params, "decision"),
        ),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.toolSkillReview.reject": ({ params, respond }) => {
    try {
      respond(true, {
        review: rejectToolSkillReview(
          requireString(params, "reviewId"),
          stringParam(params, "decision"),
        ),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.toolSkillReview.approve": ({ params, respond }) => {
    try {
      respond(true, {
        review: approveToolSkillReview(
          requireString(params, "reviewId"),
          stringParam(params, "decision"),
        ),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
};
