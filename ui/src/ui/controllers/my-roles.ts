import type { AppViewState } from "../app-view-state.js";
import { aicsMainFlow } from "./aics-main-flow.js";

export type MyRolesPageState = {
  loading: boolean;
  runningExecutionId: string | null;
  error: string | null;
  message: string | null;
  readModel: Record<string, unknown> | null;
  viewMode: "queue" | "artifacts";
  query: string;
  statusFilter: string;
  capabilityFilter: string | null;
  selectedRoleKey: string | null;
  detailTab: "overview" | "steps" | "artifacts" | "boundary";
  artifactPreviews: Record<string, RoleArtifactPreview>;
};

export type RoleArtifactPreview = {
  ok: boolean;
  executionId: string;
  ref: string;
  name: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl?: string;
  error?: string;
};

export function createDefaultMyRolesState(): MyRolesPageState {
  return {
    loading: false,
    runningExecutionId: null,
    error: null,
    message: null,
    readModel: null,
    viewMode: "queue",
    query: "",
    statusFilter: "all",
    capabilityFilter: null,
    selectedRoleKey: null,
    detailTab: "overview",
    artifactPreviews: {},
  };
}

let refreshSeq = 0;

function requestUpdate(state: AppViewState): void {
  (
    state as unknown as { requestUpdate?: () => void; requestHostUpdate?: () => void }
  ).requestHostUpdate?.();
  (
    state as unknown as { requestUpdate?: () => void; requestHostUpdate?: () => void }
  ).requestUpdate?.();
}

function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapReadModel(value: unknown): Record<string, unknown> {
  const outer = record(value) ?? {};
  const nested = record(outer.readModel);
  return nested ?? outer;
}

function rolesFromReadModel(value: Record<string, unknown>): Array<Record<string, unknown>> {
  const directRoles = Array.isArray(value.roles) ? value.roles : [];
  const roleAssets = Array.isArray(value.roleAssets) ? value.roleAssets : [];
  return [...directRoles, ...roleAssets].filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function humanReadableReasons(value: unknown): string {
  if (Array.isArray(value)) {
    const reasons = value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const record = item as Record<string, unknown>;
          return text(record.message) || text(record.code) || text(record.reason);
        }
        return "";
      })
      .filter(Boolean);
    return reasons.join("；");
  }
  return "";
}

function previewKey(executionId: string, ref: string): string {
  return `${executionId}::${ref}`;
}

function artifactRefsFromExecution(execution: Record<string, unknown>): string[] {
  const refs = Array.isArray(execution.artifactRefs)
    ? execution.artifactRefs.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
  return refs.filter((ref) => isBusinessArtifactRef(ref) && isPreviewableArtifactRef(ref));
}

function isBusinessArtifactRef(ref: string): boolean {
  return (
    !ref.startsWith("audit:") && !ref.startsWith("ledger:") && !ref.startsWith("memory_candidate:")
  );
}

function isPreviewableArtifactRef(ref: string): boolean {
  return !/^(external_record|external|record|artifact):/iu.test(ref);
}

function executionIdForArtifacts(execution: Record<string, unknown>): string {
  const result = record(execution.result);
  return text(result?.id) || text(execution.executionId) || text(execution.id);
}

async function hydrateArtifactPreviews(
  state: AppViewState,
  pageState: MyRolesPageState,
): Promise<void> {
  if (!state.client || !pageState.readModel) return;
  const executions = Array.isArray(pageState.readModel.executions)
    ? pageState.readModel.executions.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const targets = executions.flatMap((execution) => {
    const executionId = executionIdForArtifacts(execution);
    if (!executionId) return [];
    return artifactRefsFromExecution(execution).map((ref) => ({ executionId, ref }));
  });
  for (const target of targets) {
    const key = previewKey(target.executionId, target.ref);
    if (pageState.artifactPreviews[key]) continue;
    try {
      const payload = await state.client.request<Record<string, unknown>>(
        "aics.execution.artifact.get",
        {
          executionId: target.executionId,
          artifactRef: target.ref,
        },
      );
      const artifact = record(payload.artifact);
      const dataUrl = text(artifact?.dataUrl);
      pageState.artifactPreviews[key] = {
        ok: payload.ok === true,
        executionId: target.executionId,
        ref: target.ref,
        name: text(artifact?.name) || target.ref.split("/").pop() || "artifact",
        kind: text(artifact?.kind),
        mimeType: text(artifact?.mimeType),
        sizeBytes: typeof artifact?.sizeBytes === "number" ? artifact.sizeBytes : 0,
        ...(dataUrl ? { dataUrl } : {}),
        ...(payload.ok === true
          ? {}
          : { error: humanReadableReasons(payload.blockedReasons) || "产物读取失败" }),
      };
    } catch (error) {
      pageState.artifactPreviews[key] = {
        ok: false,
        executionId: target.executionId,
        ref: target.ref,
        name: target.ref.split("/").pop() || "artifact",
        kind: "",
        mimeType: "",
        sizeBytes: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function selectedModelLabel(state: AppViewState, execution: Record<string, unknown>): string {
  const summary = record(record(state.myRoles?.readModel)?.summary);
  const selectedModelRef = record(execution.selectedModelRef) ?? record(summary?.selectedModelRef);
  const provider = text(selectedModelRef?.provider);
  const model = text(selectedModelRef?.model);
  if (provider || model) return `${provider || "model"} / ${model || "未选模型"}`;
  return "API 管理已绑定的岗位执行模型";
}

function confirmRealRoleExecution(
  state: AppViewState,
  execution: Record<string, unknown>,
): boolean {
  const confirmFn = globalThis.window?.confirm;
  if (typeof confirmFn !== "function") return true;
  const roleTitle = text(execution.roleTitle) || "未命名岗位";
  const taskTitle = text(execution.title) || text(execution.taskText) || "未命名任务";
  const hasLedgerRef = Boolean(text(execution.ledgerRef));
  const message = [
    "将调用 API 管理里已绑定的真实模型、工具或 Skill 执行岗位任务，可能产生 API 费用。",
    "系统会按派发单要求生成业务结果、执行摘要和可读产物。",
    "",
    `岗位：${roleTitle}`,
    `任务：${taskTitle}`,
    `执行连接：${selectedModelLabel(state, execution)}`,
    `费用凭证：${hasLedgerRef ? "已生成" : "未生成"}`,
    "",
    "执行成功后会自动检查业务产物、执行摘要、审计记录和账本记录。",
    "缺任一项都不会报成功，会显示阻塞原因。",
    "",
    "确认继续？",
  ].join("\n");
  try {
    return confirmFn.call(globalThis.window, message) !== false;
  } catch {
    return true;
  }
}

function selectAuthorizedExecutionContext(
  state: AppViewState,
  execution: Record<string, unknown>,
): { roleListingId: string; entitlementId: string } | null {
  const executionRoleListingId = text(execution.roleListingId);
  const formRoleListingId = text(state.aicsRoleBuilder?.form?.roleListingId);
  const formEntitlementId = text(state.aicsRoleBuilder?.form?.entitlementId);
  if (
    formRoleListingId &&
    formEntitlementId &&
    (!executionRoleListingId || executionRoleListingId === formRoleListingId)
  ) {
    return { roleListingId: formRoleListingId, entitlementId: formEntitlementId };
  }
  const roles = state.aicsMarketplace?.roles ?? [];
  const exact = executionRoleListingId
    ? roles.find(
        (role) => (role.roleListingId || role.id) === executionRoleListingId && role.entitlementId,
      )
    : undefined;
  const fallback = executionRoleListingId ? undefined : roles.find((role) => role.entitlementId);
  const selected = exact ?? fallback;
  if (selected?.entitlementId) {
    return {
      roleListingId: selected.roleListingId || selected.id,
      entitlementId: selected.entitlementId,
    };
  }

  const readModel = state.myRoles?.readModel as Record<string, unknown> | null | undefined;
  const roleAssets = readModel ? rolesFromReadModel(readModel) : [];
  const exactAsset = executionRoleListingId
    ? roleAssets.find(
        (role) =>
          text(role.roleListingId) === executionRoleListingId &&
          text(role.entitlementStatus) === "authorized" &&
          text(role.entitlementId),
      )
    : undefined;
  const fallbackAsset = roleAssets.find(
    (role) =>
      !executionRoleListingId &&
      text(role.entitlementStatus) === "authorized" &&
      text(role.entitlementId),
  );
  const selectedAsset = exactAsset ?? fallbackAsset;
  const assetRoleListingId = text(selectedAsset?.roleListingId);
  const assetEntitlementId = text(selectedAsset?.entitlementId);
  return assetRoleListingId && assetEntitlementId
    ? { roleListingId: assetRoleListingId, entitlementId: assetEntitlementId }
    : null;
}

export async function refreshMyRolesReadModel(
  state: AppViewState,
  pageState: MyRolesPageState,
): Promise<void> {
  const seq = ++refreshSeq;
  pageState.loading = true;
  pageState.error = null;
  pageState.message = null;
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("未连接");
    const [executionConsole, roleAssets] = await Promise.all([
      state.client.request("aics.executionConsole.readModel.get", {}),
      state.client.request("aics.roles.mine.readModel.get", {}).catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
        roles: [],
      })),
    ]);
    if (seq !== refreshSeq) return;
    const executionRecord =
      executionConsole && typeof executionConsole === "object" && !Array.isArray(executionConsole)
        ? (executionConsole as Record<string, unknown>)
        : {};
    const roleAssetRecord = unwrapReadModel(roleAssets);
    pageState.readModel = {
      ...executionRecord,
      roleAssets: rolesFromReadModel(roleAssetRecord),
      roleAssetsSummary: roleAssetRecord.summary ?? null,
      roleAssetsError: roleAssetRecord.error ?? record(roleAssets)?.error ?? null,
    };
    await hydrateArtifactPreviews(state, pageState);
  } catch (err) {
    if (seq !== refreshSeq) return;
    pageState.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (seq !== refreshSeq) return;
    pageState.loading = false;
    requestUpdate(state);
  }
}

export async function repairRoleInstanceStore(
  state: AppViewState,
  pageState: MyRolesPageState,
): Promise<void> {
  pageState.loading = true;
  pageState.error = null;
  pageState.message = null;
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("未连接");
    const result = await state.client.request<Record<string, unknown>>(
      "aics.roles.instanceStore.repair",
      {},
    );
    const readModel = record(result.readModel);
    if (readModel) {
      pageState.readModel = {
        ...((pageState.readModel ?? {}) as Record<string, unknown>),
        ...readModel,
        roleAssets: rolesFromReadModel(readModel),
        roleAssetsSummary: readModel.summary ?? null,
      };
    }
  } catch (err) {
    pageState.error = err instanceof Error ? err.message : String(err);
  } finally {
    pageState.loading = false;
    requestUpdate(state);
  }
}

export function setViewMode(ps: MyRolesPageState, mode: MyRolesPageState["viewMode"]): void {
  ps.viewMode = mode;
}

export function setQuery(ps: MyRolesPageState, q: string): void {
  ps.query = q;
}

export function setStatusFilter(ps: MyRolesPageState, f: string): void {
  ps.statusFilter = f;
}

export function selectRole(ps: MyRolesPageState, key: string): void {
  ps.selectedRoleKey = key;
  ps.detailTab = "overview";
}

export function closeDetail(ps: MyRolesPageState): void {
  ps.selectedRoleKey = null;
}

export function setDetailTab(ps: MyRolesPageState, tab: MyRolesPageState["detailTab"]): void {
  ps.detailTab = tab;
}

export async function runExecution(
  state: AppViewState,
  pageState: MyRolesPageState,
  execution: Record<string, unknown>,
): Promise<void> {
  const dispatchToRoleRequestId =
    typeof execution.dispatchRequestId === "string" ? execution.dispatchRequestId : undefined;
  const taskPackageId =
    typeof execution.taskPackageId === "string" ? execution.taskPackageId : undefined;
  if (!dispatchToRoleRequestId && !taskPackageId) return;
  pageState.runningExecutionId = String(execution.id ?? dispatchToRoleRequestId ?? taskPackageId);
  pageState.error = null;
  pageState.message = null;
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("未连接");
    const authorizedExecution = selectAuthorizedExecutionContext(state, execution);
    if (!authorizedExecution) {
      throw new Error("岗位执行需要先到「费用与授权」完成岗位授权和费用确认。");
    }
    const ledgerRef = text(execution.ledgerRef);
    if (execution.costConfirmed !== true || !ledgerRef) {
      throw new Error("岗位执行需要先完成本次费用确认并生成费用凭证。");
    }
    if (!confirmRealRoleExecution(state, execution)) {
      return;
    }
    if (!dispatchToRoleRequestId) {
      throw new Error("岗位执行需要任务调度先生成执行队列项。请回到「任务调度」点击“检查并派发”。");
    }
    const ok = await aicsMainFlow.confirmAndRunExecution(state, dispatchToRoleRequestId, {
      ...authorizedExecution,
      roleTitle: text(execution.roleTitle) || undefined,
      ledgerRef,
    });
    if (!ok) {
      throw new Error(state.aicsMainFlow?.error ?? "岗位执行未完成，请按页面提示处理阻塞项。");
    }
    await refreshMyRolesReadModel(state, pageState);
    await state.refreshAicsMainFlowReadModel?.();
    await state.refreshAicsMarketplaceRoles?.();
    await state.refreshApiConnectionsReadModel?.();
    await state.checkClosedLoopReadiness?.();
    pageState.message = "岗位任务已完成，执行结果、审计记录、账本记录和业务产物均已读回。";
  } catch (err) {
    pageState.error = err instanceof Error ? err.message : String(err);
  } finally {
    pageState.runningExecutionId = null;
    requestUpdate(state);
  }
}
