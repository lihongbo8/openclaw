import type { AicsMainFlowReadModel } from "./types.js";

export type AicsActorContext = {
  actor_identity: "developer" | "user" | "platform_operator" | "system_job";
  caller_context:
    | "main_flow_api"
    | "dispatcher"
    | "platform_console"
    | "developer_center"
    | "user_center"
    | "role_gateway";
  actor_ref: string;
  workspace_ref: string;
  requested_scope: string;
  purpose: string;
  audit_ref: string;
  source_surface: string;
};

export type CloudMarketplaceBlockedReason =
  | "missing_actor_context"
  | "actor_scope_mismatch"
  | "missing_category_capability"
  | "unique_capability_pending"
  | "dispatcher_role_not_authorized"
  | "api_boundary_required";

export type CloudMarketplaceProjection = {
  version: 1;
  updatedAt: number;
  authority: "cloud_marketplace";
  apiHealth: {
    status: "connected" | "blocked";
    gateway: "openclaw";
    actorContextRequired: true;
    blockedReasons: CloudMarketplaceBlockedReason[];
  };
  audit: {
    pending: Array<{ id: string; kind: string; title: string; status: string; risk: string }>;
    approved: number;
    rejected: number;
  };
  capabilities: {
    categoryCommon: AicsMainFlowReadModel["capabilities"]["categoryCommon"];
    uniqueRequests: AicsMainFlowReadModel["capabilities"]["uniqueRequests"];
    approved: Array<{
      id: string;
      category: string;
      label: string;
      tools: string[];
      skills: string[];
    }>;
    blockedReasons: CloudMarketplaceBlockedReason[];
  };
  marketplace: {
    listings: Array<{
      id: string;
      title: string;
      category: string;
      status: string;
      authorization: string;
    }>;
    categories: Array<{ id: string; label: string; listingCount: number }>;
  };
  businessSummary: {
    listings: number;
    authorizations: number;
    executions: number;
    blocked: number;
    ledgerSummary: string;
  };
  dispatcherRoleReadModel: {
    callableRoles: Array<{
      roleListingId: string;
      title: string;
      category: string;
      authorized: boolean;
    }>;
    blockedRoles: Array<{
      roleListingId: string;
      title: string;
      reason: CloudMarketplaceBlockedReason;
    }>;
  };
};

export function defaultActorContext(): AicsActorContext {
  return {
    actor_identity: "platform_operator",
    caller_context: "platform_console",
    actor_ref: "local-openclaw-operator",
    workspace_ref: "local-openclaw",
    requested_scope: "admin_console.read",
    purpose: "local_admin_console_projection",
    audit_ref: `audit:${Date.now()}`,
    source_surface: "openclaw_local_admin_console",
  };
}

export function validateActorContext(value: unknown): CloudMarketplaceBlockedReason | null {
  if (!value || typeof value !== "object") {
    return "missing_actor_context";
  }
  const ctx = value as Partial<Record<keyof AicsActorContext, unknown>>;
  for (const key of [
    "actor_identity",
    "caller_context",
    "actor_ref",
    "workspace_ref",
    "requested_scope",
    "purpose",
    "audit_ref",
    "source_surface",
  ] as const) {
    if (typeof ctx[key] !== "string" || !ctx[key]?.trim()) {
      return "missing_actor_context";
    }
  }
  if (
    ctx.caller_context === "dispatcher" &&
    typeof ctx.requested_scope === "string" &&
    ctx.requested_scope.includes("platform_operator")
  ) {
    return "actor_scope_mismatch";
  }
  return null;
}

export function createCloudMarketplaceProjection(
  mainFlow: AicsMainFlowReadModel,
): CloudMarketplaceProjection {
  const matches = mainFlow.capabilities.matches;
  const categoryCommon = mainFlow.capabilities.categoryCommon;
  const uniqueRequests = mainFlow.capabilities.uniqueRequests;
  const approved = categoryCommon
    .filter((capability) => capability.approvalStatus === "approved")
    .map((capability) => ({
      id: capability.id,
      category: capability.category,
      label: capability.label,
      tools: capability.tools.map((tool) => tool.id),
      skills: capability.skills.map((skill) => skill.id),
    }));
  const blockedMatches = matches.filter((match) => match.status !== "satisfied");
  const categories = new Map<string, number>();
  for (const item of mainFlow.objects.rolePlanItems) {
    const category = item.category || "未绑定品类";
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  const listings = mainFlow.objects.rolePlanItems.map((item) => {
    const match = matches.find((candidate) => candidate.rolePlanItemId === item.id);
    return {
      id: item.roleCapabilityRef || item.id,
      title: item.title,
      category: item.category || match?.category || "未绑定品类",
      status: match?.status === "satisfied" ? "callable" : "blocked",
      authorization: match?.status === "satisfied" ? "approved" : "needs_capability",
    };
  });

  return {
    version: 1,
    updatedAt: Date.now(),
    authority: "cloud_marketplace",
    apiHealth: {
      status: "blocked",
      gateway: "openclaw",
      actorContextRequired: true,
      blockedReasons: ["missing_actor_context", "api_boundary_required"],
    },
    audit: {
      pending: [
        ...uniqueRequests.map((request) => ({
          id: request.id,
          kind: "unique_capability",
          title: request.missingCapability,
          status: request.status,
          risk: request.riskLevel,
        })),
        ...blockedMatches.map((match) => ({
          id: `audit:${match.rolePlanItemId}`,
          kind: "capability_match",
          title: match.summary,
          status: match.status,
          risk: "medium",
        })),
      ],
      approved: approved.length,
      rejected: uniqueRequests.filter((request) => request.status === "rejected").length,
    },
    capabilities: {
      categoryCommon,
      uniqueRequests,
      approved,
      blockedReasons: blockedMatches.length ? ["missing_category_capability"] : [],
    },
    marketplace: {
      listings,
      categories: [...categories.entries()].map(([id, listingCount]) => ({
        id,
        label: id,
        listingCount,
      })),
    },
    businessSummary: {
      listings: listings.length,
      authorizations: approved.length,
      executions: mainFlow.counts.roleResults,
      blocked:
        blockedMatches.length +
        uniqueRequests.filter((request) => request.status !== "approved").length,
      ledgerSummary: "第一版只展示云端聚合摘要，不同步原始账本。",
    },
    dispatcherRoleReadModel: {
      callableRoles: listings
        .filter((listing) => listing.status === "callable")
        .map((listing) => ({
          roleListingId: listing.id,
          title: listing.title,
          category: listing.category,
          authorized: true,
        })),
      blockedRoles: listings
        .filter((listing) => listing.status !== "callable")
        .map((listing) => ({
          roleListingId: listing.id,
          title: listing.title,
          reason: "missing_category_capability",
        })),
    },
  };
}
