import type { AppViewState } from "../app-view-state.js";

export type MyRolesPageState = {
  loading: boolean;
  runningExecutionId: string | null;
  error: string | null;
  readModel: Record<string, unknown> | null;
  viewMode: "queue" | "artifacts";
  query: string;
  statusFilter: string;
  capabilityFilter: string | null;
  selectedRoleKey: string | null;
  detailTab: "overview" | "steps" | "artifacts" | "boundary";
};

export function createDefaultMyRolesState(): MyRolesPageState {
  return {
    loading: false,
    runningExecutionId: null,
    error: null,
    readModel: null,
    viewMode: "queue",
    query: "",
    statusFilter: "all",
    capabilityFilter: null,
    selectedRoleKey: null,
    detailTab: "overview",
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
  const fallback = roles.find((role) => role.entitlementId);
  const selected = exact ?? fallback;
  return selected?.entitlementId
    ? {
        roleListingId: selected.roleListingId || selected.id,
        entitlementId: selected.entitlementId,
      }
    : null;
}

export async function refreshMyRolesReadModel(
  state: AppViewState,
  pageState: MyRolesPageState,
): Promise<void> {
  const seq = ++refreshSeq;
  pageState.loading = true;
  pageState.error = null;
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("未连接");
    const result = await state.client.request("aics.executionConsole.readModel.get", {});
    if (seq !== refreshSeq) return;
    pageState.readModel = result as Record<string, unknown>;
  } catch (err) {
    if (seq !== refreshSeq) return;
    pageState.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (seq !== refreshSeq) return;
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
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("未连接");
    const authorization = selectAuthorizedExecutionContext(state, execution);
    if (!authorization) {
      throw new Error("岗位执行需要先到「费用与授权」完成岗位授权和费用确认。");
    }
    const taskText = String(
      execution.taskText ?? execution.expectedOutput ?? execution.title ?? "",
    ).trim();
    const workspaceDir = String(execution.workspaceDir ?? "/tmp/dijie-role-execution").trim();
    const roleTitle = String(execution.roleTitle ?? "").trim();
    const cloudResult = await state.client.request<Record<string, unknown>>("dijie.roleTask.run", {
      role_listing_id: authorization.roleListingId,
      entitlement_id: authorization.entitlementId,
      ...(roleTitle ? { role_title: roleTitle } : {}),
      task_text: taskText || "执行已授权岗位任务，并输出可审计的业务结果。",
      confirm_execution: true,
      workspace_dir: workspaceDir,
    });
    const auditUpload =
      cloudResult && typeof cloudResult.auditUpload === "object" && cloudResult.auditUpload
        ? (cloudResult.auditUpload as Record<string, unknown>)
        : {};
    const roleResult =
      cloudResult && typeof cloudResult.roleResult === "object" && cloudResult.roleResult
        ? (cloudResult.roleResult as Record<string, unknown>)
        : {};
    const artifactRefs = Array.isArray(roleResult.artifactRefs)
      ? roleResult.artifactRefs.filter((item): item is string => typeof item === "string")
      : [];
    await state.client.request("aics.execution.result.record", {
      dispatchToRoleRequestId,
      taskPackageId,
      roleListingId: authorization.roleListingId,
      ...(roleTitle ? { roleTitle } : {}),
      entitlementId: authorization.entitlementId,
      executionId:
        typeof cloudResult.executionId === "string" ? cloudResult.executionId : undefined,
      ok: cloudResult.ok === true,
      status: typeof cloudResult.status === "string" ? cloudResult.status : undefined,
      summary: typeof cloudResult.summary === "string" ? cloudResult.summary : undefined,
      auditRecordId:
        typeof auditUpload.auditRecordId === "string" ? auditUpload.auditRecordId : undefined,
      artifactRefs,
      source_surface: "aics_execution_console",
      purpose: "record_cloud_audited_role_task_result",
    });
    await refreshMyRolesReadModel(state, pageState);
    await state.refreshAicsMainFlowReadModel?.();
  } catch (err) {
    pageState.error = err instanceof Error ? err.message : String(err);
  } finally {
    pageState.runningExecutionId = null;
    requestUpdate(state);
  }
}
