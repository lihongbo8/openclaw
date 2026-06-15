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
  risks: ToolSupplyRiskItem[];
  grants: Array<{
    id: string;
    capabilityRef: string;
    status: "approved" | "blocked" | "pending_review";
    reason?: string;
  }>;
  uniqueCapabilityRequests: Array<{
    id: string;
    title: string;
    capabilityRef: string;
    status: string;
    category?: string;
    reason?: string;
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

export async function prepareToolSupplyUniqueCapabilityRequest(
  state: AppViewState,
  params: { title: string; capabilityRef: string; category?: string; reason?: string },
): Promise<void> {
  await runToolSupplyMutation(state, "独特能力申请草稿已准备。", async () => {
    await state.client!.request("aics.toolSupply.uniqueCapabilityRequest.prepare", params);
  });
}
