import type { ToolsCatalogResult } from "../../packages/gateway-protocol/src/index.js";
import type { CloudMarketplaceProjection } from "../aics-main-flow/cloud-marketplace-projection.js";
import type { ApiConnectionsReadModel } from "../api-connections/model.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type {
  ToolSupplyConfig,
  ToolSupplyGrant,
  ToolSupplyUniqueCapabilityRequest,
} from "../config/types.tool-supply.js";
import type { SkillStatusEntry, SkillStatusReport } from "../skills/discovery/status.js";

export type ToolSupplyBlockedReason =
  | "missing_api_binding"
  | "skill_disabled"
  | "skill_missing_dependency"
  | "plugin_tool_disabled"
  | "missing_tool_permission"
  | "unique_capability_pending"
  | "cloud_capability_not_authorized"
  | "high_risk_needs_human_approval"
  | "unsupported_capability_route"
  | "actor_context_missing";

export type ToolSupplyItemStatus =
  | "available"
  | "blocked"
  | "disabled"
  | "needs_setup"
  | "pending_review";

export type ToolSupplyRiskLevel = "low" | "medium" | "high" | "unknown";

export type ToolSupplyRiskItem = {
  id: string;
  label: string;
  targetKind: ToolSupplyControlItem["kind"];
  severity: "blocking" | "warning" | "info";
  reason: ToolSupplyBlockedReason;
  message: string;
};

export type ToolSupplyControlItem = {
  id: string;
  label: string;
  description?: string;
  kind: "core_tool" | "plugin_tool" | "skill" | "api_connection" | "cloud_capability";
  source: "openclaw" | "plugin" | "skill" | "api_connections" | "cloud_marketplace";
  status: ToolSupplyItemStatus;
  risk: ToolSupplyRiskLevel;
  blockedReasons: ToolSupplyBlockedReason[];
  grantStatus?: ToolSupplyGrant["status"];
  pluginId?: string;
  skillKey?: string;
  configBindings?: string[];
  consumers?: string[];
  missing?: string[];
};

export type ToolSupplyControlReadModel = {
  version: 1;
  updatedAt: number;
  authority: "openclaw_local";
  metrics: {
    total: number;
    localTools: number;
    pluginTools: number;
    skills: number;
    apiConnections: number;
    cloudCapabilities: number;
    available: number;
    blocked: number;
    disabled: number;
    pendingReview: number;
    risks: number;
  };
  localTools: ToolSupplyControlItem[];
  skills: ToolSupplyControlItem[];
  apiBindings: ToolSupplyControlItem[];
  cloudCapabilities: ToolSupplyControlItem[];
  risks: ToolSupplyRiskItem[];
  grants: ToolSupplyGrant[];
  uniqueCapabilityRequests: ToolSupplyUniqueCapabilityRequest[];
};

function normalizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hasMissingSkillRequirement(skill: SkillStatusEntry): boolean {
  return (
    skill.missing.bins.length > 0 ||
    skill.missing.anyBins.length > 0 ||
    skill.missing.env.length > 0 ||
    skill.missing.config.length > 0 ||
    skill.missing.os.length > 0 ||
    skill.configChecks.some((check) => !check.satisfied)
  );
}

function missingSkillLabels(skill: SkillStatusEntry): string[] {
  return [
    ...skill.missing.bins.map((item) => `bin:${item}`),
    ...skill.missing.anyBins.map((item) => `anyBin:${item}`),
    ...skill.missing.env.map((item) => `env:${item}`),
    ...skill.missing.config.map((item) => `config:${item}`),
    ...skill.missing.os.map((item) => `os:${item}`),
    ...skill.configChecks
      .filter((check) => !check.satisfied)
      .map((check) => `config:${check.path}`),
  ];
}

function grantFor(grants: readonly ToolSupplyGrant[], capabilityRef: string) {
  const normalized = normalizeId(capabilityRef);
  return grants.find(
    (grant) =>
      normalizeId(grant.capabilityRef) === normalized ||
      normalizeId(grant.targetId ?? "") === normalized,
  );
}

function isPluginDisabled(config: OpenClawConfig, pluginId: string | undefined): boolean {
  if (!pluginId) {
    return false;
  }
  return config.plugins?.entries?.[pluginId]?.enabled === false;
}

function isHighRisk(risk: ToolSupplyRiskLevel): boolean {
  return risk === "high";
}

function itemStatus(reasons: readonly ToolSupplyBlockedReason[], fallback: ToolSupplyItemStatus) {
  if (reasons.includes("skill_disabled") || reasons.includes("plugin_tool_disabled")) {
    return "disabled";
  }
  if (reasons.length > 0) {
    return "blocked";
  }
  return fallback;
}

function pushRisk(
  risks: ToolSupplyRiskItem[],
  item: ToolSupplyControlItem,
  reason: ToolSupplyBlockedReason,
  severity: ToolSupplyRiskItem["severity"] = "blocking",
) {
  const messages: Record<ToolSupplyBlockedReason, string> = {
    missing_api_binding: "缺少可用 API 绑定，不能供给对应工具或 Skill。",
    skill_disabled: "Skill 已关闭，调度和岗位执行不能使用。",
    skill_missing_dependency: "Skill 依赖未满足，需要安装依赖或补齐配置。",
    plugin_tool_disabled: "插件工具所属插件已关闭。",
    missing_tool_permission: "本地工具权限未批准。",
    unique_capability_pending: "独特能力申请仍在等待审核。",
    cloud_capability_not_authorized: "云端商城能力未授权，不能本地伪造通过。",
    high_risk_needs_human_approval: "高风险能力需要人工批准后才能进入调度。",
    unsupported_capability_route: "能力路线当前没有可用 OpenClaw 工具、Skill 或 API。",
    actor_context_missing: "缺少 actor_context，不能访问云端商城管理投影。",
  };
  risks.push({
    id: `${item.id}:${reason}`,
    label: item.label,
    targetKind: item.kind,
    severity,
    reason,
    message: messages[reason],
  });
}

function buildToolItems(params: {
  config: OpenClawConfig;
  toolsCatalogResult?: ToolsCatalogResult | null;
  grants: ToolSupplyGrant[];
  risks: ToolSupplyRiskItem[];
}): ToolSupplyControlItem[] {
  const items: ToolSupplyControlItem[] = [];
  for (const group of params.toolsCatalogResult?.groups ?? []) {
    for (const tool of group.tools) {
      const pluginId = tool.pluginId ?? group.pluginId;
      const capabilityRef =
        tool.source === "plugin" && pluginId ? `plugin:${pluginId}:${tool.id}` : `tool:${tool.id}`;
      const grant = grantFor(params.grants, capabilityRef);
      const risk = tool.risk ?? "unknown";
      const blockedReasons: ToolSupplyBlockedReason[] = [];
      if (tool.source === "plugin" && isPluginDisabled(params.config, pluginId)) {
        blockedReasons.push("plugin_tool_disabled");
      }
      if (isHighRisk(risk) && grant?.status !== "approved") {
        blockedReasons.push("high_risk_needs_human_approval");
      }
      if (grant?.status === "blocked") {
        blockedReasons.push("missing_tool_permission");
      }
      const item: ToolSupplyControlItem = {
        id: capabilityRef,
        label: tool.label,
        description: tool.description,
        kind: tool.source === "plugin" ? "plugin_tool" : "core_tool",
        source: tool.source === "plugin" ? "plugin" : "openclaw",
        pluginId,
        risk,
        grantStatus: grant?.status,
        status: itemStatus(blockedReasons, "available"),
        blockedReasons,
      };
      items.push(item);
      for (const reason of blockedReasons) {
        pushRisk(params.risks, item, reason);
      }
    }
  }
  return items;
}

function buildSkillItems(params: {
  skillsReport?: SkillStatusReport | null;
  apiConnections?: ApiConnectionsReadModel | null;
  risks: ToolSupplyRiskItem[];
}): ToolSupplyControlItem[] {
  const bindingPaths = new Set(
    (params.apiConnections?.entries ?? []).flatMap((entry) =>
      (entry.configBindings ?? []).map((binding) => binding.path),
    ),
  );
  const items: ToolSupplyControlItem[] = [];
  for (const skill of params.skillsReport?.skills ?? []) {
    const blockedReasons: ToolSupplyBlockedReason[] = [];
    const missing = missingSkillLabels(skill);
    if (skill.disabled) {
      blockedReasons.push("skill_disabled");
    }
    if (hasMissingSkillRequirement(skill)) {
      blockedReasons.push("skill_missing_dependency");
    }
    const apiBindingPath = `skills.entries.${skill.skillKey}.apiKey`;
    if (
      (skill.primaryEnv ||
        skill.requirements.env.length > 0 ||
        skill.requirements.config.length > 0) &&
      !bindingPaths.has(apiBindingPath)
    ) {
      blockedReasons.push("missing_api_binding");
    }
    const item: ToolSupplyControlItem = {
      id: `skill:${skill.skillKey}`,
      label: skill.name,
      description: skill.description,
      kind: "skill",
      source: "skill",
      skillKey: skill.skillKey,
      risk: "unknown",
      status: itemStatus(blockedReasons, skill.eligible ? "available" : "needs_setup"),
      blockedReasons,
      configBindings: [apiBindingPath],
      missing,
    };
    items.push(item);
    for (const reason of blockedReasons) {
      pushRisk(params.risks, item, reason);
    }
  }
  return items;
}

function buildApiItems(apiConnections?: ApiConnectionsReadModel | null): ToolSupplyControlItem[] {
  return (apiConnections?.entries ?? []).map((entry) => ({
    id: `api:${entry.id}`,
    label: entry.name,
    description: `${entry.kind} / ${entry.provider}`,
    kind: "api_connection",
    source: "api_connections",
    status:
      entry.status === "available"
        ? "available"
        : entry.status === "disabled"
          ? "disabled"
          : entry.status === "blocked"
            ? "blocked"
            : "needs_setup",
    risk:
      entry.riskStatus === "blocked" ? "high" : entry.riskStatus === "warning" ? "medium" : "low",
    blockedReasons: entry.risks.some((risk) => risk.code === "unbound_config_path")
      ? ["missing_api_binding"]
      : [],
    configBindings: (entry.configBindings ?? []).map((binding) => binding.path),
    consumers: entry.consumers,
  }));
}

function buildCloudItems(params: {
  cloudMarketplace?: CloudMarketplaceProjection | null;
  localRequests: ToolSupplyUniqueCapabilityRequest[];
  risks: ToolSupplyRiskItem[];
}): ToolSupplyControlItem[] {
  const items: ToolSupplyControlItem[] = [];
  for (const capability of params.cloudMarketplace?.capabilities.categoryCommon ?? []) {
    const blockedReasons: ToolSupplyBlockedReason[] =
      capability.approvalStatus === "approved" ? [] : ["cloud_capability_not_authorized"];
    const item: ToolSupplyControlItem = {
      id: `cloud:${capability.id}`,
      label: capability.label,
      description: capability.category,
      kind: "cloud_capability",
      source: "cloud_marketplace",
      status: blockedReasons.length ? "blocked" : "available",
      risk: "medium",
      blockedReasons,
    };
    items.push(item);
    for (const reason of blockedReasons) {
      pushRisk(params.risks, item, reason);
    }
  }
  for (const request of [
    ...(params.cloudMarketplace?.capabilities.uniqueRequests ?? []).map((entry) => ({
      id: entry.id,
      label: entry.missingCapability,
      status: entry.status,
      category: entry.category,
    })),
    ...params.localRequests.map((entry) => ({
      id: entry.id,
      label: entry.title,
      status: entry.status,
      category: entry.category,
    })),
  ]) {
    const blockedReasons: ToolSupplyBlockedReason[] =
      request.status === "approved" ? [] : ["unique_capability_pending"];
    const item: ToolSupplyControlItem = {
      id: `unique:${request.id}`,
      label: request.label,
      description: request.category,
      kind: "cloud_capability",
      source: "cloud_marketplace",
      status:
        request.status === "draft" || request.status === "pending_review"
          ? "pending_review"
          : "available",
      risk: "high",
      blockedReasons,
    };
    items.push(item);
    for (const reason of blockedReasons) {
      pushRisk(params.risks, item, reason);
    }
  }
  return items;
}

function collectConfigArray<T>(value: Record<string, T> | undefined): T[] {
  return Object.values(value ?? {});
}

export function createToolSupplyControlReadModel(params: {
  config: OpenClawConfig;
  toolsCatalogResult?: ToolsCatalogResult | null;
  skillsReport?: SkillStatusReport | null;
  apiConnections?: ApiConnectionsReadModel | null;
  cloudMarketplace?: CloudMarketplaceProjection | null;
}): ToolSupplyControlReadModel {
  const toolSupply: ToolSupplyConfig = params.config.toolSupply ?? {};
  const grants = collectConfigArray(toolSupply.grants);
  const localRequests = collectConfigArray(toolSupply.uniqueCapabilityRequests);
  const risks: ToolSupplyRiskItem[] = [];
  const localTools = buildToolItems({
    config: params.config,
    toolsCatalogResult: params.toolsCatalogResult,
    grants,
    risks,
  });
  const skills = buildSkillItems({
    skillsReport: params.skillsReport,
    apiConnections: params.apiConnections,
    risks,
  });
  const apiBindings = buildApiItems(params.apiConnections);
  const cloudCapabilities = buildCloudItems({
    cloudMarketplace: params.cloudMarketplace,
    localRequests,
    risks,
  });
  const all = [...localTools, ...skills, ...apiBindings, ...cloudCapabilities];
  return {
    version: 1,
    updatedAt: Date.now(),
    authority: "openclaw_local",
    metrics: {
      total: all.length,
      localTools: localTools.length,
      pluginTools: localTools.filter((item) => item.kind === "plugin_tool").length,
      skills: skills.length,
      apiConnections: apiBindings.length,
      cloudCapabilities: cloudCapabilities.length,
      available: all.filter((item) => item.status === "available").length,
      blocked: all.filter((item) => item.status === "blocked").length,
      disabled: all.filter((item) => item.status === "disabled").length,
      pendingReview: all.filter((item) => item.status === "pending_review").length,
      risks: risks.length,
    },
    localTools,
    skills,
    apiBindings,
    cloudCapabilities,
    risks,
    grants,
    uniqueCapabilityRequests: localRequests,
  };
}
