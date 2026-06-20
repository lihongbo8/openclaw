import type { AicsMainFlowBlockedReason, AicsToolSupplyResolution } from "./types.js";

export const PRODUCT_EXECUTION_CORE_TOOLS = [
  "core.openai.image.generate",
  "core.workspace.detail.write",
  "core.artifact.quality.check",
  "core.artifact.package.bundle",
] as const;

export const PRODUCT_EXECUTION_CORE_SKILLS = [
  "img:gen",
  "ws:write",
  "quality:check",
  "file:pack",
] as const;

export type RoleCategoryCapabilityGrant = {
  categoryCapabilityId?: string;
  category?: string;
  allowedTools: string[];
  allowedSkills: string[];
  capabilityBlockedReasons: AicsMainFlowBlockedReason["code"][];
  toolSkillReady: boolean;
  apiBindingReady: boolean;
};

export function resolveRoleCategoryCapabilityGrant(
  resolution: AicsToolSupplyResolution | undefined,
): RoleCategoryCapabilityGrant {
  const hasResolution = Boolean(resolution);
  const blockedReasonInputs = hasResolution
    ? [...(resolution?.blockedReasons ?? [])]
    : ["missing_category_binding", "missing_tool_binding", "missing_skill_binding"];
  const includeProductExecutionCore =
    hasResolution && resolution?.dispatchReady === true && blockedReasonInputs.length === 0;
  const allowedTools = hasResolution
    ? mergeRefs(
        resolution?.allowedTools ?? [],
        includeProductExecutionCore ? PRODUCT_EXECUTION_CORE_TOOLS : [],
      )
    : [];
  const allowedSkills = hasResolution
    ? mergeRefs(
        resolution?.allowedSkills ?? [],
        includeProductExecutionCore ? PRODUCT_EXECUTION_CORE_SKILLS : [],
      )
    : [];

  if (!allowedTools.length && !blockedReasonInputs.includes("missing_tool_binding")) {
    blockedReasonInputs.push("missing_tool_binding");
  }
  if (!allowedSkills.length && !blockedReasonInputs.includes("missing_skill_binding")) {
    blockedReasonInputs.push("missing_skill_binding");
  }

  const capabilityBlockedReasons = normalizeCapabilityBlockedReasons(blockedReasonInputs);
  const hasApiBindingBlock = capabilityBlockedReasons.includes("missing_api_binding");
  const hasToolSkillBlock = capabilityBlockedReasons.some(
    (reason) => reason !== "missing_api_binding",
  );

  return {
    ...(resolution?.categoryCapabilityId
      ? { categoryCapabilityId: resolution.categoryCapabilityId }
      : {}),
    ...(resolution?.category ? { category: resolution.category } : {}),
    allowedTools,
    allowedSkills,
    capabilityBlockedReasons,
    toolSkillReady: !hasToolSkillBlock && allowedTools.length > 0 && allowedSkills.length > 0,
    apiBindingReady: !hasApiBindingBlock,
  };
}

function mergeRefs(refs: readonly string[], requiredRefs: readonly string[]): string[] {
  return [...new Set([...refs, ...requiredRefs].map((item) => item.trim()).filter(Boolean))];
}

function normalizeCapabilityBlockCode(reason: string): AicsMainFlowBlockedReason["code"] {
  switch (reason) {
    case "api_binding_required":
      return "missing_api_binding";
    case "missing_api_binding":
    case "missing_category_binding":
    case "missing_tool_binding":
    case "missing_skill_binding":
    case "skill_disabled":
    case "skill_missing_dependency":
    case "plugin_tool_disabled":
    case "missing_tool_permission":
    case "unique_capability_pending":
    case "cloud_capability_not_authorized":
    case "high_risk_needs_human_approval":
    case "unsupported_capability_route":
    case "actor_context_missing":
      return reason;
    default:
      return "tool_skill_not_ready";
  }
}

function normalizeCapabilityBlockedReasons(
  reasons: readonly string[],
): AicsMainFlowBlockedReason["code"][] {
  return [...new Set(reasons.map(normalizeCapabilityBlockCode))];
}
