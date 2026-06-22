import type { ToolsCatalogResult } from "../../packages/gateway-protocol/src/index.js";
import type { CloudMarketplaceProjection } from "../aics-main-flow/cloud-marketplace-projection.js";
import type { ApiConnectionsReadModel } from "../api-connections/model.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type {
  ToolSupplyBinding,
  ToolSupplyCategory,
  ToolSupplyConfig,
  ToolSupplyGrant,
  ToolSupplyUniqueCapabilityRequest,
} from "../config/types.tool-supply.js";
import type { SkillStatusEntry, SkillStatusReport } from "../skills/discovery/status.js";

export type ToolSupplyBlockedReason =
  | "missing_api_binding"
  | "missing_category_binding"
  | "missing_tool_binding"
  | "missing_skill_binding"
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
  canDelete?: boolean;
  canEnableDisable?: boolean;
  boundCategoryIds?: string[];
};

export type ToolSupplyCloudCategory = {
  id: string;
  name: string;
  source: "cloud";
  status: "active" | "disabled" | "pending";
  listingCount: number;
};

export type ToolSupplyCategoryCapabilityPackage = {
  category: ToolSupplyCloudCategory;
  skills: ToolSupplyControlItem[];
  tools: ToolSupplyControlItem[];
  roleUsageCount: number;
};

export type ToolSupplyCapabilityLifecycleItem = {
  id: string;
  title: string;
  kind: "category_common" | "unique_capability" | "local_tool" | "skill" | "api_supply";
  status: ToolSupplyItemStatus;
  sourceItemIds: string[];
  dispatchReady: boolean;
  nextAction: {
    label: string;
    routeTab: "skills" | "apiManagement" | "workboard";
    reason: string;
  };
  formation: string;
  acquisition: string;
  usage: string;
  management: string;
  optimization: string;
  blockedReasons: ToolSupplyBlockedReason[];
};

export type ToolSupplySystemDevelopmentTodo = {
  id: string;
  assetType: "tool" | "skill";
  assetId: string;
  source: string;
  linkedReviewId?: string | null;
  development?: {
    status: string;
    userStatusLabel: string;
    sourceRoute: string | null;
    selectedSource: string | null;
    runtime: {
      status: string;
      summary: string;
      matchingRefs: string[];
    };
    sourceCandidates: Array<{
      id: string;
      label: string;
      route: string;
      source: string;
      reason: string;
      confidence: string;
      installHint?: string;
      matchingRefs?: string[];
    }>;
    nextActions: Array<{
      kind: string;
      label: string;
      reason: string;
      enabled: boolean;
    }>;
  };
  sourceRolePackageId?: string;
  sourceListingDraftId?: string | null;
  sourceRequestId?: string;
  categoryCapabilityReviewId?: string;
  targetCategoryRef?: string;
  targetCategoryName?: string;
  declaredCapabilities: string[];
  requiredCapabilities?: string[];
  toolRequirements?: string[];
  skillRequirements?: string[];
  providerRequirements?: string[];
  humanConfirmationRules?: string[];
  riskBoundaries?: string[];
  acceptanceCriteria?: string[];
  riskLevel: string;
  reviewStatus: string;
  reviewDecision: string | null;
  reviewFindings: Array<{
    section: string;
    severity: string;
    message: string;
  }>;
  nextAction: {
    label: string;
    reason: string;
  };
};

export type ToolSupplyResolution = {
  categoryCapabilityId: string;
  category: string;
  allowedTools: string[];
  allowedSkills: string[];
  dispatchReady: boolean;
  blockedReasons: ToolSupplyBlockedReason[];
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
  categories: ToolSupplyCloudCategory[];
  packages: ToolSupplyCategoryCapabilityPackage[];
  risks: ToolSupplyRiskItem[];
  grants: ToolSupplyGrant[];
  uniqueCapabilityRequests: ToolSupplyUniqueCapabilityRequest[];
  bindings: ToolSupplyBinding[];
  resolutions: ToolSupplyResolution[];
  capabilityLifecycle: ToolSupplyCapabilityLifecycleItem[];
  systemDevelopmentTodos: ToolSupplySystemDevelopmentTodo[];
};

function normalizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeToolSupplyResolutionLookupKey(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "").replace(/[-_:]/g, "");
}

function resolutionLookupAliases(resolution: ToolSupplyResolution): string[] {
  const rawIds = [
    resolution.category,
    resolution.categoryCapabilityId,
    resolution.categoryCapabilityId.replace(/^cloud:/u, ""),
  ];
  return [...new Set(rawIds.map(normalizeToolSupplyResolutionLookupKey).filter(Boolean))];
}

export function findToolSupplyResolutionForRolePlanItem(
  resolutions: readonly ToolSupplyResolution[],
  input: { category?: string; roleCapabilityRef?: string },
): ToolSupplyResolution | null {
  const category = normalizeToolSupplyResolutionLookupKey(input.category);
  const capabilityRef = normalizeToolSupplyResolutionLookupKey(input.roleCapabilityRef);
  if (!category && !capabilityRef) {
    return null;
  }
  return (
    resolutions.find((resolution) => {
      const aliases = resolutionLookupAliases(resolution);
      return Boolean(
        (category && aliases.includes(category)) ||
        (capabilityRef && aliases.includes(capabilityRef)) ||
        (capabilityRef && aliases.some((alias) => capabilityRef.endsWith(alias))) ||
        (capabilityRef && aliases.some((alias) => alias.endsWith(capabilityRef))),
      );
    }) ?? null
  );
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
    missing_category_binding: "品类能力缺少工具/Skill 组合绑定。",
    missing_tool_binding: "品类能力缺少可用 Tool 绑定。",
    missing_skill_binding: "品类能力缺少可用 Skill 绑定。",
    skill_disabled: "Skill 已关闭，调度和岗位执行不能使用。",
    skill_missing_dependency: "Skill 依赖未满足，需要安装依赖或补齐配置。",
    plugin_tool_disabled: "插件工具所属插件已关闭。",
    missing_tool_permission: "本地工具权限未批准。",
    unique_capability_pending: "独特能力申请仍在等待审核。",
    cloud_capability_not_authorized: "云端商城能力未授权，不能本地伪造通过。",
    high_risk_needs_human_approval: "高风险能力需要人工批准后才能进入调度。",
    unsupported_capability_route: "能力路线当前没有可用 OpenClaw 工具、Skill 或 API。",
    actor_context_missing: "缺少 actor_context，不能访问云端商城投影。",
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
        canDelete: tool.source === "plugin",
        canEnableDisable: tool.source === "plugin",
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
  const availableBindingPaths = new Set(
    (params.apiConnections?.entries ?? []).flatMap((entry) =>
      entry.status === "available"
        ? (entry.configBindings ?? []).map((binding) => binding.path)
        : [],
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
      !availableBindingPaths.has(apiBindingPath)
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
      canDelete: !skill.bundled,
      canEnableDisable: true,
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
      status: request.status === "approved" ? "available" : "pending_review",
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

function buildCloudCategories(params: {
  cloudMarketplace?: CloudMarketplaceProjection | null;
  cachedCategories: ToolSupplyCategory[];
  bindings: ToolSupplyBinding[];
}): ToolSupplyCloudCategory[] {
  const categories = new Map<string, ToolSupplyCloudCategory>();
  const put = (category: ToolSupplyCloudCategory) => {
    const existing = categories.get(category.id);
    categories.set(category.id, {
      ...existing,
      ...category,
      name: existing?.name && category.name === category.id ? existing.name : category.name,
      status:
        existing?.status === "active" && category.status === "pending" ? "active" : category.status,
      listingCount: Math.max(existing?.listingCount ?? 0, category.listingCount),
    });
  };
  for (const capability of params.cloudMarketplace?.capabilities.categoryCommon ?? []) {
    put({
      id: `cloud:${capability.id}`,
      name: capability.category || capability.label,
      source: "cloud",
      status: capability.approvalStatus === "approved" ? "active" : "pending",
      listingCount: 0,
    });
  }
  for (const category of params.cloudMarketplace?.marketplace.categories ?? []) {
    put({
      id: category.id.startsWith("cloud:") ? category.id : `cloud:${category.id}`,
      name: category.label,
      source: "cloud",
      status: "active",
      listingCount: category.listingCount,
    });
  }
  for (const category of params.cachedCategories) {
    put({
      id: category.id,
      name: category.name,
      source: "cloud",
      status: category.status,
      listingCount: category.listingCount ?? 0,
    });
  }
  for (const binding of params.bindings) {
    if (binding.targetKind !== "category_capability") continue;
    put({
      id: binding.targetId,
      name: binding.targetTitle || binding.targetId,
      source: "cloud",
      status: "pending",
      listingCount: 0,
    });
  }
  return [...categories.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function lifecycleNextAction(params: {
  kind: ToolSupplyCapabilityLifecycleItem["kind"];
  status: ToolSupplyItemStatus;
  blockedReasons: ToolSupplyBlockedReason[];
}): ToolSupplyCapabilityLifecycleItem["nextAction"] {
  if (params.status === "available" && params.blockedReasons.length === 0) {
    return {
      label: params.kind === "api_supply" ? "供给依赖能力" : "进入任务调度使用",
      routeTab: params.kind === "api_supply" ? "apiManagement" : "workboard",
      reason:
        params.kind === "api_supply"
          ? "API 已可用，供工具、Skill、模型或商城连接消费。"
          : "能力已可用，可被调度层匹配 RolePlanItem。",
    };
  }
  if (params.blockedReasons.includes("missing_api_binding")) {
    return {
      label: "去 API 管理绑定",
      routeTab: "apiManagement",
      reason: "能力缺少 API/SecretRef/config binding，先修复 API 供给。",
    };
  }
  if (params.blockedReasons.includes("skill_disabled")) {
    return {
      label: "启用 Skill",
      routeTab: "skills",
      reason: "Skill 当前被禁用，启用后再评估依赖。",
    };
  }
  if (params.blockedReasons.includes("skill_missing_dependency")) {
    return {
      label: "补 Skill 依赖",
      routeTab: "skills",
      reason: "Skill 依赖不满足，需安装依赖或补配置。",
    };
  }
  if (params.blockedReasons.includes("plugin_tool_disabled")) {
    return {
      label: "启用插件工具",
      routeTab: "skills",
      reason: "插件工具所属插件未启用。",
    };
  }
  if (params.blockedReasons.includes("cloud_capability_not_authorized")) {
    return {
      label: "处理云端授权",
      routeTab: "apiManagement",
      reason: "云端商城仍是品类能力授权来源，本地不能伪造通过。",
    };
  }
  if (params.blockedReasons.includes("unique_capability_pending")) {
    return {
      label: "补独特能力申请",
      routeTab: "skills",
      reason: "独特能力还在申请/审核中，不能进入岗位执行。",
    };
  }
  if (params.blockedReasons.includes("high_risk_needs_human_approval")) {
    return {
      label: "人工批准能力",
      routeTab: "skills",
      reason: "高风险工具或能力需要人工批准。",
    };
  }
  return {
    label: "查看风险阻塞",
    routeTab: "skills",
    reason: "能力仍有阻塞原因，需要在工具与 Skill 页面处理。",
  };
}

function buildCapabilityLifecycle(params: {
  localTools: ToolSupplyControlItem[];
  skills: ToolSupplyControlItem[];
  apiBindings: ToolSupplyControlItem[];
  cloudCapabilities: ToolSupplyControlItem[];
}): ToolSupplyCapabilityLifecycleItem[] {
  const lifecycle: ToolSupplyCapabilityLifecycleItem[] = [];
  for (const item of params.cloudCapabilities) {
    const isUnique = item.id.startsWith("unique:");
    const available = item.status === "available";
    lifecycle.push({
      id: `capability:${item.id}`,
      title: item.label,
      kind: isUnique ? "unique_capability" : "category_common",
      status: item.status,
      sourceItemIds: [item.id],
      dispatchReady: available && item.blockedReasons.length === 0,
      nextAction: lifecycleNextAction({
        kind: isUnique ? "unique_capability" : "category_common",
        status: item.status,
        blockedReasons: item.blockedReasons,
      }),
      formation: isUnique
        ? "独特能力 = 业务缺口 + 能力申请 + 人工审核 + 所需工具/Skill/API。"
        : "品类通用能力 = 云端商城品类授权 + 本地 OpenClaw 工具权限 + Skill + API 绑定。",
      acquisition: available
        ? "已从云端商城或本地申请投影获得，可进入本地管控。"
        : isUnique
          ? "先在本地准备独特能力申请，等待云端审核或人工确认。"
          : "需要云端商城授权该品类通用能力，本地不能伪造通过。",
      usage: available
        ? "可被任务调度用于匹配 RolePlanItem，并参与 TaskPackage/DispatchToRoleRequest。"
        : "当前只能展示和申请，不能进入岗位执行。",
      management: "云端负责审核、授权、计费；本地负责展示、grant overlay、风险和阻塞说明。",
      optimization: isUnique
        ? "补齐缺失工具、Skill、API、示例输入输出和审核材料后再提交/复审。"
        : "根据调度失败、岗位执行结果和风险报告，补充工具/Skill/API 或调整品类能力说明。",
      blockedReasons: item.blockedReasons,
    });
  }
  for (const item of params.localTools.filter(
    (entry) => entry.risk === "high" || entry.blockedReasons.length,
  )) {
    const kind = "local_tool" as const;
    lifecycle.push({
      id: `capability:${item.id}`,
      title: item.label,
      kind,
      status: item.status,
      sourceItemIds: [item.id],
      dispatchReady: item.status === "available" && item.blockedReasons.length === 0,
      nextAction: lifecycleNextAction({
        kind,
        status: item.status,
        blockedReasons: item.blockedReasons,
      }),
      formation: "本地工具能力 = OpenClaw core/plugin tool + 本地工具权限 grant。",
      acquisition:
        item.kind === "plugin_tool" ? "通过插件安装/启用获得。" : "由 OpenClaw 本地运行时提供。",
      usage:
        item.status === "available"
          ? "可作为 Skill 或岗位执行的工具权限候选。"
          : "存在权限、插件禁用或高风险审批阻塞，不能直接供给调度。",
      management: "在工具与 Skill 页面批准、阻断或启停插件。",
      optimization: "将高频工具沉淀为 Skill 依赖，补充 API 绑定、scope 和风险说明。",
      blockedReasons: item.blockedReasons,
    });
  }
  for (const item of params.skills.filter(
    (entry) => entry.status !== "available" || entry.configBindings?.length,
  )) {
    const kind = "skill" as const;
    lifecycle.push({
      id: `capability:${item.id}`,
      title: item.label,
      kind,
      status: item.status,
      sourceItemIds: [item.id],
      dispatchReady: item.status === "available" && item.blockedReasons.length === 0,
      nextAction: lifecycleNextAction({
        kind,
        status: item.status,
        blockedReasons: item.blockedReasons,
      }),
      formation: "Skill 能力 = Skill 包 + 依赖检查 + API/配置绑定 + 启用状态。",
      acquisition: "通过 OpenClaw Skill 仓库或本地 Skill 包获得，之后绑定 API 和依赖。",
      usage:
        item.status === "available"
          ? "可被主对话、工具调用和岗位执行作为可调用能力。"
          : "缺依赖、缺 API 或禁用时不能进入调度执行。",
      management: "在本页启用/禁用 Skill，在 API 管理绑定 SecretRef 或 Provider。",
      optimization: "把反复出现的独特能力沉淀成 Skill，补齐 README、依赖和验收样例。",
      blockedReasons: item.blockedReasons,
    });
  }
  for (const item of params.apiBindings.filter(
    (entry) => entry.status !== "available" || entry.blockedReasons.length,
  )) {
    const kind = "api_supply" as const;
    lifecycle.push({
      id: `capability:${item.id}`,
      title: item.label,
      kind,
      status: item.status,
      sourceItemIds: [item.id],
      dispatchReady: item.status === "available" && item.blockedReasons.length === 0,
      nextAction: lifecycleNextAction({
        kind,
        status: item.status,
        blockedReasons: item.blockedReasons,
      }),
      formation: "API 供给 = Provider/Base URL + SecretRef + consumer/scope + config binding。",
      acquisition: "在 API 管理中添加连接并 materialize 到现有 OpenClaw 配置路径。",
      usage:
        item.status === "available"
          ? "可供模型、工具、Skill、商城和岗位调度读取。"
          : "未绑定或风险阻塞时，只影响依赖该 API 的能力。",
      management: "在 API 管理维护 SecretRef、绑定路径、风险报告和删除/更新。",
      optimization: "收敛重复 Provider，缩小 scope，避免明文密钥，补充 HTTPS 和健康检查。",
      blockedReasons: item.blockedReasons,
    });
  }
  return lifecycle;
}

function buildResolutions(params: {
  categories: ToolSupplyCloudCategory[];
  cloudCapabilities: ToolSupplyControlItem[];
  localTools: ToolSupplyControlItem[];
  skills: ToolSupplyControlItem[];
  bindings: ToolSupplyBinding[];
}): ToolSupplyResolution[] {
  const toolsById = new Map(params.localTools.map((item) => [item.id, item]));
  const skillsById = new Map(params.skills.map((item) => [item.id, item]));
  const activeBindings = params.bindings.filter((binding) => binding.status === "active");
  const cloudCapabilityById = new Map(params.cloudCapabilities.map((item) => [item.id, item]));
  return params.categories.map((category) => {
    const capability = cloudCapabilityById.get(category.id);
    const bindings = activeBindings.filter(
      (binding) => binding.targetKind === "category_capability" && binding.targetId === category.id,
    );
    const boundTools = bindings
      .filter((binding) => binding.sourceKind === "tool")
      .map((binding) => toolsById.get(binding.sourceItemId))
      .filter((item): item is ToolSupplyControlItem => Boolean(item));
    const boundSkills = bindings
      .filter((binding) => binding.sourceKind === "skill")
      .map((binding) => skillsById.get(binding.sourceItemId))
      .filter((item): item is ToolSupplyControlItem => Boolean(item));
    const allowedTools = boundTools
      .filter((item) => item.status === "available")
      .map((item) => item.id);
    const allowedSkills = boundSkills
      .filter((item) => item.status === "available")
      .map((item) => item.id);
    const blockedReasons = new Set<ToolSupplyBlockedReason>(capability?.blockedReasons ?? []);
    if (bindings.length === 0) {
      blockedReasons.add("missing_category_binding");
    }
    if (allowedTools.length === 0) {
      blockedReasons.add("missing_tool_binding");
    }
    if (allowedSkills.length === 0) {
      blockedReasons.add("missing_skill_binding");
    }
    for (const item of [...boundTools, ...boundSkills]) {
      for (const reason of item.blockedReasons) {
        blockedReasons.add(reason);
      }
    }
    return {
      categoryCapabilityId: category.id,
      category: category.name,
      allowedTools,
      allowedSkills,
      dispatchReady: blockedReasons.size === 0,
      blockedReasons: [...blockedReasons],
    };
  });
}

function addBoundCategoryIds(
  items: ToolSupplyControlItem[],
  bindings: ToolSupplyBinding[],
): ToolSupplyControlItem[] {
  return items.map((item) => ({
    ...item,
    boundCategoryIds: bindings
      .filter(
        (binding) =>
          binding.status === "active" &&
          binding.targetKind === "category_capability" &&
          binding.sourceItemId === item.id,
      )
      .map((binding) => binding.targetId),
  }));
}

function buildCategoryPackages(params: {
  categories: ToolSupplyCloudCategory[];
  localTools: ToolSupplyControlItem[];
  skills: ToolSupplyControlItem[];
  bindings: ToolSupplyBinding[];
}): ToolSupplyCategoryCapabilityPackage[] {
  const toolsById = new Map(params.localTools.map((item) => [item.id, item]));
  const skillsById = new Map(params.skills.map((item) => [item.id, item]));
  return params.categories.map((category) => {
    const categoryBindings = params.bindings.filter(
      (binding) =>
        binding.status === "active" &&
        binding.targetKind === "category_capability" &&
        binding.targetId === category.id,
    );
    const tools = categoryBindings
      .filter((binding) => binding.sourceKind === "tool")
      .map((binding) => toolsById.get(binding.sourceItemId))
      .filter((item): item is ToolSupplyControlItem => Boolean(item));
    const skills = categoryBindings
      .filter((binding) => binding.sourceKind === "skill")
      .map((binding) => skillsById.get(binding.sourceItemId))
      .filter((item): item is ToolSupplyControlItem => Boolean(item));
    return {
      category,
      skills,
      tools,
      roleUsageCount: category.listingCount,
    };
  });
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
  systemDevelopmentTodos?: ToolSupplySystemDevelopmentTodo[];
}): ToolSupplyControlReadModel {
  const toolSupply: ToolSupplyConfig = params.config.toolSupply ?? {};
  const cachedCategories = collectConfigArray(toolSupply.categories);
  const grants = collectConfigArray(toolSupply.grants);
  const localRequests = collectConfigArray(toolSupply.uniqueCapabilityRequests);
  const bindings = collectConfigArray(toolSupply.bindings);
  const risks: ToolSupplyRiskItem[] = [];
  const rawLocalTools = buildToolItems({
    config: params.config,
    toolsCatalogResult: params.toolsCatalogResult,
    grants,
    risks,
  });
  const rawSkills = buildSkillItems({
    skillsReport: params.skillsReport,
    apiConnections: params.apiConnections,
    risks,
  });
  const localTools = addBoundCategoryIds(rawLocalTools, bindings);
  const skills = addBoundCategoryIds(rawSkills, bindings);
  const apiBindings = buildApiItems(params.apiConnections);
  const cloudCapabilities = buildCloudItems({
    cloudMarketplace: params.cloudMarketplace,
    localRequests,
    risks,
  });
  const categories = buildCloudCategories({
    cloudMarketplace: params.cloudMarketplace,
    cachedCategories,
    bindings,
  });
  const resolutions = buildResolutions({
    categories,
    cloudCapabilities,
    localTools,
    skills,
    bindings,
  });
  const packages = buildCategoryPackages({
    categories,
    localTools,
    skills,
    bindings,
  });
  const capabilityLifecycle = buildCapabilityLifecycle({
    localTools,
    skills,
    apiBindings,
    cloudCapabilities,
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
    categories,
    packages,
    risks,
    grants,
    uniqueCapabilityRequests: localRequests,
    bindings,
    resolutions,
    capabilityLifecycle,
    systemDevelopmentTodos: params.systemDevelopmentTodos ?? [],
  };
}
