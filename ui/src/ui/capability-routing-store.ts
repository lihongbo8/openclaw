import type { SkillStatusEntry, SkillStatusReport, ToolsCatalogResult } from "./types.ts";

export type LocalCapabilityStatus = "available" | "blocked" | "disabled" | "needs-setup";

export type LocalCapabilityItem = {
  kind: "tool" | "skill";
  id: string;
  label: string;
  description: string;
  source: string;
  status: LocalCapabilityStatus;
  risk: "low" | "medium" | "high" | "unknown";
  catalogRefs: string[];
  version?: string;
};

export type LocalCapabilitySummary = {
  total: number;
  tools: number;
  skills: number;
  available: number;
  blocked: number;
  disabled: number;
  needsSetup: number;
  gated: number;
  highRisk: number;
};

export type LocalCapabilityStore = {
  items: LocalCapabilityItem[];
  refIndex: Map<string, LocalCapabilityItem>;
  summary: LocalCapabilitySummary;
};

export type CapabilityInstallHint = {
  source: "clawhub_skill" | "plugin_marketplace" | "provider_config" | "manual";
  label: string;
  slug?: string;
  version?: string;
  command?: string;
  note?: string;
};

export type CatalogRefCarrier = {
  catalogRefs?: readonly string[];
  blockedCatalogRefs?: readonly string[];
  callable?: boolean;
  unavailableReasons?: readonly string[];
  categoryRef?: string;
  categoryName?: string;
  categoryPackRef?: string;
  skillPackRef?: string;
  toolPackRef?: string;
  inheritedCatalogRefs?: readonly string[];
  inheritedCapabilityRefs?: readonly string[];
};

export type CapabilityRouteKind =
  | "category_pack"
  | "skill_pack"
  | "tool_pack"
  | "local_tool"
  | "local_skill"
  | "remote_api"
  | "remote_mcp"
  | "provider_capability"
  | "human_gate"
  | "unsupported";

export type CapabilityRouteStatus =
  | "available"
  | "needs_config"
  | "needs_auth"
  | "can_install"
  | "blocked"
  | "disabled"
  | "unsupported";

export type CapabilityRoute = {
  catalogRef: string;
  normalizedRef: string;
  label: string;
  kind: CapabilityRouteKind;
  status: CapabilityRouteStatus;
  risk: "low" | "medium" | "high" | "unknown";
  source: "local" | "remote" | "policy" | "catalog";
  localItem?: LocalCapabilityItem;
  installHint?: CapabilityInstallHint;
};

export type CapabilityRoutingSummary = {
  total: number;
  available: number;
  categoryPacks: number;
  skillPacks: number;
  toolPacks: number;
  local: number;
  remoteApi: number;
  remoteMcp: number;
  provider: number;
  humanGate: number;
  canInstall: number;
  needsConfig: number;
  needsAuth: number;
  gated: number;
  unsupported: number;
};

export type CapabilityRoutingProjection = {
  localStore: LocalCapabilityStore;
  routes: CapabilityRoute[];
  summary: CapabilityRoutingSummary;
};

export type CapabilityCategoryPack = {
  categoryRef: string;
  categoryName: string;
  categoryPackRef: string;
  skillPackRef?: string;
  toolPackRef?: string;
  sourceRoleIds: string[];
  catalogRefs: string[];
  capabilityRefs: string[];
  routes: CapabilityRoute[];
  summary: CapabilityRoutingSummary;
  preflight: CapabilityPreflight;
};

export type CapabilityCategoryPackProjection = {
  packs: CapabilityCategoryPack[];
  selectedCategoryRef?: string;
  selectedPack?: CapabilityCategoryPack;
};

export type CapabilityPreflightStatus =
  | "ready"
  | "needs_setup"
  | "needs_auth"
  | "needs_review"
  | "blocked";

export type CapabilityPreflight = {
  status: CapabilityPreflightStatus;
  label: string;
  nextAction: string;
  routes: CapabilityRoute[];
  blockingRoutes: CapabilityRoute[];
  installableRoutes: CapabilityRoute[];
  reviewRoutes: CapabilityRoute[];
};

export type LocalKnowledgeBindingSourceType =
  | "memory_core"
  | "memory_lancedb"
  | "memory_wiki"
  | "active_memory"
  | "unknown";

export type LocalKnowledgeSafeBindingProjection = {
  schemaVersion: "aics.local_knowledge_binding.v1";
  knowledgeRef: string;
  catalogRef: string;
  localCapabilityId: string;
  label: string;
  sourceType: LocalKnowledgeBindingSourceType;
  version: string;
  hash: string;
  capabilitySummary: string[];
  riskSummary: string[];
  applicableScopes: string[];
  reviewRecommendation: string;
  routeStatus: "available";
};

export type LocalKnowledgeSafeBindingOmission = {
  catalogRef: string;
  status: CapabilityRouteStatus;
  reason: string;
};

export type LocalKnowledgeSafeBindingExport = {
  schemaVersion: "aics.local_knowledge_binding_export.v1";
  categoryRef?: string;
  categoryPackRef?: string;
  projections: LocalKnowledgeSafeBindingProjection[];
  omittedRoutes: LocalKnowledgeSafeBindingOmission[];
  forbiddenFields: string[];
};

export const LOCAL_KNOWLEDGE_BINDING_FORBIDDEN_FIELDS = [
  "knowledgeText",
  "rawKnowledge",
  "rawMemory",
  "materials",
  "screenshots",
  "localPath",
  "userPrivateMemory",
  "fullRunHistory",
  "providerKey",
  "oauthToken",
  "rawPrompt",
  "rawApiPayload",
] as const;

function addRef(refs: Set<string>, value: string | undefined | null) {
  const ref = value?.trim();
  if (ref) {
    refs.add(ref);
  }
}

function addCatalogRef(
  refs: Set<string>,
  seenLookupRefs: Set<string>,
  value: string | undefined | null,
) {
  const ref = value?.trim();
  if (!ref) {
    return;
  }
  const lookupRef = normalizeCatalogLookupRef(ref);
  if (seenLookupRefs.has(lookupRef)) {
    return;
  }
  seenLookupRefs.add(lookupRef);
  refs.add(ref);
}

export function normalizeCatalogLookupRef(value: string): string {
  return value
    .trim()
    .replace(/@[^:@/]+$/u, "")
    .toLowerCase();
}

function refBody(ref: string): string {
  return ref
    .replace(/^[a-z]+:/iu, "")
    .replace(/@[^:@/]+$/u, "")
    .trim();
}

function labelFromRef(ref: string): string {
  return (
    refBody(ref)
      .replace(/[:._-]+/gu, " ")
      .trim() || ref
  );
}

function refPrefix(ref: string): string {
  const match = normalizeCatalogLookupRef(ref).match(/^([a-z]+):/u);
  return match?.[1] ?? "";
}

function slugFromPackRef(ref: string): string {
  return refBody(ref)
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
}

function isLocalKnowledgeRef(normalized: string): boolean {
  return /^(capability:)?(memory|knowledge|wiki)[._]/u.test(normalized);
}

function isLocalKnowledgeRoute(route: CapabilityRoute): boolean {
  if (!isLocalKnowledgeRef(route.normalizedRef)) {
    return false;
  }
  return route.kind === "local_tool" || route.kind === "local_skill";
}

function detectLocalKnowledgeSourceType(route: CapabilityRoute): LocalKnowledgeBindingSourceType {
  const refs = [
    route.normalizedRef,
    route.localItem?.id,
    route.localItem?.source,
    ...(route.localItem?.catalogRefs ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeCatalogLookupRef);
  if (refs.some((ref) => ref.includes("memory-lancedb") || ref.includes("memory_recall"))) {
    return "memory_lancedb";
  }
  if (refs.some((ref) => ref.includes("memory-wiki") || ref.startsWith("wiki"))) {
    return "memory_wiki";
  }
  if (refs.some((ref) => ref.includes("active-memory"))) {
    return "active_memory";
  }
  if (refs.some((ref) => ref.includes("memory-core") || ref.startsWith("memory"))) {
    return "memory_core";
  }
  return "unknown";
}

function knowledgeApplicableScopes(route: CapabilityRoute): string[] {
  const normalized = route.normalizedRef;
  const refs = route.localItem?.catalogRefs.map(normalizeCatalogLookupRef) ?? [];
  if (normalized.includes(".search") || refs.some((ref) => ref.includes(".search"))) {
    return ["binding_review", "knowledge_lookup", "capability_matching"];
  }
  if (normalized.includes(".get") || refs.some((ref) => ref.includes(".get"))) {
    return ["binding_review", "selected_memory_readback", "capability_matching"];
  }
  if (
    normalized.includes(".store") ||
    normalized.includes(".recall") ||
    refs.some((ref) => ref.includes(".store") || ref.includes(".recall"))
  ) {
    return ["memory_candidate", "human_confirmed_local_update"];
  }
  return ["binding_review"];
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value, (_, nestedValue: unknown) => {
    if (!nestedValue || typeof nestedValue !== "object" || Array.isArray(nestedValue)) {
      return nestedValue;
    }
    return Object.keys(nestedValue as Record<string, unknown>)
      .toSorted()
      .reduce<Record<string, unknown>>((next, key) => {
        next[key] = (nestedValue as Record<string, unknown>)[key];
        return next;
      }, {});
  });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function installHintForMissingCatalogRef(catalogRef: string): CapabilityInstallHint | undefined {
  const normalizedRef = normalizeCatalogLookupRef(catalogRef);
  const prefix = refPrefix(catalogRef);
  if (isLocalKnowledgeRef(normalizedRef)) {
    return {
      source: "plugin_marketplace",
      label: "安装或启用本地知识/记忆插件",
      note: "本地知识只能通过 memory/wiki 工具输出脱敏绑定投影；没有真实工具时保持待安装。",
    };
  }
  if (prefix === "categorypack" || prefix === "skillpack") {
    const slug = `dijie-${slugFromPackRef(catalogRef)}`;
    return {
      source: "clawhub_skill",
      label: prefix === "categorypack" ? "从市场安装品类包" : "从市场安装 Skill 包",
      slug,
      command: `openclaw skills install clawhub:${slug}`,
      note: "安装必须来自 ClawHub/OpenClaw 市场的真实包；市场没有时保持待安装。",
    };
  }
  if (prefix === "toolpack" || prefix === "tool" || prefix === "plugin") {
    return {
      source: "plugin_marketplace",
      label: prefix === "toolpack" ? "安装或启用工具包" : "安装或启用工具",
      command: "openclaw plugins install <approved-plugin-spec>",
      note: "工具必须进入 tools.catalog 后才算真实可用。",
    };
  }
  if (
    prefix === "provider" ||
    prefix === "model" ||
    normalizedRef.includes("image.generate") ||
    normalizedRef.includes(".generate")
  ) {
    return {
      source: "provider_config",
      label: "配置真实 provider/API",
      note: "需要已启用的模型、API key、OAuth 或 SecretRef；不能用测试假实现通过。",
    };
  }
  return undefined;
}

function localStatusFromSkill(skill: SkillStatusEntry): LocalCapabilityStatus {
  if (skill.disabled) {
    return "disabled";
  }
  if (skill.blockedByAllowlist || skill.blockedByAgentFilter) {
    return "blocked";
  }
  if (!skill.eligible) {
    return "needs-setup";
  }
  return "available";
}

function routeStatusFromLocalStatus(status: LocalCapabilityStatus): CapabilityRouteStatus {
  if (status === "available") {
    return "available";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "disabled") {
    return "disabled";
  }
  return "needs_config";
}

function toolCatalogRefs(params: { id: string; source: string; pluginId?: string }): string[] {
  const refs = new Set<string>();
  addRef(refs, params.id);
  addRef(refs, `tool:${params.id}`);
  addRef(refs, `capability:${params.id}`);
  const dottedId = params.id.replace(/_/gu, ".");
  if (dottedId !== params.id) {
    addRef(refs, dottedId);
    addRef(refs, `tool:${dottedId}`);
    addRef(refs, `capability:${dottedId}`);
  }
  const knowledgeSuffix = params.id.match(
    /^(?:memory|wiki)_(search|get|store|recall|apply)$/u,
  )?.[1];
  if (knowledgeSuffix) {
    addRef(refs, `knowledge.${knowledgeSuffix}`);
    addRef(refs, `capability:knowledge.${knowledgeSuffix}`);
  }
  if (params.source === "plugin" && params.pluginId) {
    addRef(refs, `plugin:${params.pluginId}:${params.id}`);
  }
  return [...refs];
}

function skillCatalogRefs(skill: SkillStatusEntry): string[] {
  const refs = new Set<string>();
  addRef(refs, skill.skillKey);
  addRef(refs, `skill:${skill.skillKey}`);
  addRef(refs, skill.name);
  addRef(refs, `skill:${skill.name}`);
  if (skill.clawhub?.status === "linked" && skill.clawhub.valid) {
    addRef(refs, `${skill.clawhub.registry}:${skill.clawhub.slug}`);
    addRef(
      refs,
      `${skill.clawhub.registry}:${skill.clawhub.slug}@${skill.clawhub.installedVersion}`,
    );
    addRef(refs, `skill:${skill.clawhub.slug}`);
    addRef(refs, `skill:${skill.clawhub.slug}@${skill.clawhub.installedVersion}`);
  }
  return [...refs];
}

function pushIndexedItem(
  items: LocalCapabilityItem[],
  refIndex: Map<string, LocalCapabilityItem>,
  item: LocalCapabilityItem,
) {
  items.push(item);
  for (const ref of item.catalogRefs) {
    refIndex.set(normalizeCatalogLookupRef(ref), item);
  }
}

export function buildLocalCapabilityStore(params: {
  toolsCatalogResult: ToolsCatalogResult | null | undefined;
  skillsReport: SkillStatusReport | null | undefined;
}): LocalCapabilityStore {
  const items: LocalCapabilityItem[] = [];
  const refIndex = new Map<string, LocalCapabilityItem>();

  for (const group of params.toolsCatalogResult?.groups ?? []) {
    for (const tool of group.tools) {
      pushIndexedItem(items, refIndex, {
        kind: "tool",
        id: tool.id,
        label: tool.label,
        description: tool.description,
        source: tool.source,
        status: "available",
        risk: tool.risk ?? "unknown",
        catalogRefs: toolCatalogRefs({
          id: tool.id,
          source: tool.source,
          pluginId: tool.pluginId ?? group.pluginId,
        }),
      });
    }
  }

  for (const skill of params.skillsReport?.skills ?? []) {
    const version =
      skill.clawhub?.status === "linked" && skill.clawhub.valid
        ? skill.clawhub.installedVersion
        : undefined;
    pushIndexedItem(items, refIndex, {
      kind: "skill",
      id: skill.skillKey,
      label: skill.name,
      description: skill.description,
      source: skill.source,
      status: localStatusFromSkill(skill),
      risk: "unknown",
      catalogRefs: skillCatalogRefs(skill),
      ...(version ? { version } : {}),
    });
  }

  const summary = items.reduce<LocalCapabilitySummary>(
    (next, item) => {
      next.total += 1;
      if (item.kind === "tool") {
        next.tools += 1;
      } else {
        next.skills += 1;
      }
      if (item.status === "available") {
        next.available += 1;
      } else if (item.status === "blocked") {
        next.blocked += 1;
      } else if (item.status === "disabled") {
        next.disabled += 1;
      } else {
        next.needsSetup += 1;
      }
      if (item.status !== "available") {
        next.gated += 1;
      }
      if (item.risk === "high") {
        next.highRisk += 1;
      }
      return next;
    },
    {
      total: 0,
      tools: 0,
      skills: 0,
      available: 0,
      blocked: 0,
      disabled: 0,
      needsSetup: 0,
      gated: 0,
      highRisk: 0,
    },
  );

  return { items, refIndex, summary };
}

function uniqueCatalogRefs(
  roles: readonly CatalogRefCarrier[],
  catalogRefs: readonly string[] = [],
): string[] {
  const refs = new Set<string>();
  const seenLookupRefs = new Set<string>();
  for (const role of roles) {
    for (const ref of [
      role.categoryPackRef,
      role.skillPackRef,
      role.toolPackRef,
      ...(role.inheritedCatalogRefs ?? []),
      ...(role.catalogRefs ?? []),
      ...(role.inheritedCapabilityRefs ?? []).map((capabilityRef) =>
        normalizeCatalogLookupRef(capabilityRef).startsWith("capability:")
          ? capabilityRef
          : `capability:${capabilityRef}`,
      ),
    ]) {
      addCatalogRef(refs, seenLookupRefs, ref);
    }
  }
  for (const ref of catalogRefs) {
    addCatalogRef(refs, seenLookupRefs, ref);
  }
  return [...refs];
}

function blockedCatalogLookupRefs(roles: readonly CatalogRefCarrier[]): Set<string> {
  const refs = new Set<string>();
  for (const role of roles) {
    for (const ref of role.blockedCatalogRefs ?? []) {
      addRef(refs, normalizeCatalogLookupRef(ref));
    }
    if (
      role.callable === false &&
      role.unavailableReasons?.some((reason) => reason === "blocked_catalog_bindings")
    ) {
      for (const ref of role.catalogRefs ?? []) {
        addRef(refs, normalizeCatalogLookupRef(ref));
      }
    }
  }
  return refs;
}

function isHumanGateRef(normalized: string): boolean {
  return (
    normalized === "human.confirm" ||
    normalized === "capability:human.confirm" ||
    normalized.includes(".confirm") ||
    normalized.includes(".approve")
  );
}

function isRemoteGenerationRef(normalized: string): boolean {
  return (
    normalized.includes(".generate") ||
    normalized.includes(".video") ||
    normalized.includes(".translate") ||
    normalized.includes(".transcribe") ||
    normalized.includes(".tts") ||
    normalized.includes(".search") ||
    normalized.includes(".crawl") ||
    normalized.includes(".actor")
  );
}

function isLocalCommonCapability(normalized: string): boolean {
  return (
    /^(capability:)?(workspace|file|code|browser|document|spreadsheet|presentation|image\.inspect|network|audit)\b/u.test(
      normalized,
    ) ||
    /^(capability:)?(workboard\.task|scheduler\.cadence|human\.confirm)\b/u.test(normalized) ||
    isLocalKnowledgeRef(normalized)
  );
}

function routeForMissingCatalogRef(catalogRef: string): CapabilityRoute {
  const normalizedRef = normalizeCatalogLookupRef(catalogRef);
  const prefix = refPrefix(catalogRef);
  const base = {
    catalogRef,
    normalizedRef,
    label: labelFromRef(catalogRef),
    risk: "unknown" as const,
  };

  if (prefix === "api" || prefix === "service" || prefix === "webhook") {
    return {
      ...base,
      kind: "remote_api",
      status: "needs_config",
      source: "remote",
      installHint: installHintForMissingCatalogRef(catalogRef),
    };
  }
  if (prefix === "mcp") {
    return { ...base, kind: "remote_mcp", status: "needs_auth", source: "remote" };
  }
  if (prefix === "provider" || prefix === "model") {
    return {
      ...base,
      kind: "provider_capability",
      status: "needs_config",
      source: "remote",
      installHint: installHintForMissingCatalogRef(catalogRef),
    };
  }
  if (isHumanGateRef(normalizedRef)) {
    return { ...base, kind: "human_gate", status: "available", source: "policy", risk: "medium" };
  }
  if (prefix === "categorypack") {
    return {
      ...base,
      kind: "category_pack",
      status: "can_install",
      source: "catalog",
      installHint: installHintForMissingCatalogRef(catalogRef),
    };
  }
  if (prefix === "skillpack") {
    return {
      ...base,
      kind: "skill_pack",
      status: "can_install",
      source: "catalog",
      installHint: installHintForMissingCatalogRef(catalogRef),
    };
  }
  if (prefix === "toolpack") {
    return {
      ...base,
      kind: "tool_pack",
      status: "can_install",
      source: "catalog",
      installHint: installHintForMissingCatalogRef(catalogRef),
    };
  }
  if (prefix === "tool" || prefix === "skill" || prefix === "clawhub" || prefix === "plugin") {
    return {
      ...base,
      kind: prefix === "skill" || prefix === "clawhub" ? "local_skill" : "local_tool",
      status: "can_install",
      source: "catalog",
      installHint: installHintForMissingCatalogRef(catalogRef),
    };
  }
  if (isRemoteGenerationRef(normalizedRef)) {
    return {
      ...base,
      kind: "remote_api",
      status: "needs_config",
      source: "remote",
      installHint: installHintForMissingCatalogRef(catalogRef),
    };
  }
  if (isLocalCommonCapability(normalizedRef)) {
    return {
      ...base,
      kind: "local_tool",
      status: "can_install",
      source: "catalog",
      installHint: installHintForMissingCatalogRef(catalogRef),
    };
  }
  return { ...base, kind: "unsupported", status: "unsupported", source: "catalog" };
}

function routeForCatalogRef(
  store: LocalCapabilityStore,
  catalogRef: string,
  blockedRefs: ReadonlySet<string>,
): CapabilityRoute {
  const normalizedRef = normalizeCatalogLookupRef(catalogRef);
  const localItem = store.refIndex.get(normalizedRef);
  if (blockedRefs.has(normalizedRef)) {
    const fallback = localItem
      ? {
          catalogRef,
          normalizedRef,
          label: localItem.label,
          kind: localItem.kind === "skill" ? ("local_skill" as const) : ("local_tool" as const),
          risk: localItem.risk,
          source: "local" as const,
          localItem,
        }
      : routeForMissingCatalogRef(catalogRef);
    return {
      ...fallback,
      status: "blocked",
      source: fallback.source === "local" ? "local" : "catalog",
    };
  }
  if (!localItem) {
    return routeForMissingCatalogRef(catalogRef);
  }
  return {
    catalogRef,
    normalizedRef,
    label: localItem.label,
    kind: localItem.kind === "skill" ? "local_skill" : "local_tool",
    status: routeStatusFromLocalStatus(localItem.status),
    risk: localItem.risk,
    source: "local",
    localItem,
  };
}

function summarizeRoutes(routes: readonly CapabilityRoute[]): CapabilityRoutingSummary {
  const summary: CapabilityRoutingSummary = {
    total: routes.length,
    available: 0,
    categoryPacks: 0,
    skillPacks: 0,
    toolPacks: 0,
    local: 0,
    remoteApi: 0,
    remoteMcp: 0,
    provider: 0,
    humanGate: 0,
    canInstall: 0,
    needsConfig: 0,
    needsAuth: 0,
    gated: 0,
    unsupported: 0,
  };
  for (const route of routes) {
    if (route.status === "available") {
      summary.available += 1;
    }
    if (route.kind === "category_pack") {
      summary.categoryPacks += 1;
    } else if (route.kind === "skill_pack") {
      summary.skillPacks += 1;
    } else if (route.kind === "tool_pack") {
      summary.toolPacks += 1;
    } else if (route.kind === "local_tool" || route.kind === "local_skill") {
      summary.local += 1;
    } else if (route.kind === "remote_api") {
      summary.remoteApi += 1;
    } else if (route.kind === "remote_mcp") {
      summary.remoteMcp += 1;
    } else if (route.kind === "provider_capability") {
      summary.provider += 1;
    } else if (route.kind === "human_gate") {
      summary.humanGate += 1;
    } else {
      summary.unsupported += 1;
    }
    if (route.status === "can_install") {
      summary.canInstall += 1;
    }
    if (route.status === "needs_config") {
      summary.needsConfig += 1;
    }
    if (route.status === "needs_auth") {
      summary.needsAuth += 1;
    }
    if (
      route.status === "blocked" ||
      route.status === "disabled" ||
      route.risk === "high" ||
      route.kind === "human_gate"
    ) {
      summary.gated += 1;
    }
  }
  return summary;
}

export function buildCapabilityRoutingProjection(params: {
  roles: readonly CatalogRefCarrier[];
  catalogRefs?: readonly string[];
  toolsCatalogResult: ToolsCatalogResult | null | undefined;
  skillsReport: SkillStatusReport | null | undefined;
}): CapabilityRoutingProjection {
  const localStore = buildLocalCapabilityStore({
    toolsCatalogResult: params.toolsCatalogResult,
    skillsReport: params.skillsReport,
  });
  const blockedRefs = blockedCatalogLookupRefs(params.roles);
  const routes = uniqueCatalogRefs(params.roles, params.catalogRefs).map((ref) =>
    routeForCatalogRef(localStore, ref, blockedRefs),
  );
  return {
    localStore,
    routes,
    summary: summarizeRoutes(routes),
  };
}

export function buildLocalKnowledgeSafeBindingExport(params: {
  routes: readonly CapabilityRoute[];
  categoryRef?: string | null;
  categoryPackRef?: string | null;
}): LocalKnowledgeSafeBindingExport {
  const projections: LocalKnowledgeSafeBindingProjection[] = [];
  const omittedRoutes: LocalKnowledgeSafeBindingOmission[] = [];

  for (const route of params.routes.filter(isLocalKnowledgeRoute)) {
    if (route.status !== "available" || !route.localItem) {
      omittedRoutes.push({
        catalogRef: route.catalogRef,
        status: route.status,
        reason:
          route.status === "can_install"
            ? "local knowledge tool is not installed or enabled"
            : "local knowledge route is not available",
      });
      continue;
    }

    const projectionWithoutHash = {
      schemaVersion: "aics.local_knowledge_binding.v1" as const,
      knowledgeRef: route.normalizedRef,
      catalogRef: route.catalogRef,
      localCapabilityId: route.localItem.id,
      label: route.label,
      sourceType: detectLocalKnowledgeSourceType(route),
      version: route.localItem.version ?? "local",
      capabilitySummary: [
        `${route.label} exposes ${route.normalizedRef} as a local knowledge capability.`,
        "Only binding metadata is exported; local memory content and workspace materials stay local.",
      ],
      riskSummary: [
        `route risk: ${route.risk}`,
        "Cloud review may approve the knowledge/capability reference, not direct database access.",
      ],
      applicableScopes: knowledgeApplicableScopes(route),
      reviewRecommendation:
        route.risk === "high" ? "manual_review_required" : "review_binding_projection_only",
      routeStatus: "available" as const,
    };

    projections.push({
      ...projectionWithoutHash,
      hash: stableHash(projectionWithoutHash),
    });
  }

  return {
    schemaVersion: "aics.local_knowledge_binding_export.v1",
    ...(params.categoryRef?.trim() ? { categoryRef: params.categoryRef.trim() } : {}),
    ...(params.categoryPackRef?.trim() ? { categoryPackRef: params.categoryPackRef.trim() } : {}),
    projections,
    omittedRoutes,
    forbiddenFields: [...LOCAL_KNOWLEDGE_BINDING_FORBIDDEN_FIELDS],
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function refsFromPackRole(role: CatalogRefCarrier): string[] {
  const refs = new Set<string>();
  const seenLookupRefs = new Set<string>();
  for (const ref of [
    role.categoryPackRef,
    role.skillPackRef,
    role.toolPackRef,
    ...(role.inheritedCatalogRefs ?? []),
    ...(role.catalogRefs ?? []),
    ...(role.inheritedCapabilityRefs ?? []).map((capabilityRef) =>
      normalizeCatalogLookupRef(capabilityRef).startsWith("capability:")
        ? capabilityRef
        : `capability:${capabilityRef}`,
    ),
  ]) {
    addCatalogRef(refs, seenLookupRefs, ref);
  }
  return [...refs];
}

function findCatalogRefByPrefix(refs: readonly string[], prefix: string): string | undefined {
  return refs.find((ref) => refPrefix(ref) === prefix);
}

function uniqueCapabilityRefs(refs: readonly string[]): string[] {
  const capabilities = new Set<string>();
  for (const ref of refs) {
    const normalized = normalizeCatalogLookupRef(ref);
    if (normalized.startsWith("capability:")) {
      addRef(capabilities, refBody(normalized));
    } else if (!refPrefix(normalized) && normalized.includes(".")) {
      addRef(capabilities, normalized);
    }
  }
  return [...capabilities];
}

export function buildCapabilityCategoryPackProjection(params: {
  roles: readonly CatalogRefCarrier[];
  routes: readonly CapabilityRoute[];
  selectedCategoryRef?: string | null;
}): CapabilityCategoryPackProjection {
  const routeByRef = new Map(params.routes.map((route) => [route.normalizedRef, route]));
  const packs = new Map<string, CapabilityCategoryPack>();

  for (const role of params.roles) {
    const roleRefs = refsFromPackRole(role);
    const categoryPackRef = firstString(
      role.categoryPackRef,
      findCatalogRefByPrefix(roleRefs, "categorypack"),
    );
    if (!categoryPackRef) {
      continue;
    }
    const categoryRef =
      firstString(role.categoryRef) ?? `category:${slugFromPackRef(categoryPackRef)}`;
    const skillPackRef =
      firstString(role.skillPackRef, findCatalogRefByPrefix(roleRefs, "skillpack")) ?? undefined;
    const toolPackRef =
      firstString(role.toolPackRef, findCatalogRefByPrefix(roleRefs, "toolpack")) ?? undefined;
    const existing = packs.get(categoryRef);
    const catalogRefs = new Set(existing?.catalogRefs ?? []);
    for (const ref of roleRefs) {
      addRef(catalogRefs, ref);
    }
    const routes = [...catalogRefs]
      .map((ref) => routeByRef.get(normalizeCatalogLookupRef(ref)))
      .filter((route): route is CapabilityRoute => Boolean(route));
    const summary = summarizeRoutes(routes);
    packs.set(categoryRef, {
      categoryRef,
      categoryName:
        firstString(role.categoryName, existing?.categoryName) ?? labelFromRef(categoryRef),
      categoryPackRef,
      ...(skillPackRef ? { skillPackRef } : {}),
      ...(toolPackRef ? { toolPackRef } : {}),
      sourceRoleIds: Array.from(
        new Set([
          ...(existing?.sourceRoleIds ?? []),
          firstString((role as { id?: string }).id) ?? categoryRef,
        ]),
      ),
      catalogRefs: [...catalogRefs],
      capabilityRefs: uniqueCapabilityRefs([...catalogRefs]),
      routes,
      summary,
      preflight: buildCapabilityPreflight(routes),
    });
  }

  const packList = [...packs.values()].toSorted((left, right) =>
    left.categoryName.localeCompare(right.categoryName),
  );
  const selectedCategoryRef =
    firstString(params.selectedCategoryRef) && packs.has(params.selectedCategoryRef!.trim())
      ? params.selectedCategoryRef!.trim()
      : packList[0]?.categoryRef;
  const selectedPack = selectedCategoryRef ? packs.get(selectedCategoryRef) : undefined;
  return {
    packs: packList,
    ...(selectedCategoryRef ? { selectedCategoryRef } : {}),
    ...(selectedPack ? { selectedPack } : {}),
  };
}

export function buildCapabilityPreflight(routes: readonly CapabilityRoute[]): CapabilityPreflight {
  const blockingRoutes = routes.filter(
    (route) =>
      route.status === "blocked" ||
      route.status === "disabled" ||
      route.status === "unsupported" ||
      route.status === "needs_config" ||
      route.status === "needs_auth",
  );
  const installableRoutes = routes.filter((route) => route.status === "can_install");
  const reviewRoutes = routes.filter(
    (route) => route.kind === "human_gate" || route.risk === "high",
  );

  if (blockingRoutes.some((route) => route.status === "unsupported")) {
    return {
      status: "blocked",
      label: "存在不可用能力",
      nextAction: "替换岗位能力引用或接入可用的远程能力。",
      routes: [...routes],
      blockingRoutes,
      installableRoutes,
      reviewRoutes,
    };
  }
  if (blockingRoutes.some((route) => route.status === "blocked")) {
    return {
      status: "blocked",
      label: "能力被阻断",
      nextAction: "先处理云端目录审核、本地策略或岗位能力绑定阻塞。",
      routes: [...routes],
      blockingRoutes,
      installableRoutes,
      reviewRoutes,
    };
  }
  if (blockingRoutes.some((route) => route.status === "needs_auth")) {
    return {
      status: "needs_auth",
      label: "等待授权",
      nextAction: "完成 OAuth、MCP 或远程服务授权后再启动岗位执行。",
      routes: [...routes],
      blockingRoutes,
      installableRoutes,
      reviewRoutes,
    };
  }
  if (blockingRoutes.length || installableRoutes.length) {
    return {
      status: "needs_setup",
      label: "待配置能力",
      nextAction: "安装通用本地能力，或配置 API key、provider、远程 MCP。",
      routes: [...routes],
      blockingRoutes,
      installableRoutes,
      reviewRoutes,
    };
  }
  if (reviewRoutes.length) {
    return {
      status: "needs_review",
      label: "需要人工确认",
      nextAction: "确认高风险动作、产物验收标准和权限边界后执行。",
      routes: [...routes],
      blockingRoutes,
      installableRoutes,
      reviewRoutes,
    };
  }
  return {
    status: "ready",
    label: "能力就绪",
    nextAction: "可以进入岗位任务分诊或执行。",
    routes: [...routes],
    blockingRoutes,
    installableRoutes,
    reviewRoutes,
  };
}
