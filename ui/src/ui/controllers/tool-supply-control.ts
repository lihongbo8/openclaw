import type { AppViewState } from "../app-view-state.ts";

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
  grants: Array<{
    id: string;
    capabilityRef: string;
    status: "approved" | "blocked" | "pending_review";
    reason?: string;
  }>;
  bindings: ToolSupplyBinding[];
  uniqueCapabilityRequests: Array<{
    id: string;
    title: string;
    capabilityRef: string;
    status: string;
    category?: string;
    reason?: string;
  }>;
  resolutions?: Array<{
    categoryCapabilityId: string;
    category: string;
    allowedTools: string[];
    allowedSkills: string[];
    dispatchReady: boolean;
    blockedReasons: string[];
  }>;
  systemDevelopmentTodos?: Array<{
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
  }>;
};

export type ToolSupplyControlItem = {
  id: string;
  label: string;
  description?: string;
  kind: "core_tool" | "plugin_tool" | "skill" | "api_connection" | "cloud_capability";
  source: "openclaw" | "plugin" | "skill" | "api_connections" | "cloud_marketplace";
  status: "available" | "blocked" | "disabled" | "needs_setup" | "pending_review";
  risk: "low" | "medium" | "high" | "unknown";
  blockedReasons: string[];
  grantStatus?: "approved" | "blocked" | "pending_review";
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

export type ToolSupplyBinding = {
  id: string;
  sourceItemId: string;
  sourceKind: "tool" | "skill";
  targetKind: "category_capability" | "role_dispatch";
  targetId: string;
  targetTitle?: string;
  status: "active" | "paused";
  syncStatus?: "local" | "syncing" | "synced" | "sync_failed";
  note?: string;
};

export type ToolSupplyCategoryCapabilityPackage = {
  category: ToolSupplyCloudCategory;
  skills: ToolSupplyControlItem[];
  tools: ToolSupplyControlItem[];
  roleUsageCount: number;
};

export type ToolSupplyRiskItem = {
  id: string;
  label: string;
  targetKind: ToolSupplyControlItem["kind"];
  severity: "blocking" | "warning" | "info";
  reason: string;
  message: string;
};

export type ToolSupplyControlPageState = {
  loading: boolean;
  saving: boolean;
  error: string | null;
  message: string | null;
  readModel: ToolSupplyControlReadModel | null;
};

export type ToolSupplyControlSystemDevelopmentTodo = NonNullable<
  ToolSupplyControlReadModel["systemDevelopmentTodos"]
>[number];

export function createDefaultToolSupplyControlState(): ToolSupplyControlPageState {
  return {
    loading: false,
    saving: false,
    error: null,
    message: null,
    readModel: null,
  };
}

function requestUpdate(state: AppViewState): void {
  (
    state as unknown as { requestUpdate?: () => void; requestHostUpdate?: () => void }
  ).requestHostUpdate?.();
  (
    state as unknown as { requestUpdate?: () => void; requestHostUpdate?: () => void }
  ).requestUpdate?.();
}

export async function refreshToolSupplyControlReadModel(state: AppViewState): Promise<void> {
  state.toolSupplyControl = { ...state.toolSupplyControl, loading: true, error: null };
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("Gateway client is not connected.");
    const readModel = await state.client.request<ToolSupplyControlReadModel>(
      "aics.toolSupply.readModel.get",
      {},
    );
    state.toolSupplyControl = {
      ...state.toolSupplyControl,
      loading: false,
      readModel,
      error: null,
    };
  } catch (err) {
    state.toolSupplyControl = {
      ...state.toolSupplyControl,
      loading: false,
      error: err instanceof Error ? err.message : "工具供给读取失败",
    };
  }
  requestUpdate(state);
}

async function runToolSupplyMutation(
  state: AppViewState,
  message: string,
  run: () => Promise<void>,
): Promise<void> {
  state.toolSupplyControl = {
    ...state.toolSupplyControl,
    saving: true,
    error: null,
    message: null,
  };
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("Gateway client is not connected.");
    await run();
    await refreshToolSupplyControlReadModel(state);
    state.toolSupplyControl = { ...state.toolSupplyControl, saving: false, message };
  } catch (err) {
    state.toolSupplyControl = {
      ...state.toolSupplyControl,
      saving: false,
      error: err instanceof Error ? err.message : "工具供给更新失败",
    };
  }
  requestUpdate(state);
}

export async function runToolSkillDevelopmentValidation(
  state: AppViewState,
  todo: ToolSupplyControlSystemDevelopmentTodo,
): Promise<void> {
  await runToolSupplyMutation(state, "工具/Skill 开发检查已执行。", async () => {
    await state.client!.request("aics.toolSkillDevelopment.runValidation", {
      taskId: todo.id,
      assetType: todo.assetType,
      assetId: todo.assetId,
      source: todo.source,
      declaredCapabilities: todo.declaredCapabilities,
    });
  });
}

export async function planToolSkillDevelopmentSource(
  state: AppViewState,
  todo: ToolSupplyControlSystemDevelopmentTodo,
): Promise<void> {
  await runToolSupplyMutation(state, "工具/Skill 开发路线已生成。", async () => {
    await state.client!.request("aics.toolSkillDevelopment.source.plan", {
      taskId: todo.id,
      assetType: todo.assetType,
      assetId: todo.assetId,
      source: todo.source,
      declaredCapabilities: todo.declaredCapabilities,
    });
  });
}

export async function selectToolSkillDevelopmentSource(
  state: AppViewState,
  todo: ToolSupplyControlSystemDevelopmentTodo,
  selectedSource: string,
): Promise<void> {
  await runToolSupplyMutation(state, "工具/Skill 开发来源已选择。", async () => {
    await state.client!.request("aics.toolSkillDevelopment.source.select", {
      taskId: todo.id,
      assetType: todo.assetType,
      assetId: todo.assetId,
      source: todo.source,
      selectedSource,
      declaredCapabilities: todo.declaredCapabilities,
    });
  });
}

export async function markToolSkillDevelopmentRuntimeReady(
  state: AppViewState,
  todo: ToolSupplyControlSystemDevelopmentTodo,
): Promise<void> {
  await runToolSupplyMutation(state, "工具/Skill 运行实现已标记就绪。", async () => {
    await state.client!.request("aics.toolSkillDevelopment.runtime.markReady", {
      taskId: todo.id,
      assetType: todo.assetType,
      assetId: todo.assetId,
      source: todo.source,
      declaredCapabilities: todo.declaredCapabilities,
    });
  });
}

export async function setToolSupplyGrant(
  state: AppViewState,
  item: ToolSupplyControlItem,
  status: "approved" | "blocked" | "pending_review",
): Promise<void> {
  await runToolSupplyMutation(state, "本地管控状态已更新。", async () => {
    await state.client!.request("aics.toolSupply.grant.set", {
      capabilityRef: item.id,
      targetKind:
        item.kind === "skill"
          ? "skill"
          : item.kind === "api_connection"
            ? "api"
            : item.kind === "cloud_capability"
              ? "cloud_capability"
              : "tool",
      targetId: item.skillKey ?? item.pluginId ?? item.id,
      status,
    });
  });
}

export async function syncToolSupplyCategories(state: AppViewState): Promise<void> {
  await runToolSupplyMutation(state, "云端品类已同步。", async () => {
    await state.client!.request("aics.toolSupply.categories.sync", {});
  });
}

export async function createToolSupplyCategory(state: AppViewState, name: string): Promise<void> {
  await runToolSupplyMutation(state, "云端品类已创建。", async () => {
    await state.client!.request("aics.toolSupply.category.create", { name });
  });
}

export async function saveToolSupplyCategorySelection(
  state: AppViewState,
  params: {
    categoryId: string;
    categoryTitle: string;
    sourceKind: "tool" | "skill";
    selectedItemIds: string[];
  },
): Promise<void> {
  await runToolSupplyMutation(state, "品类组合已保存。", async () => {
    const currentBindings =
      state.toolSupplyControl.readModel?.bindings.filter(
        (binding) =>
          binding.targetKind === "category_capability" &&
          binding.targetId === params.categoryId &&
          binding.sourceKind === params.sourceKind,
      ) ?? [];
    const nextSelected = new Set(params.selectedItemIds);
    const currentActiveByItemId = new Map(
      currentBindings
        .filter((binding) => binding.status === "active")
        .map((binding) => [binding.sourceItemId, binding]),
    );
    const requests: Array<Promise<unknown>> = [];
    for (const itemId of nextSelected) {
      if (currentActiveByItemId.has(itemId)) continue;
      requests.push(
        state.client!.request("aics.toolSupply.binding.set", {
          sourceItemId: itemId,
          sourceKind: params.sourceKind,
          targetKind: "category_capability",
          targetId: params.categoryId,
          targetTitle: params.categoryTitle,
          status: "active",
          syncStatus: "local",
        }),
      );
    }
    for (const binding of currentBindings) {
      if (nextSelected.has(binding.sourceItemId)) continue;
      requests.push(state.client!.request("aics.toolSupply.binding.remove", { id: binding.id }));
    }
    await Promise.all(requests);
  });
}

export async function syncToolSupplyBinding(state: AppViewState, id: string): Promise<void> {
  await runToolSupplyMutation(state, "绑定关系已同步云端。", async () => {
    await state.client!.request("aics.toolSupply.binding.sync", { id, syncStatus: "synced" });
  });
}

export async function activateToolSupplyCategoryCapabilityPackage(
  state: AppViewState,
  categoryCapabilityReviewId: string,
): Promise<void> {
  await runToolSupplyMutation(state, "正式品类能力包已激活，开发者中心可刷新后绑定。", async () => {
    await state.client!.request("aics.toolSupply.categoryCapability.activateReadyPackage", {
      categoryCapabilityReviewId,
    });
  });
}

export async function setToolSupplySkillEnabled(
  state: AppViewState,
  skillKey: string,
  enabled: boolean,
): Promise<void> {
  await runToolSupplyMutation(state, enabled ? "Skill 已启用。" : "Skill 已禁用。", async () => {
    await state.client!.request("aics.toolSupply.skill.setEnabled", { skillKey, enabled });
  });
  await state.refreshAicsMarketplaceRoles?.();
}

export async function uninstallToolSupplySkill(
  state: AppViewState,
  skillKey: string,
): Promise<void> {
  await runToolSupplyMutation(state, "Skill 已卸载。", async () => {
    await state.client!.request("aics.toolSupply.skill.uninstall", { skillKey });
  });
  await state.refreshAicsMarketplaceRoles?.();
}

export async function setToolSupplyPluginEnabled(
  state: AppViewState,
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  await runToolSupplyMutation(
    state,
    enabled ? "插件工具已启用。" : "插件工具已禁用。",
    async () => {
      await state.client!.request("aics.toolSupply.plugin.setEnabled", { pluginId, enabled });
    },
  );
}

export async function uninstallToolSupplyPlugin(
  state: AppViewState,
  pluginId: string,
): Promise<void> {
  await runToolSupplyMutation(state, "插件工具已卸载。", async () => {
    await state.client!.request("aics.toolSupply.plugin.uninstall", { pluginId });
  });
}

export async function prepareToolSupplyUniqueCapabilityRequest(
  state: AppViewState,
  params: { title: string; capabilityRef: string; category?: string; reason?: string },
): Promise<void> {
  await runToolSupplyMutation(state, "品类能力申请已提交审核中心。", async () => {
    await state.client!.request("aics.toolSupply.uniqueCapabilityRequest.prepare", params);
    await state.client!.request("aics.categoryCapabilityRequest.create", {
      title: params.title,
      categoryName: params.category || params.title,
      categoryRef: params.capabilityRef.startsWith("category:") ? params.capabilityRef : undefined,
      requiredCapabilities: params.capabilityRef ? [params.capabilityRef] : [],
      toolSkillRequirements: params.capabilityRef ? [params.capabilityRef] : [],
      reason: params.reason,
    });
  });
}
