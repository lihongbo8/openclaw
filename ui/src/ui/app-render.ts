import { html, nothing } from "lit";
import { guard } from "lit/directives/guard.js";
import { styleMap } from "lit/directives/style-map.js";
import { i18n, t } from "../i18n/index.ts";
import { getSafeLocalStorage } from "../local-storage.ts";
import { createApiMeteringViewModel } from "./api-metering-view-model.ts";
import {
  createChatSessionsLoadOverrides,
  hasAbortableSessionRun,
  refreshChat,
  scopedAgentListParamsForSession,
  scopedAgentParamsForSession,
} from "./app-chat.ts";
import { DEFAULT_CRON_FORM } from "./app-defaults.ts";
import {
  renderChatControls,
  renderTab,
  resolveAssistantAttachmentAuthToken,
  resolveDashboardHeaderContext,
  renderSidebarConnectionStatus,
  renderTopbarThemeModeToggle,
  createChatSession,
  dismissChatError,
  switchChatSession,
} from "./app-render.helpers.ts";
import { warnQueryToken } from "./app-settings.ts";
import type { AppViewState } from "./app-view-state.ts";
import {
  businessProjectMilestoneStatusLabel,
  businessProjectRiskStatusLabel,
  buildBusinessFlowProjection,
  type BusinessProject,
} from "./business-flow-store.ts";
import { reconcileChatRunLifecycle } from "./chat/run-lifecycle.ts";
import { renderChatSessionSelect } from "./chat/session-controls.ts";
import {
  controlUiNowMs,
  recordControlUiRenderTiming,
  roundedControlUiDurationMs,
} from "./control-ui-performance.ts";
import { loadAgentFileContent, loadAgentFiles, saveAgentFile } from "./controllers/agent-files.ts";
import { loadAgentIdentities, loadAgentIdentity } from "./controllers/agent-identity.ts";
import { loadAgentSkills } from "./controllers/agent-skills.ts";
import {
  buildToolsEffectiveRequestKey,
  loadAgents,
  loadToolsCatalog,
  loadToolsEffective,
  resetToolsEffectiveState,
  refreshVisibleToolsEffectiveForCurrentSession,
  saveAgentsConfig,
} from "./controllers/agents.ts";
import { aicsMainFlow, selectAuthorizedRoleForDispatch } from "./controllers/aics-main-flow.ts";
import {
  API_CONNECTION_TEMPLATES,
  type ApiConnectionConsumer,
} from "./controllers/api-connections.ts";
import { setAssistantAvatarOverride } from "./controllers/assistant-identity.ts";
import { loadChannels } from "./controllers/channels.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import {
  applyConfig,
  ensureAgentConfigEntry,
  findAgentConfigEntryIndex,
  loadConfig,
  openConfigFile,
  resetConfigPendingChanges,
  runUpdate,
  saveConfig,
  stageDefaultAgentConfigEntry,
  stageConfigPreset,
  updateConfigRawValue,
  updateConfigFormValue,
  removeConfigFormValue,
  updateMcpServerEnabled,
} from "./controllers/config.ts";
import {
  loadCronJobsPage,
  loadCronRuns,
  loadMoreCronRuns,
  toggleCronJob,
  runCronJob,
  removeCronJob,
  addCronJob,
  startCronEdit,
  startCronClone,
  cancelCronEdit,
  validateCronForm,
  hasCronFormErrors,
  normalizeCronFormState,
  getVisibleCronJobs,
  updateCronJobsFilter,
  updateCronRunsFilter,
} from "./controllers/cron.ts";
import { loadDebug, callDebugMethod } from "./controllers/debug.ts";
import {
  approveDevicePairing,
  loadDevices,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
} from "./controllers/devices.ts";
import { loadDreamingStatus, updateDreamingEnabled } from "./controllers/dreaming.ts";
import {
  loadExecApprovals,
  removeExecApprovalsFormValue,
  saveExecApprovals,
  updateExecApprovalsFormValue,
} from "./controllers/exec-approvals.ts";
import {
  deriveGoalView,
  openGoalForm,
  closeGoalForm,
  updateGoalFormField,
  createGoalCandidate,
  confirmGoal,
  createDefaultGoalsPageState,
} from "./controllers/goals.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadPresence } from "./controllers/presence.ts";
import {
  branchSessionFromCheckpoint,
  deleteSessionsAndRefresh,
  loadSessions,
  parseSessionsFilterInteger,
  patchSession,
  restoreSessionFromCheckpoint,
  toggleSessionCompactionCheckpoints,
} from "./controllers/sessions.ts";
import { installFromClawHub, loadSkills, searchClawHub } from "./controllers/skills.ts";
import {
  createToolSupplyCategory,
  saveToolSupplyCategorySelection,
  setToolSupplyPluginEnabled,
  setToolSupplySkillEnabled,
  syncToolSupplyCategories,
  type ToolSupplyCategoryCapabilityPackage,
  type ToolSupplyBinding,
  type ToolSupplyCloudCategory,
  type ToolSupplyControlItem,
} from "./controllers/tool-supply-control.ts";
import { getCronJobPayload } from "./cron-payload.ts";
import { formatTimeMs } from "./format.ts";
import { formatRelativeTimestamp } from "./format.ts";
import { icons } from "./icons.ts";
import { createLazyView, renderLazyView } from "./lazy-view.ts";
import {
  displayTitleForTab,
  iconForTab,
  isPrimaryNavTab,
  isSettingsTab,
  normalizeBasePath,
  pathForTab,
  SETTINGS_NAV_GROUPS,
  TAB_GROUPS,
  subtitleForTab,
  type Tab,
} from "./navigation.ts";
import { isCronSessionKey, resolveSessionDisplayName } from "./session-display.ts";
import {
  buildAgentMainSessionKey,
  areUiSessionKeysEquivalent,
  isSessionKeyTiedToAgent,
  isSubagentSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
  resolveUiConfiguredMainKey,
} from "./session-key.ts";
import "./components/dashboard-header.ts";
import { loadLocalAssistantIdentity } from "./storage.ts";
import { normalizeStringEntries } from "./string-coerce.ts";
import { normalizeOptionalString } from "./string-coerce.ts";
import type { AgentsFilesGetResult, AgentsFilesListResult, GatewaySessionRow } from "./types.ts";
import { isRenderableControlUiAvatarUrl } from "./views/agents-utils.ts";
import { agentLogoUrl } from "./views/agents-utils.ts";
import {
  resolveAgentConfig,
  resolveConfiguredCronModelSuggestions,
  resolveEffectiveModelFallbacks,
  resolveModelPrimary,
  sortLocaleStrings,
} from "./views/agents-utils.ts";
import { renderBuildSessionWizard } from "./views/build-session.ts";
import { renderChat } from "./views/chat.ts";
import { renderCommandPalette } from "./views/command-palette.ts";
import { getPresetById } from "./views/config-presets.ts";
import { renderQuickSettings, type QuickSettingsChannel } from "./views/config-quick.ts";
import { renderConfig, type ConfigProps } from "./views/config.ts";
import {
  renderCronQuickCreate,
  createDefaultDraft,
  draftToCronFormPatch,
} from "./views/cron-quick-create.ts";
import { renderDreamingRestartConfirmation } from "./views/dreaming-restart-confirmation.ts";
import { renderExecApprovalPrompt } from "./views/exec-approval.ts";
import { renderGatewayUrlConfirmation } from "./views/gateway-url-confirmation.ts";
import { renderLoginGate } from "./views/login-gate.ts";
import { renderMainSystemShell, type MainSystemItem } from "./views/main-system-shell.ts";
import { renderMcp } from "./views/mcp.ts";
import { renderMyRolesPage } from "./views/my-roles.ts";
import { renderOverview } from "./views/overview.ts";
import { renderReviewCenter } from "./views/review-center.ts";

let pendingUpdate: (() => void) | undefined;

const notifyLazyViewChanged = () => pendingUpdate?.();

function formatMainSystemCount(value: number | undefined | null) {
  return Number.isFinite(value) ? String(Math.max(0, Math.floor(value ?? 0))) : "待同步";
}

function formatMainSystemNumber(value: number | undefined | null) {
  if (!Number.isFinite(value)) {
    return "待同步";
  }
  const normalized = Math.max(0, Number(value));
  if (normalized >= 1_000_000) {
    return `${(normalized / 1_000_000).toFixed(1)}M`;
  }
  if (normalized >= 10_000) {
    return `${(normalized / 1_000).toFixed(1)}K`;
  }
  return String(Math.round(normalized));
}

function formatMainSystemCost(value: number | undefined | null) {
  if (!Number.isFinite(value)) {
    return "待同步";
  }
  return `¥${Math.max(0, Number(value)).toFixed(2)}`;
}

function businessProjectStatusLabel(status: BusinessProject["status"]) {
  switch (status) {
    case "running":
      return "推进中";
    case "review":
      return "待确认";
    case "blocked":
      return "已阻塞";
    default:
      return "已规划";
  }
}

function runUiTask<Args extends unknown[]>(
  task: (...args: Args) => Promise<unknown>,
): (...args: Args) => void {
  return (...args) => {
    void task(...args);
  };
}

function renderSettingsSectionNav(state: AppViewState) {
  if (!isSettingsTab(state.tab)) {
    return nothing;
  }
  return html`
    <nav class="settings-section-nav" aria-label=${t("common.settingsSections")}>
      ${SETTINGS_NAV_GROUPS.map(
        (group) => html`
          <div class="settings-section-nav__group">
            <div class="settings-section-nav__group-label">${group.label}</div>
            ${group.tabs.map((tab) => {
              const active = state.tab === tab;
              const href = pathForTab(tab, state.basePath);
              const label = displayTitleForTab(tab);
              return html`
                <a
                  href=${href}
                  class="settings-section-nav__item ${active
                    ? "settings-section-nav__item--active"
                    : ""}"
                  @click=${(event: MouseEvent) => {
                    if (
                      event.defaultPrevented ||
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return;
                    }
                    event.preventDefault();
                    state.setTab(tab);
                  }}
                  title=${label}
                >
                  <span class="settings-section-nav__icon" aria-hidden="true"
                    >${icons[iconForTab(tab)]}</span
                  >
                  <span class="settings-section-nav__label">${label}</span>
                </a>
              `;
            })}
          </div>
        `,
      )}
    </nav>
  `;
}

function renderSettingsWorkspace(state: AppViewState, body: unknown) {
  return html`
    <section class="settings-workspace">
      ${renderSettingsSectionNav(state)}
      <div class="settings-workspace__body">${body}</div>
    </section>
  `;
}

function mainFlowBlockerLabel(reason: Record<string, unknown>) {
  const code = String(reason.code ?? "");
  const labels: Record<string, string> = {
    missing_interaction: "还没有经营意图，先在经营概览填写要解决的经营问题。",
    missing_observation_package: "还没有数据分析包，先完成数据分析。",
    missing_attribution_report: "还没有归因报告，先完成归因分析。",
    missing_confirmed_company_goal: "还没有确认后的公司目标，先到公司目标页确认目标。",
    missing_confirmed_planning_package: "还没有确认后的规划方案，先到规划方案页生成工作块。",
    missing_confirmed_dispatch_proposal: "还没有确认后的派发预检，先在任务调度页检查并派发。",
    missing_task_package: "还没有派发单，先在任务调度页检查并派发。",
    missing_dispatch_to_role_request: "还没有执行队列项，先在任务调度页生成派发单。",
    authorization_required: "缺少岗位授权，先到费用与授权处理。",
    missing_api_binding: "缺少 API 绑定，先到 API 管理处理。",
  };
  return labels[code] ?? String(reason.message ?? (code || "当前阶段还缺少前置条件。"));
}

function mainFlowPlanItemStatusLabel(value: unknown) {
  const status = String(value ?? "");
  const labels: Record<string, string> = {
    draft: "草稿",
    prepared: "待确认",
    confirmed: "已确认",
    ready_for_dispatch: "可派发",
    blocked: "阻塞",
    done: "已完成",
    cancelled: "已取消",
  };
  return labels[status] ?? (status ? "待处理" : "待处理");
}

function mainFlowDispatchStatusLabel(value: unknown) {
  const status = String(value ?? "");
  const labels: Record<string, string> = {
    not_dispatched: "待派发",
    pending: "待派发",
    ready_for_dispatch: "可派发",
    dispatched: "已派发",
    blocked: "阻塞",
    cancelled: "已取消",
  };
  return labels[status] ?? (status ? "待处理" : "待派发");
}

function mainFlowEntityStatusLabel(value: unknown) {
  const status = String(value ?? "");
  const labels: Record<string, string> = {
    prepared: "待确认",
    confirmed: "已确认",
    candidate: "候选",
    draft: "草稿",
    rejected: "已驳回",
    cancelled: "已取消",
    materialized: "已生成",
    ready: "可执行",
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    blocked: "阻塞",
  };
  return labels[status] ?? (status ? "待处理" : "");
}

function mainFlowCapabilityRequestStatusLabel(value: unknown) {
  const status = String(value ?? "");
  const labels: Record<string, string> = {
    pending_review: "待审核",
    needs_unique_capability: "需独特能力",
    approved: "已通过",
    rejected: "已驳回",
    blocked: "阻塞",
    ready: "可继续",
  };
  return labels[status] ?? (status ? "待处理" : "待处理");
}

function mainFlowCapabilityTypeLabel(value: unknown) {
  const type = String(value ?? "");
  const labels: Record<string, string> = {
    category_capability: "品类能力",
    unique_capability: "独特能力",
    tool: "工具能力",
    skill: "Skill 能力",
    model_provider: "模型能力",
  };
  return labels[type] ?? (type ? "能力项" : "能力项");
}

function mainFlowRiskLevelLabel(value: unknown) {
  const risk = String(value ?? "");
  const labels: Record<string, string> = {
    low: "低",
    medium: "中",
    high: "高",
    critical: "严重",
  };
  return labels[risk] ?? (risk ? "待评估" : "待评估");
}

function mainFlowCategoryLabel(value: unknown) {
  const category = String(value ?? "");
  const labels: Record<string, string> = {
    marketplace_growth: "渠道增长",
    role_marketplace_ops: "岗位商品运营",
    execution_quality: "执行质量",
    authorization_governance: "授权治理",
    cloud_marketplace: "云端商城",
    local_openclaw: "本地运行",
    role_supply_capability: "岗位供给与能力",
  };
  return labels[category] ?? (category ? category.replace(/[_-]+/g, " ") : "通用品类");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
    : [];
}

function mainFlowFixTab(value: unknown): Tab | null {
  const tab = String(value ?? "");
  const candidate = tab as Tab;
  return isPrimaryNavTab(candidate) || isSettingsTab(candidate) ? candidate : null;
}

function mainFlowTabLabel(tab: Tab): string {
  const labels: Partial<Record<Tab, string>> = {
    businessOverview: "经营概览",
    observation: "数据分析",
    attribution: "归因分析",
    goals: "公司目标",
    company: "规划方案",
    workboard: "任务调度",
    aics: "岗位执行",
    apiManagement: "API 管理",
    usage: "费用与授权",
    skills: "工具与 Skill",
  };
  return labels[tab] ?? "对应页面";
}

function renderMainFlowHumanizedPanel(
  readModel: Record<string, unknown> | null | undefined,
  onNavigate: (tab: Tab) => void,
  variant: "full" | "compact" = "compact",
) {
  if (!readModel) return nothing;
  const guidance = asRecord(readModel.stageGuidance);
  const handoff = asRecord(readModel.handoffPreview);
  const operatorRecommendation = asRecord(readModel.operatorRecommendation);
  const stageBoundary = asRecord(readModel.stageBoundary);
  const preconditions = asRecordArray(readModel.preconditions);
  const blockerResolutions = asRecordArray(readModel.blockerResolutions);
  const stageProgress = asRecordArray(readModel.stageProgress);
  const currentStage = String(readModel.currentStage ?? guidance?.stage ?? "");
  const title = String(guidance?.title ?? "主流程");
  const description = String(
    guidance?.description ?? "按观察、归因、目标、规划、调度和岗位执行推进。",
  );
  const nextStepLabel = String(guidance?.nextStepLabel ?? "按当前阶段继续推进");
  const primaryActionLabel = String(guidance?.primaryActionLabel ?? "处理当前阶段");
  const primaryActionTarget = mainFlowFixTab(guidance?.primaryActionTarget);
  const latest = asRecord(readModel.latest) ?? {};
  const latestObservation = asRecord(latest.observationPackage);
  const latestAttribution = asRecord(latest.attributionReport);
  const latestGoal = asRecord(latest.companyGoal);
  const latestPlanning = asRecord(latest.planningPackage);
  const latestDispatch = asRecord(latest.dispatchProposalReview);
  const latestTaskPackage = asRecord(latest.taskPackage);
  const latestDispatchRequest = asRecord(latest.dispatchToRoleRequest);
  const latestRoleResult = asRecord(latest.roleResult);
  const readableTitle = (item: Record<string, unknown> | null | undefined, fallback: string) => {
    const title = String(item?.title ?? item?.name ?? item?.summary ?? "").trim();
    return title || fallback;
  };
  const latestTitle = (key: string, fallback: string) => {
    const item = asRecord(latest[key]);
    return readableTitle(item, fallback);
  };
  const latestStatus = (key: string) => {
    const item = asRecord(latest[key]);
    return item?.status ? ` · 状态：${mainFlowEntityStatusLabel(item.status)}` : "";
  };
  const stageTasks: Record<string, string[]> = {
    observation: [
      "确认内部经营、云端商城、本地运行、外部机会和风险事实是否足够。",
      "标记缺失、低可信或过期数据，确认后再交给归因分析。",
    ],
    attribution: [
      "把已确认事实解释成主因、影响、证据和建议目标。",
      "只解释原因，不直接创建目标、不直接调度岗位。",
    ],
    goal: [
      "把归因结果收敛成公司目标，明确指标、周期、负责人和确认状态。",
      "目标确认后才允许进入规划拆解。",
    ],
    planning: [
      "把公司目标拆成经营工作块和岗位承接任务。",
      "确认正式规划包后，任务调度才能生成派发单。",
    ],
    dispatch: [
      "检查岗位授权、能力匹配、工具/Skill、API 和人工确认条件。",
      "只生成派发单和执行队列，不在调度页运行岗位。",
    ],
    role: [
      "运行已派发、已授权、费用已确认的岗位任务。",
      "完成后读回业务产物、审计、账本和模型证据，交给下一轮观察。",
    ],
  };
  const currentTasks = stageTasks[currentStage] ?? [
    "按当前阶段处理主流程任务。",
    "完成后把可读产物交给下一层继续推进。",
  ];
  const sourceInputByStage: Record<string, { label: string; summary: string }> = {
    observation: {
      label: "经营输入",
      summary: asRecord(latest.interaction)
        ? String(asRecord(latest.interaction)?.message ?? "已有经营意图")
        : "还没有经营意图；先从经营概览填写要解决的经营问题。",
    },
    attribution: {
      label: "已确认数据分析",
      summary: `${latestTitle("observationPackage", "还没有可用于归因的数据分析包")}${latestStatus(
        "observationPackage",
      )}`,
    },
    goal: {
      label: "归因报告",
      summary: `${latestTitle("attributionReport", "还没有归因报告")}${latestStatus(
        "attributionReport",
      )}`,
    },
    planning: {
      label: "公司目标",
      summary: `${latestTitle("companyGoal", "还没有确认后的公司目标")}${latestStatus(
        "companyGoal",
      )}`,
    },
    dispatch: {
      label: "正式规划包",
      summary: `${latestTitle("planningPackage", "还没有确认后的规划方案")}${latestStatus(
        "planningPackage",
      )}`,
    },
    role: {
      label: "派发单 / 执行队列",
      summary: `${latestTitle("taskPackage", "还没有派发单")}；${latestTitle(
        "dispatchToRoleRequest",
        "还没有执行队列项",
      )}`,
    },
  };
  const sourceInput = sourceInputByStage[currentStage] ?? {
    label: "上一层输入",
    summary: "等待主流程数据。",
  };
  const recommendationSeverity = String(operatorRecommendation?.severity ?? "info");
  const recommendationActionTab = mainFlowFixTab(operatorRecommendation?.actionTab);
  const recommendationTone =
    recommendationSeverity === "warning"
      ? { border: "#f6ad55", background: "#fffaf0", color: "#744210" }
      : recommendationSeverity === "success"
        ? { border: "#9ae6b4", background: "#f0fff4", color: "#22543d" }
        : { border: "#bee3f8", background: "#ebf8ff", color: "#2b6cb0" };
  const boundaryAllowed = Array.isArray(stageBoundary?.allowed)
    ? (stageBoundary.allowed as unknown[]).filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const boundaryProhibited = Array.isArray(stageBoundary?.prohibited)
    ? (stageBoundary.prohibited as unknown[]).filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const boundaryEvidence = Array.isArray(stageBoundary?.evidenceRequired)
    ? (stageBoundary.evidenceRequired as unknown[]).filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  const statusLabel = (status: unknown, explicitLabel?: unknown) => {
    if (typeof explicitLabel === "string" && explicitLabel.trim()) return explicitLabel;
    if (status === "completed") return "已完成";
    if (status === "current") return "当前处理";
    if (status === "available") return "可处理";
    if (status === "met") return "已满足";
    if (status === "blocked") return "需处理";
    if (status === "locked") return "未开放";
    return "待完成";
  };
  const statusColor = (status: unknown) => {
    if (status === "met" || status === "completed") return "#047857";
    if (status === "current" || status === "available") return "#2563eb";
    if (status === "blocked") return "#b91c1c";
    if (status === "locked") return "#6b7280";
    return "#b7791f";
  };
  const ownerLabel = (capability: unknown) => {
    const value = String(capability ?? "");
    if (/marketplace-operations|marketplace-review/.test(value)) return "商城运营岗位";
    if (/marketplace-listing/.test(value)) return "商品运营岗位";
    if (/capability-routing/.test(value)) return "能力路由岗位";
    if (/api-connection/.test(value)) return "系统连接运营岗位";
    if (/authorization/.test(value)) return "费用与授权运营岗位";
    if (/external-capability|risk/.test(value)) return "外部观察与风险岗位";
    if (/data-collection/.test(value)) return "数据分析岗位";
    return "待匹配岗位";
  };
  const dependencyLabel = (item: Record<string, unknown>) => {
    const text = `${item.title ?? ""} ${item.taskIntent ?? ""} ${item.roleCapabilityRef ?? ""}`;
    const deps: string[] = [];
    if (/API|Provider|SecretRef|连接|api|model/i.test(text)) deps.push("API / 模型连接");
    if (/工具|tool/i.test(text)) deps.push("工具");
    if (/Skill|skill|能力流程/i.test(text)) deps.push("Skill");
    if (/授权|费用|ledger|账本/.test(text)) deps.push("费用与授权");
    if (/外部|竞品|风险|模型/.test(text)) deps.push("外部信息采集");
    if (/审核|商品|岗位/.test(text)) deps.push("云端商城数据");
    return deps.length ? deps.join("、") : "按承接岗位补齐";
  };
  const preconditionById = new Map(
    preconditions.map((item) => [String(item.id ?? ""), item] as const),
  );
  const countArray = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  const inferredPreconditions = preconditions.length
    ? preconditions
    : [
        {
          id: "task_package",
          label: "派发单",
          status: latestTaskPackage ? "met" : "blocked",
          message: latestTaskPackage
            ? `已生成派发单：${readableTitle(latestTaskPackage, "派发单已生成")}`
            : "还没有派发单，需要先到任务调度生成。",
          fixTab: "workboard",
          fixActionLabel: "去任务调度",
        },
        {
          id: "dispatch_to_role_request",
          label: "执行队列",
          status: latestDispatchRequest ? "met" : "blocked",
          message: latestDispatchRequest
            ? `已生成执行队列：${readableTitle(latestDispatchRequest, "执行队列项已生成")}`
            : "还没有执行队列，需要先完成调度派发。",
          fixTab: "workboard",
          fixActionLabel: "去任务调度",
        },
      ];
  const hasAnyDownstreamAfter = (stage: string) => {
    const order = ["observation", "attribution", "goal", "planning", "dispatch", "role"];
    const stageIndex = order.indexOf(stage);
    if (stageIndex < 0) return false;
    const evidenceByStage = {
      observation: Boolean(latestObservation),
      attribution: Boolean(latestAttribution),
      goal: Boolean(latestGoal),
      planning: Boolean(latestPlanning),
      dispatch: Boolean(latestDispatch || latestTaskPackage || latestDispatchRequest),
      role: Boolean(latestRoleResult),
    } as Record<string, boolean>;
    return order.slice(stageIndex + 1).some((nextStage) => evidenceByStage[nextStage]);
  };
  const inferredStageStatus = (stage: string, hasOwnEvidence: boolean) => {
    if (hasOwnEvidence) return "completed";
    if (stage === currentStage) return "current";
    if (hasAnyDownstreamAfter(stage)) return "blocked";
    return "locked";
  };
  const inferredMissingSummary = (label: string) =>
    `后续阶段已有记录，但${label}证据没有读回；需要回补链路证据或重新从本层生成。`;
  const fallbackStageOverview = [
    {
      stage: "observation",
      label: "数据分析",
      preconditionId: "observation_package",
      tab: "observation",
      hasOwnEvidence: Boolean(latestObservation),
      summary: latestObservation
        ? `已形成数据分析包：${readableTitle(latestObservation, "数据分析包已形成")}`
        : inferredMissingSummary("数据分析包"),
      evidenceCount: latestObservation ? countArray(latestObservation.signals) || 1 : 0,
    },
    {
      stage: "attribution",
      label: "归因分析",
      preconditionId: "attribution_report",
      tab: "attribution",
      hasOwnEvidence: Boolean(latestAttribution),
      summary: latestAttribution
        ? `已形成归因报告：${readableTitle(latestAttribution, "归因报告已形成")}`
        : inferredMissingSummary("归因报告"),
      evidenceCount: latestAttribution ? countArray(latestAttribution.findings) || 1 : 0,
    },
    {
      stage: "goal",
      label: "公司目标",
      preconditionId: "company_goal",
      tab: "goals",
      hasOwnEvidence: Boolean(latestGoal),
      summary: latestGoal
        ? `已确认公司目标：${readableTitle(latestGoal, "公司目标已确认")}`
        : inferredMissingSummary("公司目标"),
      evidenceCount: latestGoal ? 1 : 0,
    },
    {
      stage: "planning",
      label: "规划方案",
      preconditionId: "planning_package",
      tab: "company",
      hasOwnEvidence: Boolean(latestPlanning),
      summary: latestPlanning
        ? `已确认规划方案：${readableTitle(latestPlanning, "规划方案已确认")}`
        : inferredMissingSummary("规划方案"),
      evidenceCount: latestPlanning ? 1 : 0,
    },
    {
      stage: "dispatch",
      label: "任务调度",
      preconditionId: "dispatch_package",
      tab: "workboard",
      hasOwnEvidence: Boolean(latestDispatch || latestTaskPackage || latestDispatchRequest),
      summary:
        latestTaskPackage || latestDispatchRequest
          ? `已生成派发单/执行队列：${readableTitle(
              latestTaskPackage,
              "派发单已生成",
            )}；${readableTitle(latestDispatchRequest, "执行队列项已生成")}`
          : inferredMissingSummary("任务调度"),
      evidenceCount: [latestDispatch, latestTaskPackage, latestDispatchRequest].filter(Boolean)
        .length,
    },
    {
      stage: "role",
      label: "岗位执行",
      preconditionId: "role_execution_gate",
      tab: "aics",
      hasOwnEvidence: Boolean(latestRoleResult),
      summary: latestRoleResult
        ? `最近执行结果：${readableTitle(latestRoleResult, "执行结果已回写")}`
        : latestTaskPackage || latestDispatchRequest
          ? "已有派发单和执行队列，等待岗位执行确认、运行和证据读回。"
          : "等待已派发、已授权、费用确认、API 和岗位能力就绪。",
      evidenceCount: latestRoleResult ? 1 : 0,
    },
  ].map((item) => {
    const precondition = preconditionById.get(item.preconditionId);
    const status = String(
      precondition?.status ?? inferredStageStatus(item.stage, item.hasOwnEvidence),
    );
    const fallbackSummary = item.summary || "主流程状态数据未完整加载，请刷新或重新读取主流程。";
    return {
      ...item,
      status,
      statusLabel: statusLabel(status),
      summary: String(precondition?.message ?? fallbackSummary),
      nextAction: String(precondition?.message ?? fallbackSummary),
      evidenceCount: item.evidenceCount,
      blockerCount: status === "blocked" ? 1 : 0,
      tab: mainFlowFixTab(precondition?.fixTab) ?? (item.tab as Tab),
    };
  });
  const stageOverview = stageProgress.length
    ? stageProgress.map((item) => {
        const stage = String(item.stage ?? "");
        const routeTab = mainFlowFixTab(item.routeTab) ?? mainFlowFixTab(item.actionTab);
        return {
          stage,
          label: String(item.label ?? "主流程"),
          status: String(item.status ?? "locked"),
          statusLabel: statusLabel(item.status, item.statusLabel),
          summary: String(item.summary ?? "等待主流程数据。"),
          nextAction: String(item.nextAction ?? "按当前阶段继续。"),
          evidenceCount: Number(item.evidenceCount ?? 0),
          blockerCount: Number(item.blockerCount ?? 0),
          tab: routeTab ?? "businessOverview",
        };
      })
    : fallbackStageOverview;
  const currentStageOverview =
    stageOverview.find((item) => item.stage === currentStage) ?? stageOverview[0] ?? null;
  const inferredBlockedStages = stageOverview.filter(
    (item) => item.status === "blocked" && item.summary,
  );
  const firstBlockerText =
    String(blockerResolutions[0]?.humanMessage ?? "").trim() ||
    (currentStageOverview?.status === "blocked" ? currentStageOverview.summary : "") ||
    String(inferredBlockedStages[0]?.summary ?? "").trim();
  const fourQuestionSummary = [
    {
      label: "当前状态",
      value: `${currentStageOverview?.label ?? title} · ${currentStageOverview?.statusLabel ?? "待处理"}`,
    },
    {
      label: "为什么卡住",
      value: firstBlockerText || "当前没有明显阻塞，可以按主动作继续。",
    },
    {
      label: "下一步去哪",
      value: `${currentStageOverview?.nextAction ?? nextStepLabel}${
        currentStageOverview?.tab ? `（去${mainFlowTabLabel(currentStageOverview.tab)}）` : ""
      }`,
    },
    {
      label: "做完结果",
      value: `${String(handoff?.outputLabel ?? "待生成产物")}：${String(
        handoff?.summary ?? "本层完成后交给下一层。",
      )}`,
    },
  ];

  if (variant === "compact") {
    return html`
      <section
        data-testid="main-flow-stage-strip"
        style="border:1px solid var(--border-color,#ddd);border-radius:8px;background:var(--bg-elevated,#fff);padding:12px;margin-bottom:14px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"
      >
        <div style="display:grid;gap:4px;min-width:260px;flex:1">
          <div style="font-size:12px;color:var(--text-secondary,#666)">主流程 · 当前层</div>
          <strong style="font-size:14px;color:var(--text-primary,#222)">
            ${currentStageOverview?.label ?? title}
            <span
              style="font-size:12px;color:${statusColor(
                currentStageOverview?.status,
              )};font-weight:600"
            >
              · ${currentStageOverview?.statusLabel ?? "待处理"}
            </span>
          </strong>
          <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.5">
            ${currentStageOverview?.summary ?? description}
          </div>
          ${firstBlockerText
            ? html`<div style="font-size:12px;color:#9a3412;line-height:1.5">
                卡点：${firstBlockerText}
              </div>`
            : html`<div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.5">
                下一步：${currentStageOverview?.nextAction ?? nextStepLabel}
              </div>`}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px">
            ${fourQuestionSummary.map(
              (item) => html`
                <span
                  style="font-size:11px;border:1px solid var(--border-color,#e5e7eb);border-radius:999px;padding:3px 7px;background:var(--bg-secondary,#f8fafc);color:var(--text-secondary,#666)"
                  title=${item.value}
                >
                  ${item.label}
                </span>
              `,
            )}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button
            type="button"
            style="border:1px solid var(--border-color,#ddd);border-radius:6px;background:var(--bg-elevated,#fff);padding:6px 10px;font-size:12px;cursor:pointer"
            @click=${() => onNavigate("businessOverview")}
          >
            查看主流程驾驶舱
          </button>
          <button
            type="button"
            style="border:1px solid var(--accent-color,#3366ff);border-radius:6px;background:var(--accent-color,#3366ff);color:#fff;padding:6px 10px;font-size:12px;cursor:pointer"
            @click=${() =>
              onNavigate(currentStageOverview?.tab ?? primaryActionTarget ?? "businessOverview")}
          >
            ${currentStageOverview?.actionLabel ?? primaryActionLabel}
          </button>
        </div>
      </section>
    `;
  }

  return html`
    <section
      data-testid="main-flow-humanized-panel"
      style="border:1px solid var(--border-color,#ddd);border-radius:8px;background:var(--bg-elevated,#fff);padding:14px;margin-bottom:16px;display:grid;gap:14px"
    >
      <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start">
        <div style="display:grid;gap:5px">
          <div style="font-size:12px;color:var(--text-secondary,#666)">主流程驾驶舱 · 当前卡点</div>
          <h2 style="font-size:18px;margin:0">${title}</h2>
          <p style="font-size:13px;color:var(--text-secondary,#666);margin:0">${description}</p>
          <div style="font-size:12px;color:#047857">${nextStepLabel}</div>
        </div>
        <button
          type="button"
          style="padding:7px 12px;border:1px solid var(--accent-color,#3366ff);border-radius:6px;background:var(--accent-color,#3366ff);color:#fff;font-size:12px;cursor:${primaryActionTarget
            ? "pointer"
            : "default"};opacity:${primaryActionTarget ? 1 : 0.55}"
          ?disabled=${!primaryActionTarget}
          @click=${() => primaryActionTarget && onNavigate(primaryActionTarget)}
        >
          ${primaryActionLabel}
        </button>
      </div>

      ${operatorRecommendation
        ? html`
            <div
              style="border:1px solid ${recommendationTone.border};border-radius:7px;background:${recommendationTone.background};padding:10px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"
            >
              <div style="display:grid;gap:3px;min-width:260px">
                <strong style="font-size:13px;color:${recommendationTone.color}">
                  ${String(operatorRecommendation.title ?? "系统建议")}
                </strong>
                <span style="font-size:12px;color:${recommendationTone.color};line-height:1.5">
                  ${String(operatorRecommendation.summary ?? "按当前阶段继续处理。")}
                </span>
              </div>
              ${recommendationActionTab
                ? html`
                    <button
                      type="button"
                      style="border:1px solid ${recommendationTone.border};border-radius:6px;background:#fff;color:${recommendationTone.color};padding:6px 10px;font-size:12px;cursor:pointer"
                      @click=${() => onNavigate(recommendationActionTab)}
                    >
                      ${String(operatorRecommendation.actionLabel ?? "去处理")}
                    </button>
                  `
                : nothing}
            </div>
          `
        : nothing}

      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px">
        ${fourQuestionSummary.map(
          (item) => html`
            <div
              style="border:1px solid var(--border-color,#e5e7eb);border-radius:7px;background:var(--bg-secondary,#f8fafc);padding:9px;display:grid;gap:4px"
            >
              <div style="font-size:11px;font-weight:700;color:var(--text-primary,#222)">
                ${item.label}
              </div>
              <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.45">
                ${item.value}
              </div>
            </div>
          `,
        )}
      </div>

      <div style="display:grid;gap:8px">
        <div style="font-size:12px;font-weight:700;color:var(--text-primary,#222)">六层进度</div>
        <div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px">
          ${stageOverview.map(
            (item) => html`
              <button
                type="button"
                title=${`${item.summary} ${item.nextAction}`}
                style="border:1px solid ${item.stage === currentStage
                  ? "var(--accent-color,#3366ff)"
                  : "var(--border-color,#e0e0e0)"};border-radius:7px;background:${item.stage ===
                currentStage
                  ? "rgba(51,102,255,.08)"
                  : "var(--bg-secondary,#f8fafc)"};padding:8px;text-align:left;display:grid;gap:5px;cursor:pointer;min-height:94px"
                @click=${() => onNavigate(item.tab)}
              >
                <span style="font-size:12px;font-weight:700;color:var(--text-primary,#222)"
                  >${item.label}</span
                >
                <span style="font-size:11px;color:${statusColor(item.status)}"
                  >${item.statusLabel}</span
                >
                <span
                  style="font-size:11px;color:var(--text-secondary,#666);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden"
                  >${item.summary}</span
                >
                <span style="font-size:11px;color:var(--text-tertiary,#888)"
                  >证据 ${item.evidenceCount} · 阻塞 ${item.blockerCount}</span
                >
              </button>
            `,
          )}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1.1fr 1fr;gap:12px">
        <div style="display:grid;gap:8px">
          <div style="font-size:12px;font-weight:700">前置条件</div>
          ${inferredPreconditions.length
            ? inferredPreconditions.map((item) => {
                const fixTab = mainFlowFixTab(item.fixTab);
                return html`
                  <div
                    style="display:grid;gap:5px;border:1px solid var(--border-color,#eee);border-radius:7px;padding:9px;background:var(--bg-secondary,#f8fafc)"
                  >
                    <div style="display:flex;justify-content:space-between;gap:8px">
                      <strong style="font-size:12px">${String(item.label ?? "前置条件")}</strong>
                      <span style="font-size:11px;color:${statusColor(item.status)}"
                        >${statusLabel(item.status)}</span
                      >
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary,#666)">
                      ${String(item.message ?? "等待处理。")}
                    </div>
                    ${fixTab && item.status !== "met"
                      ? html`<button
                          type="button"
                          style="justify-self:start;border:1px solid var(--border-color,#ddd);border-radius:6px;background:var(--bg-elevated,#fff);padding:5px 8px;font-size:11px;cursor:pointer"
                          @click=${() => onNavigate(fixTab)}
                        >
                          ${String(item.fixActionLabel ?? "去处理")}
                        </button>`
                      : nothing}
                  </div>
                `;
              })
            : html`<div style="font-size:12px;color:var(--text-secondary,#666)">
                当前没有前置条件数据，刷新主流程后会显示。
              </div>`}
        </div>

        <div style="display:grid;gap:12px;align-content:start">
          <div
            style="border:1px solid var(--border-color,#eee);border-radius:7px;padding:10px;background:var(--bg-secondary,#f8fafc)"
          >
            <div style="font-size:12px;font-weight:700;margin-bottom:5px">来源输入</div>
            <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.45">
              <strong style="color:var(--text-primary,#222)">${sourceInput.label}：</strong
              >${sourceInput.summary}
            </div>
          </div>
          <div
            style="border:1px solid var(--border-color,#eee);border-radius:7px;padding:10px;background:var(--bg-secondary,#f8fafc)"
          >
            <div style="font-size:12px;font-weight:700;margin-bottom:6px">本页任务</div>
            <div style="display:grid;gap:5px">
              ${currentTasks.map(
                (task) =>
                  html`<div
                    style="font-size:12px;color:var(--text-secondary,#666);line-height:1.45"
                  >
                    ${task}
                  </div>`,
              )}
            </div>
          </div>
          <div
            style="border:1px solid var(--border-color,#eee);border-radius:7px;padding:10px;background:var(--bg-secondary,#f8fafc)"
          >
            <div style="font-size:12px;font-weight:700;margin-bottom:5px">下一层输出</div>
            <div style="font-size:18px;font-weight:700">${Number(handoff?.outputCount ?? 0)}</div>
            <div style="font-size:12px;color:var(--text-secondary,#666)">
              ${String(handoff?.outputLabel ?? "待生成产物")} ·
              ${String(handoff?.summary ?? "本层完成后交给下一层。")}
            </div>
          </div>
          ${boundaryAllowed.length || boundaryProhibited.length || boundaryEvidence.length
            ? html`
                <div
                  style="border:1px solid var(--border-color,#eee);border-radius:7px;padding:10px;background:var(--bg-secondary,#f8fafc);display:grid;gap:8px"
                >
                  <div style="font-size:12px;font-weight:700">本页边界</div>
                  ${[
                    ["允许", boundaryAllowed],
                    ["需要证据", boundaryEvidence],
                    ["禁止", boundaryProhibited],
                  ].map(([label, values]) =>
                    (values as string[]).length
                      ? html`
                          <div
                            style="font-size:12px;color:var(--text-secondary,#666);line-height:1.45"
                          >
                            <strong style="color:var(--text-primary,#222)">${label}：</strong>
                            ${(values as string[]).join("、")}
                          </div>
                        `
                      : nothing,
                  )}
                </div>
              `
            : nothing}
          <div style="display:grid;gap:8px">
            <div style="font-size:12px;font-weight:700">阻塞修复</div>
            ${blockerResolutions.length
              ? blockerResolutions.slice(0, 4).map((item) => {
                  const fixTab = mainFlowFixTab(item.fixTab);
                  return html`
                    <div
                      style="border:1px solid #fed7aa;border-radius:7px;background:#fffaf0;padding:9px;display:grid;gap:5px"
                    >
                      <strong style="font-size:12px;color:#9a3412"
                        >${String(item.humanMessage ?? "当前有阻塞")}</strong
                      >
                      <div style="font-size:12px;color:#9a3412">
                        ${String(item.impact ?? "需要先处理后才能继续。")}
                      </div>
                      ${fixTab
                        ? html`<button
                            type="button"
                            style="justify-self:start;border:1px solid #fdba74;border-radius:6px;background:#fff;color:#9a3412;padding:5px 8px;font-size:11px;cursor:pointer"
                            @click=${() => onNavigate(fixTab)}
                          >
                            ${String(item.fixActionLabel ?? "去修复")}
                          </button>`
                        : nothing}
                    </div>
                  `;
                })
              : inferredBlockedStages.length
                ? inferredBlockedStages.slice(0, 4).map(
                    (item) => html`
                      <div
                        style="border:1px solid #fed7aa;border-radius:7px;background:#fffaf0;padding:9px;display:grid;gap:5px"
                      >
                        <strong style="font-size:12px;color:#9a3412">${item.label}需要处理</strong>
                        <div style="font-size:12px;color:#9a3412;line-height:1.5">
                          ${item.summary}
                        </div>
                        <button
                          type="button"
                          style="justify-self:start;border:1px solid #fdba74;border-radius:6px;background:#fff;color:#9a3412;padding:5px 8px;font-size:11px;cursor:pointer"
                          @click=${() => onNavigate(item.tab)}
                        >
                          去${item.label}
                        </button>
                      </div>
                    `,
                  )
                : html`<div style="font-size:12px;color:#047857">
                    当前主流程没有阻塞项，可以按主动作继续。
                  </div>`}
          </div>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text-tertiary,#888)">
        安全边界：当前页只能推进
        ${title}；不能绕过观察、归因、目标、规划、调度直接执行岗位。阶段：${currentStage ||
        "未识别"}
      </div>
    </section>
  `;
}

function mainFlowExecutionClosureStatusLabel(status: string) {
  const labels: Record<string, string> = {
    not_ready: "未就绪",
    ready_to_run: "可运行",
    running: "运行中",
    completed: "闭环完成",
    blocked: "阻塞",
    failed: "失败",
  };
  return labels[status] ?? (status || "未知");
}

function mainFlowExecutionClosureStatusColor(status: string) {
  if (status === "completed" || status === "ready_to_run") return "#2f855a";
  if (status === "running") return "#805ad5";
  if (status === "blocked" || status === "failed") return "#c53030";
  return "#b7791f";
}

function mainFlowExecutionClosureTarget(value: unknown): Tab | null {
  const target = String(value ?? "");
  return ["apiManagement", "usage", "skills", "workboard", "aics"].includes(target)
    ? (target as Tab)
    : mainFlowFixTab(target);
}

function mainFlowExecutionClosureTargetLabel(tab: string) {
  const labels: Record<string, string> = {
    apiManagement: "API 管理",
    usage: "费用与授权",
    skills: "工具与 Skill",
    workboard: "任务调度",
    aics: "岗位执行",
  };
  return labels[tab] ?? "对应页面";
}

function mainFlowBusinessArtifactLabel(ref: string, index: number): string {
  const value = ref.trim();
  if (!value) return "业务产物 " + (index + 1);
  if (/^artifact:role-result:/iu.test(value)) return "岗位执行业务产物";
  if (/^artifact:/iu.test(value)) return "业务产物 " + (index + 1);
  if (/^external_record:/iu.test(value)) return "外部业务记录";
  if (/artifact-manifest\.json$/iu.test(value)) return "产物清单";
  if (/artifacts\.zip$/iu.test(value)) return "打包文件";
  const fileName = value.split("/").filter(Boolean).at(-1) ?? value;
  return (
    fileName.replace(/\.(md|json|html|png|jpg|jpeg|webp|zip)$/iu, "") || `业务产物 ${index + 1}`
  );
}

function mainFlowBusinessArtifactListLabel(refs: string[]): string {
  return refs.map((ref, index) => mainFlowBusinessArtifactLabel(ref, index)).join(" / ");
}

function mainFlowAuditEvidenceLabel(ref: string, index: number): string {
  const value = ref.trim();
  if (!value) return "审计记录 " + (index + 1);
  if (/^audit:/iu.test(value)) return "审计记录 " + (index + 1);
  return value;
}

function mainFlowLedgerEvidenceLabel(ref: string): string {
  const value = ref.trim();
  if (!value) return "账本记录";
  if (/^ledger:/iu.test(value)) return "账本记录";
  return value;
}

function mainFlowEvidenceSummaryDisplayValue(item: Record<string, unknown>): string {
  const label = String(item.label ?? "");
  const value = String(item.value ?? "");
  if (label.includes("业务产物")) return mainFlowBusinessArtifactLabel(value, 0);
  if (label.includes("审计") && value.trim()) return mainFlowAuditEvidenceLabel(value, 0);
  if (label.includes("账本") && value.trim()) return mainFlowLedgerEvidenceLabel(value);
  return value;
}

function renderMainFlowExecutionClosureSummary(
  readModel: Record<string, unknown> | null | undefined,
  onNavigate: (tab: Tab) => void,
  options: { compact?: boolean; observationCandidate?: boolean; apiBoundary?: boolean } = {},
) {
  const closure = asRecord(readModel?.executionClosure);
  if (!closure) return nothing;

  const status = String(closure.status ?? "not_ready");
  const evidence = asRecord(closure.evidenceReadback) ?? {};
  if (options.observationCandidate && evidence.hasRoleResult !== true) return nothing;
  const businessResult = asRecord(closure.businessResult);
  const nextObservationCandidate = asRecord(closure.nextObservationCandidate);
  const candidateArtifactTitles = Array.isArray(nextObservationCandidate?.artifactTitles)
    ? (nextObservationCandidate.artifactTitles as unknown[]).filter(
        (item): item is string => typeof item === "string" && Boolean(item.trim()),
      )
    : [];
  const artifactRefs = Array.isArray(businessResult?.artifactRefs)
    ? (businessResult.artifactRefs as unknown[]).filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const summary = String(nextObservationCandidate?.summary ?? businessResult?.summary ?? "");
  const missingEvidence = Array.isArray(closure.missingEvidence)
    ? (closure.missingEvidence as unknown[]).filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const readinessChecks = asRecordArray(closure.readinessChecks);
  const evidenceSummary = asRecordArray(closure.evidenceSummary);
  const recoveryActions = asRecordArray(closure.recoveryActions);
  const productionFinalGate = asRecord(closure.productionFinalGate);
  const productionOperatorChecklist = asRecordArray(productionFinalGate?.operatorChecklist);
  const productionOperatorSteps = asRecordArray(productionFinalGate?.operatorSteps);
  const productionRequiredInputs = Array.isArray(productionFinalGate?.requiredInputs)
    ? (productionFinalGate.requiredInputs as unknown[]).filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const statusColor = mainFlowExecutionClosureStatusColor(status);
  const border =
    status === "completed"
      ? "#9ae6b4"
      : status === "blocked" || status === "failed"
        ? "#feb2b2"
        : "#f6e05e";
  const background =
    status === "completed"
      ? "#f0fff4"
      : status === "blocked" || status === "failed"
        ? "#fff5f5"
        : "#fffaf0";
  const hasExecutionProblemForNextObservation =
    options.observationCandidate && (status === "blocked" || status === "failed");
  const title = options.observationCandidate
    ? String(
        nextObservationCandidate?.title ??
          (hasExecutionProblemForNextObservation
            ? "这次执行暴露出新的问题"
            : "上一轮执行结果可用于观察"),
      )
    : options.apiBoundary
      ? "执行闭环系统状态"
      : "执行闭环状态";
  const description = options.observationCandidate
    ? hasExecutionProblemForNextObservation
      ? "这次执行没有完成闭环，但失败原因、缺失证据和修复动作可以作为下一轮数据分析的观察候选。"
      : "这个结果已经完成业务产物、审计、账本，以及模型用量或未调用模型说明读回，可以作为下一轮数据分析证据候选。"
    : options.apiBoundary
      ? "这里只判断系统能否使用、缺哪个连接或证据；费用明细仍在费用与授权查看。"
      : "同一条闭环状态会同步到岗位执行、API 管理、费用与授权和观察页。";
  const evidenceRows: Array<[string, boolean]> = [
    ["执行结果", evidence.hasRoleResult === true],
    ["业务产物", evidence.hasBusinessArtifact === true],
    ["审计", evidence.hasAudit === true],
    ["账本", evidence.hasLedger === true],
  ];
  const modelUsageStatus = String(evidence.modelUsageStatus ?? "");
  const modelUsageMessage = String(evidence.modelUsageMessage ?? "");
  const modelUsageLabel = modelUsageStatus === "not_applicable" ? "模型证据：无需" : "模型证据";

  return html`
    <section
      data-testid="main-flow-execution-closure-summary"
      style="border:1px solid ${border};border-radius:8px;background:${background};padding:${options.compact
        ? "10px"
        : "14px"};margin-bottom:16px;display:grid;gap:10px"
    >
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div style="display:grid;gap:4px">
          <div style="font-size:12px;color:var(--text-secondary,#666)">${title}</div>
          <strong
            style="font-size:${options.compact ? "14px" : "16px"};color:var(--text-primary,#222)"
          >
            ${mainFlowExecutionClosureStatusLabel(status)}
          </strong>
          <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.5">
            ${description}
          </div>
        </div>
        <span style="font-size:12px;font-weight:700;color:${statusColor};white-space:nowrap">
          ${closure.canRun === true ? "可运行" : "不可运行"}
        </span>
      </div>

      ${readinessChecks.length
        ? html`
            <div style="display:grid;gap:5px">
              <div style="font-size:12px;font-weight:700;color:var(--text-primary,#222)">
                运行条件
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${readinessChecks.map((check) => {
                  const passed = check.status === "passed";
                  return html`
                    <span
                      title=${String(check.detail ?? "")}
                      style="font-size:11px;border:1px solid ${passed
                        ? "#9ae6b4"
                        : "#feb2b2"};border-radius:999px;padding:3px 7px;color:${passed
                        ? "#2f855a"
                        : "#c53030"};background:var(--bg-elevated,#fff)"
                    >
                      ${String(check.label ?? "条件")}：${passed ? "已满足" : "缺失"}
                    </span>
                  `;
                })}
              </div>
            </div>
          `
        : nothing}

      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${evidenceRows.map(
          ([label, ok]) => html`
            <span
              style="font-size:11px;border:1px solid ${ok
                ? "#9ae6b4"
                : "#feb2b2"};border-radius:999px;padding:3px 7px;color:${ok
                ? "#2f855a"
                : "#c53030"};background:var(--bg-elevated,#fff)"
            >
              ${label}：${ok ? "已读回" : "缺失"}
            </span>
          `,
        )}
        <span
          title=${modelUsageMessage}
          style="font-size:11px;border:1px solid ${evidence.hasModelUsage === true
            ? "#9ae6b4"
            : "#feb2b2"};border-radius:999px;padding:3px 7px;color:${evidence.hasModelUsage === true
            ? "#2f855a"
            : "#c53030"};background:var(--bg-elevated,#fff)"
        >
          ${modelUsageLabel}：${evidence.hasModelUsage === true
            ? modelUsageStatus === "not_applicable"
              ? "无需"
              : "已读回"
            : "缺失"}
        </span>
      </div>

      ${summary
        ? html`
            <div style="font-size:12px;line-height:1.55;color:var(--text-secondary,#666)">
              <strong style="color:var(--text-primary,#222)">业务摘要：</strong>${summary}
              ${candidateArtifactTitles.length || artifactRefs.length
                ? html`<div style="margin-top:3px">
                    产物：${candidateArtifactTitles.length
                      ? candidateArtifactTitles.join("、")
                      : mainFlowBusinessArtifactListLabel(artifactRefs)}
                  </div>`
                : nothing}
            </div>
          `
        : nothing}
      ${evidenceSummary.length
        ? html`
            <div style="display:grid;gap:5px">
              <div style="font-size:12px;font-weight:700;color:var(--text-primary,#222)">
                证据摘要
              </div>
              <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">
                ${evidenceSummary.map((item) => {
                  const available = item.status === "available";
                  return html`
                    <div
                      style="border:1px solid ${available
                        ? "#c6f6d5"
                        : "#fed7d7"};border-radius:6px;padding:7px;background:var(--bg-elevated,#fff);font-size:12px;line-height:1.45"
                    >
                      <strong style="color:var(--text-primary,#222)"
                        >${String(item.label ?? "证据")}</strong
                      >
                      <div style="color:${available ? "#2f855a" : "#c53030"}">
                        ${mainFlowEvidenceSummaryDisplayValue(item) ||
                        (available ? "已读回" : "缺失")}
                      </div>
                    </div>
                  `;
                })}
              </div>
            </div>
          `
        : nothing}
      ${missingEvidence.length
        ? html`
            <div style="font-size:12px;color:#c53030;line-height:1.5">
              缺口：${missingEvidence.join("；")}
            </div>
          `
        : nothing}
      ${options.observationCandidate
        ? html`
            <div
              style="border:1px solid #bee3f8;border-radius:7px;background:#ebf8ff;padding:9px;font-size:12px;color:#2a4365;line-height:1.55;display:grid;gap:3px"
            >
              <strong>建议进入下一轮观察</strong>
              <span
                >${String(
                  nextObservationCandidate?.boundary ??
                    "只作为观察候选，不会自动创建新目标，仍需你确认后进入下一轮分析。",
                )}</span
              >
              ${nextObservationCandidate?.failureReason
                ? html`<span>失败原因：${String(nextObservationCandidate.failureReason)}</span>`
                : nothing}
              ${hasExecutionProblemForNextObservation
                ? html`<span>失败/阻塞原因会作为新观察事实，用来判断下一轮主要卡点。</span>`
                : html`<span
                    >业务结果、产物和证据完整性会作为新观察事实，用来判断下一轮是否继续优化。</span
                  >`}
            </div>
          `
        : nothing}
      ${productionFinalGate
        ? html`
            <div
              style="border:1px solid #fbd38d;border-radius:7px;background:#fffaf0;padding:9px;font-size:12px;color:#744210;line-height:1.5;display:grid;gap:3px"
            >
              <strong>云端 SaaS 最终验收：未执行（本地版可跳过）</strong>
              <span
                >云端必须结果：${String(
                  productionFinalGate.requiredVerdict ?? "production_plus_passed",
                )}</span
              >
              <span>${String(productionFinalGate.reason ?? "云端 SaaS 最终验收还未执行。")}</span>
              <span
                >下一步：${String(
                  productionFinalGate.nextAction ??
                    "需要云端 SaaS 时再运行 production-plus orchestrator。",
                )}</span
              >
              ${productionOperatorChecklist.length
                ? html`
                    <div style="display:grid;gap:3px;margin-top:2px">
                      <strong>真人准备清单</strong>
                      ${productionOperatorChecklist.map(
                        (item) => html`
                          <span>
                            ${String(item.label ?? "准备项")}：${String(item.detail ?? "待确认")}
                            ${item.requiredInput ? `（需要：${String(item.requiredInput)}）` : ""}
                          </span>
                        `,
                      )}
                    </div>
                  `
                : nothing}
              ${productionOperatorSteps.length
                ? html`
                    <div style="display:grid;gap:3px;margin-top:2px">
                      <strong>云端 SaaS 操作步骤</strong>
                      ${productionOperatorSteps.map((item) => {
                        const requiredInputs = Array.isArray(item.requiredInputs)
                          ? (item.requiredInputs as unknown[]).filter(
                              (input): input is string =>
                                typeof input === "string" && Boolean(input.trim()),
                            )
                          : [];
                        return html`
                          <span>
                            ${String(item.step ?? "操作步骤")}：${String(item.action ?? "待处理")}
                            ${requiredInputs.length ? `（需要：${requiredInputs.join("、")}）` : ""}
                          </span>
                        `;
                      })}
                    </div>
                  `
                : nothing}
              ${productionRequiredInputs.length
                ? html`<span>需要准备：${productionRequiredInputs.join("、")}</span>`
                : nothing}
              ${productionFinalGate.readinessCommand
                ? html`<span>先跑 readiness：${String(productionFinalGate.readinessCommand)}</span>`
                : nothing}
              ${productionFinalGate.finalCommand
                ? html`<span>最终验收：${String(productionFinalGate.finalCommand)}</span>`
                : nothing}
              ${productionFinalGate.secretHandling
                ? html`<span>密钥处理：${String(productionFinalGate.secretHandling)}</span>`
                : nothing}
            </div>
          `
        : nothing}
      ${options.observationCandidate && recoveryActions.length
        ? html`
            <div style="display:grid;gap:6px">
              <div style="font-size:12px;font-weight:700;color:var(--text-primary,#222)">
                可记录的修复动作
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                ${recoveryActions.slice(0, 4).map((action) => {
                  const target = mainFlowExecutionClosureTarget(action.targetTab);
                  return html`
                    <button
                      type="button"
                      class="secondary"
                      style="font-size:12px;padding:5px 9px"
                      ?disabled=${!target}
                      title=${String(action.reason ?? "")}
                      @click=${() => target && onNavigate(target)}
                    >
                      ${String(
                        action.label ??
                          (target ? `去${mainFlowExecutionClosureTargetLabel(target)}` : "去处理"),
                      )}
                    </button>
                  `;
                })}
              </div>
            </div>
          `
        : recoveryActions.length && !options.observationCandidate
          ? html`
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                ${recoveryActions.slice(0, 4).map((action) => {
                  const target = mainFlowExecutionClosureTarget(action.targetTab);
                  return html`
                    <button
                      type="button"
                      class="secondary"
                      style="font-size:12px;padding:5px 9px"
                      ?disabled=${!target}
                      title=${String(action.reason ?? "")}
                      @click=${() => target && onNavigate(target)}
                    >
                      ${String(
                        action.label ??
                          (target ? `去${mainFlowExecutionClosureTargetLabel(target)}` : "去处理"),
                      )}
                    </button>
                  `;
                })}
              </div>
            `
          : html`
              <div>
                <button
                  type="button"
                  class="secondary"
                  style="font-size:12px;padding:5px 9px"
                  @click=${() => onNavigate(options.observationCandidate ? "observation" : "aics")}
                >
                  ${options.observationCandidate ? "查看数据分析" : "回到岗位执行继续闭环"}
                </button>
              </div>
            `}
    </section>
  `;
}

function renderMainFlowLayerNote(params: {
  title: string;
  body: string;
  actionLabel?: string;
  actionTab?: Tab;
  onNavigate: (tab: Tab) => void;
  tone?: "info" | "warn" | "ok";
}) {
  const tone = params.tone ?? "info";
  const border = tone === "ok" ? "#9ae6b4" : tone === "warn" ? "#f6ad55" : "#bee3f8";
  const background = tone === "ok" ? "#f0fff4" : tone === "warn" ? "#fffaf0" : "#ebf8ff";
  const color = tone === "ok" ? "#22543d" : tone === "warn" ? "#744210" : "#2b6cb0";
  return html`
    <section
      style="border:1px solid ${border};border-radius:8px;background:${background};padding:12px;margin-bottom:14px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"
    >
      <div style="display:grid;gap:4px;min-width:260px">
        <strong style="font-size:13px;color:${color}">${params.title}</strong>
        <span style="font-size:12px;color:${color};line-height:1.55">${params.body}</span>
      </div>
      ${params.actionLabel && params.actionTab
        ? html`
            <button
              type="button"
              class="secondary"
              style="font-size:12px;padding:6px 10px"
              @click=${() => params.onNavigate(params.actionTab!)}
            >
              ${params.actionLabel}
            </button>
          `
        : nothing}
    </section>
  `;
}

function renderBusinessOverviewPage(state: AppViewState, requestHostUpdate?: () => void) {
  const mf = state.aicsMainFlow;
  const readModel = mf?.readModel as Record<string, unknown> | null;
  const nextObservationSummary = (readModel?.nextObservationSummary ?? null) as Record<
    string,
    unknown
  > | null;
  const nextObservationArtifacts = Array.isArray(nextObservationSummary?.artifactTitles)
    ? (nextObservationSummary.artifactTitles as string[])
    : [];
  const counts = (readModel?.counts ?? {}) as Record<string, number>;
  const latest = (readModel?.latest ?? {}) as Record<string, unknown>;
  const readiness = (readModel?.readiness ?? {}) as Record<string, boolean>;
  const blockedReasons = (readModel?.blockedReasons ?? []) as Array<Record<string, unknown>>;
  const draft = state.businessIntentDraft ?? "";
  const loading = mf?.loading ?? false;
  const latestInteraction = latest.interaction as Record<string, unknown> | null;
  const latestObservation = latest.observationPackage as Record<string, unknown> | null;
  const flowSteps = [
    {
      title: "数据分析",
      count: counts.observations ?? 0,
      ready: readiness.canPrepareAttribution === true,
      next: "开始观察后生成初始观察包",
    },
    {
      title: "归因分析",
      count: counts.attributions ?? 0,
      ready: readiness.canCreateGoalCandidate === true,
      next: "基于观察信号生成归因报告",
    },
    {
      title: "公司目标",
      count: counts.goals ?? 0,
      ready: readiness.canPreparePlanning === true,
      next: "确认正式公司目标",
    },
    {
      title: "规划方案",
      count: counts.planningPackages ?? 0,
      ready: readiness.canCreateDispatchProposal === true,
      next: "确认规划方案与工作块",
    },
    {
      title: "任务调度",
      count: counts.dispatchProposalReviews ?? 0,
      ready: readiness.canMaterializeTaskPackage === true,
      next: "预检通过后生成派发单",
    },
    {
      title: "岗位执行",
      count: counts.roleResults ?? 0,
      ready: readiness.canEnterRoleExecution === true,
      next: "确认授权、费用和执行条件后运行",
    },
  ];

  return html`<div style="padding:16px;max-width:960px;margin:0 auto">
    <div
      style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px"
    >
      <div>
        <h1 style="font-size:20px;margin:0 0 6px 0">经营概览</h1>
        <p style="font-size:13px;color:var(--text-secondary,#666);margin:0">
          从经营意图开始，创建观察数据，再按六层主流程推进。
        </p>
      </div>
      <button
        @click=${() => state.refreshAicsMainFlowReadModel?.()}
        style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
        ?disabled=${loading}
      >
        ${loading ? "刷新中..." : "刷新"}
      </button>
    </div>
    ${mf?.error
      ? html`<div
          style="padding:10px;background:#fff5f5;border:1px solid #e53e3e;border-radius:6px;margin-bottom:12px;color:#c53030;font-size:13px"
        >
          ${mf.error}
        </div>`
      : nothing}
    ${renderMainFlowHumanizedPanel(readModel, state.setTab.bind(state), "full")}
    ${renderMainFlowExecutionClosureSummary(readModel, state.setTab.bind(state), {
      observationCandidate: true,
    })}
    <div
      style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(320px,1.2fr);gap:16px;margin-bottom:16px"
    >
      <section style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px">
        <div style="font-weight:700;margin-bottom:6px">开始观察</div>
        <div style="font-size:12px;color:var(--text-secondary,#666);margin-bottom:10px">
          这里不会直接定目标或调岗位，只会生成观察层的初始数据包。
        </div>
        <div style="display:grid;gap:6px;margin-bottom:10px">
          <div style="font-size:12px;font-weight:700">常用观察问题</div>
          ${[
            "提升岗位商城首批岗位授权转化率，并找出用户卡在授权、API 还是岗位理解上。",
            "补齐高价值岗位供给，优先发现哪些岗位商品、能力标签和输出样例不足。",
            "提升岗位执行成功率，定位模型 API、工具/Skill、调度派发和审计回写的主要阻塞。",
          ].map(
            (template) => html`<button
              type="button"
              style="text-align:left;border:1px solid var(--border-color,#ddd);border-radius:6px;background:var(--bg-elevated,#fff);padding:7px 9px;font-size:12px;cursor:pointer;color:var(--text-primary,#111)"
              @click=${() => {
                state.businessIntentDraft = template;
                requestHostUpdate?.();
              }}
            >
              ${template}
            </button>`,
          )}
        </div>
        <textarea
          .value=${draft}
          @input=${(event: InputEvent) => {
            state.businessIntentDraft = (event.target as HTMLTextAreaElement).value;
            requestHostUpdate?.();
          }}
          placeholder="例如：提升岗位商城首批岗位授权转化与执行成功率，先找出云端商城、本地 OpenClaw、岗位供给、能力路由、API/模型/工具、调度执行和外部可吸收能力之间的主要问题。"
          style="width:100%;min-height:132px;resize:vertical;padding:10px;border:1px solid var(--border-color,#ccc);border-radius:6px;background:var(--bg-primary,#fff);color:var(--text-primary,#111);font:inherit;font-size:13px;box-sizing:border-box"
        ></textarea>
        <div
          style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px"
        >
          <span style="font-size:11px;color:var(--text-secondary,#888)"
            >输出：云端商城、本地端、岗位能力、调度执行、外部能力和风险观察</span
          >
          <button
            @click=${() =>
              aicsMainFlow
                .submitBusinessIntent(state, state.businessIntentDraft ?? "")
                .then(() => requestHostUpdate?.())}
            title=${!draft.trim()
              ? "先填写经营意图，系统才会生成初始观察包。"
              : "开始观察并生成初始观察包。"}
            ?disabled=${loading || !draft.trim()}
            style="padding:7px 14px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:${loading ||
            !draft.trim()
              ? "not-allowed"
              : "pointer"};font-size:12px;opacity:${loading || !draft.trim() ? 0.55 : 1}"
          >
            开始观察
          </button>
        </div>
      </section>
      <section style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px">
        <div style="font-weight:700;margin-bottom:10px">主流程状态</div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
          ${flowSteps.map(
            (step) => html`<div
              style="border:1px solid var(--border-color,#eee);border-radius:6px;padding:10px;background:var(--bg-secondary,#f8fafc)"
            >
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
                <strong style="font-size:13px">${step.title}</strong>
                <span style="font-size:11px;color:${step.ready ? "#38a169" : "#a0aec0"}"
                  >${step.ready ? "就绪" : "待推进"}</span
                >
              </div>
              <div style="font-size:20px;font-weight:700;margin:4px 0">${step.count}</div>
              <div style="font-size:11px;color:var(--text-secondary,#777)">${step.next}</div>
            </div>`,
          )}
        </div>
      </section>
    </div>
    <div style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(280px,1fr);gap:16px">
      <section style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px">
        <div style="font-weight:700;margin-bottom:8px">最近经营输入</div>
        ${latestInteraction
          ? html`
              <div style="font-size:13px;margin-bottom:6px">
                ${latestInteraction.message as string}
              </div>
              <div style="font-size:11px;color:var(--text-secondary,#888)">
                下一步：${String(
                  latestInteraction.proposedNextAction ?? "prepare_observation_package",
                )}
              </div>
            `
          : html`<div style="font-size:12px;color:var(--text-secondary,#777)">
              还没有经营意图。填写后会生成初始观察包。
            </div>`}
      </section>
      <section style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px">
        <div style="font-weight:700;margin-bottom:8px">当前阻塞</div>
        ${blockedReasons.length > 0
          ? blockedReasons
              .slice(0, 4)
              .map(
                (reason) => html`
                  <div style="font-size:12px;color:#c05621;margin-bottom:5px">
                    ${mainFlowBlockerLabel(reason)}
                  </div>
                `,
              )
          : html`<div style="font-size:12px;color:#38a169">当前主流程没有阻塞项。</div>`}
        ${latestObservation
          ? html`<button
              @click=${() => state.setTab("observation")}
              style="margin-top:10px;padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
            >
              查看数据分析包
            </button>`
          : nothing}
      </section>
    </div>
  </div>`;
}

const MARKETPLACE_OBSERVATION_VIEW_DOMAINS = [
  "云端岗位商城观察",
  "本地 OpenClaw 运行观察",
  "岗位供给与能力观察",
  "用户/管理者使用观察",
  "调度与执行链路观察",
  "外部产品与竞品观察",
  "外部技术/工具/模型观察",
  "可吸收能力库观察",
  "风险与数据质量观察",
] as const;

const MARKETPLACE_ATTRIBUTION_VIEW_CAUSES = [
  "云端商城问题",
  "本地 OpenClaw 问题",
  "岗位供给问题",
  "授权与费用问题",
  "能力路由问题",
  "API / 模型 / 工具 / Skill 问题",
  "页面体验问题",
  "调度链路问题",
  "岗位执行质量问题",
  "外部能力未吸收",
  "外部竞品/产品压力",
  "风险与数据质量问题",
  "目标设定问题",
] as const;

const OBSERVATION_SIGNAL_GROUPS = [
  {
    title: "内部经营数据",
    hint: "授权、执行、转化、失败、客服反馈等本地和云端经营事实。",
    keywords: ["授权", "执行", "转化", "失败", "经营", "用户", "管理者", "账本"],
  },
  {
    title: "云端商城数据",
    hint: "岗位商品、能力、审核、分类、可调用状态和云端投影。",
    keywords: ["云端", "商城", "岗位", "商品", "能力", "审核", "分类"],
  },
  {
    title: "本地 OpenClaw 数据",
    hint: "Gateway、API、工具、Skill、调度、岗位执行和本地运行状态。",
    keywords: ["本地", "OpenClaw", "Gateway", "API", "工具", "Skill", "调度"],
  },
  {
    title: "外部机会 / 风险",
    hint: "可吸收的技术、工具、产品能力，以及外部风险和数据质量问题。",
    keywords: ["外部", "竞品", "技术", "工具", "模型", "风险", "机会"],
  },
] as const;

function observationSignalGroup(signal: Record<string, unknown>) {
  const haystack = `${String(signal.title ?? "")} ${String(signal.summary ?? "")}`;
  return (
    OBSERVATION_SIGNAL_GROUPS.find((group) =>
      group.keywords.some((keyword) => haystack.includes(keyword)),
    ) ?? OBSERVATION_SIGNAL_GROUPS[0]
  );
}

function signalCredibilityLabel(signal: Record<string, unknown>) {
  const confidence = String(signal.confidence ?? signal.credibility ?? "");
  if (confidence === "high") return "高可信";
  if (confidence === "medium") return "中可信";
  if (confidence === "low") return "低可信";
  return "待标记";
}

function signalCollectedAt(signal: Record<string, unknown>) {
  const value = signal.collectedAt ?? signal.updatedAt ?? signal.createdAt;
  return typeof value === "number" ? new Date(value).toLocaleString() : "待采集";
}

function observationSourceKindLabel(kind: unknown): string {
  switch (kind) {
    case "internal_read_model":
      return "内部数据";
    case "gateway_api":
      return "网关 API";
    case "external_web_search":
      return "外部搜索";
    case "external_web_fetch":
      return "外部网页";
    case "external_api":
      return "外部 API";
    case "file_parse":
      return "文件解析";
    case "database_query":
      return "数据库查询";
    case "tool":
      return "工具";
    case "skill":
      return "Skill";
    case "manual":
      return "人工输入";
    default:
      return "观察来源";
  }
}

function renderObservationWorkspacePanel(params: {
  readModel: Record<string, unknown> | null;
  observationPackage: Record<string, unknown> | null;
  signals: Array<Record<string, unknown>>;
}) {
  const latest = (params.readModel?.latest ?? {}) as Record<string, unknown>;
  const counts = (params.readModel?.counts ?? {}) as Record<string, number>;
  const workspace = (params.readModel?.observationWorkspace ?? null) as Record<
    string,
    unknown
  > | null;
  const businessContext = (workspace?.businessContext ?? null) as Record<string, unknown> | null;
  const guidance = (workspace?.guidance ?? null) as Record<string, unknown> | null;
  const workspaceObjects = Array.isArray(workspace?.objects)
    ? (workspace.objects as Array<Record<string, unknown>>)
    : [];
  const workspaceSources = Array.isArray(workspace?.sources)
    ? (workspace.sources as Array<Record<string, unknown>>)
    : [];
  const workspaceToolPlans = Array.isArray(workspace?.toolPlans)
    ? (workspace.toolPlans as Array<Record<string, unknown>>)
    : [];
  const workspaceEvidence = Array.isArray(workspace?.evidence)
    ? (workspace.evidence as Array<Record<string, unknown>>)
    : [];
  const workspaceCandidate = (workspace?.candidate ?? null) as Record<string, unknown> | null;
  const collectionReadiness = (workspace?.collectionReadiness ?? null) as Record<
    string,
    unknown
  > | null;
  const qualitySummary = (workspaceCandidate?.qualitySummary ?? {}) as Record<string, number>;
  const blockedCollectionDetails = Array.isArray(collectionReadiness?.blockedDetails)
    ? (collectionReadiness.blockedDetails as Array<Record<string, unknown>>)
    : [];
  const uncoveredRequiredObjectIds = Array.isArray(workspaceCandidate?.uncoveredRequiredObjectIds)
    ? (workspaceCandidate.uncoveredRequiredObjectIds as unknown[]).map((item) => String(item))
    : [];
  const latestInteraction = latest.interaction as Record<string, unknown> | null | undefined;
  const currentGoal = latest.companyGoal as Record<string, unknown> | null | undefined;
  const businessDescription =
    String(businessContext?.businessDescription ?? "").trim() ||
    String(latestInteraction?.message ?? "").trim() ||
    String(currentGoal?.title ?? "").trim() ||
    "系统将根据当前账号的经营输入、主流程状态和可用数据源动态建模观察对象。";
  const hasObservation = Boolean(params.observationPackage);
  const hasAcceptedSignals = params.signals.length > 0;
  const observationObjects = workspaceObjects.length
    ? workspaceObjects.map((object) => ({
        id: String(object.id ?? ""),
        title: String(object.name ?? object.id ?? "观察对象"),
        detail: String(object.description ?? object.whyObserve ?? "等待补充观察说明。"),
        ready: object.status === "active" || hasObservation,
        missing: String(object.whyObserve ?? ""),
      }))
    : [
        {
          id: "business-health",
          title: "业务健康状态",
          detail: "观察当前业务是否能正常完成核心经营闭环。",
          ready: hasObservation,
        },
        {
          id: "customer-action",
          title: "用户关键动作",
          detail: "观察用户在哪些页面、确认点或修复动作上卡住。",
          ready: Boolean(counts.interactions),
        },
        {
          id: "role-supply",
          title: "岗位供给与授权",
          detail: "观察岗位商品、审核、授权、能力标签和可调用状态。",
          ready: Boolean(counts.dispatchToRoleRequests || counts.taskPackages),
        },
        {
          id: "execution-chain",
          title: "调度执行链路",
          detail: "观察规划、派发、执行、失败、审计和账本回读。",
          ready: Boolean(counts.taskPackages || counts.roleResults),
        },
        {
          id: "api-tool-skill",
          title: "API、工具与 Skill",
          detail: "观察模型 Provider、API、工具、Skill 和 SecretRef 是否可用。",
          ready: Boolean(params.readModel?.executionPreflight),
        },
        {
          id: "external-factor",
          title: "外部机会与风险",
          detail: "观察外部产品、工具、模型、竞品和可吸收能力变化。",
          ready: false,
          missing: "需要授权外部搜索、网页读取或相关 Skill 后采集。",
        },
      ];
  const sources = workspaceSources.length
    ? workspaceSources.map((source) => {
        const ok = source.canAccess === true;
        return {
          title: String(source.label ?? source.id ?? "观察来源"),
          detail: String(source.missingRequirement ?? "可作为观察证据来源。"),
          kind: observationSourceKindLabel(source.sourceKind),
          status: ok ? "可读取" : "待补条件",
          ok,
        };
      })
    : [
        {
          title: "内部主流程",
          detail: "目标、规划、调度、岗位执行和结果回写。",
          kind: "内部数据",
          status: params.readModel ? "可读取" : "待刷新",
          ok: Boolean(params.readModel),
        },
        {
          title: "现有观察包",
          detail: "已采集事实、证据引用、可信度和缺失标记。",
          kind: "内部数据",
          status: hasObservation ? "可读取" : "待生成",
          ok: hasObservation,
        },
        {
          title: "工具 / Skill / 外部信息",
          detail: "用于外部搜索、网页读取、质量检查和信息抽取。",
          kind: "工具 / Skill",
          status: "待授权采集",
          ok: false,
        },
      ];
  const toolPlanReadyCount = workspaceToolPlans.filter((plan) => plan.status === "ready").length;
  const toolPlanBlockedCount = workspaceToolPlans.filter(
    (plan) => plan.status === "blocked",
  ).length;
  const evidenceWithSourceCount = workspaceEvidence.filter((item) =>
    String(item.sourceRef ?? "").trim(),
  ).length;
  const canConfirmCandidate = workspaceCandidate
    ? workspaceCandidate.canConfirm === true
    : hasAcceptedSignals;
  const candidateStatus =
    String(guidance?.headline ?? "").trim() ||
    (hasAcceptedSignals ? "已有可确认事实，可复核后进入归因" : "暂无可信事实，不能进入正式归因");
  const uncoveredRequiredObjectLabels = uncoveredRequiredObjectIds.map((objectId) => {
    const object = observationObjects.find((item) => item.id === objectId);
    return object?.title ?? objectId;
  });

  return html`
    <section
      data-testid="observation-workspace-panel"
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;margin-bottom:14px;background:var(--bg-elevated,#fff);display:grid;gap:12px"
    >
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div style="display:grid;gap:4px">
          <div style="font-size:12px;color:var(--text-secondary,#666)">通用观察工作台</div>
          <strong style="font-size:15px;color:var(--text-primary,#222)"
            >先理解业务，再采集证据</strong
          >
          <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.5">
            ${businessDescription}
          </div>
        </div>
        <span
          style="font-size:12px;font-weight:700;color:${canConfirmCandidate
            ? "#2f855a"
            : "#b7791f"}"
        >
          ${canConfirmCandidate ? "可复核确认" : "需要补证据"}
        </span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
        <div
          style="border:1px solid var(--border-color,#edf2f7);border-radius:7px;padding:10px;background:var(--bg-secondary,#f8fafc)"
        >
          <div style="font-size:12px;font-weight:700;margin-bottom:6px">观察对象</div>
          <div style="display:grid;gap:6px">
            ${observationObjects.slice(0, 6).map(
              (item) => html`<div style="font-size:12px;line-height:1.4">
                <strong>${item.title}</strong>
                <span style="color:${item.ready ? "#2f855a" : "#b7791f"}">
                  · ${item.ready ? "已有数据" : "待采集"}</span
                >
                <div style="color:var(--text-secondary,#666)">${item.missing ?? item.detail}</div>
              </div>`,
            )}
          </div>
        </div>
        <div
          style="border:1px solid var(--border-color,#edf2f7);border-radius:7px;padding:10px;background:var(--bg-secondary,#f8fafc)"
        >
          <div style="font-size:12px;font-weight:700;margin-bottom:6px">数据源和工具</div>
          <div style="display:grid;gap:6px">
            ${sources.map(
              (source) => html`<div style="font-size:12px;line-height:1.4">
                <strong>${source.title}</strong>
                <span style="color:${source.ok ? "#2f855a" : "#b7791f"}">
                  · ${source.kind} · ${source.status}</span
                >
                <div style="color:var(--text-secondary,#666)">${source.detail}</div>
              </div>`,
            )}
          </div>
        </div>
        <div
          style="border:1px solid var(--border-color,#edf2f7);border-radius:7px;padding:10px;background:var(--bg-secondary,#f8fafc)"
        >
          <div style="font-size:12px;font-weight:700;margin-bottom:6px">观察包候选</div>
          <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.45">
            ${candidateStatus}
          </div>
          <div style="display:grid;gap:4px;margin-top:8px;font-size:12px">
            <div>
              真实来源：${Number(
                collectionReadiness?.accessibleSourceCount ??
                  sources.filter((source) => source.ok).length,
              )}
              个可读取 ·
              ${Number(
                collectionReadiness?.blockedSourceCount ??
                  sources.filter((source) => !source.ok).length,
              )}
              个待补条件
            </div>
            <div>
              缺连接：${Number(collectionReadiness?.missingSecretCount ?? 0)} ·
              缺权限：${Number(collectionReadiness?.missingScopeCount ?? 0)} ·
              待授权：${Number(collectionReadiness?.approvalRequiredCount ?? 0)}
            </div>
            <div>可信事实：${qualitySummary.accepted ?? params.signals.length}</div>
            <div>
              待验证：${qualitySummary.needsReview ??
              (hasObservation && !hasAcceptedSignals ? 1 : 0)}
            </div>
            <div>不可归因：${qualitySummary.rejected ?? 0} 条缺证据或采集失败</div>
            <div>
              采集计划：${Number(collectionReadiness?.readyToolPlanCount ?? toolPlanReadyCount)}
              个可运行 ·
              ${Number(collectionReadiness?.blockedToolPlanCount ?? toolPlanBlockedCount)}
              个待补条件
            </div>
            <div>证据来源：${evidenceWithSourceCount} 条可追溯</div>
            ${blockedCollectionDetails.length
              ? html`<div style="color:#b7791f">
                  修复建议：${blockedCollectionDetails
                    .slice(0, 2)
                    .map(
                      (item) =>
                        `${String(item.label ?? "观察来源")}：${String(item.repairAction ?? item.reason ?? "补齐采集条件")}`,
                    )
                    .join("；")}
                </div>`
              : nothing}
            ${uncoveredRequiredObjectLabels.length
              ? html`<div style="color:#b7791f">
                  还缺关键观察：${uncoveredRequiredObjectLabels.join("、")}
                </div>`
              : nothing}
            <div style="color:var(--text-secondary,#666)">
              无证据来源的内容只能待验证，不能进入正式归因。
            </div>
            <div>
              下一步：${String(
                guidance?.nextAction ??
                  (canConfirmCandidate ? "确认观察包" : "采集内部/外部/工具证据"),
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderObservationPage(state: AppViewState, requestHostUpdate?: () => void) {
  const mf = state.aicsMainFlow;
  const readModel = mf?.readModel as Record<string, unknown> | null;
  const externalUrlDraft = String(state.observationExternalUrlDraft ?? "").trim();
  const externalUrlValid = !externalUrlDraft || /^https?:\/\/\S+$/i.test(externalUrlDraft);
  const externalSourceParams =
    externalUrlDraft && externalUrlValid
      ? {
          externalSources: [
            {
              id: "manual_external_source_1",
              label: "手动外部观察来源",
              url: externalUrlDraft,
              kind: "technology_tool_model",
            },
          ],
        }
      : {};
  const lastObservationRun = (mf?.lastObservationRun ?? null) as Record<string, unknown> | null;
  const lastObservationPackage = (mf?.lastObservationPackage ?? null) as Record<
    string,
    unknown
  > | null;
  const latestObservationEvidenceRun = ((readModel?.latest as Record<string, unknown> | undefined)
    ?.observationEvidenceRun ?? null) as Record<string, unknown> | null;
  const lastRunEvidence = Array.isArray(lastObservationRun?.evidence)
    ? (lastObservationRun.evidence as Array<Record<string, unknown>>)
    : [];
  const lastRunQuality = Array.isArray(lastObservationRun?.qualityResults)
    ? (lastObservationRun.qualityResults as Array<Record<string, unknown>>)
    : [];
  const lastRunBlockedReasons = Array.isArray(lastObservationRun?.blockedReasons)
    ? (lastObservationRun.blockedReasons as unknown[]).map((item) => String(item))
    : [];
  const counts = (readModel?.counts ?? {}) as Record<string, number>;
  const latest = (readModel?.latest ?? {}) as Record<string, unknown>;
  const obs = latest.observationPackage as Record<string, unknown> | null;
  const blocked = ((readModel?.blockedReasons ?? []) as Array<Record<string, unknown>>).filter(
    (r: Record<string, unknown>) => r.stage === "observation",
  );
  const signals = (obs?.signals ?? []) as Array<Record<string, unknown>>;
  const groupedSignals = OBSERVATION_SIGNAL_GROUPS.map((group) => ({
    ...group,
    signals: signals.filter((signal) => observationSignalGroup(signal).title === group.title),
  }));
  const domainHits = MARKETPLACE_OBSERVATION_VIEW_DOMAINS.filter((domain) =>
    signals.some(
      (signal) =>
        String(signal.title ?? "").includes(domain) ||
        String(signal.summary ?? "").includes(domain.replace("观察", "")),
    ),
  ).length;
  const metrics = [
    { l: "数据包", v: counts.observations ?? 0 },
    { l: "事实数", v: signals.length },
    { l: "观察域", v: domainHits || MARKETPLACE_OBSERVATION_VIEW_DOMAINS.length },
    {
      l: "就绪",
      v: blocked.length === 0 ? "是" : "否",
      c: blocked.length === 0 ? "#38a169" : "#e53e3e",
    },
    { l: "阻塞", v: blocked.length, c: blocked.length > 0 ? "#e53e3e" : "#a0aec0" },
  ];

  return html`<div style="padding:16px;max-width:900px;margin:0 auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h1 style="font-size:20px;margin:0">数据分析</h1>
      <div style="display:flex;gap:8px">
        <button
          @click=${() =>
            aicsMainFlow
              .runObservationToolPlan(state, undefined, externalSourceParams)
              .then(() => requestHostUpdate?.())}
          ?disabled=${mf?.loading === true || !externalUrlValid}
          style="padding:6px 12px;background:#38a169;color:#fff;border:none;border-radius:4px;cursor:${mf?.loading ===
            true || !externalUrlValid
            ? "not-allowed"
            : "pointer"};font-size:12px;opacity:${mf?.loading === true || !externalUrlValid
            ? 0.55
            : 1}"
        >
          ${mf?.loading === true ? "观察中..." : "开始观察"}
        </button>
        <button
          @click=${() => {
            state.setTab("businessOverview");
            requestHostUpdate?.();
          }}
          style="padding:6px 12px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
        >
          去经营概览
        </button>
        <button
          @click=${() => state.refreshAicsMainFlowReadModel?.()}
          style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
        >
          刷新
        </button>
      </div>
    </div>
    <section
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:12px;margin-bottom:14px;background:var(--bg-elevated,#fff);display:grid;gap:8px"
    >
      <div style="display:grid;gap:4px">
        <strong style="font-size:13px">外部观察来源</strong>
        <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.45">
          可填一个公开网页、产品更新页、工具说明页或风险信息页。系统只读取，不写入外部系统；没有填写时只采集内部来源。
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input
          .value=${state.observationExternalUrlDraft ?? ""}
          @input=${(event: Event) => {
            state.observationExternalUrlDraft = (event.currentTarget as HTMLInputElement).value;
            requestHostUpdate?.();
          }}
          placeholder="例如：https://example.com/changelog"
          style="flex:1;min-width:0;padding:7px 9px;border:1px solid var(--border-color,#ccc);border-radius:6px;background:var(--bg-primary,#fff);color:var(--text-primary,#222);font-size:12px"
        />
        <button
          type="button"
          @click=${() => {
            state.observationExternalUrlDraft = "";
            requestHostUpdate?.();
          }}
          style="padding:7px 10px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:6px;cursor:pointer;font-size:12px"
        >
          清空
        </button>
      </div>
      ${externalUrlDraft && !externalUrlValid
        ? html`<div style="font-size:12px;color:#c53030">
            外部来源需要填写以 http:// 或 https:// 开头的公开网页地址。
          </div>`
        : nothing}
    </section>
    ${renderMainFlowHumanizedPanel(readModel, state.setTab.bind(state))}
    ${nextObservationSummary
      ? html`<section
          style="border:1px solid ${nextObservationSummary.readyForReview
            ? "#9ae6b4"
            : "#f6ad55"};background:${nextObservationSummary.readyForReview
            ? "#f0fff4"
            : "#fffaf0"};border-radius:8px;padding:12px;margin-bottom:14px;display:grid;gap:8px"
        >
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
            <div>
              <strong
                style="font-size:13px;color:${nextObservationSummary.readyForReview
                  ? "#276749"
                  : "#9c4221"}"
              >
                下一轮观察候选
              </strong>
              <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
                ${String(nextObservationSummary.userMessage ?? "等待执行结果形成观察候选。")}
              </div>
            </div>
            <span
              style="font-size:12px;font-weight:700;color:${nextObservationSummary.hasCandidate
                ? "#2f855a"
                : "#b7791f"}"
            >
              ${nextObservationSummary.hasCandidate ? "已有候选" : "暂无候选"}
            </span>
          </div>
          <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.5">
            ${String(nextObservationSummary.title ?? "还没有执行结果可作为下一轮观察")}：${String(
              nextObservationSummary.summary ?? "",
            )}
          </div>
          <div
            style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;font-size:12px"
          >
            <div>
              产物：${nextObservationArtifacts.length
                ? nextObservationArtifacts.join("、")
                : "暂无"}
            </div>
            <div>审计：${nextObservationSummary.auditComplete ? "完整" : "缺失"}</div>
            <div>账本：${nextObservationSummary.ledgerComplete ? "完整" : "缺失"}</div>
            <div>
              模型费用：${nextObservationSummary.modelUsageEvidence === "recorded"
                ? "已记录"
                : nextObservationSummary.modelUsageEvidence === "not_applicable"
                  ? "无需"
                  : "缺失"}
            </div>
          </div>
          ${nextObservationSummary.failureReason
            ? html`<div style="font-size:12px;color:#c53030">
                失败原因：${String(nextObservationSummary.failureReason)}
              </div>`
            : nothing}
          <div style="font-size:12px;color:var(--text-secondary,#666)">
            ${String(nextObservationSummary.boundary ?? "只作为观察候选，不自动创建新目标。")}
          </div>
        </section>`
      : nothing}
    ${renderMainFlowExecutionClosureSummary(readModel, state.setTab.bind(state), {
      observationCandidate: true,
    })}
    ${renderMainFlowLayerNote({
      title: "数据分析这一层只整理事实",
      body: "系统会按当前业务上下文动态发现内部数据、外部信息、工具和 Skill 证据源；确认后才允许进入归因，不在这里定目标或调岗位。",
      actionLabel: obs ? "继续归因分析" : "去经营概览补数据",
      actionTab: obs ? "attribution" : "businessOverview",
      onNavigate: state.setTab.bind(state),
      tone: obs ? "info" : "warn",
    })}
    ${lastObservationRun
      ? html`<section
          style="border:1px solid ${lastObservationRun.status === "completed"
            ? "#9ae6b4"
            : "#f6ad55"};background:${lastObservationRun.status === "completed"
            ? "#f0fff4"
            : "#fffaf0"};border-radius:8px;padding:12px;margin-bottom:14px;display:grid;gap:8px"
        >
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
            <div>
              <strong
                style="font-size:13px;color:${lastObservationRun.status === "completed"
                  ? "#276749"
                  : "#9c4221"}"
              >
                本次观察采集
              </strong>
              <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
                ${String(lastObservationRun.userMessage ?? "观察采集已返回结果。")}
              </div>
            </div>
            <span
              style="font-size:12px;font-weight:700;color:${lastObservationRun.status ===
              "completed"
                ? "#2f855a"
                : "#b7791f"}"
            >
              ${lastObservationRun.status === "completed"
                ? "已采集"
                : lastObservationRun.status === "blocked"
                  ? "有阻塞"
                  : "采集失败"}
            </span>
          </div>
          <div
            style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;font-size:12px"
          >
            <div>采集证据：${lastRunEvidence.length} 条</div>
            <div>
              可信证据：${lastRunQuality.filter((item) => item.status === "accepted").length} 条
            </div>
            <div>
              待修复：${lastRunBlockedReasons.length +
              lastRunQuality.filter((item) => item.status === "rejected").length}
              项
            </div>
          </div>
          ${lastRunEvidence.length
            ? html`<div style="display:grid;gap:6px">
                ${lastRunEvidence.slice(0, 3).map(
                  (item) => html`
                    <div
                      style="font-size:12px;line-height:1.45;border-top:1px solid rgba(0,0,0,0.08);padding-top:6px"
                    >
                      <strong>${String(item.statement ?? "观察事实")}</strong>
                      <div style="color:var(--text-secondary,#666)">
                        来源：${String(item.sourceLabel ?? "观察来源")} ·
                        可信度：${String(item.confidence ?? "待评估")} ·
                        新鲜度：${String(item.freshness ?? "待评估")}
                      </div>
                    </div>
                  `,
                )}
              </div>`
            : nothing}
          ${lastRunBlockedReasons.length
            ? html`<div style="font-size:12px;color:#9c4221;line-height:1.5">
                阻塞：${lastRunBlockedReasons.join("；")}
              </div>`
            : nothing}
          <div style="font-size:12px;color:var(--text-secondary,#666)">
            ${lastObservationPackage
              ? "可信证据已保存为待确认观察包；确认后才进入归因层。"
              : "本次采集还没有形成可确认观察包；修复阻塞或补采证据后再确认。"}
          </div>
          ${lastObservationPackage
            ? html`<div>
                <button
                  type="button"
                  @click=${() =>
                    aicsMainFlow
                      .confirmObservation(state, String(lastObservationPackage.id))
                      .then(() => requestHostUpdate?.())}
                  style="padding:6px 12px;background:#38a169;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
                >
                  确认本次观察
                </button>
              </div>`
            : nothing}
        </section>`
      : nothing}
    ${!lastObservationRun && latestObservationEvidenceRun
      ? html`<section
          style="border:1px solid #bee3f8;background:#ebf8ff;border-radius:8px;padding:12px;margin-bottom:14px;display:grid;gap:6px"
        >
          <strong style="font-size:13px;color:#2b6cb0">最近一次观察采集</strong>
          <div style="font-size:12px;color:var(--text-secondary,#666)">
            状态：${String(latestObservationEvidenceRun.status ?? "待确认")} ·
            可信证据：${Number(latestObservationEvidenceRun.acceptedCount ?? 0)} 条 ·
            待复核：${Number(latestObservationEvidenceRun.needsReviewCount ?? 0)} 条 ·
            不可归因：${Number(latestObservationEvidenceRun.rejectedCount ?? 0)} 条
          </div>
          ${Array.isArray(latestObservationEvidenceRun.blockedReasons) &&
          latestObservationEvidenceRun.blockedReasons.length
            ? html`<div style="font-size:12px;color:#9c4221">
                阻塞：${(latestObservationEvidenceRun.blockedReasons as unknown[])
                  .map((item) => String(item))
                  .join("；")}
              </div>`
            : nothing}
        </section>`
      : nothing}
    ${renderObservationWorkspacePanel({ readModel, observationPackage: obs, signals })}
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px">
      ${metrics.map(
        (m: Record<string, unknown>) =>
          html`<div
            style="text-align:center;padding:8px;border:1px solid var(--border-color,#e0e0e0);border-radius:6px"
          >
            <div
              style="font-size:20px;font-weight:700;color:${(m.c as string) ||
              "var(--text-primary,#333)"}"
            >
              ${m.v}
            </div>
            <div style="font-size:11px;color:var(--text-secondary,#666)">${m.l}</div>
          </div>`,
      )}
    </div>
    ${blocked.length > 0
      ? html`<div
          style="padding:10px;background:#fffaf0;border:1px solid #dd6b20;border-radius:6px;margin-bottom:12px"
        >
          ${blocked.map(
            (b: Record<string, unknown>) =>
              html`<div style="font-size:13px;color:#c05621">⚠ ${mainFlowBlockerLabel(b)}</div>`,
          )}
        </div>`
      : ""}
    ${obs
      ? html`<div
          style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;margin-bottom:12px"
        >
          <div
            style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"
          >
            <strong>${obs.title as string}</strong>
            <span
              style="font-size:11px;padding:2px 8px;border-radius:10px;background:${obs.status ===
              "prepared"
                ? "#3182ce"
                : "#a0aec0"};color:#fff"
              >${obs.status as string}</span
            >
          </div>
          <p style="font-size:13px;color:var(--text-secondary,#666);margin:0 0 8px 0">
            ${obs.summary as string}
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <button
              type="button"
              @click=${() =>
                aicsMainFlow
                  .confirmObservation(state, String(obs.id))
                  .then(() => requestHostUpdate?.())}
              style="padding:5px 10px;background:#38a169;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
              ?disabled=${obs.status === "confirmed" || signals.length === 0}
            >
              确认观察包
            </button>
            ${obs.status === "confirmed"
              ? html`<span style="font-size:12px;color:#2f855a;align-self:center"
                  >已确认，可进入归因分析。</span
                >`
              : signals.length === 0
                ? html`<span style="font-size:12px;color:#c53030;align-self:center"
                    >没有可用事实，不能确认。请先补采集或回经营概览重新生成。</span
                  >`
                : nothing}
            <button
              type="button"
              @click=${() =>
                aicsMainFlow
                  .markObservationDataMissing(state, String(obs.id))
                  .then(() => requestHostUpdate?.())}
              style="padding:5px 10px;background:#dd6b20;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
            >
              标记数据缺失
            </button>
            <button
              type="button"
              @click=${() =>
                aicsMainFlow
                  .rejectObservation(state, String(obs.id))
                  .then(() => requestHostUpdate?.())}
              style="padding:5px 10px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
              ?disabled=${obs.status === "rejected"}
            >
              驳回观察包
            </button>
          </div>
          ${signals.length > 0
            ? html`
                <div
                  style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px"
                >
                  ${groupedSignals.map(
                    (group) => html`
                      <section
                        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:10px;background:var(--bg-secondary,#f8fafc);display:grid;gap:7px"
                      >
                        <div style="display:flex;justify-content:space-between;gap:8px">
                          <strong style="font-size:12px">${group.title}</strong>
                          <span style="font-size:11px;color:var(--text-secondary,#666)"
                            >${group.signals.length} 条</span
                          >
                        </div>
                        <div
                          style="font-size:11px;color:var(--text-secondary,#666);line-height:1.45"
                        >
                          ${group.hint}
                        </div>
                        ${group.signals.slice(0, 3).map(
                          (s) => html`
                            <div
                              style="border-top:1px solid var(--border-color,#e5e7eb);padding-top:6px;font-size:12px;display:grid;gap:3px"
                            >
                              <div style="display:flex;justify-content:space-between;gap:8px">
                                <strong>${s.title}</strong>
                                <span style="color:var(--text-secondary,#999)"
                                  >${(s.evidenceRefs as Array<unknown>)?.length ?? 0} 证据</span
                                >
                              </div>
                              <div style="color:var(--text-secondary,#777);line-height:1.45">
                                ${s.summary}
                              </div>
                              <div style="font-size:11px;color:var(--text-secondary,#888)">
                                来源：${String(s.source ?? "主流程采集")} ·
                                采集：${signalCollectedAt(s)} · 可信度：${signalCredibilityLabel(s)}
                                · ${s.usableForAttribution === false ? "暂不可归因" : "可用于归因"}
                              </div>
                            </div>
                          `,
                        )}
                      </section>
                    `,
                  )}
                </div>
              `
            : html`<div
                style="padding:8px;background:#fffaf0;border:1px solid #dd6b20;border-radius:6px;font-size:12px;color:#c05621"
              >
                观察信号为空，不能进入归因分析。请从「经营概览」开始观察生成初始观察包。
              </div>`}
          <div style="margin-top:12px">
            <div style="font-size:12px;font-weight:700;margin-bottom:6px">岗位商城观察域</div>
            <div
              style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;font-size:12px"
            >
              ${MARKETPLACE_OBSERVATION_VIEW_DOMAINS.map(
                (domain) => html`<div
                  style="padding:8px;background:var(--bg-secondary,#f8fafc);border-radius:6px;border:1px solid var(--border-color,#edf2f7)"
                >
                  ${domain}
                </div>`,
              )}
            </div>
          </div>
          <div
            style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px;font-size:12px"
          >
            <div style="padding:8px;background:var(--bg-secondary,#f8fafc);border-radius:6px">
              <strong>允许动作</strong><br />真实采集、证据留存、异常/缺失/可信度标记
            </div>
            <div style="padding:8px;background:var(--bg-secondary,#f8fafc);border-radius:6px">
              <strong>下游用途</strong><br />进入归因、目标、规划、调度前的事实依据
            </div>
            <div style="padding:8px;background:var(--bg-secondary,#f8fafc);border-radius:6px">
              <strong>禁止动作</strong><br />不定目标、不归因、不直接调岗位执行
            </div>
          </div>
        </div>`
      : html`<div style="text-align:center;padding:40px;color:var(--text-secondary,#666)">
          <p style="font-size:15px;margin:0 0 4px 0">暂无数据分析包</p>
          <p style="font-size:12px;margin:0 0 12px 0">
            先在「经营概览」开始观察，系统会创建包含意图、观察范围、数据缺口和可信度的初始观察包。
          </p>
          <button
            @click=${() =>
              aicsMainFlow
                .runObservationToolPlan(state, undefined, externalSourceParams)
                .then(() => requestHostUpdate?.())}
            ?disabled=${mf?.loading === true || !externalUrlValid}
            style="padding:7px 14px;background:#38a169;color:#fff;border:none;border-radius:4px;cursor:${mf?.loading ===
              true || !externalUrlValid
              ? "not-allowed"
              : "pointer"};font-size:12px;margin-right:8px;opacity:${mf?.loading === true ||
            !externalUrlValid
              ? 0.55
              : 1}"
          >
            ${mf?.loading === true ? "观察中..." : "开始观察"}
          </button>
          <button
            @click=${() => {
              state.setTab("businessOverview");
              requestHostUpdate?.();
            }}
            style="padding:7px 14px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
          >
            去经营概览
          </button>
        </div>`}
    ${blocked.length > 0
      ? html`<div
          style="border:1px dashed var(--border-color,#ccc);border-radius:6px;padding:12px;font-size:11px;color:var(--text-secondary,#999)"
        >
          <strong>门禁区</strong> · QA: 待检 · Guardrail: — · Checkpoint:
          ${readModel?.updatedAt ? new Date(readModel.updatedAt as number).toLocaleString() : "—"}
        </div>`
      : ""}
  </div>`;
}

function renderAttributionPage(state: AppViewState, requestHostUpdate?: () => void) {
  const mf = state.aicsMainFlow;
  const readModel = mf?.readModel as Record<string, unknown> | null;
  const counts = (readModel?.counts ?? {}) as Record<string, number>;
  const latest = (readModel?.latest ?? {}) as Record<string, unknown>;
  const readiness = (readModel?.readiness ?? {}) as Record<string, boolean>;
  const attr = latest.attributionReport as Record<string, unknown> | null;
  const obs = latest.observationPackage as Record<string, unknown> | null;
  const attributionSummary = (readModel?.attributionSummary ?? null) as Record<
    string,
    unknown
  > | null;
  const attributionTopFindings = Array.isArray(attributionSummary?.topFindings)
    ? (attributionSummary.topFindings as Array<Record<string, unknown>>)
    : [];
  const attributionMatchedDimensions = Array.isArray(attributionSummary?.matchedDimensions)
    ? (attributionSummary.matchedDimensions as string[])
    : [];
  const attributionMissingData = Array.isArray(attributionSummary?.missingData)
    ? (attributionSummary.missingData as string[])
    : [];
  const blocked = ((readModel?.blockedReasons ?? []) as Array<Record<string, unknown>>).filter(
    (r: Record<string, unknown>) => r.stage === "observation",
  );
  const canPrepareAttribution = readiness.canPrepareAttribution === true;
  const findings = (attr?.findings ?? []) as Array<Record<string, unknown>>;
  const observationSignals = Array.isArray(obs?.signals)
    ? (obs.signals as Array<Record<string, unknown>>)
    : [];
  const attributionActionLabel = canPrepareAttribution
    ? "开始归因"
    : obs && obs.status !== "confirmed"
      ? "先确认数据分析"
      : "去数据分析";
  const causeHits = MARKETPLACE_ATTRIBUTION_VIEW_CAUSES.filter((cause) =>
    findings.some(
      (finding) =>
        String(finding.title ?? "").includes(cause) ||
        String(finding.summary ?? "").includes(cause),
    ),
  ).length;
  const topFindings = findings.slice(0, 3);
  const attributionEvidenceCount = findings.reduce((sum, finding) => {
    const ids = Array.isArray(finding.observationSignalIds)
      ? finding.observationSignalIds
      : Array.isArray(finding.evidenceRefs)
        ? finding.evidenceRefs
        : [];
    return sum + ids.length;
  }, 0);
  const lowConfidenceCount = findings.filter((finding) => finding.confidence === "low").length;
  const missingAttributionData = !attr
    ? "还没有归因报告。"
    : findings.length === 0
      ? "归因报告没有问题发现，不能进入目标层。"
      : attributionEvidenceCount === 0
        ? "归因发现缺少观察证据引用。"
        : lowConfidenceCount > 0
          ? `${lowConfidenceCount} 个问题可信度较低，需要补数据。`
          : "";
  const attributionUserMessage =
    String(attributionSummary?.userMessage ?? "").trim() ||
    missingAttributionData ||
    `引用 ${attributionEvidenceCount} 条观察证据`;

  return html`<div style="padding:16px;max-width:900px;margin:0 auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h1 style="font-size:20px;margin:0">归因分析</h1>
      <div style="display:flex;gap:8px">
        <button
          @click=${() => {
            if (!canPrepareAttribution) {
              state.setTab("observation");
              requestHostUpdate?.();
              return;
            }
            void aicsMainFlow
              .generateAttributionFromLatest(state)
              .then(() => requestHostUpdate?.());
          }}
          style="padding:6px 12px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
          title=${canPrepareAttribution
            ? "基于已确认的数据分析生成归因报告。"
            : "先去数据分析生成并确认观察包。"}
        >
          ${attributionActionLabel}
        </button>
        <button
          @click=${() => state.refreshAicsMainFlowReadModel?.()}
          style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
        >
          刷新
        </button>
      </div>
    </div>
    ${renderMainFlowHumanizedPanel(readModel, state.setTab.bind(state))}
    <section
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:12px;margin-bottom:14px;background:var(--bg-elevated,#fff);display:grid;gap:10px"
    >
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div>
          <strong style="font-size:13px">归因前置条件</strong>
          <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
            归因只解释已确认事实，不从空白处编原因。
            ${!canPrepareAttribution
              ? html`<span style="color:#b7791f">需要先确认数据分析包。</span>`
              : nothing}
          </div>
        </div>
        <button
          type="button"
          class="secondary"
          style="font-size:12px;padding:5px 9px"
          @click=${() => state.setTab("observation")}
        >
          查看数据分析
        </button>
      </div>
      <div
        style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;font-size:12px"
      >
        ${[
          ["观察包", obs ? String(obs.title ?? "已生成") : "缺失", Boolean(obs)],
          [
            "确认状态",
            obs?.status === "confirmed" ? "已确认" : "待确认",
            obs?.status === "confirmed",
          ],
          ["证据数", String(observationSignals.length), observationSignals.length > 0],
          [
            "可信度",
            observationSignals.length ? "可评估" : "待补数据",
            observationSignals.length > 0,
          ],
        ].map(
          ([label, value, ok]) => html`
            <div
              style="border:1px solid ${ok
                ? "#9ae6b4"
                : "#f6ad55"};border-radius:7px;padding:8px;background:${ok ? "#f0fff4" : "#fffaf0"}"
            >
              <div style="font-size:11px;color:var(--text-secondary,#666)">${label}</div>
              <div style="font-weight:700;color:${ok ? "#2f855a" : "#b7791f"}">${value}</div>
            </div>
          `,
        )}
      </div>
    </section>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px">
      ${[
        { l: "报告数", v: counts.attributions ?? 0 },
        { l: "待审核", v: 0 },
        { l: "可引用", v: attr ? 1 : 0, c: attr ? "#38a169" : "#a0aec0" },
        { l: "观察阻塞", v: blocked.length, c: blocked.length > 0 ? "#e53e3e" : "#a0aec0" },
        {
          l: "归因维度",
          v: causeHits || (attr ? MARKETPLACE_ATTRIBUTION_VIEW_CAUSES.length : "—"),
        },
      ].map(
        (m: Record<string, unknown>) =>
          html`<div
            style="text-align:center;padding:8px;border:1px solid var(--border-color,#e0e0e0);border-radius:6px"
          >
            <div
              style="font-size:20px;font-weight:700;color:${(m.c as string) ||
              "var(--text-primary,#333)"}"
            >
              ${m.v}
            </div>
            <div style="font-size:11px;color:var(--text-secondary,#666)">${m.l}</div>
          </div>`,
      )}
    </div>
    ${blocked.length > 0
      ? html`<div
          style="padding:10px;background:#fffaf0;border:1px solid #dd6b20;border-radius:6px;margin-bottom:12px"
        >
          ${blocked.map(
            (b: Record<string, unknown>) =>
              html`<div style="font-size:13px;color:#c05621">⚠ ${mainFlowBlockerLabel(b)}</div>`,
          )}
        </div>`
      : ""}
    ${attr
      ? html`<div
          style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;margin-bottom:12px"
        >
          <div
            style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"
          >
            <strong>${attr.title as string}</strong
            ><span
              style="font-size:11px;padding:2px 8px;border-radius:10px;background:#805ad5;color:#fff"
              >${attr.status as string}</span
            >
          </div>
          <p style="font-size:13px;color:var(--text-secondary,#666);margin:0 0 8px 0">
            ${attr.summary as string}
          </p>
          <section
            style="border:1px solid #bee3f8;background:#ebf8ff;border-radius:7px;padding:10px;margin-bottom:10px;display:grid;gap:8px"
          >
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
              <div>
                <strong style="font-size:13px;color:#2a4365">主要问题</strong>
                <div style="font-size:12px;color:#2a4365;margin-top:3px">
                  归因只引用已确认观察证据；低可信或缺证据的问题需要补数据。
                </div>
              </div>
              <span
                style="font-size:12px;color:${missingAttributionData
                  ? "#b7791f"
                  : "#2f855a"};font-weight:700"
              >
                ${attributionUserMessage}
              </span>
            </div>
            <div
              style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;font-size:12px"
            >
              <div>维度覆盖：${attributionMatchedDimensions.length || causeHits || 0}</div>
              <div>
                观察证据：${Number(attributionSummary?.evidenceCount ?? attributionEvidenceCount)}
                条
              </div>
              <div>缺证据：${Number(attributionSummary?.missingEvidenceCount ?? 0)} 个问题</div>
              <div>
                低可信：${Number(attributionSummary?.lowConfidenceCount ?? lowConfidenceCount)}
                个问题
              </div>
            </div>
            ${attributionMissingData.length
              ? html`<div style="font-size:12px;color:#b7791f">
                  还缺数据：${attributionMissingData.join("；")}
                </div>`
              : nothing}
            <div style="display:grid;gap:6px">
              ${(attributionTopFindings.length ? attributionTopFindings : topFindings).map(
                (finding, index) => {
                  const evidenceIds = Array.isArray(finding.observationSignalIds)
                    ? finding.observationSignalIds
                    : Array.isArray(finding.evidenceRefs)
                      ? finding.evidenceRefs
                      : [];
                  const evidenceCount = Number(finding.evidenceCount ?? evidenceIds.length);
                  return html`
                    <div style="font-size:12px;line-height:1.45;color:#2a4365">
                      <strong>${index + 1}. ${String(finding.title ?? "待命名问题")}</strong>
                      <span> · 影响：${String(finding.summary ?? "待补充")}</span>
                      ${finding.dimension
                        ? html`<span> · 维度：${String(finding.dimension)}</span>`
                        : nothing}
                      <span> · 证据：${evidenceCount} 条观察证据</span>
                      <span>
                        ·
                        可信度：${finding.confidence === "high"
                          ? "高"
                          : finding.confidence === "medium"
                            ? "中"
                            : "低"}</span
                      >
                    </div>
                  `;
                },
              )}
            </div>
          </section>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <button
              type="button"
              @click=${() =>
                aicsMainFlow
                  .confirmAttribution(state, String(attr.id))
                  .then(() => requestHostUpdate?.())}
              style="padding:5px 10px;background:#38a169;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
              ?disabled=${attr.status === "confirmed" || findings.length === 0}
            >
              确认归因
            </button>
            <button
              type="button"
              @click=${() =>
                aicsMainFlow
                  .requestAttributionMoreData(state, String(attr.id))
                  .then(() => requestHostUpdate?.())}
              style="padding:5px 10px;background:#dd6b20;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
            >
              要求补数据
            </button>
            <button
              type="button"
              @click=${() =>
                aicsMainFlow
                  .rejectAttribution(state, String(attr.id))
                  .then(() => requestHostUpdate?.())}
              style="padding:5px 10px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
              ?disabled=${attr.status === "rejected"}
            >
              驳回归因报告
            </button>
          </div>
          ${findings.map(
            (f: Record<string, unknown>) =>
              html`<div
                style="padding:8px;border:1px solid var(--border-color,#e0e0e0);border-radius:4px;margin-bottom:4px;font-size:12px"
              >
                <div
                  style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"
                >
                  <strong>${f.title}</strong>
                  <span
                    style="color:${f.confidence === "high"
                      ? "#38a169"
                      : f.confidence === "medium"
                        ? "#dd6b20"
                        : "#a0aec0"}"
                    >置信:${f.confidence}</span
                  >
                </div>
                <div style="color:var(--text-secondary,#888);margin-top:4px;line-height:1.5">
                  主因/影响：${f.summary}
                </div>
                <div style="font-size:11px;color:var(--text-secondary,#999);margin-top:3px">
                  证据：${Array.isArray(f.observationSignalIds)
                    ? f.observationSignalIds.length
                    : Array.isArray(f.evidenceRefs)
                      ? f.evidenceRefs.length
                      : 0}
                  条观察证据 · 建议目标：${String(f.suggestedGoal ?? f.title ?? "待收敛")}
                </div>
              </div>`,
          )}
          <div
            style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px;font-size:12px"
          >
            <div style="padding:8px;background:var(--bg-secondary,#f8fafc);border-radius:6px">
              <strong>完成判断</strong><br />完成 / 未完成 / 部分 / 超额 / 数据不足
            </div>
            <div style="padding:8px;background:var(--bg-secondary,#f8fafc);border-radius:6px">
              <strong>问题来源</strong><br />云端商城、本地端、能力、API、调度、执行、外部生态、风险
            </div>
            <div style="padding:8px;background:var(--bg-secondary,#f8fafc);border-radius:6px">
              <strong>目标层参考</strong><br />产品改进、能力吸收、风险预案、调度修复
            </div>
            <div style="padding:8px;background:var(--bg-secondary,#f8fafc);border-radius:6px">
              <strong>禁止动作</strong><br />不制定目标、不调用岗位执行
            </div>
          </div>
          <div style="margin-top:12px">
            <div style="font-size:12px;font-weight:700;margin-bottom:6px">岗位商城归因维度</div>
            <div
              style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;font-size:12px"
            >
              ${MARKETPLACE_ATTRIBUTION_VIEW_CAUSES.map(
                (cause) => html`<div
                  style="padding:8px;background:var(--bg-secondary,#f8fafc);border-radius:6px;border:1px solid var(--border-color,#edf2f7)"
                >
                  ${cause}
                </div>`,
              )}
            </div>
          </div>
        </div>`
      : html`<div style="text-align:center;padding:40px;color:var(--text-secondary,#666)">
          <p style="font-size:15px;margin:0 0 4px 0">暂无归因报告</p>
          <p style="font-size:12px;margin:0">先在「数据分析」生成并确认观察事实，系统才能归因。</p>
          <button
            type="button"
            @click=${() => {
              state.setTab("observation");
              requestHostUpdate?.();
            }}
            style="margin-top:12px;padding:7px 14px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
          >
            去数据分析
          </button>
          <div style="margin-top:16px;text-align:left">
            <div style="font-size:12px;font-weight:700;margin-bottom:6px">岗位商城归因维度</div>
            <div
              style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;font-size:12px"
            >
              ${MARKETPLACE_ATTRIBUTION_VIEW_CAUSES.map(
                (cause) => html`<div
                  style="padding:8px;background:var(--bg-secondary,#f8fafc);border-radius:6px;border:1px solid var(--border-color,#edf2f7)"
                >
                  ${cause}
                </div>`,
              )}
            </div>
          </div>
        </div>`}
    ${blocked.length === 0 && attr
      ? html`<div
          style="border:1px dashed #38a169;border-radius:6px;padding:12px;font-size:12px;color:#38a169;text-align:center"
        >
          ✅ 归因报告已就绪，可进入「公司目标」页创建目标候选。
        </div>`
      : ""}
  </div>`;
}

function renderGoalManagementProductPage(
  state: AppViewState,
  onNavigate: (tab: Tab) => void,
  requestHostUpdate?: () => void,
) {
  const gs = state.goalsState ?? (state.goalsState = createDefaultGoalsPageState());
  const mf = state.aicsMainFlow;
  const readModel = mf?.readModel as Record<string, unknown> | null;
  const view = deriveGoalView(readModel);
  const goal = view.goal;
  const goalSummary = (readModel?.goalSummary ?? null) as Record<string, unknown> | null;
  const latest = (readModel?.latest ?? {}) as Record<string, unknown>;
  const sourceAttribution = latest.attributionReport as Record<string, unknown> | null;
  const loading = mf?.loading ?? false;
  const error = mf?.error ?? null;

  const statusLabel = (status: string) => {
    switch (status) {
      case "confirmed":
        return "已确认";
      case "candidate":
        return "候选";
      case "draft":
        return "草稿";
      case "rejected":
        return "已拒绝";
      case "completed":
        return "已完成";
      default:
        return status || "未知";
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "confirmed":
        return "#38a169";
      case "candidate":
        return "#3182ce";
      case "draft":
        return "#a0aec0";
      case "rejected":
        return "#e53e3e";
      case "completed":
        return "#38a169";
      default:
        return "#a0aec0";
    }
  };

  const renderGoalCard = (g: Record<string, unknown>) => {
    const status = String(g.status ?? "draft");
    const title = String(g.title ?? "");
    const owner = String(g.owner ?? "");
    const metric = String(g.metric ?? "-");
    const currentValue = String(g.currentValue ?? "待确认");
    const target = String(g.target ?? "-");
    const cycle = String(g.cycle ?? "当前经营周期");
    const rationale = String(g.rationale ?? "");
    const whyNow = String(g.whyNow ?? (rationale || "来自最新观察和归因，等待人工确认。"));
    const id = String(g.id ?? "");
    const isConfirmed = status === "confirmed";
    const isRejected = status === "rejected";
    const auditCount = Array.isArray(g.auditRefs) ? g.auditRefs.length : 0;
    const observationSourceCount = Array.isArray(g.sourceObservationSignalIds)
      ? g.sourceObservationSignalIds.length
      : g.observationPackageId
        ? 1
        : 0;
    const attributionSourceCount = Array.isArray(g.sourceAttributionFindingIds)
      ? g.sourceAttributionFindingIds.length
      : g.attributionReportId
        ? 1
        : 0;
    const blockedReasons = Array.isArray(g.blockedReasons)
      ? g.blockedReasons.map(String).filter(Boolean)
      : [];
    const readyForPlanning = g.readyForPlanning !== false && blockedReasons.length === 0;

    return html`
      <div
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:16px;margin-bottom:12px;${isConfirmed
          ? "border-left:4px solid #38a169"
          : isRejected
            ? "border-left:4px solid #e53e3e"
            : ""}"
      >
        <div
          style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px"
        >
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <strong style="font-size:15px">${title}</strong>
              <span
                style="font-size:11px;padding:1px 8px;border-radius:10px;background:${statusColor(
                  status,
                )};color:#fff"
                >${statusLabel(status)}</span
              >
            </div>
            <div style="font-size:13px;color:var(--text-secondary,#666);margin-bottom:4px">
              指标：${metric} · 周期：${cycle} · 负责人：${owner || "待确认"}
            </div>
            <div
              style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0"
            >
              ${[
                { label: "当前值", value: currentValue },
                { label: "目标值", value: target },
                {
                  label: "来源观察",
                  value:
                    observationSourceCount > 0 ? `${observationSourceCount} 条事实` : "缺少来源",
                  warn: observationSourceCount === 0,
                },
                {
                  label: "来源归因",
                  value:
                    attributionSourceCount > 0 ? `${attributionSourceCount} 条原因` : "缺少来源",
                  warn: attributionSourceCount === 0,
                },
              ].map(
                (item) => html`
                  <div
                    style="border:1px solid ${item.warn
                      ? "#dd6b20"
                      : "var(--border-color,#e0e0e0)"};border-radius:6px;padding:8px;background:${item.warn
                      ? "#fffaf0"
                      : "var(--bg-secondary,#fafafa)"}"
                  >
                    <div style="font-size:11px;color:var(--text-secondary,#666);margin-bottom:3px">
                      ${item.label}
                    </div>
                    <div style="font-size:13px;font-weight:600;color:var(--text-primary,#333)">
                      ${item.value}
                    </div>
                  </div>
                `,
              )}
            </div>
            <div style="font-size:12px;color:var(--text-secondary,#666);margin-bottom:6px">
              为什么要做：${whyNow}
            </div>
            ${rationale && rationale !== whyNow
              ? html`<div style="font-size:12px;color:var(--text-secondary,#888);margin-bottom:6px">
                  依据说明：${rationale}
                </div>`
              : nothing}
            <section
              style="border:1px solid #bee3f8;background:#ebf8ff;border-radius:6px;padding:8px;margin-bottom:6px;font-size:12px;color:#2a4365;line-height:1.5"
            >
              <strong>确认前检查</strong>
              <div>
                ${isConfirmed
                  ? "这是已确认公司目标，可以交给规划方案拆成工作块。"
                  : "这是候选目标，还不是正式公司目标；确认后才允许进入规划方案。"}
              </div>
              <div>
                来源：${observationSourceCount} 条观察事实 · ${attributionSourceCount} 条归因原因。
                ${blockedReasons.length
                  ? `阻塞：${blockedReasons.join("；")}`
                  : "当前没有目标层阻塞。"}
              </div>
            </section>
            <div
              style="font-size:12px;padding:8px;border-radius:6px;background:${readyForPlanning
                ? "#f0fff4"
                : "#fffaf0"};border:1px solid ${readyForPlanning
                ? "#9ae6b4"
                : "#f6ad55"};color:${readyForPlanning ? "#276749" : "#9c4221"};margin-bottom:6px"
            >
              ${readyForPlanning
                ? isConfirmed
                  ? "已确认，可进入规划方案拆解。"
                  : "来源完整，确认后可进入规划方案。"
                : `还不能进入规划：${blockedReasons.join("；") || "来源证据或归因信息不足"}`}
            </div>
            <div style="font-size:11px;color:var(--text-secondary,#999)">
              审计记录：${auditCount} 条
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            ${!isConfirmed && !isRejected
              ? html`
                  <button
                    @click=${() => {
                      confirmGoal(state, id);
                      requestHostUpdate?.();
                    }}
                    style="padding:4px 12px;background:#38a169;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
                    title="确认此目标，使其可进入规划层"
                  >
                    确认
                  </button>
                `
              : nothing}
          </div>
        </div>
      </div>
    `;
  };

  // Blocked reasons for goal stage
  const goalBlocked = view.blockedReasons;

  return html`
    <div class="aics-goals-page" style="padding:16px;max-width:900px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <h1 style="font-size:20px;margin:0">公司目标</h1>
          <p style="font-size:12px;color:var(--text-secondary,#666);margin:4px 0 0 0">
            把已确认归因收敛成可治理目标；目标确认后才进入规划拆解。
          </p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button
            @click=${() => {
              state.refreshAicsMainFlowReadModel();
            }}
            style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
            ?disabled=${loading}
          >
            ${loading ? "刷新中..." : "刷新"}
          </button>
          <button
            @click=${() =>
              aicsMainFlow.generateGoalFromLatest(state).then(() => requestHostUpdate?.())}
            style="padding:6px 16px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px"
            title=${view.canCreate
              ? "基于已确认观察和归因自动生成候选目标。"
              : "先完成数据分析和归因分析，才能创建候选目标。"}
            ?disabled=${!view.canCreate}
          >
            生成目标候选
          </button>
          <button
            @click=${() => {
              openGoalForm(gs);
              requestHostUpdate?.();
            }}
            style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
            title="手动补充候选目标；仍必须基于已确认观察和归因。"
            ?disabled=${!view.canCreate}
          >
            手动补充
          </button>
        </div>
      </div>

      ${renderMainFlowHumanizedPanel(readModel, state.setTab.bind(state))}
      ${goalSummary
        ? html`<section
            style="border:1px solid ${goalSummary.readyForPlanning
              ? "#9ae6b4"
              : "#f6ad55"};background:${goalSummary.readyForPlanning
              ? "#f0fff4"
              : "#fffaf0"};border-radius:8px;padding:12px;margin-bottom:12px;display:grid;gap:8px"
          >
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
              <div>
                <strong
                  style="font-size:13px;color:${goalSummary.readyForPlanning
                    ? "#276749"
                    : "#9c4221"}"
                >
                  目标进入规划判断
                </strong>
                <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
                  ${String(goalSummary.userMessage ?? "等待目标层判断。")}
                </div>
              </div>
              <button
                type="button"
                style="padding:5px 10px;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-elevated,#fff);font-size:12px;cursor:pointer"
                @click=${() => {
                  state.setTab(goalSummary.readyForPlanning ? "company" : "attribution");
                  requestHostUpdate?.();
                }}
              >
                ${String(goalSummary.nextAction ?? "查看下一步")}
              </button>
            </div>
            <div
              style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;font-size:12px"
            >
              <div>状态：${String(goalSummary.statusLabel ?? "未知")}</div>
              <div>来源观察：${Number(goalSummary.observationSourceCount ?? 0)} 条</div>
              <div>来源归因：${Number(goalSummary.attributionSourceCount ?? 0)} 条</div>
              <div>负责人：${String(goalSummary.owner ?? "待确认")}</div>
            </div>
          </section>`
        : nothing}
      ${!view.canCreate && !goal
        ? renderMainFlowLayerNote({
            title: "还不能创建公司目标",
            body: "需要先完成数据分析和归因分析。目标层只承接已确认归因，不能凭空定目标。",
            actionLabel: "去归因分析",
            actionTab: "attribution",
            onNavigate,
            tone: "warn",
          })
        : goal && String(goal.status) === "confirmed"
          ? renderMainFlowLayerNote({
              title: "公司目标已确认",
              body: "下一步把目标拆成经营工作块和岗位承接任务，形成正式规划包。",
              actionLabel: "去规划方案拆解",
              actionTab: "company",
              onNavigate,
              tone: "ok",
            })
          : nothing}
      ${error
        ? html`<div
            style="padding:12px;background:#fff5f5;border:1px solid #e53e3e;border-radius:6px;color:#e53e3e;margin-bottom:12px;font-size:13px"
          >
            ${error}
          </div>`
        : nothing}
      ${goalBlocked.length > 0
        ? html`
            <div
              style="padding:12px;background:#fffaf0;border:1px solid #dd6b20;border-radius:6px;margin-bottom:12px;font-size:13px"
            >
              ${goalBlocked.map((b) => html`<div>⚠️ ${mainFlowBlockerLabel(b)}</div>`)}
              <div style="margin-top:4px;font-size:11px;color:var(--text-secondary,#666)">
                目标层被阻塞。请先完成数据分析和归因分析。
              </div>
            </div>
          `
        : nothing}

      <!-- Metrics -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
        ${[
          { label: "目标总数", value: view.totalGoals },
          { label: "可创建候选", value: view.canCreate ? "✓" : "✗", warn: !view.canCreate },
          { label: "当前阶段", value: readModel?.currentStage ?? "—" },
          {
            label: "就绪状态",
            value: goal
              ? String(goal.status) === "confirmed"
                ? goal.readyForPlanning === false
                  ? "有阻塞"
                  : "可规划"
                : String(goal.status)
              : "无目标",
            warn: !goal || goal.readyForPlanning === false,
          },
        ].map(
          (m) => html`
            <div
              style="text-align:center;padding:8px;border:1px solid var(--border-color,#e0e0e0);border-radius:6px;${m.warn
                ? "border-color:#dd6b20;background:#fffaf0"
                : ""}"
            >
              <div
                style="font-size:20px;font-weight:700;color:${m.warn
                  ? "#dd6b20"
                  : "var(--text-primary,#333)"}"
              >
                ${m.value}
              </div>
              <div style="font-size:11px;color:var(--text-secondary,#666)">${m.label}</div>
            </div>
          `,
        )}
      </div>

      <!-- Form panel -->
      ${gs.formOpen
        ? html`
            <div
              style="border:1px solid var(--accent-color,#3366ff);border-radius:8px;padding:16px;margin-bottom:16px;background:var(--bg-secondary,#f8f9fa)"
            >
              <h2 style="font-size:15px;margin:0 0 12px 0">新建公司目标候选</h2>
              <div style="display:grid;gap:8px;margin-bottom:12px">
                <input
                  placeholder="目标名称（必填）"
                  .value=${gs.form.title}
                  @input=${(e: InputEvent) => {
                    updateGoalFormField(gs, "title", (e.target as HTMLInputElement).value);
                    requestHostUpdate?.();
                  }}
                  style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
                />
                <input
                  placeholder="负责人"
                  .value=${gs.form.owner}
                  @input=${(e: InputEvent) => {
                    updateGoalFormField(gs, "owner", (e.target as HTMLInputElement).value);
                    requestHostUpdate?.();
                  }}
                  style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
                />
                <input
                  placeholder="指标（如：首批岗位授权转化与执行成功率）"
                  .value=${gs.form.metric}
                  @input=${(e: InputEvent) => {
                    updateGoalFormField(gs, "metric", (e.target as HTMLInputElement).value);
                    requestHostUpdate?.();
                  }}
                  style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
                />
                <input
                  placeholder="当前值（如：授权转化率 8%，执行成功率 60%）"
                  .value=${gs.form.currentValue}
                  @input=${(e: InputEvent) => {
                    updateGoalFormField(gs, "currentValue", (e.target as HTMLInputElement).value);
                    requestHostUpdate?.();
                  }}
                  style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
                />
                <input
                  placeholder="目标值（如：首批岗位可授权、可执行、可回写）"
                  .value=${gs.form.target}
                  @input=${(e: InputEvent) => {
                    updateGoalFormField(gs, "target", (e.target as HTMLInputElement).value);
                    requestHostUpdate?.();
                  }}
                  style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
                />
                <input
                  placeholder="周期（如：Q3 / 当前经营周期）"
                  .value=${gs.form.cycle}
                  @input=${(e: InputEvent) => {
                    updateGoalFormField(gs, "cycle", (e.target as HTMLInputElement).value);
                    requestHostUpdate?.();
                  }}
                  style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
                />
                <textarea
                  placeholder="为什么现在要做（可选）"
                  .value=${gs.form.whyNow}
                  @input=${(e: InputEvent) => {
                    updateGoalFormField(gs, "whyNow", (e.target as HTMLTextAreaElement).value);
                    requestHostUpdate?.();
                  }}
                  rows="2"
                  style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical"
                ></textarea>
                <textarea
                  placeholder="理由（可选）"
                  .value=${gs.form.rationale}
                  @input=${(e: InputEvent) => {
                    updateGoalFormField(gs, "rationale", (e.target as HTMLTextAreaElement).value);
                    requestHostUpdate?.();
                  }}
                  rows="2"
                  style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical"
                ></textarea>
              </div>
              <div style="display:flex;gap:8px">
                <button
                  @click=${() => {
                    createGoalCandidate(state, gs);
                    requestHostUpdate?.();
                  }}
                  style="padding:6px 16px;background:#38a169;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px"
                  ?disabled=${!gs.form.title.trim() ||
                  !gs.form.metric.trim() ||
                  !gs.form.target.trim()}
                >
                  提交候选
                </button>
                <button
                  @click=${() => {
                    closeGoalForm(gs);
                    requestHostUpdate?.();
                  }}
                  style="padding:6px 16px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:13px"
                >
                  取消
                </button>
              </div>
            </div>
          `
        : nothing}

      <!-- Goal Cards -->
      ${!goal
        ? html`<div style="text-align:center;padding:40px;color:var(--text-secondary,#666)">
            <p style="font-size:16px;margin-bottom:8px">暂无公司目标</p>
            <p style="font-size:13px">
              公司目标由 AI 从归因报告自动生成候选，经人工确认后进入规划层。
            </p>
            <p style="font-size:12px;color:var(--text-secondary,#999)">
              点击「生成目标候选」会从已确认观察和归因生成候选，不会自动确认或进入规划。
            </p>
            <button
              type="button"
              @click=${() =>
                view.canCreate
                  ? aicsMainFlow.generateGoalFromLatest(state).then(() => requestHostUpdate?.())
                  : onNavigate("attribution")}
              style="margin-top:12px;padding:7px 14px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
            >
              ${view.canCreate ? "生成目标候选" : "去归因分析"}
            </button>
          </div>`
        : renderGoalCard(goal)}
      ${sourceAttribution || goal
        ? html`
            <section
              style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:12px;margin-top:14px;background:var(--bg-elevated,#fff);font-size:12px;display:grid;gap:5px"
            >
              <strong>来源与下游</strong>
              <div style="color:var(--text-secondary,#666)">
                来源归因：${String(
                  sourceAttribution?.title ?? (goal ? "已记录来源归因" : "待生成"),
                )}
              </div>
              <div style="color:var(--text-secondary,#666)">
                下游产物：确认后的公司目标会进入规划方案，不会在目标页直接调度岗位。
              </div>
            </section>
          `
        : nothing}
    </div>
  `;
}

function renderCompanyManagementProductPage(
  state: AppViewState,
  onNavigate: (tab: Tab) => void,
  requestHostUpdate?: () => void,
) {
  const readModel = state.aicsMainFlow?.readModel as Record<string, unknown> | null | undefined;
  const latest = (readModel?.latest ?? {}) as Record<string, unknown>;
  const objects = (readModel?.objects ?? {}) as Record<string, unknown>;
  const goal = (latest.companyGoal ?? null) as Record<string, unknown> | null;
  const latestPlanning = (latest.planningPackage ?? null) as Record<string, unknown> | null;
  const planningSummary = (readModel?.planningSummary ?? null) as Record<string, unknown> | null;
  const planningSummaryWorkBlocks = Array.isArray(planningSummary?.workBlocks)
    ? (planningSummary.workBlocks as Array<Record<string, unknown>>)
    : [];
  const planningPackages = ((objects.planningPackages ?? []) as Array<Record<string, unknown>>)
    .filter((item) => item.status !== "cancelled")
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
  const currentPlanning = latestPlanning ?? planningPackages[0] ?? null;
  const rolePlanItems = ((objects.rolePlanItems ?? []) as Array<Record<string, unknown>>).filter(
    (item) => item.planningPackageId === currentPlanning?.id,
  );
  const dispatchableItems = rolePlanItems.filter(
    (item) => item.status === "confirmed" && item.dispatchStatus !== "dispatched",
  );
  const blockedItems = rolePlanItems.filter(
    (item) => item.dispatchStatus === "blocked" || item.status === "blocked",
  );
  const completedItems = rolePlanItems.filter((item) => item.dispatchStatus === "dispatched");
  const progress =
    rolePlanItems.length > 0
      ? Math.round((completedItems.length / rolePlanItems.length) * 100)
      : currentPlanning?.status === "confirmed"
        ? 10
        : 0;
  const loading = state.aicsMainFlow?.loading ?? false;
  const goalTitle = String(goal?.title ?? "Q3 销售额 300 万");
  const refresh = () => {
    state.refreshAicsMainFlowReadModel();
    requestHostUpdate?.();
  };
  const preparePlan = async (regenerate = false) => {
    const ok = await aicsMainFlow.generatePlanningFromLatest(state, regenerate);
    if (ok) refresh();
  };
  const confirmPlan = async () => {
    const id = typeof currentPlanning?.id === "string" ? currentPlanning.id : "";
    if (!id) return;
    const ok = await aicsMainFlow.confirmPlanning(state, id);
    if (ok) refresh();
  };
  const enrichItem = async (item: Record<string, unknown>) => {
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) return;
    const title = String(item.title ?? "规划项");
    const ok = await aicsMainFlow.updateRolePlanItem(state, {
      rolePlanItemId: id,
      acceptanceCriteria: [
        `${title} 的输入来源可追溯`,
        `${title} 的输出可被调度层转成派发单`,
        `${title} 的风险和阻塞原因需要在调度前明确`,
      ],
      capabilityMatchSummary:
        typeof item.capabilityMatchSummary === "string" && item.capabilityMatchSummary
          ? item.capabilityMatchSummary
          : "已按商城运营目标补齐能力匹配说明。",
    });
    if (ok) refresh();
  };
  const cancelItem = async (item: Record<string, unknown>) => {
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) return;
    const ok = await aicsMainFlow.cancelRolePlanItem(state, id, "人工判断该规划项暂不进入本轮调度");
    if (ok) refresh();
  };
  const statusLabel = (status: unknown) => {
    switch (status) {
      case "confirmed":
        return "已确认";
      case "prepared":
        return "待确认";
      case "done":
        return "已完成";
      case "blocked":
        return "阻塞";
      case "cancelled":
        return "已取消";
      default:
        return "草稿";
    }
  };
  const statusColor = (status: unknown) => {
    switch (status) {
      case "confirmed":
      case "dispatched":
        return "#2f855a";
      case "prepared":
      case "ready_for_dispatch":
        return "#b7791f";
      case "blocked":
      case "cancelled":
        return "#c53030";
      default:
        return "#2b6cb0";
    }
  };

  return html`
    <div style="padding:16px;max-width:1180px;margin:0 auto">
      <div
        style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px"
      >
        <div>
          <h1 style="font-size:20px;margin:0;color:#c53030">规划方案</h1>
          <p style="margin:6px 0 0 0;color:var(--text-secondary,#666);font-size:13px">
            把已确认公司目标拆成工作块，明确谁做、做什么、输出什么和能不能调度。
          </p>
        </div>
        <button
          @click=${refresh}
          style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
        >
          刷新
        </button>
      </div>

      ${renderMainFlowHumanizedPanel(readModel, onNavigate)}
      ${!goal
        ? renderMainFlowLayerNote({
            title: "还没有可拆解的公司目标",
            body: "规划方案只承接已确认公司目标。请先到公司目标页确认目标，再回来拆成工作块。",
            actionLabel: "去公司目标",
            actionTab: "goals",
            onNavigate,
            tone: "warn",
          })
        : currentPlanning?.status === "confirmed"
          ? renderMainFlowLayerNote({
              title: "正式规划包已确认",
              body: `已生成 ${dispatchableItems.length} 个可进入任务调度的工作块。`,
              actionLabel: "去任务调度",
              actionTab: "workboard",
              onNavigate,
              tone: "ok",
            })
          : renderMainFlowLayerNote({
              title: "先做经营拆解，再确认正式规划包",
              body: "这里先拆工作和条件；确认规划后，任务调度才会生成派发单和执行队列。",
              actionLabel: "查看任务调度",
              actionTab: "workboard",
              onNavigate,
              tone: "info",
            })}

      <div
        style="display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:10px;margin-bottom:18px"
      >
        ${[
          { label: "当前目标", value: goal ? "已确认" : "缺失", title: goalTitle },
          {
            label: "规划版本",
            value: currentPlanning?.revision ?? "-",
            title: "同一目标的规划修订号。",
          },
          { label: "工作块", value: rolePlanItems.length, title: "从公司目标拆出的经营工作块。" },
          { label: "可调度", value: dispatchableItems.length, title: "已确认且尚未派发的工作块。" },
          {
            label: "阻塞",
            value: blockedItems.length || "无",
            title: "能力、授权、API 或人工取消导致的阻塞。",
          },
        ].map(
          (metric) => html`
            <div
              title=${metric.title}
              style="border:1px solid var(--border-color,#e2e8f0);border-radius:8px;background:var(--bg-elevated,#fff);padding:12px"
            >
              <div style="font-size:22px;font-weight:700;color:var(--text-primary,#222)">
                ${metric.value}
              </div>
              <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:2px">
                ${metric.label}
              </div>
            </div>
          `,
        )}
      </div>

      ${planningSummary
        ? html`<section
            style="border:1px solid ${planningSummary.readyForDispatch
              ? "#9ae6b4"
              : "#f6ad55"};background:${planningSummary.readyForDispatch
              ? "#f0fff4"
              : "#fffaf0"};border-radius:10px;padding:12px;margin-bottom:14px;display:grid;gap:8px"
          >
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
              <div>
                <strong
                  style="font-size:13px;color:${planningSummary.readyForDispatch
                    ? "#276749"
                    : "#9c4221"}"
                >
                  规划进入调度判断
                </strong>
                <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
                  ${String(planningSummary.userMessage ?? "等待规划层判断。")}
                </div>
              </div>
              <button
                type="button"
                style="padding:5px 10px;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-elevated,#fff);font-size:12px;cursor:pointer"
                @click=${() => {
                  onNavigate(planningSummary.readyForDispatch ? "workboard" : "company");
                }}
              >
                ${String(planningSummary.nextAction ?? "查看下一步")}
              </button>
            </div>
            <div
              style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;font-size:12px"
            >
              <div>状态：${String(planningSummary.statusLabel ?? "未知")}</div>
              <div>工作块：${Number(planningSummary.workBlockCount ?? 0)} 个</div>
              <div>可调度：${Number(planningSummary.dispatchableCount ?? 0)} 个</div>
              <div>阻塞：${Number(planningSummary.blockedCount ?? 0)} 个</div>
              <div>缺验收：${Number(planningSummary.missingAcceptanceCount ?? 0)} 个</div>
            </div>
            ${planningSummaryWorkBlocks.length
              ? html`<div
                  style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)"
                >
                  ${planningSummaryWorkBlocks
                    .slice(0, 3)
                    .map(
                      (item) => html`<div>
                        ${String(item.title ?? "工作块")}：${String(item.roleLabel ?? "待匹配岗位")}
                        · 输出 ${String(item.expectedOutput ?? "待确认产物")} ·
                        ${item.dispatchable ? "可调度" : String(item.blockedReason ?? "待补条件")}
                      </div>`,
                    )}
                </div>`
              : nothing}
          </section>`
        : nothing}

      <section
        style="border:1px solid var(--border-color,#e2e8f0);border-radius:10px;background:var(--bg-elevated,#fff);padding:14px;margin-bottom:14px"
      >
        <div
          style="font-size:12px;font-weight:700;color:var(--text-secondary,#666);margin-bottom:8px"
        >
          经营拆解看板
        </div>
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
          <div>
            <h2 style="font-size:16px;margin:0;color:var(--text-primary,#222)">${goalTitle}</h2>
            <p
              style="font-size:12px;line-height:1.6;color:var(--text-secondary,#666);margin:6px 0 0 0"
            >
              ${currentPlanning?.summary ?? "先在公司目标页确认目标，再在这里生成可调度规划方案。"}
            </p>
          </div>
          <span
            style="font-size:12px;font-weight:600;color:${statusColor(currentPlanning?.status)}"
          >
            ${currentPlanning ? statusLabel(currentPlanning.status) : "未生成"}
          </span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
          <div
            style="height:8px;flex:1;background:var(--bg-secondary,#edf2f7);border-radius:999px;overflow:hidden"
          >
            <div
              style="height:100%;width:${progress}%;background:${progress >= 70
                ? "#38a169"
                : progress >= 35
                  ? "#3182ce"
                  : "#dd6b20"};border-radius:999px"
            ></div>
          </div>
          <strong style="font-size:13px;color:var(--text-primary,#222)">${progress}%</strong>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">
          <button
            ?disabled=${loading || !goal}
            @click=${() => preparePlan(Boolean(currentPlanning))}
            style="padding:8px 12px;border:1px solid #c53030;border-radius:6px;background:#c53030;color:white;cursor:pointer;font-size:13px;opacity:${loading ||
            !goal
              ? 0.5
              : 1}"
          >
            ${currentPlanning ? "重新生成规划" : "生成规划方案"}
          </button>
          <button
            ?disabled=${loading || !currentPlanning || currentPlanning.status === "confirmed"}
            @click=${confirmPlan}
            style="padding:8px 12px;border:1px solid var(--border-color,#ccc);border-radius:6px;background:var(--bg-elevated,#fff);cursor:pointer;font-size:13px;opacity:${loading ||
            !currentPlanning ||
            currentPlanning.status === "confirmed"
              ? 0.5
              : 1}"
          >
            确认规划方案
          </button>
          <button
            @click=${() => onNavigate("workboard")}
            style="padding:8px 12px;border:1px solid var(--border-color,#ccc);border-radius:6px;background:var(--bg-elevated,#fff);cursor:pointer;font-size:13px"
          >
            进入任务调度
          </button>
        </div>
      </section>

      <div style="display:grid;gap:10px;margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:var(--text-secondary,#666)">
          工作块拆解
        </div>
        ${rolePlanItems.length === 0
          ? html`
              <div
                style="border:1px dashed var(--border-color,#cbd5e0);border-radius:10px;padding:18px;text-align:center;color:var(--text-secondary,#666);font-size:13px"
              >
                暂无工作块。确认公司目标后点击“生成规划方案”，系统会创建可调度的经营工作块。
              </div>
            `
          : rolePlanItems.map((item) => {
              const blockedReasons = Array.isArray(item.blockedReasons) ? item.blockedReasons : [];
              const acceptanceCriteria = Array.isArray(item.acceptanceCriteria)
                ? item.acceptanceCriteria
                : [];
              const canDispatch =
                item.status === "confirmed" &&
                item.dispatchStatus !== "dispatched" &&
                item.dispatchStatus !== "blocked" &&
                item.status !== "cancelled";
              const dispatchReadinessText = canDispatch
                ? "可以进入任务调度生成派发单和执行队列。"
                : item.dispatchStatus === "dispatched"
                  ? "已经进入任务调度，本页不重复派发。"
                  : item.dispatchStatus === "blocked" || blockedReasons.length
                    ? `暂不能调度：${blockedReasons.join("；") || "能力、授权、API、工具/Skill 或费用条件未满足。"}`
                    : item.status === "cancelled"
                      ? "已取消，不进入本轮调度。"
                      : "需要先确认规划方案，才能进入任务调度。";
              return html`
                <section
                  style="border:1px solid var(--border-color,#e2e8f0);border-radius:8px;background:var(--bg-elevated,#fff);padding:12px"
                >
                  <div
                    style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"
                  >
                    <div>
                      <h3 style="font-size:15px;margin:0;color:var(--text-primary,#222)">
                        ${item.title}
                      </h3>
                      <div
                        style="display:flex;flex-wrap:wrap;gap:8px;margin-top:7px;font-size:11px;color:var(--text-secondary,#666)"
                      >
                        <span>承接岗位：${ownerLabel(item.roleCapabilityRef)}</span>
                        <span>业务范围：${mainFlowCategoryLabel(item.category)}</span>
                        <span>状态：${statusLabel(item.status)}</span>
                        <span>调度：${mainFlowDispatchStatusLabel(item.dispatchStatus)}</span>
                      </div>
                    </div>
                    <span
                      style="font-size:12px;font-weight:600;color:${statusColor(
                        item.dispatchStatus ?? item.status,
                      )}"
                    >
                      ${item.dispatchStatus === "dispatched"
                        ? "已派发"
                        : item.dispatchStatus === "blocked"
                          ? "阻塞"
                          : item.status === "confirmed"
                            ? "可进入调度"
                            : statusLabel(item.status)}
                    </span>
                  </div>
                  <p
                    style="font-size:12px;line-height:1.6;color:var(--text-secondary,#666);margin:8px 0 0 0"
                  >
                    做什么：${item.taskIntent}
                  </p>
                  <div
                    style="margin-top:9px;font-size:12px;color:var(--text-primary,#222);background:var(--bg-secondary,#f8fafc);border-radius:6px;padding:8px"
                  >
                    输出什么：${item.expectedOutput}
                  </div>
                  <div
                    style="margin-top:9px;font-size:12px;border:1px solid ${canDispatch
                      ? "#9ae6b4"
                      : "#f6ad55"};background:${canDispatch
                      ? "#f0fff4"
                      : "#fffaf0"};color:${canDispatch
                      ? "#276749"
                      : "#9c4221"};border-radius:6px;padding:8px"
                  >
                    是否可调度：${dispatchReadinessText}
                  </div>
                  <div
                    style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:9px"
                  >
                    <div style="font-size:12px;color:var(--text-secondary,#666)">
                      <strong style="color:var(--text-primary,#222)">需要条件</strong>
                      <div style="margin-top:4px">${dependencyLabel(item)}</div>
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary,#666)">
                      <strong style="color:var(--text-primary,#222)">验收标准</strong>
                      <div style="margin-top:4px">
                        ${acceptanceCriteria.length
                          ? acceptanceCriteria.join("；")
                          : "尚未补齐验收标准"}
                      </div>
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary,#666)">
                      <strong style="color:var(--text-primary,#222)">阻塞原因</strong>
                      <div style="margin-top:4px">
                        ${blockedReasons.length ? blockedReasons.join("；") : "无"}
                      </div>
                    </div>
                  </div>
                  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:11px">
                    <button
                      ?disabled=${loading || item.status === "cancelled"}
                      @click=${() => enrichItem(item)}
                      style="padding:6px 10px;border:1px solid var(--border-color,#ccc);border-radius:6px;background:var(--bg-elevated,#fff);cursor:pointer;font-size:12px;opacity:${loading ||
                      item.status === "cancelled"
                        ? 0.5
                        : 1}"
                    >
                      补齐说明
                    </button>
                    <button
                      ?disabled=${loading ||
                      item.status === "cancelled" ||
                      item.dispatchStatus === "dispatched"}
                      @click=${() => cancelItem(item)}
                      style="padding:6px 10px;border:1px solid var(--border-color,#ccc);border-radius:6px;background:var(--bg-elevated,#fff);cursor:pointer;font-size:12px;opacity:${loading ||
                      item.status === "cancelled" ||
                      item.dispatchStatus === "dispatched"
                        ? 0.5
                        : 1}"
                    >
                      取消项
                    </button>
                  </div>
                </section>
              `;
            })}
      </div>

      ${renderManagementBreakdown(state)}

      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button
          @click=${() => onNavigate("goals")}
          style="padding:8px 12px;border:1px solid var(--border-color,#ccc);border-radius:6px;background:var(--bg-elevated,#fff);cursor:pointer;font-size:13px"
        >
          查看公司目标
        </button>
        <button
          @click=${() => onNavigate("workboard")}
          style="padding:8px 12px;border:1px solid var(--border-color,#ccc);border-radius:6px;background:var(--bg-elevated,#fff);cursor:pointer;font-size:13px"
        >
          查看任务调度
        </button>
        <button
          @click=${() => onNavigate("aics")}
          style="padding:8px 12px;border:1px solid var(--border-color,#ccc);border-radius:6px;background:var(--bg-elevated,#fff);cursor:pointer;font-size:13px"
        >
          查看岗位执行
        </button>
      </div>
    </div>
  `;
}

function renderManagementBreakdown(state: AppViewState) {
  const mf = state.aicsMainFlow?.readModel as Record<string, unknown> | null;
  const latest = (mf?.latest ?? {}) as Record<string, unknown>;
  const goal = (latest.companyGoal ?? null) as Record<string, unknown> | null;
  const blocks = (mf?.workBlocks ?? []) as Array<Record<string, unknown>>;
  const roles = (mf?.workBlockRoles ?? []) as Array<Record<string, unknown>>;
  const tasks = (mf?.workBlockTaskCandidates ?? []) as Array<Record<string, unknown>>;
  const loading = state.aicsMainFlow?.loading ?? false;

  if (!blocks.length) {
    const goalId = typeof goal?.id === "string" ? goal.id : "";
    const goalConfirmed = goal?.status === "confirmed";
    return html`
      <div
        style="padding:16px;color:var(--text-secondary,#666);border:1px dashed var(--border-color,#ccc);border-radius:6px;margin-bottom:12px;font-size:13px"
      >
        <div
          style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"
        >
          <div>
            <strong style="display:block;color:var(--text-primary,#333);margin-bottom:4px"
              >主流程经营拆解尚未生成</strong
            >
            <span>
              ${goalConfirmed
                ? "已确认公司目标，可以生成岗位供给、授权转化、执行质量、费用审核四个经营工作块。"
                : "请先在「公司目标」确认公司目标；未确认目标不能进入经营拆解。"}
            </span>
          </div>
          <button
            @click=${() => goalId && aicsMainFlow.createManagementBreakdown(state, goalId)}
            ?disabled=${!goalConfirmed || !goalId || loading}
            style="padding:7px 12px;border:1px solid ${goalConfirmed
              ? "var(--accent-color,#3366ff)"
              : "var(--border-color,#ccc)"};border-radius:6px;background:${goalConfirmed
              ? "var(--accent-color,#3366ff)"
              : "var(--bg-secondary,#eee)"};color:${goalConfirmed
              ? "#fff"
              : "var(--text-secondary,#777)"};cursor:${goalConfirmed
              ? "pointer"
              : "not-allowed"};font-size:13px"
            title=${goalConfirmed
              ? "根据已确认目标生成经营拆解。"
              : "请先在公司目标页确认公司目标。"}
          >
            ${loading ? "生成中..." : "生成经营拆解"}
          </button>
        </div>
      </div>
    `;
  }

  const sb = (s: string) =>
    ({ pending: "#a0aec0", in_progress: "#3182ce", completed: "#38a169", blocked: "#e53e3e" })[s] ||
    "#a0aec0";
  const sl = (s: string) =>
    ({ pending: "待开始", in_progress: "进行中", completed: "已完成", blocked: "阻塞" })[s] || s;

  return html` <div style="margin-bottom:16px">
    <h3 style="font-size:15px;margin:0 0 10px 0">经营拆解</h3>
    ${blocks.map((wb) => {
      const wbRoles = roles.filter((r) => r.workBlockId === wb.id);
      const wbTasks = tasks.filter((t) => t.workBlockId === wb.id);
      const blocked = (wb.status as string) === "blocked";
      const done = (wb.status as string) === "completed";
      return html` <div
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:12px;margin-bottom:8px;${blocked
          ? "border-left:4px solid #e53e3e"
          : done
            ? "border-left:4px solid #38a169"
            : ""}"
      >
        <div
          style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"
        >
          <strong style="font-size:14px">${wb.name}</strong>
          <span
            style="font-size:11px;padding:2px 8px;border-radius:10px;background:${sb(
              wb.status as string,
            )};color:#fff"
            >${sl(wb.status as string)}</span
          >
        </div>
        ${wb.purpose
          ? html`<div style="font-size:11px;color:var(--text-secondary,#888);margin-bottom:4px">
              ${wb.purpose}
            </div>`
          : ""}
        ${wb.progressGauge
          ? html`<div style="font-size:11px;color:var(--text-secondary,#666);margin-bottom:4px">
              口径：${wb.progressGauge}
            </div>`
          : ""}
        ${wbRoles.length
          ? html`<div style="margin:6px 0;font-size:12px">
              <span style="color:var(--text-secondary,#999)">承接岗位：</span>${wbRoles.map(
                (r) =>
                  html`<span
                    style="margin-left:4px;padding:1px 6px;background:var(--bg-secondary,#eee);border-radius:3px"
                    >${r.roleTitle}</span
                  >`,
              )}
            </div>`
          : ""}
        ${wbTasks.length
          ? html`<div style="margin-top:6px">
              ${wbTasks.map((t) => {
                const ts = t.status as string;
                const tc =
                  ts === "completed"
                    ? "#38a169"
                    : ts === "dispatched"
                      ? "#3182ce"
                      : ts === "running"
                        ? "#dd6b20"
                        : "#a0aec0";
                return html`<div
                  style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px;border-bottom:1px solid var(--border-color,#f0f0f0)"
                >
                  <span>${t.title}</span
                  ><span style="color:${tc};font-size:11px"
                    >${ts === "candidate"
                      ? "待调度"
                      : ts === "dispatched"
                        ? "已调度"
                        : ts === "running"
                          ? "执行中"
                          : ts}</span
                  >
                </div>`;
              })}
            </div>`
          : ""}
        ${wb.blockedReason
          ? html`<div style="font-size:11px;color:#c53030;margin-top:4px">
              🚫 ${wb.blockedReason}
            </div>`
          : ""}
        ${wb.nextConfirm
          ? html`<div style="font-size:11px;color:#805ad5;margin-top:2px">
              下一步：${wb.nextConfirm}
            </div>`
          : ""}
      </div>`;
    })}
  </div>`;
}

function renderProjectManagementProductPage(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const flow = buildBusinessFlowProjection(state.businessFlow);
  const cards: Array<{ metadata?: { businessFlow?: { projectId?: string } } }> = [];
  const confirmationCount = flow.selectedProject.risks.filter(
    (risk) => risk.status === "needs-confirmation" || risk.status === "blocked",
  ).length;
  const items: MainSystemItem[] = flow.projects.map((project) => {
    const selected = project.id === flow.selectedProject.id;
    const owner = flow.departments.find(
      (department) => department.id === project.ownerDepartmentId,
    );
    const goals = flow.goals
      .filter((goal) => project.linkedGoalIds.includes(goal.id))
      .map((goal) => goal.title);
    return {
      title: project.name,
      status: selected ? "当前项目" : businessProjectStatusLabel(project.status),
      meta: `${project.theme} 责任部门：${owner?.name ?? "待定"}。承接目标：${goals.join(" / ") || "待关联"}。交付物：${project.deliverable}`,
      icon: selected ? "check" : "folder",
      action: {
        label: selected ? "当前" : "查看",
        title: "查看该项目的目标承接和风险状态。",
        disabled: selected,
        onClick: () => state.updateBusinessFlowSelection({ selectedProjectId: project.id }),
      },
    };
  });

  return renderMainSystemShell({
    title: "项目承接看板",
    status: flow.selectedProject.name,
    icon: "folder",
    emptyLabel: "暂无项目",
    metrics: [
      { label: "项目主题", value: flow.projects.length, title: "当前规划的经营项目主题。" },
      {
        label: "承接目标",
        value: flow.selectedProjectGoals.length,
        title: "当前项目承接的经营目标。",
      },
      {
        label: "责任部门",
        value: flow.selectedProjectDepartment.name,
        title: "当前项目的主责部门。",
      },
      {
        label: "待确认",
        value: confirmationCount || "无",
        title: "项目范围、风险或资源上的确认点。",
      },
      {
        label: "关联记录",
        value: cards.length || "待接数据",
        title: "岗位任务看板中与该项目关联的记录。",
      },
    ],
    items: [
      ...items,
      {
        title: "项目里程碑",
        status: flow.selectedProject.milestones.length
          ? `${flow.selectedProject.milestones.length} 个节点`
          : "待规划",
        meta:
          flow.selectedProject.milestones
            .map(
              (milestone) =>
                `${milestone.title}：${businessProjectMilestoneStatusLabel(milestone.status)}`,
            )
            .join("；") || "项目还没有里程碑。",
        icon: "activity",
      },
      {
        title: "项目风险与确认",
        status: flow.selectedProject.risks.some((risk) => risk.status === "blocked")
          ? "存在阻塞"
          : flow.selectedProject.risks.some((risk) => risk.status === "needs-confirmation")
            ? "待确认"
            : "关注中",
        meta:
          flow.selectedProject.risks
            .map(
              (risk) =>
                `${risk.title}：${businessProjectRiskStatusLabel(risk.status)}，${risk.mitigation}`,
            )
            .join("；") || "暂无风险。",
        icon: "eye",
      },
      {
        title: "任务关联记录",
        status: cards.length ? `${cards.length} 条记录` : "待接数据",
        meta: "这里只显示已经由规划确认和任务中心产生的关联记录；项目看板不能直接创建岗位任务。",
        icon: "folder",
        action: {
          label: "看任务",
          title: "查看岗位任务状态看板。",
          onClick: () => onNavigate("workboard"),
        },
      },
    ],
    actions: [
      { label: "目标来源", title: "查看经营目标。", icon: "barChart", tab: "goals" },
      { label: "公司责任", title: "查看部门责任。", icon: "brain", tab: "company" },
      { label: "岗位任务", title: "查看任务状态看板。", icon: "folder", tab: "workboard" },
    ],
    onNavigate,
  });
}

function renderWorkboardProductPage(
  state: AppViewState,
  onNavigate: (tab: Tab) => void,
  requestHostUpdate?: () => void,
) {
  const mf = state.aicsMainFlow;
  const readModel = mf?.readModel as Record<string, unknown> | null;
  const loading = mf?.loading ?? false;
  const error = mf?.error ?? null;
  const objects = (readModel?.objects ?? {}) as Record<string, unknown>;
  const rolePlanItems = (objects.rolePlanItems ?? []) as Array<Record<string, unknown>>;
  const taskPackages = (objects.taskPackages ?? []) as Array<Record<string, unknown>>;
  const requests = (objects.dispatchToRoleRequests ?? []) as Array<Record<string, unknown>>;
  const results = (objects.roleResults ?? []) as Array<Record<string, unknown>>;
  const capabilities = (readModel?.capabilities ?? {}) as Record<string, unknown>;
  const matches = (capabilities.matches ?? []) as Array<Record<string, unknown>>;
  const uniqueRequests = (capabilities.uniqueRequests ?? []) as Array<Record<string, unknown>>;
  const readiness = (readModel?.readiness ?? {}) as Record<string, boolean>;
  const blockedReasons = (readModel?.blockedReasons ?? []) as Array<Record<string, unknown>>;
  const executionPreflight = (readModel?.executionPreflight ?? {}) as Record<string, unknown>;
  const dispatchSummary = (readModel?.dispatchSummary ?? null) as Record<string, unknown> | null;
  const dispatchSummaryChecks = Array.isArray(dispatchSummary?.checks)
    ? (dispatchSummary.checks as Array<Record<string, unknown>>)
    : [];
  const latestPlanning = ((readModel?.latest as Record<string, unknown> | undefined)
    ?.planningPackage ?? null) as Record<string, unknown> | null;
  const latestGoal = ((readModel?.latest as Record<string, unknown> | undefined)?.companyGoal ??
    null) as Record<string, unknown> | null;

  const proposal = ((readModel?.latest as Record<string, unknown> | undefined)
    ?.dispatchProposalReview ?? null) as Record<string, unknown> | null;
  const confirmedProposal = proposal?.status === "confirmed";
  const canCreateProposal = readiness.canCreateDispatchProposal === true;
  const canMaterialize = readiness.canMaterializeTaskPackage === true;
  const confirmedRolePlanItems = rolePlanItems.filter((item) => item.status === "confirmed");
  const dispatchCandidates = confirmedRolePlanItems.map((item) => {
    const match =
      matches.find(
        (entry) =>
          entry.rolePlanItemId === item.id ||
          entry.roleCapabilityRef === item.roleCapabilityRef ||
          entry.category === item.category,
      ) ?? null;
    return { item, match };
  });
  const hasPlanningItems = confirmedRolePlanItems.length > 0;
  const hasDispatchQueue = requests.length > 0 || taskPackages.length > 0;
  const authorizedRole = selectAuthorizedRoleForDispatch(state);
  const hasAuthorizedRole = Boolean(authorizedRole);
  const dispatchDisabledReason = !hasPlanningItems
    ? "还没有确认后的规划方案，先去规划方案拆出工作块。"
    : !hasAuthorizedRole
      ? "还没有已同步的岗位授权。先到费用与授权创建 0 元正式授权。"
      : !proposal && !canCreateProposal
        ? "规划方案还没有准备好，暂时不能生成派发预检。"
        : proposal && !confirmedProposal && !canMaterialize
          ? "派发预检还没有确认，系统会先确认预检再生成派发单。"
          : !canMaterialize && !canCreateProposal
            ? "派发条件还不完整，请先处理授权、能力或 API 阻塞。"
            : "";
  const multipleDispatchCandidatesReason =
    confirmedRolePlanItems.length > 1 ? "有多个工作块，请在下方派发候选卡选择一项生成派发单。" : "";
  const topDispatchReason = multipleDispatchCandidatesReason || dispatchDisabledReason;
  const canRunDispatch =
    hasPlanningItems &&
    hasAuthorizedRole &&
    (canCreateProposal || canMaterialize || Boolean(proposal));
  const hasConfirmedGoal = latestGoal?.status === "confirmed";
  const hasConfirmedPlanning = latestPlanning?.status === "confirmed";
  const preflightBlockedCodes = new Set(
    [
      ...blockedReasons.map((reason) => String(reason.code ?? "")),
      ...(
        (executionPreflight.blockedReasons as Array<Record<string, unknown>> | undefined) ?? []
      ).map((reason) => String(reason.code ?? "")),
      ...requests.flatMap((request) =>
        Array.isArray(request.capabilityBlockedReasons)
          ? request.capabilityBlockedReasons.map(String)
          : [],
      ),
    ].filter(Boolean),
  );
  const hasApiReady =
    !preflightBlockedCodes.has("missing_api_binding") &&
    requests.every((request) => request.apiBindingReady !== false);
  const hasToolSkillReady =
    ![
      "missing_tool_binding",
      "missing_skill_binding",
      "tool_skill_not_ready",
      "skill_disabled",
      "skill_missing_dependency",
      "plugin_tool_disabled",
      "missing_tool_permission",
      "unique_capability_pending",
      "cloud_capability_not_authorized",
      "unsupported_capability_route",
    ].some((code) => preflightBlockedCodes.has(code)) &&
    requests.every((request) => request.toolSkillReady !== false);
  const hasCostReady =
    Boolean(requests.find((request) => request.costConfirmed === true || request.ledgerRef)) ||
    !hasDispatchQueue;
  const hasActorContext =
    !preflightBlockedCodes.has("actor_context_missing") &&
    !preflightBlockedCodes.has("missing_actor_context");
  const dispatchPreflightRows = [
    {
      label: "目标已确认",
      ok: hasConfirmedGoal,
      detail: hasConfirmedGoal ? "公司目标已确认。" : "先到公司目标页确认目标。",
      target: "goals" as Tab,
    },
    {
      label: "规划已确认",
      ok: hasConfirmedPlanning && hasPlanningItems,
      detail:
        hasConfirmedPlanning && hasPlanningItems
          ? "规划方案已拆成可调度工作块。"
          : "先到规划方案页确认工作块。",
      target: "company" as Tab,
    },
    {
      label: "岗位已授权",
      ok: hasAuthorizedRole,
      detail: hasAuthorizedRole
        ? "已找到同步到本地的岗位授权。"
        : "先到费用与授权创建或同步岗位授权。",
      target: "usage" as Tab,
    },
    {
      label: "API 可用",
      ok: hasApiReady,
      detail: hasApiReady ? "没有发现 API 连接阻塞。" : "去 API 管理补齐模型、云端商城或工具连接。",
      target: "apiManagement" as Tab,
    },
    {
      label: "工具 / Skill 可用",
      ok: hasToolSkillReady,
      detail: hasToolSkillReady
        ? "工具和 Skill 没有发现阻塞。"
        : "去工具与 Skill 处理缺依赖或未启用能力。",
      target: "skills" as Tab,
    },
    {
      label: "费用已确认",
      ok: hasCostReady,
      detail: hasCostReady
        ? "费用/账本确认已满足或尚未生成执行队列。"
        : "去费用与授权确认本次执行费用。",
      target: "usage" as Tab,
    },
    {
      label: "账号上下文完整",
      ok: hasActorContext,
      detail: hasActorContext
        ? "账号身份和调用范围完整，可读取云端商城状态。"
        : "缺少账号身份或调用范围，去 API 管理检查连接配置。",
      target: "apiManagement" as Tab,
    },
  ];
  const runDispatch = async (targetItem?: Record<string, unknown>) => {
    if (!hasPlanningItems) {
      onNavigate("company");
      return;
    }
    if (!hasAuthorizedRole) {
      onNavigate("usage");
      return;
    }
    const selectedItem =
      targetItem ?? (confirmedRolePlanItems.length === 1 ? confirmedRolePlanItems[0] : null);
    if (!selectedItem?.id) {
      onNavigate("company");
      return;
    }
    const planningPackageId =
      typeof selectedItem.planningPackageId === "string"
        ? selectedItem.planningPackageId
        : typeof latestPlanning?.id === "string"
          ? latestPlanning.id
          : undefined;
    const ok = await aicsMainFlow.checkAndCreateDispatchQueue(state, {
      ...(planningPackageId ? { planningPackageId } : {}),
      rolePlanItemId: String(selectedItem.id),
    });
    requestHostUpdate?.();
    if (ok) {
      await state.refreshMyRolesReadModel?.();
      onNavigate("aics");
    }
  };
  const columns = [
    {
      key: "backlog",
      label: "待派发",
      count: rolePlanItems.filter(
        (item) => item.status === "confirmed" || item.status === "prepared",
      ).length,
      color: "#718096",
    },
    {
      key: "assigned",
      label: "已排队",
      count: requests.filter((item) => item.status === "ready").length,
      color: "#3182ce",
    },
    {
      key: "running",
      label: "执行中",
      count: requests.filter((item) => item.status === "running").length,
      color: "#805ad5",
    },
    {
      key: "review",
      label: "派发单",
      count: taskPackages.filter((item) => item.status === "materialized").length,
      color: "#b7791f",
    },
    { key: "revision", label: "需调整", count: 0, color: "#dd6b20" },
    {
      key: "human",
      label: "待人工确认",
      count: uniqueRequests.length + requests.filter((item) => item.status === "blocked").length,
      color: "#c05621",
    },
    {
      key: "done",
      label: "已完成",
      count: results.filter((item) => item.status === "completed").length,
      color: "#38a169",
    },
    {
      key: "failed",
      label: "失败",
      count: results.filter((item) => item.status === "failed" || item.outcome === "failed").length,
      color: "#e53e3e",
    },
  ];

  return html`
    <div style="padding:16px;max-width:1180px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <h1 style="font-size:20px;margin:0">派发中心</h1>
          <p style="font-size:12px;color:var(--text-secondary,#666);margin:4px 0 0 0">
            任务调度层只做派发前检查、能力匹配和派发单生成；岗位真正执行必须进入岗位执行页。
          </p>
        </div>
        <div
          style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"
        >
          ${hasPlanningItems
            ? html`<button
                @click=${() => onNavigate("company")}
                style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
              >
                去规划方案
              </button>`
            : nothing}
          <button
            @click=${!hasPlanningItems
              ? () => onNavigate("company")
              : confirmedRolePlanItems.length === 1
                ? () => runDispatch(confirmedRolePlanItems[0])
                : () => undefined}
            style="padding:6px 12px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
            title=${topDispatchReason || "检查规划、授权、能力和 API 后生成派发单。"}
            ?disabled=${hasPlanningItems
              ? !canRunDispatch || loading || confirmedRolePlanItems.length !== 1
              : false}
          >
            ${loading
              ? "检查中..."
              : hasPlanningItems && confirmedRolePlanItems.length === 1
                ? "检查并派发"
                : hasPlanningItems
                  ? "选择下方候选"
                  : "去规划方案"}
          </button>
          <button
            @click=${() => {
              state.refreshAicsMainFlowReadModel();
            }}
            style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
            ?disabled=${loading}
          >
            ${loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      ${renderMainFlowHumanizedPanel(readModel, onNavigate)}
      ${dispatchSummary
        ? html`<section
            style="border:1px solid ${dispatchSummary.canEnterRoleExecution ||
            dispatchSummary.canCreateDispatch
              ? "#9ae6b4"
              : "#f6ad55"};background:${dispatchSummary.canEnterRoleExecution ||
            dispatchSummary.canCreateDispatch
              ? "#f0fff4"
              : "#fffaf0"};border-radius:8px;padding:12px;margin-bottom:14px;display:grid;gap:8px"
          >
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
              <div>
                <strong
                  style="font-size:13px;color:${dispatchSummary.canEnterRoleExecution ||
                  dispatchSummary.canCreateDispatch
                    ? "#276749"
                    : "#9c4221"}"
                >
                  调度进入执行判断
                </strong>
                <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
                  ${String(dispatchSummary.userMessage ?? "等待调度层判断。")}
                </div>
              </div>
              <button
                type="button"
                style="padding:5px 10px;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-elevated,#fff);font-size:12px;cursor:pointer"
                @click=${() => {
                  onNavigate(dispatchSummary.canEnterRoleExecution ? "aics" : "workboard");
                }}
              >
                ${String(dispatchSummary.nextAction ?? "查看下一步")}
              </button>
            </div>
            <div
              style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;font-size:12px"
            >
              <div>可派发工作块：${Number(dispatchSummary.dispatchableWorkBlockCount ?? 0)} 个</div>
              <div>派发单：${dispatchSummary.hasTaskPackage ? "已生成" : "未生成"}</div>
              <div>执行队列：${dispatchSummary.hasDispatchQueue ? "已生成" : "未生成"}</div>
              <div>边界：不直接执行岗位</div>
            </div>
            <div style="font-size:12px;color:var(--text-secondary,#666)">
              ${String(dispatchSummary.boundary ?? "任务调度只生成派发单和执行队列。")}
            </div>
          </section>`
        : nothing}
      <section
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);margin-bottom:14px"
      >
        <div
          style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px"
        >
          <div>
            <strong style="font-size:14px">调度前检查</strong>
            <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
              只有这些条件满足后，调度层才会生成派发单和执行队列；这里不会运行岗位。
              做完结果：到岗位执行页确认并运行。
            </div>
          </div>
          <span
            style="font-size:12px;color:${dispatchPreflightRows.every((row) => row.ok)
              ? "#2f855a"
              : "#b7791f"}"
          >
            ${dispatchPreflightRows.every((row) => row.ok) ? "可以派发" : "需要处理条件"}
          </span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
          ${(dispatchSummaryChecks.length ? dispatchSummaryChecks : dispatchPreflightRows).map(
            (row) => html`
              <div
                style="border:1px solid ${row.ok
                  ? "#9ae6b4"
                  : "#f6ad55"};border-radius:7px;padding:9px;background:${row.ok
                  ? "#f0fff4"
                  : "#fffaf0"};display:grid;gap:4px;font-size:12px"
              >
                <div style="display:flex;justify-content:space-between;gap:8px">
                  <strong style="color:${row.ok ? "#276749" : "#9c4221"}">${row.label}</strong>
                  <span style="color:${row.ok ? "#2f855a" : "#b7791f"}"
                    >${row.ok ? "已满足" : "待处理"}</span
                  >
                </div>
                <div style="color:var(--text-secondary,#666)">${row.detail}</div>
                ${row.ok
                  ? nothing
                  : html`<button
                      type="button"
                      class="secondary"
                      style="justify-self:start;font-size:12px;padding:5px 9px"
                      @click=${() => onNavigate((row.targetTab ?? row.target) as Tab)}
                    >
                      去处理
                    </button>`}
              </div>
            `,
          )}
        </div>
      </section>
      <section
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);margin-bottom:14px;display:grid;gap:10px"
      >
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
          <div>
            <strong style="font-size:14px">派发候选</strong>
            <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
              调度页只解释和生成派发单；真正运行必须进入岗位执行页。
            </div>
          </div>
          <span style="font-size:12px;color:${topDispatchReason ? "#b7791f" : "#2f855a"}">
            ${multipleDispatchCandidatesReason
              ? "请选择候选"
              : dispatchDisabledReason
                ? "预检未完成"
                : "可检查并派发"}
          </span>
        </div>
        ${dispatchCandidates.length
          ? html`
              <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
                ${dispatchCandidates.map(({ item, match }) => {
                  const recommendedRole = String(
                    match?.roleTitle ??
                      match?.roleListingTitle ??
                      authorizedRole?.roleTitle ??
                      "待选择授权岗位",
                  );
                  const matchReason = String(
                    match?.matchSummary ??
                      item.capabilityMatchSummary ??
                      "根据工作块能力、授权和工具/Skill 条件匹配。",
                  );
                  const risk = String(
                    match?.riskSummary ??
                      item.riskSummary ??
                      "派发前仍需检查授权、API、工具/Skill 和人工确认。",
                  );
                  return html`
                    <div
                      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:10px;background:var(--bg-secondary,#f8fafc);display:grid;gap:6px;font-size:12px"
                    >
                      <div style="display:flex;justify-content:space-between;gap:8px">
                        <strong>${String(item.title ?? "工作块")}</strong>
                        <span style="color:var(--text-secondary,#666)"
                          >${mainFlowPlanItemStatusLabel(item.status)}</span
                        >
                      </div>
                      <div style="color:var(--text-secondary,#666)">
                        推荐岗位：${recommendedRole}
                      </div>
                      <div style="color:var(--text-secondary,#666)">匹配原因：${matchReason}</div>
                      <div style="color:var(--text-secondary,#666)">
                        预计产物：${String(item.expectedOutput ?? "可验收产物")}
                      </div>
                      <div style="color:${risk.includes("阻塞") ? "#c53030" : "#b7791f"}">
                        风险：${risk}
                      </div>
                      <button
                        type="button"
                        class="secondary"
                        style="justify-self:start;font-size:12px;padding:5px 9px"
                        ?disabled=${!hasAuthorizedRole || loading}
                        @click=${() => runDispatch(item)}
                        title=${hasAuthorizedRole
                          ? "检查这条工作块并生成派发单。"
                          : "先到费用与授权创建正式授权。"}
                      >
                        生成这一项派发单
                      </button>
                    </div>
                  `;
                })}
              </div>
            `
          : html`
              <div
                style="border:1px dashed var(--border-color,#cbd5e0);border-radius:8px;padding:18px;text-align:center;font-size:12px;color:var(--text-secondary,#666)"
              >
                还没有可派发的工作块。先到规划方案确认正式规划包。
                <div style="margin-top:10px">
                  <button
                    type="button"
                    class="secondary"
                    style="font-size:12px;padding:6px 10px"
                    @click=${() => onNavigate("company")}
                  >
                    去规划方案
                  </button>
                </div>
              </div>
            `}
      </section>

      ${error
        ? html`<div
            style="padding:12px;background:#fff5f5;border:1px solid #e53e3e;border-radius:6px;color:#e53e3e;margin-bottom:12px;font-size:13px"
          >
            ${error}
          </div>`
        : nothing}
      ${topDispatchReason
        ? html`<div
            style="padding:10px 12px;background:#fffaf0;border:1px solid #f6ad55;border-radius:6px;color:#744210;margin-bottom:12px;font-size:13px;display:flex;justify-content:space-between;gap:12px;align-items:center"
          >
            <span>${topDispatchReason}</span>
            ${hasPlanningItems && !hasAuthorizedRole
              ? html`<button
                  type="button"
                  @click=${() => onNavigate("usage")}
                  style="padding:6px 12px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap"
                >
                  去费用与授权
                </button>`
              : nothing}
          </div>`
        : nothing}
      ${hasDispatchQueue
        ? html`<div
            style="padding:10px 12px;background:#f0fff4;border:1px solid #9ae6b4;border-radius:6px;color:#22543d;margin-bottom:12px;font-size:13px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"
          >
            <span>派发单已生成，下一步到岗位执行页运行已授权任务。</span>
            <button
              type="button"
              @click=${() => onNavigate("aics")}
              style="padding:6px 12px;background:#2f855a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
            >
              去岗位执行
            </button>
          </div>`
        : nothing}

      <div
        style="display:grid;grid-template-columns:repeat(8,minmax(96px,1fr));gap:8px;margin-bottom:16px"
      >
        ${columns.map(
          (col) => html`
            <div
              style="text-align:center;padding:10px;border:1px solid var(--border-color,#e0e0e0);border-radius:6px;background:var(--bg-elevated,#fff)"
            >
              <div style="font-size:22px;font-weight:700;color:${col.color}">${col.count}</div>
              <div style="font-size:11px;color:var(--text-secondary,#666)">${col.label}</div>
            </div>
          `,
        )}
      </div>

      <div style="display:grid;grid-template-columns:1.1fr .9fr;gap:12px;margin-bottom:16px">
        <section
          style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff)"
        >
          <h2 style="font-size:15px;margin:0 0 10px 0">待派发工作块</h2>
          ${confirmedRolePlanItems.length === 0
            ? html`<div
                style="font-size:13px;color:var(--text-secondary,#666);padding:18px;text-align:center"
              >
                <div>还没有可派发工作块。先确认规划方案，系统才会生成岗位承接和派发内容。</div>
              </div>`
            : confirmedRolePlanItems.map((item) => {
                const match = matches.find((m) => m.rolePlanItemId === item.id);
                const blocked = match?.status === "needs_unique_capability";
                return html`
                  <div
                    style="border:1px solid var(--border-color,#edf2f7);border-left:4px solid ${blocked
                      ? "#dd6b20"
                      : "#38a169"};border-radius:7px;padding:10px;margin-bottom:8px;font-size:12px"
                  >
                    <div style="display:flex;justify-content:space-between;gap:8px">
                      <strong style="font-size:13px">${item.title}</strong>
                      <span style="color:${blocked ? "#dd6b20" : "#38a169"}"
                        >${blocked ? "需独特能力" : "通用能力满足"}</span
                      >
                    </div>
                    <div style="color:var(--text-secondary,#666);margin-top:4px">
                      品类：${mainFlowCategoryLabel(match?.category ?? item.category)} ·
                      能力要求：${item.capabilityMatchSummary ?? "等待能力匹配"}
                    </div>
                    <div style="color:var(--text-secondary,#666);margin-top:3px">
                      任务：${item.taskIntent}
                    </div>
                    <div style="color:var(--text-secondary,#666);margin-top:3px">
                      输出：${item.expectedOutput}
                    </div>
                    ${match
                      ? html`<div style="margin-top:6px;color:${blocked ? "#c05621" : "#2f855a"}">
                          ${match.summary}
                        </div>`
                      : html`<div style="margin-top:6px;color:#718096">
                          等待派发预检匹配可用能力。
                        </div>`}
                    ${blocked
                      ? html`<button
                          @click=${() => onNavigate("skills")}
                          style="margin-top:8px;padding:5px 9px;border:1px solid #dd6b20;background:#fffaf0;color:#744210;border-radius:4px;cursor:pointer;font-size:12px"
                        >
                          去工具与 Skill
                        </button>`
                      : nothing}
                    <button
                      ?disabled=${loading || item.dispatchStatus === "dispatched"}
                      @click=${() => runDispatch(item)}
                      style="margin-top:8px;margin-left:6px;padding:5px 9px;border:1px solid #3182ce;background:#ebf8ff;color:#2b6cb0;border-radius:4px;cursor:pointer;font-size:12px;opacity:${loading ||
                      item.dispatchStatus === "dispatched"
                        ? 0.5
                        : 1}"
                    >
                      ${item.dispatchStatus === "dispatched" ? "已派发" : "派发此项"}
                    </button>
                  </div>
                `;
              })}
        </section>

        <section
          style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff)"
        >
          <h2 style="font-size:15px;margin:0 0 10px 0">派发预检</h2>
          ${!hasPlanningItems
            ? html`<div
                style="font-size:13px;color:var(--text-secondary,#666);padding:18px;text-align:center"
              >
                等待规划方案确认后开始预检。
              </div>`
            : html`<div style="display:grid;gap:8px;font-size:12px">
                ${[
                  ["规划方案", hasPlanningItems ? "已准备" : "待准备", hasPlanningItems],
                  ["岗位授权", hasAuthorizedRole ? "已同步" : "待授权", hasAuthorizedRole],
                  [
                    "能力匹配",
                    uniqueRequests.length === 0 ? "可继续" : "需处理",
                    uniqueRequests.length === 0,
                  ],
                  ["派发预检", proposal ? "已生成" : "待生成", Boolean(proposal)],
                  ["派发单", hasDispatchQueue ? "已生成" : "待生成", hasDispatchQueue],
                ].map(
                  ([label, value, ok]) => html`
                    <div
                      style="display:flex;justify-content:space-between;gap:8px;padding:8px;border:1px solid var(--border-color,#edf2f7);border-radius:6px"
                    >
                      <span>${label}</span>
                      <strong style="color:${ok ? "#2f855a" : "#b7791f"}">${value}</strong>
                    </div>
                  `,
                )}
              </div>`}
        </section>
      </div>

      <section
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);margin-bottom:16px"
      >
        <h2 style="font-size:15px;margin:0 0 10px 0">能力匹配</h2>
        ${uniqueRequests.length === 0
          ? html`<div
              style="font-size:13px;color:var(--text-secondary,#666);padding:18px;text-align:center"
            >
              当前任务都可由品类通用能力处理。
            </div>`
          : uniqueRequests.map(
              (req) => html`
                <div
                  style="border:1px solid #f6ad55;border-radius:7px;padding:10px;margin-bottom:8px;background:#fffaf0;font-size:12px"
                >
                  <div style="display:flex;justify-content:space-between;gap:8px">
                    <strong>${req.missingCapability}</strong
                    ><span>${mainFlowCapabilityRequestStatusLabel(req.status)}</span>
                  </div>
                  <div style="margin-top:4px;color:#744210">
                    类型：${mainFlowCapabilityTypeLabel(req.capabilityType)} ·
                    风险：${mainFlowRiskLevelLabel(req.riskLevel)}
                  </div>
                  <div style="margin-top:4px;color:#744210">
                    工具：${((req.neededTools as string[]) ?? []).join(" / ") || "—"}
                  </div>
                  <div style="margin-top:4px;color:#744210">
                    Skill：${((req.neededSkills as string[]) ?? []).join(" / ") || "—"}
                  </div>
                  <div style="margin-top:4px;color:#744210">${req.reason}</div>
                  <button
                    @click=${() => onNavigate("skills")}
                    style="margin-top:8px;padding:5px 9px;border:1px solid #dd6b20;background:#fff;color:#744210;border-radius:4px;cursor:pointer;font-size:12px"
                  >
                    去工具与 Skill
                  </button>
                </div>
              `,
            )}
      </section>

      <div
        style="border:1px dashed var(--border-color,#ccc);border-radius:8px;padding:12px;font-size:12px;color:var(--text-secondary,#666)"
      >
        边界：任务调度只做派发预检和派发单生成，不能直接执行岗位；岗位运行必须进入岗位执行页。
      </div>
    </div>
  `;
}

function renderRoleExecutionProductPage(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const readModel = state.aicsMainFlow?.readModel as Record<string, unknown> | null | undefined;
  const roleExecutionSummary = (readModel?.roleExecutionSummary ?? null) as Record<
    string,
    unknown
  > | null;
  const roleMissingEvidence = Array.isArray(roleExecutionSummary?.missingEvidence)
    ? (roleExecutionSummary.missingEvidence as string[])
    : [];
  return html`
    <div style="padding:16px 16px 0;max-width:1180px;margin:0 auto">
      ${renderMainFlowHumanizedPanel(readModel, onNavigate)}
      ${roleExecutionSummary
        ? html`<section
            style="border:1px solid ${roleExecutionSummary.canMarkCompleted
              ? "#9ae6b4"
              : roleExecutionSummary.canRun
                ? "#f6e05e"
                : "#f6ad55"};background:${roleExecutionSummary.canMarkCompleted
              ? "#f0fff4"
              : "#fffaf0"};border-radius:8px;padding:12px;margin-bottom:14px;display:grid;gap:8px"
          >
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
              <div>
                <strong
                  style="font-size:13px;color:${roleExecutionSummary.canMarkCompleted
                    ? "#276749"
                    : "#9c4221"}"
                >
                  岗位执行进入观察判断
                </strong>
                <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
                  ${String(roleExecutionSummary.userMessage ?? "等待岗位执行状态。")}
                </div>
              </div>
              <button
                type="button"
                style="padding:5px 10px;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-elevated,#fff);font-size:12px;cursor:pointer"
                @click=${() =>
                  onNavigate(roleExecutionSummary.nextObservationReady ? "observation" : "aics")}
              >
                ${String(roleExecutionSummary.nextAction ?? "查看下一步")}
              </button>
            </div>
            <div
              style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;font-size:12px"
            >
              <div>状态：${String(roleExecutionSummary.statusLabel ?? "未知")}</div>
              <div>业务结果：${roleExecutionSummary.hasBusinessResult ? "已回写" : "缺失"}</div>
              <div>产物：${roleExecutionSummary.hasBusinessArtifact ? "已读回" : "缺失"}</div>
              <div>
                审计/账本：${roleExecutionSummary.hasAudit && roleExecutionSummary.hasLedger
                  ? "完整"
                  : "缺失"}
              </div>
              <div>模型费用：${roleExecutionSummary.hasModelUsage ? "有证据" : "缺失"}</div>
            </div>
            ${roleMissingEvidence.length
              ? html`<div style="font-size:12px;color:#c53030">
                  证据缺口：${roleMissingEvidence.join("；")}
                </div>`
              : nothing}
            <div style="font-size:12px;color:var(--text-secondary,#666)">
              ${String(roleExecutionSummary.boundary ?? "岗位执行只运行调度层派发的任务。")}
            </div>
          </section>`
        : nothing}
    </div>
    ${renderMyRolesPage(state, onNavigate)}
  `;
}

function renderMemoryEvolutionProductPage(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const status = state.dreamingStatus;
  return renderMainSystemShell({
    title: "记忆与进化",
    status: state.dreamingStatusLoading ? "同步中" : status ? "已接入" : "待接入",
    icon: "brain",
    loading: state.dreamingStatusLoading,
    error: state.dreamingStatusError,
    emptyLabel: "暂无记忆候选",
    metrics: [
      {
        label: "记忆候选",
        value: formatMainSystemCount(status?.shortTermCount),
        title: "等待任务中心评估的记忆候选。",
      },
      {
        label: "已确认记忆",
        value: formatMainSystemCount(status?.promotedTotal),
        title: "已经确认并可召回的记忆。",
      },
      { label: "待人工确认", value: "待接入", title: "高风险记忆需要人工确认。" },
      { label: "优化候选", value: "待接入", title: "岗位能力优化候选。" },
    ],
    items: [
      {
        title: "记忆候选",
        status: formatMainSystemCount(status?.shortTermCount),
        icon: "brain",
        titleHelp: "只显示任务中心候选，不由岗位直接写入。",
      },
      { title: "已确认记忆", status: formatMainSystemCount(status?.promotedTotal), icon: "check" },
      { title: "自动归档低风险记忆", status: status?.enabled ? "已开启" : "待接入", icon: "book" },
      { title: "待人工确认高风险记忆", status: "待接入", icon: "eye" },
      { title: "岗位优化候选", status: "待接入", icon: "spark" },
      { title: "任务中心总结入库", status: "待接入", icon: "fileText" },
    ],
    actions: [{ label: "设置", title: "打开设置。", icon: "settings", tab: "config" }],
    onNavigate,
  });
}

function renderBillingAuthorizationProductPage(
  state: AppViewState,
  onNavigate: (tab: Tab) => void,
) {
  const marketplaceRoles = state.aicsMarketplace.roles ?? [];
  const myRolesReadModel =
    state.myRoles?.readModel &&
    typeof state.myRoles.readModel === "object" &&
    !Array.isArray(state.myRoles.readModel)
      ? (state.myRoles.readModel as Record<string, unknown>)
      : {};
  const roleAssetRows = [
    ...(Array.isArray(myRolesReadModel.roles)
      ? (myRolesReadModel.roles as Array<Record<string, unknown>>)
      : []),
    ...(Array.isArray(myRolesReadModel.roleAssets)
      ? (myRolesReadModel.roleAssets as Array<Record<string, unknown>>)
      : []),
  ].filter((role, index, rows) => {
    const key =
      typeof role.roleListingId === "string" && role.roleListingId.trim()
        ? role.roleListingId.trim()
        : typeof role.id === "string" && role.id.trim()
          ? role.id.trim()
          : "";
    return (
      Boolean(key) &&
      rows.findIndex((candidate) => {
        const candidateKey =
          typeof candidate.roleListingId === "string" && candidate.roleListingId.trim()
            ? candidate.roleListingId.trim()
            : typeof candidate.id === "string" && candidate.id.trim()
              ? candidate.id.trim()
              : "";
        return candidateKey === key;
      }) === index
    );
  });
  const roleKeys = new Set(
    marketplaceRoles
      .map((role) => role.roleListingId || role.id)
      .filter((roleListingId): roleListingId is string => Boolean(roleListingId)),
  );
  const roleAssets = roleAssetRows
    .filter((role) => typeof role.roleListingId === "string" && !roleKeys.has(role.roleListingId))
    .map((role) => ({
      id: role.roleListingId as string,
      roleListingId: role.roleListingId as string,
      title: typeof role.title === "string" ? role.title : "已授权岗位",
      entitlementId: typeof role.entitlementId === "string" ? role.entitlementId : undefined,
      entitlementStatus: role.entitlementStatus === "authorized" ? "authorized" : "missing",
      authorizationFeeCents:
        typeof role.authorizationFeeCents === "number" ? role.authorizationFeeCents : 0,
      priceLabel: typeof role.priceLabel === "string" ? role.priceLabel : "0 元",
      source: "my_roles_read_model",
    }));
  const roles = [...marketplaceRoles, ...roleAssets];
  const authorized = roles.filter((r) => r.entitlementId);
  const pendingAuthorization = roles.filter((r) => !r.entitlementId);
  const pendingRoleListingId =
    typeof state.aicsRoleBuilder.form.roleListingId === "string"
      ? state.aicsRoleBuilder.form.roleListingId
      : "";
  const normalizedPendingRoleListingId = pendingRoleListingId.trim();
  const manuallySelectedPendingRole =
    normalizedPendingRoleListingId.length > 0
      ? roles.find((role) => (role.roleListingId ?? role.id) === normalizedPendingRoleListingId)
      : null;
  const manuallySelectedFeeCents =
    manuallySelectedPendingRole &&
    typeof (manuallySelectedPendingRole as { authorizationFeeCents?: unknown })
      .authorizationFeeCents === "number"
      ? ((manuallySelectedPendingRole as { authorizationFeeCents?: number })
          .authorizationFeeCents ?? 0)
      : 0;
  const manuallySelectedIsPaidListing =
    Boolean(manuallySelectedPendingRole) && manuallySelectedFeeCents !== 0;
  const manuallySelectedIsUnknownListing =
    normalizedPendingRoleListingId.length > 0 && !manuallySelectedPendingRole;
  const pendingEntitlementId =
    typeof state.aicsRoleBuilder.form.entitlementId === "string"
      ? state.aicsRoleBuilder.form.entitlementId
      : "";
  const totals = state.usageCostSummary?.totals ?? state.usageResult?.totals ?? null;
  const apiMetering = createApiMeteringViewModel({
    readModel: state.apiConnections.readModel,
    usageResult: state.usageResult,
    includeSessionUsage: true,
  });
  const modelTokenTotals = apiMetering.hasModelMetering ? apiMetering.modelTotals : null;
  const mf = state.aicsMainFlow?.readModel as Record<string, unknown> | null;
  const execCount = (mf?.counts as Record<string, number>)?.roleResults ?? 0;
  const mainFlowObjects = (mf?.objects ?? {}) as Record<string, unknown>;
  const roleResults = Array.isArray(mainFlowObjects.roleResults)
    ? (mainFlowObjects.roleResults as Array<Record<string, unknown>>)
    : [];
  const latestRoleResult = roleResults.at(-1) ?? null;
  const latestExecutionEvidence =
    latestRoleResult?.executionEvidence && typeof latestRoleResult.executionEvidence === "object"
      ? (latestRoleResult.executionEvidence as Record<string, unknown>)
      : {};
  const latestArtifactRefs = Array.isArray(latestRoleResult?.artifactRefs)
    ? (latestRoleResult.artifactRefs as unknown[]).filter(
        (ref): ref is string => typeof ref === "string",
      )
    : [];
  const latestArtifactLedgerRef = latestArtifactRefs.find((ref) => ref.startsWith("ledger:")) ?? "";
  const latestAuditRefs = latestArtifactRefs.filter((ref) => ref.startsWith("audit:"));
  const latestBusinessArtifactRefs = latestArtifactRefs.filter(
    (ref) => !ref.startsWith("audit:") && !ref.startsWith("ledger:"),
  );
  const latestLocalLedgerRef =
    typeof latestExecutionEvidence.ledgerRef === "string" &&
    latestExecutionEvidence.ledgerRef.trim()
      ? latestExecutionEvidence.ledgerRef.trim()
      : latestArtifactLedgerRef;
  const latestExecutionSummary =
    typeof latestRoleResult?.summary === "string" && latestRoleResult.summary.trim()
      ? latestRoleResult.summary.trim()
      : "";
  const latestModelUsage =
    latestExecutionEvidence.modelUsage &&
    typeof latestExecutionEvidence.modelUsage === "object" &&
    !Array.isArray(latestExecutionEvidence.modelUsage)
      ? (latestExecutionEvidence.modelUsage as Record<string, unknown>)
      : null;
  const latestNoModelReason =
    latestExecutionEvidence.modelUsageNotApplicable === true &&
    typeof latestExecutionEvidence.modelUsageNotApplicableReason === "string" &&
    latestExecutionEvidence.modelUsageNotApplicableReason.trim()
      ? latestExecutionEvidence.modelUsageNotApplicableReason.trim()
      : "";
  const latestInputTokens =
    typeof latestModelUsage?.inputTokens === "number" &&
    Number.isFinite(latestModelUsage.inputTokens)
      ? latestModelUsage.inputTokens
      : 0;
  const latestOutputTokens =
    typeof latestModelUsage?.outputTokens === "number" &&
    Number.isFinite(latestModelUsage.outputTokens)
      ? latestModelUsage.outputTokens
      : 0;
  const latestTotalTokens =
    typeof latestModelUsage?.totalTokens === "number" &&
    Number.isFinite(latestModelUsage.totalTokens)
      ? latestModelUsage.totalTokens
      : latestInputTokens + latestOutputTokens;
  const latestCostCents =
    typeof latestModelUsage?.costCents === "number" && Number.isFinite(latestModelUsage.costCents)
      ? latestModelUsage.costCents
      : 0;
  const hasLatestCostCents =
    typeof latestModelUsage?.costCents === "number" && Number.isFinite(latestModelUsage.costCents);
  const latestLedgerSync = apiMetering.ledgerSyncRows[0] ?? null;
  const ledgerSyncStatusLabel =
    latestLedgerSync?.status === "synced"
      ? "云端已同步"
      : latestLedgerSync?.status === "pending"
        ? "云端待同步"
        : latestLedgerSync?.status === "blocked"
          ? "云端阻塞"
          : "待执行";
  const ledgerSyncTone =
    latestLedgerSync?.status === "synced"
      ? "#2f855a"
      : latestLedgerSync?.status === "pending"
        ? "#b7791f"
        : latestLedgerSync?.status === "blocked"
          ? "#c53030"
          : "var(--text-secondary,#666)";

  return html`
    <div style="padding:16px;max-width:900px;margin:0 auto">
      <h1 style="font-size:20px;margin:0 0 16px 0">费用与授权</h1>
      ${state.aicsMarketplace.error
        ? html`<div
            style="padding:10px;background:#fff5f5;border:1px solid #e53e3e;border-radius:6px;color:#c53030;margin-bottom:12px;font-size:13px"
          >
            ${state.aicsMarketplace.error}
          </div>`
        : nothing}
      ${renderMainFlowExecutionClosureSummary(mf, state.setTab.bind(state), { compact: true })}

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px">
        <div
          style="text-align:center;padding:12px;border:1px solid var(--border-color,#e0e0e0);border-radius:6px"
        >
          <div style="font-size:11px;color:var(--text-secondary,#666)">已授权</div>
          <div style="font-size:24px;font-weight:700;color:#38a169">${authorized.length}</div>
        </div>
        <div
          style="text-align:center;padding:12px;border:1px solid var(--border-color,#e0e0e0);border-radius:6px"
        >
          <div style="font-size:11px;color:var(--text-secondary,#666)">执行次数</div>
          <div style="font-size:24px;font-weight:700">${execCount}</div>
        </div>
        <div
          style="text-align:center;padding:12px;border:1px solid var(--border-color,#e0e0e0);border-radius:6px"
        >
          <div style="font-size:11px;color:var(--text-secondary,#666)">Token用量</div>
          <div style="font-size:24px;font-weight:700">
            ${modelTokenTotals?.totalTokens
              ? formatMainSystemNumber(modelTokenTotals.totalTokens)
              : totals?.totalTokens
                ? formatMainSystemNumber(totals.totalTokens)
                : "-"}
          </div>
        </div>
        <div
          style="text-align:center;padding:12px;border:1px solid var(--border-color,#e0e0e0);border-radius:6px"
        >
          <div style="font-size:11px;color:var(--text-secondary,#666)">费用</div>
          <div style="font-size:24px;font-weight:700">
            ${modelTokenTotals?.costCny
              ? formatMainSystemCost(modelTokenTotals.costCny)
              : totals?.totalCost
                ? formatMainSystemCost(totals.totalCost)
                : "¥0.00"}
          </div>
        </div>
      </div>

      <section
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;margin-bottom:18px;background:var(--bg-elevated,#fff)"
      >
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
          <div>
            <h2 style="font-size:15px;margin:0">账本回读</h2>
            <p style="font-size:12px;color:var(--text-secondary,#666);margin:4px 0 0 0">
              执行完成后回读本地账本引用，并显示云端账本同步状态。
            </p>
          </div>
          <span style="font-size:12px;font-weight:700;color:${ledgerSyncTone}">
            ${latestLocalLedgerRef ? "本地已记录" : "本地待记录"} · ${ledgerSyncStatusLabel}
          </span>
        </div>
        <div
          style="display:grid;gap:6px;margin-top:10px;font-size:12px;color:var(--text-secondary,#666)"
        >
          <div>
            执行结果：${latestExecutionSummary
              ? html`<span style="color:#2f855a">${latestExecutionSummary}</span>`
              : html`<span style="color:#c53030">暂无执行结果</span>`}
          </div>
          <div>
            本地账本：${latestLocalLedgerRef
              ? html`<span style="color:#2f855a"
                  >${mainFlowLedgerEvidenceLabel(latestLocalLedgerRef)}</span
                >`
              : html`<span style="color:#c53030">暂无费用凭证</span>`}
          </div>
          <div>
            本次模型用量：${latestModelUsage
              ? html`<span style="color:#2f855a"
                  >${latestTotalTokens} Token（输入 ${latestInputTokens} / 输出
                  ${latestOutputTokens}）</span
                >`
              : latestNoModelReason
                ? html`<span style="color:#2f855a">无需模型费用证据：${latestNoModelReason}</span>`
                : html`<span style="color:var(--text-secondary,#666)">暂无模型用量证据</span>`}
          </div>
          <div>
            本次费用证据：${latestModelUsage && hasLatestCostCents
              ? html`<span style="color:#2f855a">¥${(latestCostCents / 100).toFixed(4)}</span>`
              : latestNoModelReason
                ? html`<span style="color:#2f855a">本次未调用模型</span>`
                : html`<span style="color:var(--text-secondary,#666)">无真实费用金额</span>`}
          </div>
          <div>
            审计记录：${latestAuditRefs.length
              ? latestAuditRefs.map(
                  (auditRef, index) => html`${index ? "、" : ""}<span style="color:#2f855a"
                      >${mainFlowAuditEvidenceLabel(auditRef, index)}</span
                    >`,
                )
              : html`<span style="color:#c53030">暂无审计记录</span>`}
          </div>
          <div>
            业务产物：${latestBusinessArtifactRefs.length
              ? latestBusinessArtifactRefs
                  .slice(-3)
                  .map(
                    (artifactRef, index) => html`${index ? "、" : ""}<span style="color:#2f855a"
                        >${mainFlowBusinessArtifactLabel(artifactRef, index)}</span
                      >`,
                  )
              : html`<span style="color:var(--text-secondary,#666)">暂无业务产物引用</span>`}
          </div>
          <div>
            云端账本：${latestLedgerSync?.cloudRef
              ? html`<span style="color:#2f855a">云端账本记录</span>`
              : html`<span style="color:${ledgerSyncTone}"
                  >${latestLedgerSync?.message || "暂无同步记录"}</span
                >`}
          </div>
          ${latestLedgerSync?.pendingUsageRefs.length
            ? html`<div>待同步执行：${latestLedgerSync.pendingUsageRefs.length} 项</div>`
            : nothing}
        </div>
      </section>

      <section
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;margin-bottom:18px;background:var(--bg-elevated,#fff)"
      >
        <div
          style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px"
        >
          <div>
            <h2 style="font-size:15px;margin:0">正式 0 元授权</h2>
            <p style="font-size:12px;color:var(--text-secondary,#666);margin:4px 0 0 0">
              岗位开发者确认上架后这里会显示正式岗位商品；创建 0 元授权后会生成
              RoleEntitlement，并同步到我的岗位。
            </p>
          </div>
          <button
            type="button"
            @click=${() => state.refreshAicsMarketplaceRoles?.()}
            style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
            ?disabled=${state.aicsMarketplace.loading}
          >
            ${state.aicsMarketplace.loading ? "同步中..." : "同步岗位商品与授权"}
          </button>
        </div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">
          <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
            岗位商品编号 roleListingId
            <input
              .value=${pendingRoleListingId}
              @input=${(event: InputEvent) =>
                state.updateAicsRoleBuilderField(
                  "roleListingId",
                  (event.target as HTMLInputElement).value,
                )}
              placeholder="例如 local_rolelisting_xxx 或岗位商品编号"
              style="padding:8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
            />
          </label>
          <button
            type="button"
            @click=${() =>
              state.authorizeAicsMarketplaceRole?.(state.aicsRoleBuilder.form.roleListingId)}
            style="padding:8px 12px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
            ?disabled=${state.aicsMarketplace.loading ||
            !normalizedPendingRoleListingId ||
            manuallySelectedIsUnknownListing ||
            manuallySelectedIsPaidListing}
          >
            ${state.aicsMarketplace.loading ? "处理中..." : "创建 0 元正式授权"}
          </button>
        </div>
        ${manuallySelectedIsUnknownListing
          ? html`<div style="font-size:12px;color:#c53030;margin-top:8px">
              没有在已同步岗位商品中找到这个
              roleListingId。请先点击「同步我的岗位」，或从下方待授权岗位中创建授权。
            </div>`
          : nothing}
        ${manuallySelectedIsPaidListing
          ? html`<div style="font-size:12px;color:#c53030;margin-top:8px">
              该岗位不是 0 元授权岗位，不能在这里创建 0 元授权。
            </div>`
          : nothing}
        <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:10px">
          当前执行授权：${pendingEntitlementId
            ? html`<span style="color:#2f855a">${pendingEntitlementId}</span>`
            : html`<span style="color:#c53030">未生成 entitlementId</span>`}
        </div>
      </section>

      <h2 style="font-size:15px;margin:0 0 8px 0">岗位授权</h2>
      ${pendingAuthorization.length
        ? html`
            <div style="display:grid;gap:4px;margin-bottom:16px">
              ${pendingAuthorization.map((r) => {
                const feeCents =
                  typeof (r as { authorizationFeeCents?: unknown }).authorizationFeeCents ===
                  "number"
                    ? ((r as { authorizationFeeCents?: number }).authorizationFeeCents ?? 0)
                    : 0;
                const isZeroPrice = feeCents === 0;
                return html`
                  <div
                    style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:10px;display:flex;justify-content:space-between;gap:10px;align-items:center"
                  >
                    <span style="display:grid;gap:3px">
                      <span style="font-size:13px;font-weight:600">${r.title ?? "岗位"}</span>
                      <span style="font-size:11px;color:var(--text-secondary,#666)"
                        >${r.roleListingId ?? r.id} ·
                        ${(r as { priceLabel?: string }).priceLabel ?? "0 元"}</span
                      >
                      ${isZeroPrice
                        ? nothing
                        : html`<span style="font-size:11px;color:#c53030">
                            该岗位不是 0 元授权岗位，不能走本地 0 元授权。
                          </span>`}
                    </span>
                    ${isZeroPrice
                      ? html`<button
                          type="button"
                          @click=${() =>
                            state.authorizeAicsMarketplaceRole?.(r.roleListingId ?? r.id)}
                          style="padding:6px 10px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
                          ?disabled=${state.aicsMarketplace.loading}
                        >
                          创建 0 元正式授权
                        </button>`
                      : html`<span style="font-size:12px;color:#c53030;font-weight:650"
                          >需付费授权</span
                        >`}
                  </div>
                `;
              })}
            </div>
          `
        : nothing}
      ${authorized.length === 0
        ? html`<p style="color:var(--text-secondary,#666);font-size:13px;margin-bottom:16px">
            ${pendingAuthorization.length
              ? "暂无已授权岗位。请在上方待授权岗位点击“创建 0 元正式授权”；成功后点击“同步岗位商品与授权”，再进入任务调度和岗位执行。"
              : "暂无岗位。先在主对话切换开发者模式创建岗位，通过审核中心后由岗位开发者确认上架，这里会显示待授权岗位。"}
          </p>`
        : html`
            <div
              style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:12px;margin-bottom:12px;background:var(--bg-elevated,#fff);display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"
            >
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--text-primary,#333)">
                  授权已就绪
                </div>
                <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
                  已同步到我的岗位；下一步先到任务调度生成派发单，已有执行队列时再进入岗位执行运行任务。
                </div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button
                  type="button"
                  @click=${() => onNavigate("workboard")}
                  style="padding:6px 12px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
                >
                  去任务调度
                </button>
                <button
                  type="button"
                  @click=${() => onNavigate("aics")}
                  style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
                >
                  去岗位执行
                </button>
              </div>
            </div>
            <div style="display:grid;gap:4px;margin-bottom:16px">
              ${authorized.map(
                (r) => html`
                  <div
                    style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:10px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start"
                  >
                    <span style="display:grid;gap:3px">
                      <span style="font-size:13px;font-weight:600">${r.title ?? "岗位"}</span>
                      <span style="font-size:11px;color:var(--text-secondary,#666)"
                        >${r.roleListingId ?? r.id}</span
                      >
                      ${r.entitlementId
                        ? html`<span style="font-size:11px;color:#2f855a"
                            >entitlementId：${r.entitlementId}</span
                          >`
                        : html`<span style="font-size:11px;color:#c53030"
                            >缺少 entitlementId，不能进入任务调度。</span
                          >`}
                    </span>
                    <span style="font-size:11px;color:#38a169;white-space:nowrap"
                      >已授权 · ${(r as { priceLabel?: string }).priceLabel ?? "免费"}</span
                    >
                  </div>
                `,
              )}
            </div>
          `}
    </div>
  `;
}

function renderClosedLoopReadinessDetails(
  readiness: Record<string, unknown> | null | undefined,
  onNavigate?: (tab: Tab) => void,
) {
  if (!readiness) return nothing;
  const checks = Array.isArray(readiness.checks)
    ? (readiness.checks as Array<Record<string, unknown>>)
    : [];
  const nextActions = Array.isArray(readiness.nextActions)
    ? (readiness.nextActions as Array<Record<string, unknown>>)
    : [];
  const context =
    readiness.context && typeof readiness.context === "object" && !Array.isArray(readiness.context)
      ? (readiness.context as Record<string, unknown>)
      : {};
  const artifactRefs = Array.isArray(context.artifactRefs)
    ? context.artifactRefs.filter(
        (item): item is string => typeof item === "string" && Boolean(item.trim()),
      )
    : [];
  const businessArtifactRefs = artifactRefs.filter(
    (item) => !item.startsWith("audit:") && !item.startsWith("ledger:"),
  );
  const modelUsage =
    context.modelUsage &&
    typeof context.modelUsage === "object" &&
    !Array.isArray(context.modelUsage)
      ? (context.modelUsage as Record<string, unknown>)
      : null;
  const hasModelUsage =
    Boolean(modelUsage) &&
    (typeof modelUsage?.totalTokens === "number" ||
      typeof modelUsage?.inputTokens === "number" ||
      typeof modelUsage?.outputTokens === "number" ||
      typeof modelUsage?.costCents === "number");
  const noModelUsageReason =
    typeof context.modelUsageNotApplicableReason === "string" &&
    context.modelUsageNotApplicableReason.trim()
      ? context.modelUsageNotApplicableReason.trim()
      : "";
  const hasModelEvidence = hasModelUsage || Boolean(noModelUsageReason);
  const modelUsageLabel = hasModelUsage
    ? [
        typeof modelUsage?.totalTokens === "number" ? `${modelUsage.totalTokens} Token` : "",
        typeof modelUsage?.costCents === "number"
          ? `¥${(modelUsage.costCents / 100).toFixed(2)}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : noModelUsageReason
      ? `本次未调用模型 · ${noModelUsageReason}`
      : "";
  const evidenceRows = [
    [
      "执行结果",
      typeof context.executionId === "string" && context.executionId.trim() ? "已回写" : "",
    ],
    [
      "审计记录",
      typeof context.auditRecordId === "string" && context.auditRecordId.trim() ? "已读回" : "",
    ],
    ["账本记录", typeof context.ledgerRef === "string" && context.ledgerRef.trim() ? "已读回" : ""],
    [
      "产物",
      businessArtifactRefs.length ? mainFlowBusinessArtifactListLabel(businessArtifactRefs) : "",
    ],
    ["模型费用", modelUsageLabel],
  ].filter(([, value]) => typeof value === "string" && value.trim());
  if (!checks.length && !nextActions.length && !evidenceRows.length) return nothing;
  const mode = typeof readiness.mode === "string" ? readiness.mode : "";
  const status = typeof readiness.status === "string" ? readiness.status : "";
  const completedWithEvidence =
    status === "ready" &&
    !nextActions.length &&
    typeof context.executionId === "string" &&
    Boolean(context.executionId.trim()) &&
    typeof context.auditRecordId === "string" &&
    Boolean(context.auditRecordId.trim()) &&
    typeof context.ledgerRef === "string" &&
    Boolean(context.ledgerRef.trim()) &&
    businessArtifactRefs.length > 0 &&
    hasModelEvidence;
  const showLocalFieldAcceptance =
    mode === "local" && !completedWithEvidence && (nextActions.length > 0 || status === "blocked");
  const statusLabel = completedWithEvidence
    ? "已完成"
    : status === "ready" && nextActions.length
      ? "可继续"
      : status === "ready"
        ? "可执行"
        : status === "blocked"
          ? "有阻塞"
          : status || "已检查";
  const statusColor = status === "blocked" ? "#c53030" : nextActions.length ? "#b7791f" : "#2f855a";
  const checkLabel = (checkStatus: unknown) =>
    checkStatus === "pass"
      ? "通过"
      : checkStatus === "blocked"
        ? "阻塞"
        : checkStatus === "skipped"
          ? "跳过"
          : String(checkStatus || "未知");
  const checkColor = (checkStatus: unknown) =>
    checkStatus === "pass" ? "#2f855a" : checkStatus === "blocked" ? "#c53030" : "#718096";
  return html`
    <div
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:10px;display:grid;gap:8px;background:var(--bg-elevated,#fff)"
    >
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px">
        <strong style="color:var(--text-primary,#333)">闭环检查明细</strong>
        <span style="color:${statusColor}"
          >${mode === "local" ? "本地模式" : mode === "cloud" ? "云端模式" : "当前模式"} ·
          ${statusLabel}</span
        >
      </div>
      ${completedWithEvidence
        ? html`
            <div
              style="border:1px solid #9ae6b4;background:#f0fff4;border-radius:6px;padding:8px;font-size:12px;color:#276749;line-height:1.5;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"
            >
              <span
                >本地岗位闭环已完成：执行结果、审计记录、账本记录、业务产物，以及模型费用证据或未调用模型说明均已读回。</span
              >
              ${onNavigate
                ? html`<button
                    type="button"
                    class="secondary"
                    style="font-size:12px;padding:5px 9px"
                    @click=${() => onNavigate("aics")}
                  >
                    查看岗位结果
                  </button>`
                : nothing}
            </div>
          `
        : nothing}
      <div style="display:grid;gap:6px">
        ${checks.map((check) => {
          const itemStatus = check.status;
          return html`
            <div
              style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:8px;display:grid;gap:3px;background:var(--bg-secondary,#fafafa)"
            >
              <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px">
                <span style="font-weight:650;color:var(--text-primary,#333)"
                  >${String(check.label ?? check.id ?? "检查项")}</span
                >
                <span style="color:${checkColor(itemStatus)}">${checkLabel(itemStatus)}</span>
              </div>
              <div style="font-size:12px;color:var(--text-secondary,#666)">
                ${String(check.message ?? "")}
              </div>
            </div>
          `;
        })}
      </div>
      ${nextActions.length
        ? html`
            <div style="display:grid;gap:6px">
              <div style="font-size:12px;font-weight:700;color:var(--text-primary,#333)">
                下一步
              </div>
              ${nextActions.map((action) => {
                const actionText = `${String(action.id ?? "")} ${String(action.action ?? "")}`;
                const targetsRoleExecution =
                  actionText.includes("localEvidenceReadback") || actionText.includes("岗位执行");
                return html`
                  <div
                    style="border:1px solid #bee3f8;border-radius:6px;padding:8px;display:grid;gap:3px;background:#ebf8ff;font-size:12px"
                  >
                    <div style="font-weight:650;color:#2b6cb0">
                      ${String(action.label ?? action.id ?? "下一步")}
                    </div>
                    ${action.message
                      ? html`<div style="color:var(--text-secondary,#666)">
                          ${String(action.message)}
                        </div>`
                      : nothing}
                    ${action.action
                      ? html`<div style="color:var(--text-primary,#333)">
                          ${String(action.action)}
                        </div>`
                      : nothing}
                    ${targetsRoleExecution && onNavigate
                      ? html`<div>
                          <button
                            type="button"
                            class="secondary"
                            style="font-size:12px;padding:5px 9px"
                            @click=${() => onNavigate("aics")}
                          >
                            去岗位执行
                          </button>
                        </div>`
                      : nothing}
                  </div>
                `;
              })}
            </div>
          `
        : nothing}
      ${showLocalFieldAcceptance
        ? html`
            <div
              style="border:1px solid #fbd38d;border-radius:6px;padding:8px;background:#fffaf0;font-size:12px;color:#744210;line-height:1.55"
            >
              <strong>现场验收标准：</strong
              >真实运行后回到这里点“闭环检查”，必须看到执行结果、审计记录、账本记录、业务产物、模型费用证据或未调用模型说明。缺任一项都不算完成。
            </div>
          `
        : nothing}
      ${evidenceRows.length
        ? html`
            <div style="display:grid;gap:6px">
              <div style="font-size:12px;font-weight:700;color:var(--text-primary,#333)">
                真人验收摘要
              </div>
              <div
                style="border:1px solid #c6f6d5;border-radius:6px;padding:8px;display:grid;gap:3px;background:#f0fff4;font-size:12px;color:var(--text-primary,#333)"
              >
                ${evidenceRows.map(
                  ([label, value]) => html`<div>${String(label)}：${String(value)}</div>`,
                )}
              </div>
            </div>
          `
        : nothing}
    </div>
  `;
}

function renderApiManagementProductPage(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const navigateFromApiManagement = (tab: Tab) => {
    onNavigate(tab);
    if (tab === "aics") {
      void Promise.allSettled([
        state.refreshAicsMainFlowReadModel?.(),
        state.refreshMyRolesReadModel?.(),
      ]);
    }
  };
  {
    const pageState = state.apiConnections;
    const readModel = (pageState.readModel ?? {}) as Record<string, unknown>;
    const groups = (readModel.groups ?? {}) as Record<string, unknown>;
    const entries = Array.isArray(readModel.entries)
      ? (readModel.entries as Array<Record<string, unknown>>)
      : Object.values(groups).flatMap((group) =>
          Array.isArray(group) ? (group as Array<Record<string, unknown>>) : [],
        );
    const formState = pageState.form;
    const selectedTemplate =
      API_CONNECTION_TEMPLATES.find((template) => template.id === formState.templateId) ??
      API_CONNECTION_TEMPLATES[0]!;
    const simpleTemplates = API_CONNECTION_TEMPLATES.filter(
      (template) =>
        template.visibleInApiManagement !== false &&
        (template.category === "model_provider" || template.id === "dijie-cloud-bridge"),
    );
    const visibleTemplates = simpleTemplates.some(
      (template) => template.id === formState.templateId,
    )
      ? simpleTemplates
      : [...simpleTemplates, selectedTemplate];
    const modelEntries = entries.filter((entry) => entry.kind === "model");
    const cloudEntries = entries.filter((entry) => entry.provider === "dijie-cloud-bridge");
    const visibleEntries = [...modelEntries, ...cloudEntries];
    const modelOptions = selectedTemplate.modelOptions ?? [];
    const hasSecretValue =
      formState.connectionMode === "oauth" ||
      formState.connectionMode === "local" ||
      Boolean(formState.secretValue.trim()) ||
      Boolean(formState.existingSecretRef);
    const hasModelPricing =
      selectedTemplate.kind !== "model" ||
      (Number(formState.inputTokenPriceCnyPerMillion) > 0 &&
        Number(formState.outputTokenPriceCnyPerMillion) > 0);
    const canSave =
      Boolean(formState.name.trim()) &&
      Boolean(formState.provider.trim()) &&
      (selectedTemplate.kind !== "model" || Boolean(formState.modelId.trim())) &&
      hasSecretValue &&
      hasModelPricing;
    const closedLoopReadinessMode =
      pageState.closedLoopReadiness &&
      typeof pageState.closedLoopReadiness === "object" &&
      !Array.isArray(pageState.closedLoopReadiness)
        ? String((pageState.closedLoopReadiness as Record<string, unknown>).mode ?? "")
        : "";
    const localClosedLoopReadiness =
      closedLoopReadinessMode === "local" ? pageState.closedLoopReadiness : null;
    const hasNonLocalClosedLoopReadiness =
      Boolean(pageState.closedLoopReadiness) && closedLoopReadinessMode !== "local";
    const visiblePageError =
      hasNonLocalClosedLoopReadiness &&
      typeof pageState.error === "string" &&
      pageState.error.includes("闭环检查阻塞")
        ? ""
        : pageState.error;
    const pageMessageIsCloudSyncWarning =
      typeof pageState.message === "string" && pageState.message.includes("云端变量同步未完成");
    const cloudConsumerSelected = formState.consumers.some((consumer) =>
      ["buyer_storefront", "user_center", "developer_center"].includes(consumer),
    );
    const consumerOptions: Array<{
      value: ApiConnectionConsumer;
      label: string;
      hint: string;
    }> = [
      { value: "marketplace", label: "迭界AI云端", hint: "授权、执行 token、审计和 ledger" },
      { value: "local_dialog", label: "本地主对话框", hint: "本地端主聊天窗口" },
      { value: "operations_backend", label: "经营后台", hint: "经营概览、分析、规划" },
      { value: "build_session", label: "BuildSession", hint: "岗位开发辅助" },
      { value: "role_execution", label: "岗位执行", hint: "调度后的岗位运行" },
      { value: "ai_review", label: "AI 辅助审核", hint: "本地上架检查" },
      { value: "buyer_storefront", label: "商城前台", hint: "云端商城对话/推荐" },
      { value: "user_center", label: "使用者中心", hint: "用户侧对话与帮助" },
      { value: "developer_center", label: "开发者中心", hint: "开发者侧对话与帮助" },
      { value: "tool", label: "工具 API", hint: "工具调用池" },
      { value: "skill", label: "Skill API", hint: "Skill 调用池" },
      { value: "media_model", label: "图片/视频/语音", hint: "多模态模型池" },
    ];
    const statusLabel = (status: string) => {
      switch (status) {
        case "available":
          return "可用";
        case "blocked":
          return "阻塞";
        case "unbound":
          return "未应用";
        case "disabled":
          return "已关闭";
        default:
          return status || "未知";
      }
    };
    const statusColor = (status: string, riskStatus?: string) =>
      status === "available" || riskStatus === "ok"
        ? "#2f855a"
        : status === "blocked" || riskStatus === "blocked"
          ? "#c53030"
          : "#b7791f";
    const consumerLabel = (consumer: string) =>
      consumerOptions.find((option) => option.value === consumer)?.label ?? consumer;
    const formatValue = (value: unknown) =>
      typeof value === "number" || typeof value === "string" ? String(value) : "0";
    const enabledEntry = (entry: Record<string, unknown>) =>
      entry.enabled !== false && String(entry.status ?? "available") !== "disabled";
    const secretConfigured = (entry: Record<string, unknown>) => {
      const secret = (entry.secret ?? {}) as Record<string, unknown>;
      return secret.status === "configured" || entry.authMode === "plaintext";
    };
    const modelCoverage = (consumer: ApiConnectionConsumer) => {
      const specific = modelEntries.find((entry) => {
        const consumers = Array.isArray(entry.consumers) ? (entry.consumers as string[]) : [];
        return enabledEntry(entry) && consumers.includes(consumer) && secretConfigured(entry);
      });
      if (specific) {
        return {
          ok: true,
          title: String(specific.name ?? specific.id ?? "模型 Provider"),
          mode: "专用绑定",
          message: `已勾选 ${consumerLabel(consumer)}。`,
        };
      }
      const generic = modelEntries.find((entry) => {
        const consumers = Array.isArray(entry.consumers) ? (entry.consumers as string[]) : [];
        return enabledEntry(entry) && consumers.includes("model") && secretConfigured(entry);
      });
      if (generic) {
        return {
          ok: true,
          title: String(generic.name ?? generic.id ?? "模型 Provider"),
          mode: "通用模型池",
          message: `未专门勾选 ${consumerLabel(consumer)}，会使用通用模型池。`,
        };
      }
      return {
        ok: false,
        title: "未就绪",
        mode: "缺模型",
        message: `请添加模型 API Key，并勾选 ${consumerLabel(consumer)} 或通用模型池。`,
      };
    };
    const cloudBridge = cloudEntries.find(
      (entry) => enabledEntry(entry) && secretConfigured(entry),
    );
    const cloudBridgeReady = Boolean(cloudBridge);
    const cloudSyncFailures = modelEntries.flatMap((entry) => {
      const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
      const sync = (metadata.cloudVariableSync ?? {}) as Record<string, unknown>;
      const status = String(sync.status ?? "");
      return status === "failed" || status === "blocked"
        ? [
            {
              entry,
              status,
              message: String(sync.message ?? sync.lastError ?? "云端变量同步未成功。"),
            },
          ]
        : [];
    });
    const buildSessionCoverage = modelCoverage("build_session");
    const roleExecutionCoverage = modelCoverage("role_execution");
    const renderChainCheck = (item: {
      title: string;
      ok: boolean;
      badge: string;
      message: string;
    }) => html`
      <div
        style="border:1px solid ${item.ok ? "#9ae6b4" : "#feb2b2"};background:${item.ok
          ? "#f0fff4"
          : "#fff5f5"};border-radius:8px;padding:10px;display:grid;gap:5px"
      >
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
          <strong style="font-size:13px">${item.title}</strong>
          <span style="font-size:11px;color:${item.ok ? "#2f855a" : "#c53030"}">${item.badge}</span>
        </div>
        <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.45">
          ${item.message}
        </div>
      </div>
    `;
    const renderSimpleEntry = (entry: Record<string, unknown>) => {
      const secret = (entry.secret ?? {}) as Record<string, unknown>;
      const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
      const pricing = (metadata.pricing ?? {}) as Record<string, unknown>;
      const metering = (metadata.metering ?? {}) as Record<string, unknown>;
      const cloudSync = (metadata.cloudVariableSync ?? {}) as Record<string, unknown>;
      const consumers = Array.isArray(entry.consumers) ? (entry.consumers as string[]) : [];
      const status = String(entry.status ?? "unbound");
      const riskStatus = String(entry.riskStatus ?? "ok");
      const cloudStatus = String(cloudSync.status ?? "");
      const inputPrice = Number(pricing.inputCnyPerMillion);
      const outputPrice = Number(pricing.outputCnyPerMillion);
      const lacksModelPricing =
        entry.kind === "model" &&
        (!Number.isFinite(inputPrice) ||
          inputPrice <= 0 ||
          !Number.isFinite(outputPrice) ||
          outputPrice <= 0);
      return html`
        <div
          style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr));gap:12px;align-items:center;background:var(--bg-elevated,#fff)"
        >
          <div style="min-width:0">
            <div
              style="font-size:14px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
            >
              ${entry.name ?? "Unnamed API"}
            </div>
            <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
              ${entry.kind === "model" ? (metadata.defaultModel ?? "未选模型") : "公共连接"} ·
              ${entry.provider ?? "provider"}
            </div>
            <span
              style="display:inline-flex;margin-top:7px;font-size:11px;padding:3px 7px;border:1px solid var(--border-color,#e0e0e0);border-radius:999px;color:${statusColor(
                status,
                riskStatus,
              )}"
            >
              ${statusLabel(status)}
            </span>
          </div>
          <div style="min-width:0">
            <div style="font-size:12px;color:var(--text-secondary,#666)">提供给</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px">
              ${consumers
                .slice(0, 5)
                .map(
                  (consumer) => html`
                    <span
                      style="font-size:11px;border:1px solid var(--border-color,#e0e0e0);border-radius:999px;padding:2px 6px"
                      >${consumerLabel(consumer)}</span
                    >
                  `,
                )}
              ${consumers.length > 5
                ? html`<span style="font-size:11px;color:var(--text-secondary,#666)"
                    >+${consumers.length - 5}</span
                  >`
                : nothing}
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-secondary,#666)">
            <div>密钥：${secret.status === "configured" ? "本地安全保存" : "未配置"}</div>
            ${entry.kind === "model"
              ? html`
                  ${lacksModelPricing
                    ? html`<div style="margin-top:4px">计费状态: 缺少模型单价，费用不可计算</div>`
                    : html`<div style="margin-top:4px">
                        定价：${formatValue(pricing.inputCnyPerMillion)} /
                        ${formatValue(pricing.outputCnyPerMillion)} 元/百万
                      </div>`}
                  <div style="margin-top:4px">
                    用量：${formatValue(metering.totalTokens)} Token ·
                    ${formatValue(metering.costCny)} 元
                  </div>
                  ${cloudStatus
                    ? html`<div style="margin-top:4px">
                        云端变量：${cloudStatus === "synced"
                          ? "已同步"
                          : cloudStatus === "failed"
                            ? "同步失败"
                            : cloudStatus === "blocked"
                              ? "未同步"
                              : cloudStatus}
                      </div>`
                    : nothing}
                `
              : html`<div style="margin-top:4px">
                  ${entry.baseUrl ?? entry.endpoint ?? "未填写地址"}
                </div>`}
          </div>
          <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
            <button
              type="button"
              class="secondary"
              style="font-size:12px;padding:6px 10px"
              ?disabled=${pageState.saving}
              @click=${() => state.editApiConnectionEntry?.(String(entry.id ?? ""))}
            >
              编辑
            </button>
            ${entry.kind === "model"
              ? html`<button
                  type="button"
                  class="secondary"
                  style="font-size:12px;padding:6px 10px"
                  ?disabled=${pageState.saving}
                  @click=${() => state.syncApiConnectionCloudVariables?.(String(entry.id ?? ""))}
                >
                  同步云端
                </button>`
              : html`<button
                  type="button"
                  class="secondary"
                  style="font-size:12px;padding:6px 10px"
                  ?disabled=${pageState.saving}
                  @click=${() => state.materializeApiConnectionEntry?.(String(entry.id ?? ""))}
                >
                  应用
                </button>`}
            <button
              type="button"
              class="secondary"
              style="font-size:12px;padding:6px 10px"
              ?disabled=${pageState.saving}
              @click=${() => state.testApiConnectionEntry?.(String(entry.id ?? ""))}
            >
              测试
            </button>
            <button
              type="button"
              class="secondary"
              style="font-size:12px;padding:6px 10px;color:#c53030"
              ?disabled=${pageState.saving}
              @click=${() => state.deleteApiConnectionEntry?.(String(entry.id ?? ""))}
            >
              删除
            </button>
          </div>
        </div>
      `;
    };
    return html`
      <div
        style="padding:16px;max-width:1120px;width:100%;box-sizing:border-box;margin:0 auto;display:grid;gap:14px"
      >
        <header style="display:flex;align-items:center;justify-content:space-between;gap:16px">
          <div>
            <h1 style="font-size:22px;margin:0 0 4px 0">API 管理</h1>
            <p style="font-size:13px;color:var(--text-secondary,#666);margin:0">
              添加模型/API Key，选择供给位置，填写 Token 定价；费用按模型 Token 计量。
            </p>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button
              type="button"
              class="secondary"
              @click=${() => state.checkClosedLoopReadiness?.()}
              ?disabled=${pageState.saving || pageState.loading}
            >
              闭环检查
            </button>
            <button
              type="button"
              class="secondary"
              @click=${() => state.refreshApiConnectionsReadModel?.()}
              ?disabled=${pageState.loading}
            >
              刷新
            </button>
          </div>
        </header>

        <section
          style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);display:grid;gap:10px"
        >
          <div>
            <h2 style="font-size:15px;margin:0">系统使用闭环检查</h2>
            <p style="font-size:12px;color:var(--text-secondary,#666);margin:4px 0 0 0">
              检查模型连接、岗位创建、岗位执行、审计和账本读回；云端桥接只影响 SaaS
              同步、云端变量和云端 execution-token。
            </p>
          </div>
          <div
            style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:8px"
          >
            ${renderChainCheck({
              title: "创建岗位",
              ok: buildSessionCoverage.ok,
              badge: buildSessionCoverage.ok ? "可用" : "阻塞",
              message: `${buildSessionCoverage.mode}：${buildSessionCoverage.title}。${buildSessionCoverage.message}`,
            })}
            ${renderChainCheck({
              title: "执行岗位",
              ok: roleExecutionCoverage.ok,
              badge: roleExecutionCoverage.ok ? "可用" : "阻塞",
              message: `${roleExecutionCoverage.mode}：${roleExecutionCoverage.title}。${roleExecutionCoverage.message}`,
            })}
            ${renderChainCheck({
              title: "云端桥接",
              ok: cloudBridgeReady || cloudEntries.length === 0,
              badge: cloudBridgeReady ? "已接入" : "本地版可跳过",
              message: cloudBridgeReady
                ? `已配置 ${String(cloudBridge?.name ?? "迭界AI云端")}，可用于云端岗位目录、授权、execution-token、审计和账本。`
                : "当前先跑本地版，不部署 SaaS 时可暂不配置；需要云端同步时再填写迭界AI云端 Base URL 和 Token。",
            })}
          </div>
          <div
            style="border:1px solid ${roleExecutionCoverage.ok
              ? "#9ae6b4"
              : "#fed7d7"};background:${roleExecutionCoverage.ok
              ? "#f0fff4"
              : "#fff5f5"};border-radius:8px;padding:10px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"
          >
            <div style="display:grid;gap:3px;min-width:220px">
              <strong style="font-size:13px">
                ${roleExecutionCoverage.ok ? "岗位执行 API 已就绪" : "岗位执行 API 未就绪"}
              </strong>
              <span style="font-size:12px;color:var(--text-secondary,#666);line-height:1.45">
                ${roleExecutionCoverage.ok
                  ? "填完 API 后，先到任务调度生成派发单；已有派发单时直接到岗位执行运行任务。"
                  : roleExecutionCoverage.message}
              </span>
            </div>
            ${roleExecutionCoverage.ok
              ? html`
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    <button
                      type="button"
                      class="secondary"
                      style="font-size:12px;padding:6px 10px"
                      @click=${() => onNavigate("workboard")}
                    >
                      去任务调度
                    </button>
                    <button
                      type="button"
                      class="secondary"
                      style="font-size:12px;padding:6px 10px"
                      @click=${() => navigateFromApiManagement("aics")}
                    >
                      去岗位执行
                    </button>
                  </div>
                `
              : nothing}
          </div>
          ${cloudSyncFailures.length
            ? html`
                <div
                  style="border:1px solid #f6e05e;background:#fffff0;border-radius:8px;padding:10px;font-size:12px;color:#975a16;line-height:1.55"
                >
                  云端变量同步未完成（本地版可跳过）：${cloudSyncFailures
                    .map((item) => `${String(item.entry.name ?? item.entry.id)}：${item.message}`)
                    .join("；")}
                  <div style="margin-top:4px">
                    本地版岗位创建和岗位执行不受影响；需要云端
                    SaaS、使用者中心或开发者中心云端同步时再处理云端桥接授权。
                  </div>
                </div>
              `
            : nothing}
          ${hasNonLocalClosedLoopReadiness
            ? html`
                <div
                  style="border:1px solid #bee3f8;background:#ebf8ff;border-radius:8px;padding:10px;font-size:12px;color:#2b6cb0;line-height:1.55;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"
                >
                  <span
                    >当前显示的是旧的云端闭环检查结果。本地版请重新点击“闭环检查”，按本地岗位结果、业务产物、审计和账本验收。</span
                  >
                  <button
                    type="button"
                    class="secondary"
                    style="font-size:12px;padding:5px 9px"
                    ?disabled=${pageState.saving || pageState.loading}
                    @click=${() => state.checkClosedLoopReadiness?.()}
                  >
                    重新检查本地闭环
                  </button>
                </div>
              `
            : nothing}
          ${renderClosedLoopReadinessDetails(localClosedLoopReadiness, navigateFromApiManagement)}
          ${renderMainFlowExecutionClosureSummary(
            state.aicsMainFlow?.readModel as Record<string, unknown> | null | undefined,
            navigateFromApiManagement,
            { compact: true, apiBoundary: true },
          )}
        </section>

        <section
          data-api-connection-form
          style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;display:grid;gap:14px;background:var(--bg-elevated,#fff)"
        >
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
            <h2 style="font-size:15px;margin:0">
              ${formState.editingId ? "编辑 API" : "添加 API"}
            </h2>
            <span style="font-size:12px;color:var(--text-secondary,#666)">
              保存后自动转成本地 SecretRef，不把明文密钥写进普通配置。
            </span>
          </div>

          <div
            style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:10px"
          >
            <label style="display:grid;gap:5px;font-size:12px;color:var(--text-secondary,#666)">
              模型供应商 / 服务
              <select
                .value=${formState.templateId}
                @change=${(event: Event) =>
                  state.updateApiConnectionFormField?.(
                    "templateId",
                    (event.currentTarget as HTMLSelectElement).value,
                  )}
              >
                ${visibleTemplates.map(
                  (template) => html`
                    <option value=${template.id} ?selected=${template.id === formState.templateId}>
                      ${template.title}
                    </option>
                  `,
                )}
              </select>
            </label>
            <label style="display:grid;gap:5px;font-size:12px;color:var(--text-secondary,#666)">
              选择模型
              ${modelOptions.length
                ? html`
                    <select
                      .value=${formState.modelId}
                      ?disabled=${selectedTemplate.kind !== "model"}
                      @change=${(event: Event) =>
                        state.updateApiConnectionFormField?.(
                          "modelId",
                          (event.currentTarget as HTMLSelectElement).value,
                        )}
                    >
                      ${modelOptions.map(
                        (model) => html`
                          <option value=${model} ?selected=${model === formState.modelId}>
                            ${model}
                          </option>
                        `,
                      )}
                    </select>
                  `
                : html`
                    <input
                      .value=${formState.modelId}
                      ?disabled=${selectedTemplate.kind !== "model"}
                      @input=${(event: Event) =>
                        state.updateApiConnectionFormField?.(
                          "modelId",
                          (event.currentTarget as HTMLInputElement).value,
                        )}
                      placeholder="模型 ID"
                    />
                  `}
            </label>
            <label style="display:grid;gap:5px;font-size:12px;color:var(--text-secondary,#666)">
              API Key
              ${formState.connectionMode === "oauth"
                ? html`<input value="OAuth 已授权，不需要填写 API Key" disabled />`
                : formState.connectionMode === "local"
                  ? html`<input value="本地服务，不需要填写 API Key" disabled />`
                  : html`
                      <input
                        type="password"
                        .value=${formState.secretValue}
                        @input=${(event: Event) =>
                          state.updateApiConnectionFormField?.(
                            "secretValue",
                            (event.currentTarget as HTMLInputElement).value,
                          )}
                        placeholder=${formState.existingSecretRef
                          ? "已保存；需要更换时重新粘贴"
                          : "粘贴真实 API Key"}
                      />
                    `}
            </label>
          </div>

          <div
            style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:12px;display:grid;gap:10px"
          >
            <div>
              <div style="font-size:13px;font-weight:700">提供给</div>
              <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
                勾选后进入对应调用池；模型 Token、调用量和费用按这些位置归属。
              </div>
            </div>
            <div
              style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr));gap:8px"
            >
              ${consumerOptions.map((option) => {
                const checked = formState.consumers.includes(option.value);
                return html`
                  <label
                    style="border:1px solid ${checked
                      ? "#90cdf4"
                      : "var(--border-color,#e0e0e0)"};background:${checked
                      ? "#ebf8ff"
                      : "var(--bg-elevated,#fff)"};border-radius:8px;padding:9px;display:flex;gap:8px;align-items:flex-start;min-height:56px"
                  >
                    <input
                      type="checkbox"
                      .checked=${checked}
                      @change=${(event: Event) => {
                        const isChecked = (event.currentTarget as HTMLInputElement).checked;
                        const next = isChecked
                          ? Array.from(new Set([...formState.consumers, option.value]))
                          : formState.consumers.filter((value) => value !== option.value);
                        state.updateApiConnectionFormField?.("consumers", next);
                      }}
                    />
                    <span style="display:grid;gap:2px">
                      <span style="font-size:12px;font-weight:700;color:var(--text-primary,#222)">
                        ${option.label}
                      </span>
                      <span style="font-size:11px;color:var(--text-secondary,#666)">
                        ${option.hint}
                      </span>
                    </span>
                  </label>
                `;
              })}
            </div>
          </div>

          ${selectedTemplate.kind === "model"
            ? html`
                <div
                  style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:12px;display:grid;gap:10px"
                >
                  <div>
                    <div style="font-size:13px;font-weight:700">模型定价</div>
                    <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
                      计量记录调用、输入 Token、输出 Token；费用用这里的每百万 Token 单价计算。
                    </div>
                  </div>
                  <div
                    style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr));gap:10px"
                  >
                    <label
                      style="display:grid;gap:5px;font-size:12px;color:var(--text-secondary,#666)"
                    >
                      输入 Token 单价（元 / 百万）
                      <input
                        inputmode="decimal"
                        .value=${formState.inputTokenPriceCnyPerMillion}
                        @input=${(event: Event) =>
                          state.updateApiConnectionFormField?.(
                            "inputTokenPriceCnyPerMillion",
                            (event.currentTarget as HTMLInputElement).value,
                          )}
                      />
                    </label>
                    <label
                      style="display:grid;gap:5px;font-size:12px;color:var(--text-secondary,#666)"
                    >
                      输出 Token 单价（元 / 百万）
                      <input
                        inputmode="decimal"
                        .value=${formState.outputTokenPriceCnyPerMillion}
                        @input=${(event: Event) =>
                          state.updateApiConnectionFormField?.(
                            "outputTokenPriceCnyPerMillion",
                            (event.currentTarget as HTMLInputElement).value,
                          )}
                      />
                    </label>
                    <label
                      style="display:grid;gap:5px;font-size:12px;color:var(--text-secondary,#666)"
                    >
                      日预算（元，可选）
                      <input
                        inputmode="decimal"
                        .value=${formState.dailyBudgetCny}
                        @input=${(event: Event) =>
                          state.updateApiConnectionFormField?.(
                            "dailyBudgetCny",
                            (event.currentTarget as HTMLInputElement).value,
                          )}
                        placeholder="不限制可留空"
                      />
                    </label>
                  </div>
                </div>
              `
            : nothing}

          <details
            .open=${formState.advancedOpen}
            @toggle=${(event: Event) =>
              state.updateApiConnectionFormField?.(
                "advancedOpen",
                (event.currentTarget as HTMLDetailsElement).open,
              )}
            style="border:1px dashed var(--border-color,#d9d9d9);border-radius:8px;padding:10px"
          >
            <summary style="font-size:12px;font-weight:700;cursor:pointer">高级设置</summary>
            <div
              style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr));gap:8px;margin-top:10px"
            >
              <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
                连接名称
                <input
                  .value=${formState.name}
                  @input=${(event: Event) =>
                    state.updateApiConnectionFormField?.(
                      "name",
                      (event.currentTarget as HTMLInputElement).value,
                    )}
                />
              </label>
              <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
                Provider ID
                <input
                  .value=${formState.provider}
                  @input=${(event: Event) =>
                    state.updateApiConnectionFormField?.(
                      "provider",
                      (event.currentTarget as HTMLInputElement).value,
                    )}
                />
              </label>
              <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
                Base URL
                <input
                  .value=${formState.baseUrl}
                  @input=${(event: Event) =>
                    state.updateApiConnectionFormField?.(
                      "baseUrl",
                      (event.currentTarget as HTMLInputElement).value,
                    )}
                />
              </label>
            </div>
            <label
              style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666);margin-top:8px"
            >
              绑定路径
              <input
                .value=${formState.bindingPath}
                @input=${(event: Event) =>
                  state.updateApiConnectionFormField?.(
                    "bindingPath",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>
          </details>

          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button
              type="button"
              ?disabled=${pageState.saving || !canSave}
              @click=${() => state.createApiConnectionEntry?.()}
            >
              ${formState.editingId ? "保存 API 修改" : "添加 API 连接"}
            </button>
            ${formState.editingId
              ? html`<button
                  type="button"
                  class="secondary"
                  @click=${() => state.resetApiConnectionForm?.()}
                >
                  取消
                </button>`
              : nothing}
            <span style="font-size:12px;color:var(--text-secondary,#666)">
              ${selectedTemplate.kind === "model" && cloudConsumerSelected
                ? "保存后可点“同步云端”，把密钥写入迭界AI云端变量。"
                : "保存后本地端立即可用。"}
            </span>
          </div>
          ${visiblePageError
            ? html`<div style="font-size:12px;color:#c53030">${visiblePageError}</div>`
            : nothing}
          ${pageState.message
            ? html`<div
                style="font-size:12px;color:${pageMessageIsCloudSyncWarning
                  ? "#975a16"
                  : "#2f855a"}"
              >
                ${pageState.message}
              </div>`
            : nothing}
        </section>

        <section
          style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;display:grid;gap:12px;background:var(--bg-elevated,#fff)"
        >
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
            <div>
              <h2 style="font-size:15px;margin:0">API 列表与计量</h2>
              <p style="font-size:12px;color:var(--text-secondary,#666);margin:4px 0 0 0">
                已保存 API 都在这里管理；计量先按使用范围归属，后续 ledger 按同一口径汇总。
              </p>
            </div>
            <div style="font-size:12px;color:var(--text-secondary,#666)">
              模型 ${modelEntries.length} · 云端连接 ${cloudEntries.length}
            </div>
          </div>
          ${visibleEntries.length
            ? html`<div style="display:grid;gap:8px">${visibleEntries.map(renderSimpleEntry)}</div>`
            : html`<p style="font-size:12px;color:var(--text-secondary,#666);margin:0">
                暂无 API。先在上面添加模型 API。
              </p>`}
        </section>
      </div>
    `;
  }
  const apiState = state.apiConnections;
  const readModel = (apiState.readModel ?? {}) as Record<string, unknown>;
  const metrics = (readModel.metrics ?? {}) as Record<string, unknown>;
  const groups = (readModel.groups ?? {}) as Record<string, unknown>;
  const riskReport = (readModel.riskReport ?? {}) as Record<string, unknown>;
  const riskItems = Array.isArray(riskReport.items)
    ? (riskReport.items as Array<Record<string, unknown>>)
    : [];
  const allEntries = Array.isArray(readModel.entries)
    ? (readModel.entries as Array<Record<string, unknown>>)
    : Object.values(groups).flatMap((group) =>
        Array.isArray(group) ? (group as Array<Record<string, unknown>>) : [],
      );
  const toolModel = state.toolSupplyControl.readModel;
  const toolMetrics = toolModel?.metrics;
  const roleModel = (state.myRoles.readModel ?? {}) as Record<string, unknown>;
  const roleSummary = (roleModel.summary ?? {}) as Record<string, unknown>;
  const form = apiState.form;
  const selectedTemplate =
    API_CONNECTION_TEMPLATES.find((template) => template.id === form.templateId) ??
    API_CONNECTION_TEMPLATES[0]!;
  const visibleTemplates = API_CONNECTION_TEMPLATES.filter(
    (template) => template.visibleInApiManagement !== false || template.id === form.templateId,
  );
  const recommendedTemplates = API_CONNECTION_TEMPLATES.filter(
    (template) =>
      template.visibleInApiManagement !== false &&
      template.id !== "openclaw-local" &&
      template.id !== "custom",
  );
  const consumerOptions: Array<{ value: ApiConnectionConsumer; label: string }> = [
    { value: "marketplace", label: "迭界AI云端" },
    { value: "model", label: "通用模型池" },
    { value: "local_dialog", label: "本地主对话框" },
    { value: "operations_backend", label: "经营后台" },
    { value: "build_session", label: "BuildSession" },
    { value: "buyer_storefront", label: "商城前台" },
    { value: "user_center", label: "使用者中心" },
    { value: "developer_center", label: "开发者中心" },
    { value: "role_execution", label: "岗位执行" },
    { value: "ai_review", label: "AI 辅助审核" },
    { value: "tool", label: "工具" },
    { value: "skill", label: "Skill" },
    { value: "media_model", label: "图片/视频/语音" },
  ];
  const count = (value: unknown) =>
    typeof value === "number" || typeof value === "string" ? String(value) : "0";
  const marketplaceEntries = allEntries.filter((entry) => {
    const consumers = Array.isArray(entry.consumers) ? entry.consumers : [];
    return entry.kind === "marketplace" || consumers.includes("marketplace");
  });
  const modelEntries = allEntries.filter((entry) => entry.kind === "model");
  const blockedConnections = Number(metrics.blocked ?? 0) || 0;
  const blockedTools = toolMetrics?.blocked ?? 0;
  const blockedRoles = Number(roleSummary.blockedRoles ?? 0) || 0;
  const totalBlocked = blockedConnections + blockedTools + blockedRoles;
  const localOnline = state.connected;
  const statusText = (status: string) => {
    switch (status) {
      case "available":
        return "可用";
      case "blocked":
        return "阻塞";
      case "disabled":
        return "已禁用";
      case "unbound":
        return "未同步";
      case "needs_setup":
        return "需配置";
      case "pending_review":
        return "待确认";
      case "missing_config":
        return "缺配置";
      case "not_run":
        return "未运行";
      default:
        return status || "未知";
    }
  };
  const statusColor = (status: string, riskStatus?: string) =>
    status === "available" || status === "ready" || riskStatus === "ok"
      ? "#2f855a"
      : status === "blocked" || riskStatus === "blocked"
        ? "#c53030"
        : "#b7791f";
  const entryMatchesTemplate = (entry: Record<string, unknown>, templateId: string) => {
    const template = API_CONNECTION_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return false;
    const consumers = Array.isArray(entry.consumers) ? entry.consumers : [];
    return (
      entry.provider === template.provider ||
      (template.id === "cloud-marketplace" && consumers.includes("marketplace")) ||
      (template.category === "model_provider" &&
        entry.kind === "model" &&
        entry.provider === template.provider)
    );
  };
  const entriesForTemplate = (templateId: string) =>
    allEntries.filter((entry) => entryMatchesTemplate(entry, templateId));
  const renderEntry = (entry: Record<string, unknown>) => {
    const secret = (entry.secret ?? {}) as Record<string, unknown>;
    const bindings = Array.isArray(entry.configBindings)
      ? (entry.configBindings as Array<Record<string, unknown>>)
      : [];
    const consumers = Array.isArray(entry.consumers) ? (entry.consumers as string[]) : [];
    const status = String(entry.status ?? "unbound");
    const riskStatus = String(entry.riskStatus ?? "ok");
    const risks = Array.isArray(entry.risks) ? (entry.risks as Array<Record<string, unknown>>) : [];
    return html`
      <div
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:12px;display:grid;gap:8px;background:var(--bg-elevated,#fff)"
      >
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div>
            <div style="font-size:14px;font-weight:700">${entry.name ?? "Unnamed API"}</div>
            <div style="font-size:12px;color:var(--text-secondary,#666)">
              ${entry.provider ?? "provider"} ·
              ${entry.baseUrl ?? entry.endpoint ?? "endpoint 未填写"}
            </div>
          </div>
          <span
            style="font-size:11px;padding:3px 7px;border:1px solid var(--border-color,#e0e0e0);border-radius:999px;color:${statusColor(
              status,
              riskStatus,
            )}"
          >
            ${statusText(status)}
          </span>
        </div>
        <div
          style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;color:var(--text-secondary,#666)"
        >
          <span>Secret: ${secret.mode ?? "none"}${secret.id ? `:${secret.id}` : ""}</span>
          <span>供给: ${consumers.length ? consumers.join(" / ") : "未声明"}</span>
          <span
            >绑定:
            ${bindings.length
              ? bindings.map((binding) => binding.path).join(" / ")
              : "未绑定"}</span
          >
        </div>
        ${risks.length
          ? html`<div
              style="font-size:11px;color:${risks.some((risk) => risk.severity === "blocking")
                ? "#c53030"
                : "#b7791f"}"
            >
              ${risks[0]?.message}
            </div>`
          : nothing}
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button
            type="button"
            class="secondary"
            style="font-size:12px;padding:6px 10px"
            ?disabled=${apiState.saving}
            @click=${() => state.testApiConnectionEntry?.(String(entry.id ?? ""))}
          >
            测试
          </button>
          <button
            type="button"
            class="secondary"
            style="font-size:12px;padding:6px 10px"
            ?disabled=${apiState.saving}
            @click=${() => state.editApiConnectionEntry?.(String(entry.id ?? ""))}
          >
            编辑
          </button>
          <button
            type="button"
            class="secondary"
            style="font-size:12px;padding:6px 10px"
            ?disabled=${apiState.saving || bindings.length === 0}
            @click=${() => state.materializeApiConnectionEntry?.(String(entry.id ?? ""))}
          >
            同步到运行时配置
          </button>
          <button
            type="button"
            class="secondary"
            style="font-size:12px;padding:6px 10px;color:#c53030"
            ?disabled=${apiState.saving}
            @click=${() => state.deleteApiConnectionEntry?.(String(entry.id ?? ""))}
          >
            删除
          </button>
        </div>
      </div>
    `;
  };
  const renderMetricCard = (
    label: string,
    value: string | number,
    hint: string,
    color = "#2d3748",
  ) => html`
    <div
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:12px;background:var(--bg-elevated,#fff);min-width:0"
    >
      <div style="font-size:11px;color:var(--text-secondary,#666)">${label}</div>
      <div style="font-size:24px;font-weight:800;color:${color};margin-top:3px">${value}</div>
      <div style="font-size:11px;color:var(--text-secondary,#666);margin-top:3px">${hint}</div>
    </div>
  `;
  const renderSection = (title: string, subtitle: string, body: unknown) => html`
    <section
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;display:grid;gap:10px;background:var(--bg-elevated,#fff)"
    >
      <div>
        <h2 style="font-size:15px;margin:0">${title}</h2>
        <p style="font-size:12px;color:var(--text-secondary,#666);margin:4px 0 0 0">${subtitle}</p>
      </div>
      ${body}
    </section>
  `;
  const renderTemplateCard = (template: (typeof API_CONNECTION_TEMPLATES)[number]) => {
    const entries = entriesForTemplate(template.id);
    const available = entries.some((entry) => entry.status === "available");
    const blocked = entries.some((entry) => entry.status === "blocked");
    const status =
      entries.length === 0 ? "未连接" : available ? "可用" : blocked ? "需修复" : "已保存";
    const color =
      entries.length === 0 ? "#718096" : available ? "#2f855a" : blocked ? "#c53030" : "#b7791f";
    return html`
      <div
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:12px;display:grid;gap:8px;min-height:128px;background:var(--bg-elevated,#fff)"
      >
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div>
            <div style="font-size:14px;font-weight:750">${template.title}</div>
            <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
              ${template.description}
            </div>
          </div>
          <span
            style="font-size:11px;color:${color};border:1px solid var(--border-color,#ddd);border-radius:999px;padding:3px 7px;white-space:nowrap"
            >${status}</span
          >
        </div>
        <div style="font-size:11px;color:var(--text-secondary,#666)">
          ${template.category === "cloud_marketplace"
            ? "商城 / 岗位 / 能力"
            : template.category === "model_provider"
              ? "多模型适配"
              : template.category === "tool_provider"
                ? "工具与 Skill 依赖"
                : "系统连接"}
        </div>
        <button
          type="button"
          class="secondary"
          style="font-size:12px;padding:7px 10px;justify-self:start"
          @click=${(event: Event) => {
            if (entries[0]) {
              state.editApiConnectionEntry?.(String(entries[0].id ?? ""));
            } else {
              state.updateApiConnectionFormField?.("templateId", template.id);
            }
            const root = (event.currentTarget as HTMLElement).getRootNode() as
              | Document
              | ShadowRoot;
            const formElement = root.querySelector<HTMLElement>("[data-api-connection-form]");
            if (typeof formElement?.scrollIntoView === "function") {
              formElement.scrollIntoView({
                block: "start",
                behavior: "smooth",
              });
            }
          }}
        >
          ${entries.length
            ? "管理 API"
            : template.connectionMode === "local"
              ? "检测本地服务"
              : template.category === "cloud_marketplace"
                ? "接入商城 API"
                : template.category === "model_provider"
                  ? "接入模型 API"
                  : template.category === "tool_provider"
                    ? "接入工具 API"
                    : "接入 API"}
        </button>
      </div>
    `;
  };
  return html`
    <div style="padding:16px;max-width:1120px;margin:0 auto;display:grid;gap:14px">
      <header style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
        <div>
          <h1 style="font-size:22px;margin:0 0 4px 0">API 供给中心</h1>
          <p style="font-size:13px;color:var(--text-secondary,#666);margin:0">
            给云端商城、OpenClaw 对话框、工具、Skill、多模型和岗位调用统一供给 API，并持续监控风险。
          </p>
        </div>
        <div style="display:flex;gap:8px">
          <button
            type="button"
            class="secondary"
            @click=${() => state.checkClosedLoopReadiness?.()}
            ?disabled=${apiState.saving || apiState.loading}
          >
            闭环检查
          </button>
          <button
            type="button"
            class="secondary"
            @click=${() => state.refreshApiConnectionsReadModel?.()}
            ?disabled=${apiState.loading}
          >
            刷新
          </button>
        </div>
      </header>

      <section style="display:grid;gap:8px">
        <h2 style="font-size:15px;margin:0">系统使用总览</h2>
        <div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px">
          ${renderMetricCard(
            "云端商城",
            marketplaceEntries.some((entry) => entry.status === "available")
              ? "可用"
              : marketplaceEntries.length
                ? "需修复"
                : "未连接",
            "岗位、能力、审核、授权读取",
            marketplaceEntries.some((entry) => entry.status === "available")
              ? "#2f855a"
              : "#c53030",
          )}
          ${renderMetricCard(
            "本地 OpenClaw",
            localOnline ? "在线" : "离线",
            "Gateway / runtime / 插件状态",
            localOnline ? "#2f855a" : "#c53030",
          )}
          ${renderMetricCard("模型 Provider", modelEntries.length, "多模型适配连接")}
          ${renderMetricCard("工具/Skill", toolMetrics?.available ?? 0, "当前可调用能力")}
          ${renderMetricCard("岗位调用", count(roleSummary.availableRoles), "可用岗位")}
          ${renderMetricCard(
            "当前阻塞",
            totalBlocked,
            "连接、能力或岗位阻塞",
            totalBlocked > 0 ? "#c53030" : "#2f855a",
          )}
        </div>
      </section>

      ${renderSection(
        "推荐连接",
        "选择服务后直接粘贴 API Key；底层用途与绑定路径由 OpenClaw 自动生成。",
        html`<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px">
          ${recommendedTemplates.map(renderTemplateCard)}
        </div>`,
      )}

      <section
        data-api-connection-form
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;display:grid;gap:12px;background:var(--bg-elevated,#fff)"
      >
        <h2 style="font-size:15px;margin:0">${form.editingId ? "编辑连接" : "连接服务"}</h2>
        <div
          style="border:1px solid #bee3f8;background:#ebf8ff;color:#2a4365;border-radius:8px;padding:10px;display:grid;gap:4px;font-size:12px"
        >
          <strong
            >怎么填：先选服务，普通情况直接粘贴 API
            Key。不要从自定义服务开始，除非这个服务不在推荐列表里。</strong
          >
          <span>当前服务：${selectedTemplate.title}。${selectedTemplate.description}</span>
          <span>
            ${selectedTemplate.connectionMode === "local"
              ? "本地服务选择“本地服务”，API Key 可以留空。"
              : selectedTemplate.id === "cloud-marketplace"
                ? "云端商城 API 用来连接本地 OpenClaw 和云端商城；本地开发默认 Base URL 是 127.0.0.1:9000，推荐用 DIJIE_CLOUD_ACCESS_TOKEN 这类 SecretRef，保存后再同步到 AICS runtime。"
                : selectedTemplate.id === "openai"
                  ? "OpenAI 直接粘贴 sk- 开头的真实 API Key；不需要手填 Provider ID 或绑定路径。"
                  : selectedTemplate.id === "anthropic"
                    ? "Anthropic 直接粘贴真实 API Key；不需要手填 Provider ID 或绑定路径。"
                    : selectedTemplate.id === "gemini"
                      ? "Google Gemini 直接粘贴真实 API Key；不需要手填 Provider ID 或绑定路径。"
                      : selectedTemplate.id === "deepseek"
                        ? "DeepSeek 直接粘贴 sk- 开头的真实 API Key；不需要手填 Provider ID 或绑定路径。"
                        : selectedTemplate.id === "qwen-dashscope"
                          ? "阿里百炼直接粘贴百炼控制台给你的真实 API Key；不需要手填 Provider ID 或绑定路径。"
                          : selectedTemplate.id === "custom"
                            ? "自定义服务才需要展开高级设置，手动填写 Provider ID、Base URL、用途和绑定路径。"
                            : "直接粘贴这个服务给你的真实 API Key。"}
          </span>
          ${form.bindingPath
            ? html`<span
                style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#1a365d"
              >
                将绑定到：${form.bindingPath}
              </span>`
            : nothing}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:8px">
          <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
            服务类型
            <select
              .value=${form.templateId}
              @change=${(event: Event) =>
                state.updateApiConnectionFormField?.(
                  "templateId",
                  (event.currentTarget as HTMLSelectElement).value,
                )}
            >
              ${visibleTemplates.map(
                (template) => html`
                  <option value=${template.id} ?selected=${template.id === form.templateId}>
                    ${template.title}
                  </option>
                `,
              )}
            </select>
          </label>
          <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
            连接方式
            <select
              .value=${form.connectionMode}
              @change=${(event: Event) =>
                state.updateApiConnectionFormField?.(
                  "connectionMode",
                  (event.currentTarget as HTMLSelectElement).value,
                )}
            >
              <option value="direct">直接输入 API Key</option>
              <option value="env">本机安全保存</option>
              <option value="oauth">OAuth / 云端授权</option>
              <option value="local">本地服务</option>
            </select>
          </label>
          <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
            ${form.connectionMode === "env" ? "API Key（本机安全保存）" : "API Key"}
            <input
              type=${form.connectionMode === "direct" || form.connectionMode === "env"
                ? "password"
                : "text"}
              .value=${form.connectionMode === "direct" || form.connectionMode === "env"
                ? form.secretValue
                : form.secretEnvId}
              ?disabled=${form.connectionMode === "local"}
              @input=${(event: Event) =>
                state.updateApiConnectionFormField?.(
                  form.connectionMode === "direct" || form.connectionMode === "env"
                    ? "secretValue"
                    : "secretEnvId",
                  (event.currentTarget as HTMLInputElement).value,
                )}
              placeholder=${form.connectionMode === "env" ? "粘贴后保存为本机 SecretRef" : "sk-..."}
            />
          </label>
        </div>
        <details
          .open=${form.advancedOpen}
          @toggle=${(event: Event) =>
            state.updateApiConnectionFormField?.(
              "advancedOpen",
              (event.currentTarget as HTMLDetailsElement).open,
            )}
          style="border:1px dashed var(--border-color,#d9d9d9);border-radius:8px;padding:10px"
        >
          <summary style="font-size:12px;font-weight:700;cursor:pointer">高级设置</summary>
          <div
            style="display:grid;grid-template-columns:1.1fr .8fr 1fr 1.2fr;gap:8px;margin-top:10px"
          >
            <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
              连接名称
              <input
                .value=${form.name}
                @input=${(event: Event) =>
                  state.updateApiConnectionFormField?.(
                    "name",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>
            <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
              类型
              <select
                .value=${form.kind}
                @change=${(event: Event) =>
                  state.updateApiConnectionFormField?.(
                    "kind",
                    (event.currentTarget as HTMLSelectElement).value,
                  )}
              >
                <option value="model">模型</option>
                <option value="tool_skill">工具/Skill</option>
                <option value="marketplace">商城</option>
                <option value="dialog">对话框</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
              Provider ID
              <input
                .value=${form.provider}
                @input=${(event: Event) =>
                  state.updateApiConnectionFormField?.(
                    "provider",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>
            <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
              Base URL
              <input
                .value=${form.baseUrl}
                @input=${(event: Event) =>
                  state.updateApiConnectionFormField?.(
                    "baseUrl",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>
          </div>
          <label
            style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666);margin-top:8px"
          >
            绑定路径
            <input
              .value=${form.bindingPath}
              @input=${(event: Event) =>
                state.updateApiConnectionFormField?.(
                  "bindingPath",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
          </label>
          ${form.connectionMode === "env"
            ? html`
                <label
                  style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666);margin-top:8px"
                >
                  或使用已有环境变量名
                  <input
                    .value=${form.secretEnvId}
                    @input=${(event: Event) =>
                      state.updateApiConnectionFormField?.(
                        "secretEnvId",
                        (event.currentTarget as HTMLInputElement).value,
                      )}
                    placeholder="DIJIE_CLOUD_ACCESS_TOKEN"
                  />
                </label>
              `
            : nothing}
          ${form.kind === "marketplace"
            ? html`
                <label
                  style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666);margin-top:8px"
                >
                  云端 smoke 输出 JSON
                  <textarea
                    .value=${form.smokeJson}
                    @input=${(event: Event) =>
                      state.updateApiConnectionFormField?.(
                        "smokeJson",
                        (event.currentTarget as HTMLTextAreaElement).value,
                      )}
                    placeholder='{"roleListingId":"djrole_...","entitlementId":"djent_...","deviceId":"local-admin-device","workspaceRef":"local-admin-workspace","localGatewayId":"openclaw-local-gateway"}'
                    style="min-height:88px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px"
                  ></textarea>
                </label>
              `
            : nothing}
          <div
            style="display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:var(--text-secondary,#666);margin-top:8px"
          >
            ${consumerOptions.map((option) => {
              const checked = form.consumers.includes(option.value);
              return html`
                <label style="display:flex;align-items:center;gap:5px">
                  <input
                    type="checkbox"
                    .checked=${checked}
                    @change=${(event: Event) => {
                      const isChecked = (event.currentTarget as HTMLInputElement).checked;
                      const next = isChecked
                        ? Array.from(new Set([...form.consumers, option.value]))
                        : form.consumers.filter((value) => value !== option.value);
                      state.updateApiConnectionFormField?.("consumers", next);
                    }}
                  />
                  ${option.label}
                </label>
              `;
            })}
          </div>
        </details>
        <div style="display:flex;gap:8px;align-items:center">
          <button
            type="button"
            ?disabled=${apiState.saving ||
            !form.name.trim() ||
            !form.provider.trim() ||
            (form.connectionMode === "direct" && !form.secretValue.trim()) ||
            (form.connectionMode === "env" &&
              !form.secretValue.trim() &&
              !form.secretEnvId.trim() &&
              !form.existingSecretRef)}
            @click=${() => state.createApiConnectionEntry?.()}
          >
            ${form.editingId ? "保存 API 修改" : "添加 API 连接"}
          </button>
          ${form.editingId
            ? html`<button
                type="button"
                class="secondary"
                @click=${() => state.resetApiConnectionForm?.()}
              >
                取消
              </button>`
            : nothing}
          <span style="font-size:12px;color:var(--text-secondary,#666)"
            >普通模式直接粘贴 API Key；系统字段由模板生成。</span
          >
        </div>
        ${apiState.error
          ? html`<div style="font-size:12px;color:#c53030">${apiState.error}</div>`
          : ""}
        ${apiState.message
          ? html`<div style="font-size:12px;color:#2f855a">${apiState.message}</div>`
          : ""}
        ${renderClosedLoopReadinessDetails(apiState.closedLoopReadiness, navigateFromApiManagement)}
      </section>

      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
        ${renderSection(
          "云端商城",
          "商城 API 负责读取岗位、能力、审核、商品和授权状态。",
          marketplaceEntries.length
            ? html`<div style="display:grid;gap:8px">${marketplaceEntries.map(renderEntry)}</div>`
            : html`<p style="font-size:12px;color:#c53030;margin:0">
                云端商城 API 未连接，商城管理与岗位授权读取会被阻塞。
              </p>`,
        )}
        ${renderSection(
          "本地服务",
          "本地服务只做健康检测，不要求填写外部 API。",
          html`<div style="display:grid;gap:8px;font-size:12px">
            <div
              style="display:flex;justify-content:space-between;border:1px solid var(--border-color,#edf2f7);border-radius:6px;padding:9px"
            >
              <span>Gateway 连接</span
              ><strong style="color:${localOnline ? "#2f855a" : "#c53030"}"
                >${localOnline ? "在线" : "离线"}</strong
              >
            </div>
            <div
              style="display:flex;justify-content:space-between;border:1px solid var(--border-color,#edf2f7);border-radius:6px;padding:9px"
            >
              <span>OpenClaw runtime</span><strong>${localOnline ? "可检测" : "待连接"}</strong>
            </div>
            <div
              style="display:flex;justify-content:space-between;border:1px solid var(--border-color,#edf2f7);border-radius:6px;padding:9px"
            >
              <span>插件 / Skill 服务</span><strong>${toolModel ? "已读取" : "待刷新"}</strong>
            </div>
          </div>`,
        )}
        ${renderSection(
          "多模型适配",
          "模型 Provider 只管理连接与默认可用状态，不展示用量统计。",
          modelEntries.length
            ? html`<div style="display:grid;gap:8px">${modelEntries.map(renderEntry)}</div>`
            : html`<p style="font-size:12px;color:var(--text-secondary,#666);margin:0">
                还没有模型 Provider；可从推荐连接选择 OpenAI、DeepSeek、阿里百炼、Anthropic、Gemini
                或 Ollama。
              </p>`,
        )}
        ${renderSection(
          "已连接服务",
          "所有已保存连接都在这里管理，可测试、编辑、删除或同步运行时配置。",
          allEntries.length
            ? html`<div style="display:grid;gap:8px">${allEntries.map(renderEntry)}</div>`
            : html`<p style="font-size:12px;color:var(--text-secondary,#666);margin:0">
                暂无已连接服务。
              </p>`,
        )}
      </div>

      <section
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;display:grid;gap:10px"
      >
        <h2 style="font-size:15px;margin:0">风险与阻塞</h2>
        ${riskItems.length || toolModel?.risks?.length
          ? html`
              <div style="display:grid;gap:8px">
                ${[...riskItems, ...(toolModel?.risks ?? [])].map((risk) => {
                  const riskRecord = risk as Record<string, unknown>;
                  return html`
                    <div
                      style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:10px;display:grid;gap:3px"
                    >
                      <div
                        style="font-size:12px;font-weight:700;color:${riskRecord.severity ===
                        "blocking"
                          ? "#c53030"
                          : "#b7791f"}"
                      >
                        ${riskRecord.severity} ·
                        ${riskRecord.code ?? riskRecord.reason ?? "blocked"}
                      </div>
                      <div style="font-size:12px;color:var(--text-secondary,#666)">
                        ${riskRecord.message ?? riskRecord.reason}
                      </div>
                    </div>
                  `;
                })}
              </div>
            `
          : html`<p style="font-size:12px;color:var(--text-secondary,#666);margin:0">
              暂无风险或阻塞。
            </p>`}
      </section>
    </div>
  `;
}

function renderToolSupplyFourPage(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const model = state.toolSupplyControl.readModel;
  const loading = state.toolSupplyControl.loading;
  const saving = state.toolSupplyControl.saving;
  const message = state.toolSupplyControl.message;
  const error = state.toolSupplyControl.error;
  const subpage = state.toolSupplyActiveSubpage ?? "skill";
  const bindings = model?.bindings ?? [];
  const systemDevelopmentTodos = model?.systemDevelopmentTodos ?? [];
  const displayCategoryName = (categoryId: string) =>
    categoryId
      .replace(/^cloud:/u, "")
      .replace(/^category_common:/u, "")
      .replace(/^category:/u, "");
  const categoryMap = new Map<string, ToolSupplyCloudCategory>();
  for (const category of model?.categories ?? []) {
    categoryMap.set(category.id, category);
  }
  for (const binding of bindings) {
    if (binding.targetKind !== "category_capability") continue;
    if (categoryMap.has(binding.targetId)) continue;
    categoryMap.set(binding.targetId, {
      id: binding.targetId,
      name: binding.targetTitle || displayCategoryName(binding.targetId),
      source: "cloud",
      status: "pending",
      listingCount: 0,
    });
  }
  const categories = [...categoryMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN"),
  );
  const existingPackages = new Map((model?.packages ?? []).map((pack) => [pack.category.id, pack]));
  const packages: ToolSupplyCategoryCapabilityPackage[] = categories.map((category) => {
    const existing = existingPackages.get(category.id);
    const categoryBindings = bindings.filter(
      (binding) =>
        binding.status === "active" &&
        binding.targetKind === "category_capability" &&
        binding.targetId === category.id,
    );
    const skills = categoryBindings
      .filter((binding) => binding.sourceKind === "skill")
      .map((binding) => (model?.skills ?? []).find((item) => item.id === binding.sourceItemId))
      .filter((item): item is ToolSupplyControlItem => Boolean(item));
    const tools = categoryBindings
      .filter((binding) => binding.sourceKind === "tool")
      .map((binding) => (model?.localTools ?? []).find((item) => item.id === binding.sourceItemId))
      .filter((item): item is ToolSupplyControlItem => Boolean(item));
    return {
      category,
      skills: skills.length ? skills : (existing?.skills ?? []),
      tools: tools.length ? tools : (existing?.tools ?? []),
      roleUsageCount: existing?.roleUsageCount ?? category.listingCount,
    };
  });
  if (!model && !loading && state.connected) {
    queueMicrotask(() => {
      if (state.tab === "skills" && !state.toolSupplyControl.loading) {
        void state.refreshToolSupplyControlReadModel();
      }
    });
  }
  const buttonBase =
    "border:1px solid var(--border-color,#d0d0d0);border-radius:6px;padding:7px 10px;background:var(--bg-elevated,#fff);color:var(--text-primary,#111);font-size:12px;cursor:pointer";
  const primaryButton =
    "border:1px solid var(--accent-color,#2563eb);border-radius:6px;padding:7px 10px;background:var(--accent-color,#2563eb);color:#fff;font-size:12px;font-weight:700;cursor:pointer";
  const disabledStyle = saving || loading ? "opacity:.55;cursor:not-allowed" : "";
  const setSubpage = (next: AppViewState["toolSupplyActiveSubpage"]) => {
    state.toolSupplyActiveSubpage = next;
  };
  const selectedCategoryId =
    state.toolSupplySelectedCategoryId &&
    categories.some((category) => category.id === state.toolSupplySelectedCategoryId)
      ? state.toolSupplySelectedCategoryId
      : (categories[0]?.id ?? null);
  const selectedCategory = selectedCategoryId ? categoryMap.get(selectedCategoryId) : undefined;
  const categoryName = (categoryId: string) =>
    categories.find((category) => category.id === categoryId)?.name ?? categoryId;
  const itemKind = (item: ToolSupplyControlItem): "skill" | "tool" =>
    item.kind === "skill" ? "skill" : "tool";
  const itemBindings = (item: ToolSupplyControlItem) =>
    bindings.filter(
      (binding) =>
        binding.status === "active" &&
        binding.targetKind === "category_capability" &&
        binding.sourceItemId === item.id &&
        binding.sourceKind === itemKind(item),
    );
  const currentItemIdsForCategory = (sourceKind: "skill" | "tool", categoryId: string | null) =>
    new Set(
      categoryId
        ? bindings
            .filter(
              (binding) =>
                binding.status === "active" &&
                binding.targetKind === "category_capability" &&
                binding.targetId === categoryId &&
                binding.sourceKind === sourceKind,
            )
            .map((binding) => binding.sourceItemId)
        : [],
    );
  const selectionDraftKey = (sourceKind: "skill" | "tool", categoryId: string | null) =>
    `${sourceKind}:${categoryId ?? "none"}`;
  const selectedItemIdsForCategory = (sourceKind: "skill" | "tool", categoryId: string | null) => {
    const key = selectionDraftKey(sourceKind, categoryId);
    return new Set(
      state.toolSupplySelectionDrafts[key] ?? [
        ...currentItemIdsForCategory(sourceKind, categoryId),
      ],
    );
  };
  const updateSelectedItemIdsForCategory = (
    sourceKind: "skill" | "tool",
    categoryId: string | null,
    updater: (current: Set<string>) => Set<string>,
  ) => {
    if (!categoryId) return;
    const key = selectionDraftKey(sourceKind, categoryId);
    const next = [...updater(selectedItemIdsForCategory(sourceKind, categoryId))];
    state.toolSupplySelectionDrafts = {
      ...state.toolSupplySelectionDrafts,
      [key]: next,
    };
  };
  const hasCategorySelectionChanges = (sourceKind: "skill" | "tool", categoryId: string | null) => {
    const current = currentItemIdsForCategory(sourceKind, categoryId);
    const draft = selectedItemIdsForCategory(sourceKind, categoryId);
    if (current.size !== draft.size) return true;
    return [...draft].some((id) => !current.has(id));
  };
  const statusText = (status: string) => {
    const labels: Record<string, string> = {
      available: "可用",
      blocked: "阻塞",
      disabled: "已禁用",
      needs_setup: "需配置",
      pending_review: "待审核",
      active: "可用",
      pending: "待同步",
    };
    return labels[status] ?? status;
  };
  const syncText = (binding: ToolSupplyBinding) => {
    const labels: Record<string, string> = {
      local: "本地",
      syncing: "同步中",
      synced: "已同步",
      sync_failed: "同步失败",
    };
    return labels[binding.syncStatus ?? "local"];
  };
  const reasonText = (item: ToolSupplyControlItem) => {
    const labels: Record<string, string> = {
      missing_api_binding: "缺 API，请去 API 管理补齐",
      missing_category_binding: "还没有加入品类",
      missing_tool_binding: "缺工具",
      missing_skill_binding: "缺 Skill",
      skill_disabled: "Skill 已停用",
      skill_missing_dependency: "缺本地依赖或配置",
      plugin_tool_disabled: "插件已停用",
      missing_tool_permission: "工具权限未批准",
      unique_capability_pending: "需要下载或开发新的 Skill/工具",
      cloud_capability_not_authorized: "云端品类未授权",
      high_risk_needs_human_approval: "高风险，需要人工确认",
      unsupported_capability_route: "当前没有可用路线",
      actor_context_missing: "缺少操作者上下文",
    };
    return item.blockedReasons.map((reason) => labels[reason] ?? reason).join("、");
  };
  const renderCategoryBatchControls = (
    sourceKind: "skill" | "tool",
    items: ToolSupplyControlItem[],
  ) => {
    const selectedItemIds = selectedItemIdsForCategory(sourceKind, selectedCategoryId);
    const dirty = hasCategorySelectionChanges(sourceKind, selectedCategoryId);
    return html`
      <div
        style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:12px;background:var(--bg-elevated,#fff);display:grid;gap:10px"
      >
        <div
          style="display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:10px;align-items:end"
        >
          <label style="display:grid;gap:5px;font-size:12px;color:var(--text-secondary,#666)">
            当前品类能力包
            <select
              style="border:1px solid var(--border-color,#d0d0d0);border-radius:6px;padding:8px;background:var(--bg-elevated,#fff);color:var(--text-primary,#111)"
              .value=${selectedCategoryId ?? ""}
              ?disabled=${saving || categories.length === 0}
              @change=${(event: Event) => {
                state.toolSupplySelectedCategoryId =
                  (event.currentTarget as HTMLSelectElement).value || null;
              }}
            >
              ${categories.map(
                (category) => html`
                  <option value=${category.id} ?selected=${category.id === selectedCategoryId}>
                    ${category.name}
                  </option>
                `,
              )}
            </select>
          </label>
          <div style="font-size:12px;color:var(--text-secondary,#666);text-align:right">
            ${selectedCategory
              ? `已选 ${selectedItemIds.size} / ${items.length}${dirty ? "，未保存" : ""}`
              : "请先创建或同步品类"}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button
            type="button"
            style=${buttonBase}
            ?disabled=${saving || !selectedCategoryId || items.length === 0}
            @click=${() =>
              updateSelectedItemIdsForCategory(
                sourceKind,
                selectedCategoryId,
                () => new Set(items.map((item) => item.id)),
              )}
          >
            全选当前列表
          </button>
          <button
            type="button"
            style=${buttonBase}
            ?disabled=${saving || !selectedCategoryId || selectedItemIds.size === 0}
            @click=${() =>
              updateSelectedItemIdsForCategory(sourceKind, selectedCategoryId, () => new Set())}
          >
            取消选择
          </button>
          <button
            type="button"
            style=${dirty ? primaryButton : buttonBase}
            ?disabled=${saving || !selectedCategory || !dirty}
            @click=${() =>
              selectedCategory
                ? void saveToolSupplyCategorySelection(state, {
                    categoryId: selectedCategory.id,
                    categoryTitle: selectedCategory.name,
                    sourceKind,
                    selectedItemIds: [...selectedItemIds],
                  })
                : undefined}
          >
            保存组合
          </button>
        </div>
      </div>
    `;
  };
  const renderItemCard = (item: ToolSupplyControlItem, sourceKind: "skill" | "tool") => {
    const bound = itemBindings(item);
    const selectedItemIds = selectedItemIdsForCategory(sourceKind, selectedCategoryId);
    const checked = selectedItemIds.has(item.id);
    return html`
      <div
        style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:12px;background:var(--bg-elevated,#fff);display:grid;gap:9px"
      >
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <div style="display:flex;gap:8px;align-items:flex-start">
            <input
              type="checkbox"
              .checked=${checked}
              ?disabled=${saving || !selectedCategoryId}
              aria-label=${`${selectedCategory?.name ?? "当前品类"}选择${item.label}`}
              @change=${(event: Event) => {
                const nextChecked = (event.target as HTMLInputElement).checked;
                updateSelectedItemIdsForCategory(sourceKind, selectedCategoryId, (current) => {
                  const next = new Set(current);
                  if (nextChecked) next.add(item.id);
                  else next.delete(item.id);
                  return next;
                });
              }}
            />
            <div>
              <div style="font-weight:750">${item.label}</div>
              <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
                ${item.kind === "skill"
                  ? "Skill"
                  : item.kind === "core_tool"
                    ? "OpenClaw 内置工具"
                    : "插件工具"}${item.source ? ` · ${item.source}` : ""}
              </div>
            </div>
          </div>
          <span
            style="font-size:12px;border:1px solid var(--border-color,#ddd);border-radius:999px;padding:4px 8px"
          >
            ${statusText(item.status)}
          </span>
        </div>
        ${item.description
          ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">
              ${item.description}
            </div>`
          : nothing}
        <div style="font-size:12px;color:var(--text-secondary,#666)">
          已用于：${bound.length
            ? bound
                .map((binding) => `${categoryName(binding.targetId)} · ${syncText(binding)}`)
                .join("、")
            : "未加入品类"}
        </div>
        ${item.blockedReasons.length
          ? html`<div style="font-size:12px;color:#b7791f">需要处理：${reasonText(item)}</div>`
          : nothing}
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${item.kind === "skill"
            ? html`
                <button
                  type="button"
                  style=${`${buttonBase};${disabledStyle}`}
                  ?disabled=${saving || !item.skillKey}
                  @click=${() =>
                    item.skillKey
                      ? void setToolSupplySkillEnabled(
                          state,
                          item.skillKey,
                          item.status === "disabled",
                        )
                      : undefined}
                >
                  ${item.status === "disabled" ? "启用" : "禁用"}
                </button>
              `
            : item.kind === "plugin_tool"
              ? html`
                  <button
                    type="button"
                    style=${`${buttonBase};${disabledStyle}`}
                    ?disabled=${saving || !item.pluginId}
                    @click=${() =>
                      item.pluginId
                        ? void setToolSupplyPluginEnabled(
                            state,
                            item.pluginId,
                            item.status === "disabled",
                          )
                        : undefined}
                  >
                    ${item.status === "disabled" ? "启用" : "禁用"}
                  </button>
                `
              : html`<span
                  style="font-size:12px;color:var(--text-secondary,#666);align-self:center"
                >
                  内置工具不可卸载
                </span>`}
        </div>
      </div>
    `;
  };
  const renderSkillPage = () => html`
    <section style="display:grid;gap:12px">
      <div
        style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"
      >
        <h3 style="margin:0;font-size:16px">Skill</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" style=${buttonBase} @click=${() => void loadSkills(state)}>
            刷新 Skill
          </button>
          <button type="button" style=${buttonBase} @click=${() => onNavigate("skillWorkshop")}>
            开发新 Skill
          </button>
        </div>
      </div>
      ${renderCategoryBatchControls("skill", model?.skills ?? [])}
      <div
        style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:12px;background:var(--bg-elevated,#fff);display:grid;gap:8px"
      >
        <div style="font-weight:700">下载 / 安装 Skill</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input
            style="min-width:220px;flex:1;border:1px solid var(--border-color,#d0d0d0);border-radius:6px;padding:8px"
            .value=${state.clawhubSearchQuery}
            placeholder="搜索 ClawHub Skill"
            @input=${(event: Event) => {
              state.clawhubSearchQuery = (event.target as HTMLInputElement).value;
              void searchClawHub(state, state.clawhubSearchQuery);
            }}
          />
        </div>
        ${state.clawhubSearchResults?.length
          ? html`<div style="display:grid;gap:6px">
              ${state.clawhubSearchResults.map(
                (result) => html`
                  <div
                    style="display:flex;justify-content:space-between;gap:8px;align-items:center"
                  >
                    <span>${result.displayName}</span>
                    <button
                      type="button"
                      style=${buttonBase}
                      ?disabled=${Boolean(state.clawhubInstallSlug)}
                      @click=${() => void installFromClawHub(state, result.slug)}
                    >
                      安装
                    </button>
                  </div>
                `,
              )}
            </div>`
          : nothing}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">
        ${(model?.skills ?? []).map((item) => renderItemCard(item, "skill"))}
      </div>
    </section>
  `;
  const renderToolPage = () => html`
    <section style="display:grid;gap:12px">
      <div
        style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"
      >
        <h3 style="margin:0;font-size:16px">工具</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button
            type="button"
            style=${buttonBase}
            @click=${() => {
              state.toolSupplyControl.message =
                "当前页面只管理已安装插件工具和内置工具权限；新增第三方插件工具需由系统开发者在本地完成安装或开发后，刷新这里检查能力包。";
            }}
          >
            安装插件工具
          </button>
          <button type="button" style=${buttonBase} @click=${() => onNavigate("skillWorkshop")}>
            开发工具 / Skill
          </button>
        </div>
      </div>
      ${renderCategoryBatchControls("tool", model?.localTools ?? [])}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">
        ${(model?.localTools ?? []).map((item) => renderItemCard(item, "tool"))}
      </div>
    </section>
  `;
  const renderCategoryPage = () => html`
    <section style="display:grid;gap:12px">
      <div
        style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"
      >
        <h3 style="margin:0;font-size:16px">品类能力</h3>
        <button
          type="button"
          style=${buttonBase}
          @click=${() => void syncToolSupplyCategories(state)}
        >
          同步云端品类
        </button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input
          style="min-width:220px;flex:1;border:1px solid var(--border-color,#d0d0d0);border-radius:6px;padding:8px"
          .value=${state.toolSupplyCategoryDraftName}
          placeholder="新建云端品类名称"
          @input=${(event: Event) =>
            (state.toolSupplyCategoryDraftName = (event.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          style=${primaryButton}
          ?disabled=${saving || !state.toolSupplyCategoryDraftName.trim()}
          @click=${() => {
            const name = state.toolSupplyCategoryDraftName.trim();
            if (!name) return;
            state.toolSupplyCategoryDraftName = "";
            void createToolSupplyCategory(state, name);
          }}
        >
          创建品类
        </button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px">
        ${packages.map(
          (pack: ToolSupplyCategoryCapabilityPackage) => html`
            <div
              style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:12px;background:var(--bg-elevated,#fff);display:grid;gap:8px"
            >
              <div style="display:flex;justify-content:space-between;gap:8px">
                <strong>${pack.category.name}</strong>
                <span style="font-size:12px">${statusText(pack.category.status)}</span>
              </div>
              <div style="font-size:12px;color:var(--text-secondary,#666)">
                岗位使用数：${pack.roleUsageCount}
              </div>
              <div style="font-size:12px">
                <strong>Skill：</strong>${pack.skills.length
                  ? pack.skills.map((item) => item.label).join("、")
                  : "未加入"}
              </div>
              <div style="font-size:12px">
                <strong>工具：</strong>${pack.tools.length
                  ? pack.tools.map((item) => item.label).join("、")
                  : "未加入"}
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button
                  type="button"
                  style=${buttonBase}
                  @click=${() => {
                    state.toolSupplySelectedCategoryId = pack.category.id;
                    setSubpage("skill");
                  }}
                >
                  编辑 Skill
                </button>
                <button
                  type="button"
                  style=${buttonBase}
                  @click=${() => {
                    state.toolSupplySelectedCategoryId = pack.category.id;
                    setSubpage("tool");
                  }}
                >
                  编辑工具
                </button>
              </div>
            </div>
          `,
        )}
      </div>
    </section>
  `;
  const todosByCategoryCapabilityReviewId = new Map<string, typeof systemDevelopmentTodos>();
  for (const todo of systemDevelopmentTodos) {
    if (!todo.categoryCapabilityReviewId) continue;
    const related = todosByCategoryCapabilityReviewId.get(todo.categoryCapabilityReviewId) ?? [];
    related.push(todo);
    todosByCategoryCapabilityReviewId.set(todo.categoryCapabilityReviewId, related);
  }
  const categoryTodoStatus = (todo: (typeof systemDevelopmentTodos)[number]) => {
    const categoryCapabilityReviewId = todo.categoryCapabilityReviewId;
    const related = categoryCapabilityReviewId
      ? (todosByCategoryCapabilityReviewId.get(categoryCapabilityReviewId) ?? [])
      : [];
    const total = related.length;
    const approved = related.filter((item) => item.reviewStatus === "已通过").length;
    return {
      categoryCapabilityReviewId,
      related,
      total,
      approved,
      ready: Boolean(categoryCapabilityReviewId && total > 0 && approved === total),
      isFirstForCategory: Boolean(related[0]?.id === todo.id),
    };
  };
  const renderSystemDevelopmentTodos = () =>
    systemDevelopmentTodos.length
      ? html`
          <section
            style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:12px;background:var(--bg-elevated,#fff);display:grid;gap:10px"
          >
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
              <div>
                <h3 style="margin:0;font-size:16px">品类能力制作待办</h3>
                <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:3px">
                  来自开发者中心的品类能力申请；这里负责具体 Tool、Skill、Provider/API
                  的开发、创建、安装和检查，审核中心只读取制作状态。
                </div>
              </div>
              <button type="button" style=${buttonBase} @click=${() => onNavigate("reviewCenter")}>
                回审核中心看品类状态
              </button>
            </div>
            <div
              style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px"
            >
              ${systemDevelopmentTodos.map((todo) => {
                const status = categoryTodoStatus(todo);
                const pendingCount = Math.max(0, status.total - status.approved);
                const development = todo.development;
                const canApproveReview = Boolean(
                  todo.linkedReviewId &&
                  todo.reviewStatus === "检查中" &&
                  todo.reviewFindings.length > 0 &&
                  !todo.reviewFindings.some((finding) => finding.severity === "blocking"),
                );
                return html`
                  <article
                    style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:10px;display:grid;gap:7px"
                  >
                    <div style="display:flex;justify-content:space-between;gap:8px">
                      <strong style="font-size:13px"
                        >${todo.assetType === "skill" ? "Skill" : "Tool/API"} ·
                        ${todo.assetId}</strong
                      >
                      <span
                        style="font-size:12px;color:${todo.reviewStatus === "已通过"
                          ? "#2f855a"
                          : "#b7791f"}"
                      >
                        ${todo.reviewStatus}
                      </span>
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary,#666)">
                      能力：${todo.declaredCapabilities.join("、") || "未声明"} ·
                      来源：${todo.source}
                    </div>
                    ${development
                      ? html`
                          <div style="font-size:12px;color:var(--text-secondary,#666)">
                            开发路线：${development.sourceRoute || "待判断"} ·
                            运行状态：${development.runtime.status}
                            ${development.runtime.matchingRefs.length
                              ? ` · 匹配：${development.runtime.matchingRefs.join("、")}`
                              : ""}
                          </div>
                          <div style="font-size:12px;color:var(--text-secondary,#666)">
                            开发状态：${development.userStatusLabel}。${development.runtime.summary}
                          </div>
                          ${development.sourceCandidates.length
                            ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">
                                候选来源：${development.sourceCandidates
                                  .slice(0, 2)
                                  .map(
                                    (candidate) => `${candidate.label}（${candidate.confidence}）`,
                                  )
                                  .join("；")}
                              </div>`
                            : nothing}
                        `
                      : nothing}
                    ${todo.sourceRolePackageId || todo.sourceRequestId || todo.targetCategoryName
                      ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">
                          来源岗位：${todo.sourceRolePackageId || "未关联"} ·
                          申请：${todo.sourceRequestId || "未关联"} ·
                          目标品类：${todo.targetCategoryName || todo.targetCategoryRef || "未关联"}
                        </div>`
                      : nothing}
                    ${status.total
                      ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">
                          品类能力包进度：${status.approved}/${status.total}
                        </div>`
                      : nothing}
                    ${todo.toolRequirements?.length ||
                    todo.skillRequirements?.length ||
                    todo.providerRequirements?.length
                      ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">
                          需求：Tool ${todo.toolRequirements?.join("、") || "无"} · Skill
                          ${todo.skillRequirements?.join("、") || "无"} · Provider/API
                          ${todo.providerRequirements?.join("、") || "无"}
                        </div>`
                      : nothing}
                    ${todo.humanConfirmationRules?.length
                      ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">
                          人工确认：${todo.humanConfirmationRules.join("；")}
                        </div>`
                      : nothing}
                    ${todo.riskBoundaries?.length
                      ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">
                          风险边界：${todo.riskBoundaries.join("；")}
                        </div>`
                      : nothing}
                    ${todo.acceptanceCriteria?.length
                      ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">
                          验收：${todo.acceptanceCriteria.join("；")}
                        </div>`
                      : nothing}
                    <div style="font-size:12px;color:var(--text-secondary,#666)">
                      下一步：${todo.nextAction.label}。${todo.nextAction.reason}
                    </div>
                    ${todo.reviewFindings.length
                      ? html`<div style="display:grid;gap:3px;font-size:12px">
                          ${todo.reviewFindings
                            .slice(0, 2)
                            .map(
                              (finding) => html`
                                <span
                                  style="color:${finding.severity === "blocking"
                                    ? "#c53030"
                                    : "#b7791f"}"
                                >
                                  ${finding.section} · ${finding.message}
                                </span>
                              `,
                            )}
                        </div>`
                      : nothing}
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      ${development?.nextActions.some((action) => action.kind === "plan_source")
                        ? html`
                            <button
                              type="button"
                              style=${buttonBase}
                              ?disabled=${saving}
                              @click=${() => void state.planToolSkillDevelopmentSource?.(todo)}
                            >
                              生成路线
                            </button>
                          `
                        : nothing}
                      ${development?.sourceCandidates
                        .filter((candidate) => candidate.id !== development.selectedSource)
                        .slice(0, 2)
                        .map(
                          (candidate) => html`
                            <button
                              type="button"
                              style=${buttonBase}
                              title=${candidate.reason}
                              ?disabled=${saving || todo.reviewStatus === "已通过"}
                              @click=${() =>
                                void state.selectToolSkillDevelopmentSource?.(todo, candidate.id)}
                            >
                              选 ${candidate.label}
                            </button>
                          `,
                        )}
                      ${development?.nextActions.some((action) =>
                        [
                          "install_or_enable",
                          "adapt_open_source",
                          "build_in_house",
                          "add_runtime",
                        ].includes(action.kind),
                      )
                        ? html`
                            <button
                              type="button"
                              style=${buttonBase}
                              title="确认已安装、改造或自研完成后，标记运行实现就绪。"
                              ?disabled=${saving || todo.reviewStatus === "已通过"}
                              @click=${() =>
                                void state.markToolSkillDevelopmentRuntimeReady?.(todo)}
                            >
                              运行就绪
                            </button>
                          `
                        : nothing}
                      <button
                        type="button"
                        style=${buttonBase}
                        ?disabled=${saving || todo.reviewStatus === "已通过"}
                        @click=${() =>
                          void (state.runToolSkillDevelopmentValidation
                            ? state.runToolSkillDevelopmentValidation(todo)
                            : state.runToolSkillReviewValidation?.(todo.id))}
                      >
                        检查
                      </button>
                      <button
                        type="button"
                        style=${primaryButton}
                        title=${todo.reviewStatus !== "检查中"
                          ? "请先点击检查，检查通过后才能人工通过。"
                          : !todo.linkedReviewId
                            ? "还没有关联最终审核单，请先执行检查。"
                            : ""}
                        ?disabled=${saving || !canApproveReview}
                        @click=${() => void state.approveToolSkillReview?.(todo.linkedReviewId!)}
                      >
                        通过审核
                      </button>
                      ${status.categoryCapabilityReviewId && status.isFirstForCategory
                        ? html`
                            <button
                              type="button"
                              style=${status.ready ? primaryButton : buttonBase}
                              title=${status.ready
                                ? "把已完成的 Tool / Skill / Provider 制作结果激活成正式品类能力包。"
                                : `该品类能力包还有 ${pendingCount} 项待办未通过。`}
                              ?disabled=${saving || !status.ready}
                              @click=${async () => {
                                await state.activateToolSupplyCategoryCapabilityPackage?.(
                                  status.categoryCapabilityReviewId!,
                                );
                                state.setTab?.("aics");
                              }}
                            >
                              激活并回岗位开发
                            </button>
                          `
                        : nothing}
                    </div>
                  </article>
                `;
              })}
            </div>
          </section>
        `
      : nothing;
  return html`
    <div style="display:grid;gap:14px">
      <header
        style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"
      >
        <div>
          <h2 style="margin:0;font-size:22px">工具与 Skill</h2>
        </div>
        <button
          type="button"
          style=${buttonBase}
          @click=${() => void state.refreshToolSupplyControlReadModel()}
        >
          ${loading ? "读取中" : "刷新"}
        </button>
      </header>
      ${message
        ? html`<div
            style="border:1px solid #9ae6b4;background:#f0fff4;color:#276749;border-radius:6px;padding:8px;font-size:12px"
          >
            ${message}
          </div>`
        : nothing}
      ${error
        ? html`<div
            style="border:1px solid #feb2b2;background:#fff5f5;color:#c53030;border-radius:6px;padding:8px;font-size:12px"
          >
            ${error}
          </div>`
        : nothing}
      ${renderSystemDevelopmentTodos()}
      <nav style="display:flex;gap:8px;flex-wrap:wrap">
        ${(["skill", "tool", "category"] as const).map((id) => {
          const label = id === "skill" ? "Skill" : id === "tool" ? "工具" : "品类能力";
          return html`<button
            type="button"
            style=${subpage === id ? primaryButton : buttonBase}
            @click=${() => setSubpage(id)}
          >
            ${label}
          </button>`;
        })}
      </nav>
      ${subpage === "skill"
        ? renderSkillPage()
        : subpage === "tool"
          ? renderToolPage()
          : renderCategoryPage()}
    </div>
  `;
}

const CONFIG_SETTINGS_TABS = [
  "config",
  "channels",
  "automation",
  "mcp",
  "infrastructure",
  "aiAgents",
] as const satisfies readonly Tab[];

function isConfigSettingsTab(tab: Tab): boolean {
  return (CONFIG_SETTINGS_TABS as readonly Tab[]).includes(tab);
}

const SETTINGS_WORKSPACE_WRAPPED_TABS = [
  ...CONFIG_SETTINGS_TABS,
  "debug",
  "logs",
] as const satisfies readonly Tab[];
const CHAT_WORKSPACE_FILE_RAIL_ENABLED = false;

function shouldRenderStandaloneSettingsSectionNav(tab: Tab): boolean {
  return (
    isSettingsTab(tab) &&
    !isPrimaryNavTab(tab) &&
    !(SETTINGS_WORKSPACE_WRAPPED_TABS as readonly Tab[]).includes(tab)
  );
}

function renderStandaloneSettingsSectionNav(state: AppViewState) {
  if (!shouldRenderStandaloneSettingsSectionNav(state.tab)) {
    return nothing;
  }
  return html`
    <div class="settings-workspace settings-workspace--nav-only">
      ${renderSettingsSectionNav(state)}
    </div>
  `;
}

function isSidebarSessionBusy(state: AppViewState) {
  return (
    state.chatLoading ||
    state.chatSending ||
    Boolean(state.chatRunId) ||
    state.chatStream !== null ||
    state.chatQueue.length > 0
  );
}

function resolveSidebarDefaultAgentId(state: AppViewState): string {
  const snapshot = state.hello?.snapshot as
    | { sessionDefaults?: { defaultAgentId?: string } }
    | undefined;
  return normalizeAgentId(
    state.agentsList?.defaultId ?? snapshot?.sessionDefaults?.defaultAgentId ?? "main",
  );
}

function resolveSidebarSelectedAgentId(state: AppViewState): string {
  const parsed = parseAgentSessionKey(state.sessionKey);
  if (parsed) {
    return normalizeAgentId(parsed.agentId);
  }
  const sessionKey = normalizeOptionalString(state.sessionKey)?.toLowerCase();
  const fallbackAgentId =
    sessionKey === "global" || sessionKey === "unknown"
      ? (state.assistantAgentId ?? resolveSidebarDefaultAgentId(state))
      : resolveSidebarDefaultAgentId(state);
  return normalizeAgentId(fallbackAgentId);
}

function isSidebarSessionForSelectedAgent(
  state: AppViewState,
  row: GatewaySessionRow,
  selectedAgentId: string,
): boolean {
  return isSessionKeyTiedToAgent(row.key, selectedAgentId, resolveSidebarDefaultAgentId(state));
}

function isSidebarMainSessionKey(state: AppViewState, key: string): boolean {
  const configuredMainKey = resolveUiConfiguredMainKey(state);
  if (key.trim().toLowerCase() === configuredMainKey) {
    return true;
  }
  const parsed = parseAgentSessionKey(key);
  if (parsed) {
    return (
      normalizeAgentId(parsed.agentId) === resolveSidebarDefaultAgentId(state) &&
      parsed.rest === configuredMainKey
    );
  }
  return areUiSessionKeysEquivalent(
    key,
    buildAgentMainSessionKey({
      agentId: resolveSidebarDefaultAgentId(state),
      mainKey: configuredMainKey,
    }),
  );
}

function isSidebarProtectedRecentSession(state: AppViewState, key: string): boolean {
  return areUiSessionKeysEquivalent(key, state.sessionKey) || isSidebarMainSessionKey(state, key);
}

function isSidebarRecentSessionHidden(state: AppViewState, key: string): boolean {
  return (state.settings.hiddenRecentSessionKeys ?? []).some(
    (hiddenKey) => hiddenKey === key || areUiSessionKeysEquivalent(hiddenKey, key),
  );
}

function hideSidebarRecentSession(state: AppViewState, key: string, label: string): boolean {
  const confirmed = window.confirm(
    `从最近会话隐藏「${label}」？\n\n这是当前或主会话，OpenClaw 会保留对话记录，只从侧边栏最近会话列表移除。`,
  );
  if (!confirmed) {
    return false;
  }
  const hidden = state.settings.hiddenRecentSessionKeys ?? [];
  const nextHidden = [
    key,
    ...hidden.filter((hiddenKey) => !areUiSessionKeysEquivalent(hiddenKey, key)),
  ].slice(0, 50);
  state.applySettings({
    ...state.settings,
    hiddenRecentSessionKeys: nextHidden,
  });
  return true;
}

function resolveSidebarRecentSessions(state: AppViewState): GatewaySessionRow[] {
  const selectedAgentId = resolveSidebarSelectedAgentId(state);
  const shouldFilterByAgent =
    normalizeOptionalString(state.sessionKey)?.toLowerCase() !== "unknown";
  return (state.sessionsResult?.sessions ?? [])
    .filter(
      (row) =>
        !row.archived &&
        row.kind !== "global" &&
        row.kind !== "unknown" &&
        row.kind !== "cron" &&
        !isCronSessionKey(row.key) &&
        !isSubagentSessionKey(row.key) &&
        !row.spawnedBy &&
        !isSidebarRecentSessionHidden(state, row.key) &&
        (!shouldFilterByAgent || isSidebarSessionForSelectedAgent(state, row, selectedAgentId)),
    )
    .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 5);
}

function renderSidebarSessions(state: AppViewState) {
  const collapsed = state.settings.navCollapsed;
  const busy = isSidebarSessionBusy(state);
  const recent = collapsed ? [] : resolveSidebarRecentSessions(state);
  const newSessionDisabled = !state.connected || state.sessionsLoading || busy || !state.client;
  const newSessionTitle = !state.connected
    ? "Connect to create a new session"
    : busy
      ? "Finish the active run before creating a new session"
      : "New session";

  return html`
    <section class="sidebar-sessions ${collapsed ? "sidebar-sessions--collapsed" : ""}">
      <button
        type="button"
        class="sidebar-new-session"
        title=${newSessionTitle}
        aria-label=${t("chat.runControls.newSession")}
        ?disabled=${newSessionDisabled}
        @click=${async () => {
          if (newSessionDisabled) {
            return;
          }
          if (await createChatSession(state)) {
            state.setTab("chat" as import("./navigation.ts").Tab);
          }
        }}
      >
        <span class="sidebar-new-session__icon" aria-hidden="true">${icons.plus}</span>
        ${collapsed
          ? nothing
          : html`<span class="sidebar-new-session__label"
              >${t("chat.runControls.newSession")}</span
            >`}
      </button>
      <div class="sidebar-session-select ${collapsed ? "sidebar-session-select--collapsed" : ""}">
        ${renderChatSessionSelect(state, switchChatSession, {
          compact: collapsed,
          sessionSwitcherOnly: true,
          surface: "sidebar",
        })}
      </div>
      ${collapsed || recent.length === 0
        ? nothing
        : html`
            <div
              class="sidebar-recent-sessions ${state.settings.recentSessionsCollapsed
                ? "sidebar-recent-sessions--collapsed"
                : ""}"
              aria-label=${t("overview.cards.recentSessions")}
            >
              <button
                class="sidebar-recent-sessions__label"
                type="button"
                aria-expanded=${String(!state.settings.recentSessionsCollapsed)}
                @click=${() => {
                  state.applySettings({
                    ...state.settings,
                    recentSessionsCollapsed: !state.settings.recentSessionsCollapsed,
                  });
                }}
              >
                <span class="sidebar-recent-sessions__label-text"
                  >${t("usage.sessions.recentShort")}</span
                >
                <span class="sidebar-recent-sessions__chevron"> ${icons.chevronDown} </span>
              </button>
              <div class="sidebar-recent-sessions__list">
                ${recent.map((row) => renderSidebarRecentSession(state, row))}
              </div>
            </div>
          `}
    </section>
  `;
}

function renderSidebarRecentSession(state: AppViewState, row: GatewaySessionRow) {
  const active = row.key === state.sessionKey;
  const label = resolveSessionDisplayName(row.key, row);
  const meta = row.updatedAt ? formatRelativeTimestamp(row.updatedAt) : "n/a";
  const href = `${pathForTab("chat", state.basePath)}?session=${encodeURIComponent(row.key)}`;
  const protectedRecentSession = isSidebarProtectedRecentSession(state, row.key);
  return html`
    <div
      class="sidebar-recent-session ${active ? "sidebar-recent-session--active" : ""}"
      data-session-key=${row.key}
      title=${`${label} · ${meta}`}
      @click=${(event: MouseEvent) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("a,button")) {
          return;
        }
        if (row.key !== state.sessionKey) {
          switchChatSession(state, row.key);
        }
        state.setTab("chat" as import("./navigation.ts").Tab);
      }}
    >
      <a
        href=${href}
        class="sidebar-recent-session__link"
        @click=${(event: MouseEvent) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          if (row.key !== state.sessionKey) {
            switchChatSession(state, row.key);
          }
          state.setTab("chat" as import("./navigation.ts").Tab);
        }}
      >
        <span class="sidebar-recent-session__dot" aria-hidden="true"></span>
        <span class="sidebar-recent-session__body">
          <span class="sidebar-recent-session__name">${label}</span>
          <span class="sidebar-recent-session__meta">${meta}</span>
        </span>
      </a>
      ${row.hasActiveRun
        ? html`<span
            class="sidebar-recent-session__live"
            aria-label=${t("sessions.sessionDetails.activeRun")}
          ></span>`
        : nothing}
      <button
        class="sidebar-recent-session__delete"
        type="button"
        title=${protectedRecentSession ? "从最近会话隐藏" : "删除对话记录"}
        aria-label=${protectedRecentSession ? `从最近会话隐藏：${label}` : `删除对话记录：${label}`}
        ?disabled=${state.sessionsLoading}
        @click=${async (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          if (protectedRecentSession) {
            hideSidebarRecentSession(state, row.key, label);
            return;
          }
          const deleted = await deleteSessionsAndRefresh(state, [row.key]);
          if (deleted.includes(row.key) && row.key === state.sessionKey) {
            const nextSessionKey =
              state.sessionsResult?.sessions.find((session) => !deleted.includes(session.key))
                ?.key ?? null;
            if (nextSessionKey) {
              switchChatSession(state, nextSessionKey);
              state.setTab("chat" as import("./navigation.ts").Tab);
            } else {
              await createChatSession(state);
            }
          }
        }}
      >
        ${icons.trash}
      </button>
    </div>
  `;
}

// Lazy-loaded view modules are deferred so the initial bundle stays small.
// The shared loader renders visible fallback states instead of leaving a tab blank.
const lazyAgents = createLazyView(() => import("./views/agents.ts"), notifyLazyViewChanged);
const lazyActivity = createLazyView(() => import("./views/activity.ts"), notifyLazyViewChanged);
const lazyChannels = createLazyView(() => import("./views/channels.ts"), notifyLazyViewChanged);
const lazyCron = createLazyView(() => import("./views/cron.ts"), notifyLazyViewChanged);
const lazyDebug = createLazyView(() => import("./views/debug.ts"), notifyLazyViewChanged);
const lazyInstances = createLazyView(() => import("./views/instances.ts"), notifyLazyViewChanged);
const lazyLogs = createLazyView(() => import("./views/logs.ts"), notifyLazyViewChanged);
const lazyNodes = createLazyView(() => import("./views/nodes.ts"), notifyLazyViewChanged);
const lazySessions = createLazyView(() => import("./views/sessions.ts"), notifyLazyViewChanged);

type ChatWorkspaceFilesState = {
  activeName: string | null;
  agentId: string;
  error: string | null;
  list: AgentsFilesListResult | null;
  loading: boolean;
  requestId: number;
};

const chatWorkspaceFilesStates = new WeakMap<AppViewState, ChatWorkspaceFilesState>();
const chatWorkspaceFileOpenRequests = new WeakMap<
  AppViewState,
  { agentId: string; id: number; name: string; sessionKey: string }
>();

function getChatWorkspaceFilesState(state: AppViewState, agentId: string): ChatWorkspaceFilesState {
  const current = chatWorkspaceFilesStates.get(state);
  if (current?.agentId === agentId) {
    return current;
  }
  const next = {
    activeName: null,
    agentId,
    error: null,
    list: null,
    loading: false,
    requestId: 0,
  };
  chatWorkspaceFilesStates.set(state, next);
  return next;
}

export function formatDreamNextCycle(nextRunAtMs: number | undefined): string | null {
  return (
    formatTimeMs(
      nextRunAtMs,
      {
        hour: "numeric",
        minute: "2-digit",
      },
      "",
    ) || null
  );
}

const UPDATE_BANNER_DISMISS_KEY = "openclaw:control-ui:update-banner-dismissed:v1";
const CRON_THINKING_SUGGESTIONS = ["off", "minimal", "low", "medium", "high"];
const CRON_TIMEZONE_SUGGESTIONS = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeSuggestionValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

type DismissedUpdateBanner = {
  latestVersion: string;
  channel: string | null;
  dismissedAtMs: number;
};

function loadDismissedUpdateBanner(): DismissedUpdateBanner | null {
  try {
    const raw = getSafeLocalStorage()?.getItem(UPDATE_BANNER_DISMISS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DismissedUpdateBanner>;
    if (!parsed || typeof parsed.latestVersion !== "string") {
      return null;
    }
    return {
      latestVersion: parsed.latestVersion,
      channel: typeof parsed.channel === "string" ? parsed.channel : null,
      dismissedAtMs: typeof parsed.dismissedAtMs === "number" ? parsed.dismissedAtMs : Date.now(),
    };
  } catch {
    return null;
  }
}

function isUpdateBannerDismissed(updateAvailable: unknown): boolean {
  const dismissed = loadDismissedUpdateBanner();
  if (!dismissed) {
    return false;
  }
  const info = updateAvailable as { latestVersion?: unknown; channel?: unknown };
  const latestVersion = info && typeof info.latestVersion === "string" ? info.latestVersion : null;
  const channel = info && typeof info.channel === "string" ? info.channel : null;
  return Boolean(
    latestVersion && dismissed.latestVersion === latestVersion && dismissed.channel === channel,
  );
}

function dismissUpdateBanner(updateAvailable: unknown) {
  const info = updateAvailable as { latestVersion?: unknown; channel?: unknown };
  const latestVersion = info && typeof info.latestVersion === "string" ? info.latestVersion : null;
  if (!latestVersion) {
    return;
  }
  const channel = info && typeof info.channel === "string" ? info.channel : null;
  const payload: DismissedUpdateBanner = {
    latestVersion,
    channel,
    dismissedAtMs: Date.now(),
  };
  try {
    getSafeLocalStorage()?.setItem(UPDATE_BANNER_DISMISS_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

const COMMUNICATION_SECTION_KEYS = [
  "messages",
  "broadcast",
  "__notifications__",
  "talk",
  "audio",
  "channels",
] as const;
const APPEARANCE_SECTION_KEYS = ["__appearance__", "ui", "wizard"] as const;
const AUTOMATION_SECTION_KEYS = [
  "commands",
  "hooks",
  "bindings",
  "cron",
  "approvals",
  "plugins",
] as const;
const INFRASTRUCTURE_SECTION_KEYS = [
  "gateway",
  "web",
  "browser",
  "nodeHost",
  "canvasHost",
  "discovery",
  "media",
  "acp",
  "mcp",
] as const;
const AI_AGENTS_SECTION_KEYS = [
  "agents",
  "models",
  "skills",
  "tools",
  "memory",
  "session",
] as const;
type ConfigSectionSelection = {
  activeSection: string | null;
  activeSubsection: string | null;
};

type ConfigTabOverrides = Pick<
  ConfigProps,
  | "formMode"
  | "searchQuery"
  | "activeSection"
  | "activeSubsection"
  | "onFormModeChange"
  | "onSearchChange"
  | "onSectionChange"
  | "onSubsectionChange"
> &
  Partial<
    Pick<
      ConfigProps,
      | "showModeToggle"
      | "navRootLabel"
      | "showRootTab"
      | "includeSections"
      | "excludeSections"
      | "includeVirtualSections"
      | "settingsLayout"
      | "onBackToQuick"
      | "webPush"
      | "onWebPushSubscribe"
      | "onWebPushUnsubscribe"
      | "onWebPushTest"
    >
  >;

const SCOPED_CONFIG_SECTION_KEYS = new Set<string>([
  ...COMMUNICATION_SECTION_KEYS,
  ...APPEARANCE_SECTION_KEYS,
  ...AUTOMATION_SECTION_KEYS,
  ...INFRASTRUCTURE_SECTION_KEYS,
  ...AI_AGENTS_SECTION_KEYS,
]);

function normalizeMainConfigSelection(
  activeSection: string | null,
  activeSubsection: string | null,
): ConfigSectionSelection {
  if (activeSection && SCOPED_CONFIG_SECTION_KEYS.has(activeSection)) {
    return { activeSection: null, activeSubsection: null };
  }
  return { activeSection, activeSubsection };
}

function normalizeScopedConfigSelection(
  activeSection: string | null,
  activeSubsection: string | null,
  includedSections: readonly string[],
): ConfigSectionSelection {
  if (activeSection && !includedSections.includes(activeSection)) {
    return { activeSection: null, activeSubsection: null };
  }
  return { activeSection, activeSubsection };
}

function countScopedTopLevelSchemaProperties(
  schema: unknown,
  includeSections?: readonly string[],
  excludeSections?: readonly string[],
): number {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return 0;
  }
  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return 0;
  }
  const include = includeSections?.length ? new Set(includeSections) : null;
  const exclude = excludeSections?.length ? new Set(excludeSections) : null;
  return Object.keys(properties).filter((key) => {
    if (include && !include.has(key)) {
      return false;
    }
    if (exclude?.has(key)) {
      return false;
    }
    return true;
  }).length;
}

function renderMeasured<T>(
  state: AppViewState,
  surface: string,
  payload: Record<string, unknown>,
  render: () => T,
): T {
  const startedAtMs = controlUiNowMs();
  const result = render();
  recordControlUiRenderTiming(state, surface, {
    ...payload,
    durationMs: roundedControlUiDurationMs(controlUiNowMs() - startedAtMs),
  });
  return result;
}

function renderGuardedChatControls(state: AppViewState) {
  return guard(
    [
      state.sessionKey,
      state.connected,
      state.client,
      state.onboarding,
      state.chatManualRefreshInFlight,
      state.chatLoading,
      state.chatSending,
      state.chatStream,
      state.chatRunId,
      state.chatMobileControlsOpen,
      state.sessionsHideCron ?? true,
      state.sessionsResult,
      state.sessionsShowArchived,
      state.agentsList,
      state.chatModelOverrides,
      state.chatModelSwitchPromises,
      state.chatModelsLoading,
      state.chatModelCatalog,
      state.settings.chatShowThinking,
      state.settings.chatShowToolCalls,
      state.settings.chatAutoScroll,
      state.chatSessionPickerOpen,
      state.chatSessionPickerSurface,
      state.chatSessionPickerQuery,
      state.chatSessionPickerAppliedQuery,
      state.chatSessionPickerLoading,
      state.chatSessionPickerError,
      state.chatSessionPickerResult,
      state.sessionSwitchNotice?.id ?? null,
      state.sessionSwitchNotice?.text ?? null,
      state.sessionSwitchFlashKey,
      i18n.getLocale(),
    ],
    () => renderChatControls(state),
  );
}

function resolveAssistantAvatarUrl(state: AppViewState): string | undefined {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) {
    return undefined;
  }
  if (isRenderableControlUiAvatarUrl(candidate)) {
    return candidate;
  }
  return undefined;
}

function resolveAssistantAvatarOverride(config: unknown): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }
  const ui = (config as { ui?: unknown }).ui;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) {
    return null;
  }
  const assistant = (ui as { assistant?: unknown }).assistant;
  if (!assistant || typeof assistant !== "object" || Array.isArray(assistant)) {
    return null;
  }
  return normalizeOptionalString((assistant as { avatar?: unknown }).avatar) ?? null;
}

function buildAssistantAvatarRoute(basePathValue: string | null | undefined, agentId: string) {
  const basePath = normalizeBasePath(basePathValue ?? "");
  const encoded = encodeURIComponent(agentId);
  return basePath ? `${basePath}/avatar/${encoded}` : `/avatar/${encoded}`;
}

// ── Quick Settings data extraction helpers ──

const KNOWN_CHANNEL_IDS = [
  { id: "telegram", label: "Telegram" },
  { id: "discord", label: "Discord" },
  { id: "slack", label: "Slack" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "signal", label: "Signal" },
  { id: "imessage", label: "iMessage" },
] as const;

function formatQuickSettingsLabel(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) {
    return "Unknown";
  }
  return trimmed
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractQuickSettingsChannels(state: AppViewState): QuickSettingsChannel[] {
  const config = state.configForm ?? state.configSnapshot?.config;
  if (!config || typeof config !== "object") {
    return [];
  }
  const channelsConfig =
    "channels" in config && config.channels && typeof config.channels === "object"
      ? (config.channels as Record<string, unknown>)
      : {};
  const configuredIds = Object.keys(channelsConfig).filter((id) => id.trim().length > 0);
  const channelIds =
    configuredIds.length > 0
      ? configuredIds.toSorted((a, b) => a.localeCompare(b))
      : KNOWN_CHANNEL_IDS.map(({ id }) => id);
  const knownLabels = new Map<string, string>(
    KNOWN_CHANNEL_IDS.map(({ id, label }) => [id, label]),
  );
  const channels: QuickSettingsChannel[] = [];
  for (const id of channelIds) {
    const channelConfig = channelsConfig[id];
    const hasConfig =
      channelConfig != null &&
      typeof channelConfig === "object" &&
      Object.keys(channelConfig).length > 0;
    channels.push({
      id,
      label: knownLabels.get(id) ?? formatQuickSettingsLabel(id),
      connected: hasConfig,
      detail: hasConfig ? "Configured" : undefined,
    });
  }
  return channels;
}

function extractMcpServerCount(state: AppViewState): number {
  const config = state.configForm ?? state.configSnapshot?.config;
  if (!config || typeof config !== "object") {
    return 0;
  }
  const mcp = config.mcp;
  if (!mcp || typeof mcp !== "object") {
    return 0;
  }
  const servers =
    "servers" in mcp && mcp.servers && typeof mcp.servers === "object"
      ? (mcp.servers as Record<string, unknown>)
      : {};
  return Object.keys(servers).length;
}

export function extractQuickSettingsSecurity(state: AppViewState): {
  gatewayAuth: string;
  execPolicy: string;
  deviceAuth: boolean;
  browserEnabled: boolean;
  toolProfile: string;
} {
  const config = state.configForm ?? state.configSnapshot?.config;
  if (!config || typeof config !== "object") {
    return {
      gatewayAuth: "unknown",
      execPolicy: "unknown",
      deviceAuth: false,
      browserEnabled: true,
      toolProfile: "full",
    };
  }
  const cfg = config;
  const gateway =
    "gateway" in cfg && cfg.gateway && typeof cfg.gateway === "object"
      ? (cfg.gateway as Record<string, unknown>)
      : null;
  const auth =
    gateway && "auth" in gateway && gateway.auth && typeof gateway.auth === "object"
      ? (gateway.auth as Record<string, unknown>)
      : null;
  let gatewayAuth = "unknown";
  if (auth) {
    const mode = typeof auth.mode === "string" ? auth.mode.trim() : "";
    if (mode) {
      gatewayAuth = mode;
    } else if (auth.password) {
      gatewayAuth = "password";
    } else if (auth.token) {
      gatewayAuth = "token";
    } else if (auth.trustedProxy) {
      gatewayAuth = "trusted-proxy";
    } else {
      gatewayAuth = "none";
    }
  }
  let execPolicy = "allowlist";
  let toolProfile = "full";
  const tools = cfg.tools;
  if (tools && typeof tools === "object") {
    const profile = (tools as Record<string, unknown>).profile;
    if (typeof profile === "string") {
      const trimmedProfile = profile.trim();
      if (trimmedProfile) {
        toolProfile = trimmedProfile;
      }
    }
    const exec = (tools as Record<string, unknown>).exec;
    if (exec && typeof exec === "object") {
      const security = (exec as Record<string, unknown>).security;
      if (typeof security === "string") {
        const trimmedSecurity = security.trim();
        if (trimmedSecurity) {
          execPolicy = trimmedSecurity;
        }
      }
    }
  }
  let browserEnabled = true;
  const browser =
    "browser" in cfg && cfg.browser && typeof cfg.browser === "object"
      ? (cfg.browser as Record<string, unknown>)
      : null;
  if (browser && typeof browser.enabled === "boolean") {
    browserEnabled = browser.enabled;
  }
  let deviceAuth = true;
  if (gateway) {
    const controlUi =
      "controlUi" in gateway && gateway.controlUi && typeof gateway.controlUi === "object"
        ? (gateway.controlUi as Record<string, unknown>)
        : null;
    if (controlUi?.dangerouslyDisableDeviceAuth === true) {
      deviceAuth = false;
    }
  }
  return { gatewayAuth, execPolicy, deviceAuth, browserEnabled, toolProfile };
}

function resolveQuickSettingsSessionRow(state: AppViewState) {
  return state.sessionsResult?.sessions?.find((row) => row.key === state.sessionKey);
}

function renderCronQuickCreateForTab(
  state: AppViewState,
  requestHostUpdate: (() => void) | undefined,
) {
  return renderCronQuickCreate({
    open: state.cronQuickCreateOpen,
    step: state.cronQuickCreateStep,
    draft: state.cronQuickCreateDraft ?? createDefaultDraft(),
    onDraftChange: (patch) => {
      state.cronQuickCreateDraft = {
        ...(state.cronQuickCreateDraft ?? createDefaultDraft()),
        ...patch,
      };
      requestHostUpdate?.();
    },
    onStepChange: (step) => {
      state.cronQuickCreateStep = step;
      requestHostUpdate?.();
    },
    onCreate: () => {
      const draft = state.cronQuickCreateDraft ?? createDefaultDraft();
      const formPatch = draftToCronFormPatch(draft);
      state.cronEditingJobId = null;
      state.cronForm = { ...DEFAULT_CRON_FORM, ...formPatch } as typeof state.cronForm;
      requestHostUpdate?.();
      void (async () => {
        const saved = await addCronJob(state);
        if (!saved) {
          requestHostUpdate?.();
          return;
        }
        state.cronQuickCreateOpen = false;
        state.cronQuickCreateStep = "what";
        state.cronQuickCreateDraft = null;
        requestHostUpdate?.();
      })();
    },
    onAdvancedCreate: () => {
      const draft = state.cronQuickCreateDraft ?? createDefaultDraft();
      const formPatch = draftToCronFormPatch(draft);
      state.cronEditingJobId = null;
      state.cronForm = normalizeCronFormState({
        ...DEFAULT_CRON_FORM,
        ...formPatch,
      } as typeof state.cronForm);
      state.cronFieldErrors = validateCronForm(state.cronForm);
      state.cronQuickCreateOpen = false;
      state.cronQuickCreateStep = "what";
      state.cronQuickCreateDraft = null;
      state.cronFormCollapsed = false;
      requestHostUpdate?.();
    },
    onCancel: () => {
      state.cronQuickCreateOpen = false;
      state.cronQuickCreateStep = "what";
      state.cronQuickCreateDraft = null;
      requestHostUpdate?.();
    },
  });
}

function buildWorkspaceFileSidebarContent(name: string, content: string): string {
  if (/\.(?:md|markdown|mdx)$/i.test(name)) {
    return content;
  }
  const language = name.match(/\.([a-z0-9_-]+)$/i)?.[1]?.toLowerCase() ?? "";
  return `# ${name}\n\n\`\`\`${language}\n${content}\n\`\`\``;
}

export function renderApp(state: AppViewState) {
  const updatableState = state as AppViewState & { requestUpdate?: () => void };
  const requestHostUpdate =
    typeof updatableState.requestUpdate === "function"
      ? () => updatableState.requestUpdate?.()
      : undefined;
  pendingUpdate = requestHostUpdate;

  // Gate: require successful gateway connection before showing the dashboard.
  // The gateway URL confirmation overlay is always rendered so URL-param flows still work.
  if (!state.connected) {
    return html` ${renderLoginGate(state)} ${renderGatewayUrlConfirmation(state)} `;
  }

  const presenceCount = state.presenceEntries.length;
  const sessionsCount = state.sessionsResult?.count ?? null;
  const cronNext = state.cronStatus?.nextWakeAtMs ?? null;
  const chatDisabledReason = state.connected ? null : t("chat.disconnected");
  const isChat = state.tab === "chat";
  const headerError = !isChat && state.lastError !== state.chatError ? state.lastError : null;
  const chatViewError = state.lastError;
  const chatHeaderHidden = isChat && (state.onboarding || state.chatHeaderControlsHidden);
  const navDrawerOpen = state.navDrawerOpen && !state.onboarding;
  const navCollapsed = state.settings.navCollapsed && !navDrawerOpen;
  const dashboardHeaderContext = resolveDashboardHeaderContext(state);
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const showToolCalls = state.onboarding ? true : state.settings.chatShowToolCalls;
  const navigateProductTab = (tab: Tab) => {
    state.setTab(tab);
  };
  const localAssistantAvatarOverride =
    normalizeOptionalString(loadLocalAssistantIdentity().avatar) ?? null;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAssistantAvatarStatus = localAssistantAvatarOverride
    ? "data"
    : (state.chatAvatarStatus ?? state.assistantAvatarStatus ?? null);
  const chatAssistantAvatarReason = localAssistantAvatarOverride
    ? null
    : (state.chatAvatarReason ?? state.assistantAvatarReason ?? null);
  const chatAssistantAvatarMissing =
    chatAssistantAvatarStatus === "none" && chatAssistantAvatarReason === "missing";
  const effectiveAssistantAvatar =
    localAssistantAvatarOverride ?? (chatAssistantAvatarMissing ? null : state.assistantAvatar);
  const chatAvatarUrl =
    localAssistantAvatarOverride ??
    state.chatAvatarUrl ??
    (chatAssistantAvatarMissing ? null : (assistantAvatarUrl ?? null));
  const configAssistantAvatarStatus = localAssistantAvatarOverride
    ? "data"
    : (state.assistantAvatarStatus ?? state.chatAvatarStatus ?? null);
  const configAssistantAvatarReason = localAssistantAvatarOverride
    ? null
    : (state.assistantAvatarReason ?? state.chatAvatarReason ?? null);
  const configAssistantAvatarSource =
    localAssistantAvatarOverride ?? state.assistantAvatarSource ?? state.chatAvatarSource ?? null;
  const configAssistantAvatarMissing =
    configAssistantAvatarStatus === "none" && configAssistantAvatarReason === "missing";
  const configAssistantAvatar =
    localAssistantAvatarOverride ??
    (configAssistantAvatarMissing || configAssistantAvatarStatus === "local"
      ? null
      : state.assistantAvatar);
  const configAssistantAvatarUrl =
    localAssistantAvatarOverride ??
    (configAssistantAvatarStatus === "local" && state.assistantAgentId
      ? buildAssistantAvatarRoute(state.basePath, state.assistantAgentId)
      : (state.chatAvatarUrl ??
        (configAssistantAvatarMissing ? null : (assistantAvatarUrl ?? null))));
  const cancelDreamingRestart = () => {
    if (state.dreamingRestartConfirmLoading) {
      return;
    }
    state.dreamingRestartConfirmOpen = false;
    state.dreamingPendingEnabled = null;
    state.dreamingStatusError = null;
  };
  const confirmDreamingRestart = () => {
    const enabled = state.dreamingPendingEnabled;
    if (enabled == null || state.dreamingRestartConfirmLoading) {
      return;
    }
    void (async () => {
      state.dreamingRestartConfirmLoading = true;
      state.dreamingStatusError = null;
      try {
        const updated = await updateDreamingEnabled(state, enabled);
        if (!updated) {
          if (!state.dreamingStatusError) {
            state.dreamingStatusError = t("dreaming.restartConfirmation.failed");
          }
          return;
        }
        await loadConfig(state);
        await loadDreamingStatus(state);
        state.dreamingRestartConfirmOpen = false;
        state.dreamingPendingEnabled = null;
      } finally {
        state.dreamingRestartConfirmLoading = false;
      }
    })();
  };
  const basePath = normalizeBasePath(state.basePath ?? "");
  const resolveSelectedAgentId = () =>
    state.agentsSelectedId ??
    state.agentsList?.defaultId ??
    state.agentsList?.agents?.[0]?.id ??
    null;
  const resolvedAgentId = resolveSelectedAgentId();
  const normalizedChatSessionKey = normalizeOptionalString(state.sessionKey)?.toLowerCase();
  const activeSessionAgentId =
    normalizedChatSessionKey === "global" ? null : resolveAgentIdFromSessionKey(state.sessionKey);
  const scopedChatAgentId = scopedAgentParamsForSession(state, state.sessionKey).agentId;
  const chatFallbackAgentId = normalizeAgentId(
    state.assistantAgentId ??
      state.agentsList?.defaultId ??
      state.agentsList?.agents?.[0]?.id ??
      "main",
  );
  const resolveChatWorkspaceAgentId = () => {
    const normalizedKey = normalizeOptionalString(state.sessionKey)?.toLowerCase();
    const activeAgentId =
      normalizedKey === "global" ? null : resolveAgentIdFromSessionKey(state.sessionKey);
    const scopedAgentId = scopedAgentParamsForSession(state, state.sessionKey).agentId;
    return normalizedKey === "global"
      ? (scopedAgentId ?? chatFallbackAgentId)
      : (activeAgentId ?? scopedAgentId ?? chatFallbackAgentId);
  };
  const chatAgentId =
    normalizedChatSessionKey === "global"
      ? (scopedChatAgentId ?? chatFallbackAgentId)
      : (activeSessionAgentId ?? scopedChatAgentId ?? chatFallbackAgentId);
  const toolsPanelUsesActiveSession = Boolean(resolvedAgentId && resolvedAgentId === chatAgentId);
  const chatWorkspaceFiles = getChatWorkspaceFilesState(state, chatAgentId);
  const currentChatWorkspaceFilesState = () =>
    resolveChatWorkspaceAgentId() === chatAgentId
      ? getChatWorkspaceFilesState(state, chatAgentId)
      : null;
  const getCurrentConfigValue = () =>
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const configValue = getCurrentConfigValue();
  const findAgentIndex = (agentId: string) =>
    findAgentConfigEntryIndex(getCurrentConfigValue(), agentId);
  const ensureAgentIndex = (agentId: string) => ensureAgentConfigEntry(state, agentId);
  const resolveAgentToolsPath = (agentId: string, ensure: boolean) => {
    const index = ensure ? ensureAgentIndex(agentId) : findAgentIndex(agentId);
    return index >= 0 ? (["agents", "list", index, "tools"] as const) : null;
  };
  const resolveAgentModelFormEntry = (index: number) => {
    const list = (getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null)?.agents
      ?.list;
    const existing = Array.isArray(list)
      ? (list[index] as { model?: unknown } | undefined)?.model
      : undefined;
    return {
      basePath: ["agents", "list", index, "model"] as Array<string | number>,
      existing,
    };
  };
  const cronAgentSuggestions = sortLocaleStrings(
    new Set(
      [
        ...(state.agentsList?.agents?.map((entry) => entry.id.trim()) ?? []),
        ...state.cronJobs
          .map((job) => (typeof job.agentId === "string" ? job.agentId.trim() : ""))
          .filter(Boolean),
      ].filter(Boolean),
    ),
  );
  const cronModelSuggestions = sortLocaleStrings(
    new Set(
      [
        ...state.cronModelSuggestions,
        ...resolveConfiguredCronModelSuggestions(configValue),
        ...state.cronJobs
          .map((job) => {
            const payload = getCronJobPayload(job);
            if (payload?.kind !== "agentTurn" || typeof payload.model !== "string") {
              return "";
            }
            return payload.model.trim();
          })
          .filter(Boolean),
      ].filter(Boolean),
    ),
  );
  const visibleCronJobs = getVisibleCronJobs(state);
  const selectedDeliveryChannel =
    state.cronForm.deliveryChannel && state.cronForm.deliveryChannel.trim()
      ? state.cronForm.deliveryChannel.trim()
      : "last";
  const jobToSuggestions = state.cronJobs
    .map((job) => normalizeSuggestionValue(job.delivery?.to))
    .filter(Boolean);
  const accountToSuggestions = (
    selectedDeliveryChannel === "last"
      ? Object.values(state.channelsSnapshot?.channelAccounts ?? {}).flat()
      : (state.channelsSnapshot?.channelAccounts?.[selectedDeliveryChannel] ?? [])
  )
    .flatMap((account) => [
      normalizeSuggestionValue(account.accountId),
      normalizeSuggestionValue(account.name),
    ])
    .filter(Boolean);
  const rawDeliveryToSuggestions = uniquePreserveOrder([
    ...jobToSuggestions,
    ...accountToSuggestions,
  ]);
  const accountSuggestions = uniquePreserveOrder(accountToSuggestions);
  const deliveryToSuggestions =
    state.cronForm.deliveryMode === "webhook"
      ? rawDeliveryToSuggestions.filter((value) => isHttpUrl(value))
      : rawDeliveryToSuggestions;
  const commonConfigProps = {
    raw: state.configRaw,
    originalRaw: state.configRawOriginal,
    valid: state.configValid,
    issues: state.configIssues,
    loading: state.configLoading,
    saving: state.configSaving,
    applying: state.configApplying,
    updating: state.updateRunning,
    connected: state.connected,
    schema: state.configSchema,
    schemaLoading: state.configSchemaLoading,
    uiHints: state.configUiHints,
    formValue: state.configForm,
    originalValue: state.configFormOriginal,
    onRawChange: (next: string) => {
      updateConfigRawValue(state, next);
    },
    onRequestUpdate: requestHostUpdate,
    onFormPatch: (path: Array<string | number>, value: unknown) =>
      updateConfigFormValue(state, path, value),
    onReload: () => void loadConfig(state, { discardPendingChanges: true }),
    onReset: () => resetConfigPendingChanges(state),
    onSave: () => void saveConfig(state),
    onApply: () => void applyConfig(state),
    onUpdate: () => void runUpdate(state),
    onOpenFile: () => void openConfigFile(state),
    version: state.hello?.server?.version ?? "",
    theme: state.theme,
    themeMode: state.themeMode,
    setTheme: (theme, context) => state.setTheme(theme, context),
    setThemeMode: (mode, context) => state.setThemeMode(mode, context),
    hasCustomTheme: Boolean(state.settings.customTheme),
    customThemeLabel: state.settings.customTheme?.label ?? null,
    customThemeSourceUrl: state.settings.customTheme?.sourceUrl ?? null,
    customThemeImportUrl: state.customThemeImportUrl,
    customThemeImportBusy: state.customThemeImportBusy,
    customThemeImportMessage: state.customThemeImportMessage,
    customThemeImportExpanded: state.customThemeImportExpanded,
    customThemeImportFocusToken: state.customThemeImportFocusToken,
    onCustomThemeImportUrlChange: (next) => state.setCustomThemeImportUrl(next),
    onOpenCustomThemeImport: () => state.openCustomThemeImport(),
    onImportCustomTheme: () => void state.importCustomTheme(),
    onClearCustomTheme: () => state.clearCustomTheme(),
    borderRadius: state.settings.borderRadius,
    setBorderRadius: (value) => state.setBorderRadius(value),
    textScale: state.settings.textScale ?? 100,
    setTextScale: (value) => state.setTextScale(value),
    gatewayUrl: state.settings.gatewayUrl,
    assistantName: state.assistantName,
    configPath: state.configSnapshot?.path ?? null,
    rawAvailable:
      typeof state.configSnapshot?.raw === "string" ||
      Boolean(state.configSnapshot?.config) ||
      Boolean(state.configForm),
  } satisfies Omit<
    ConfigProps,
    | "formMode"
    | "searchQuery"
    | "activeSection"
    | "activeSubsection"
    | "onFormModeChange"
    | "onSearchChange"
    | "onSectionChange"
    | "onSubsectionChange"
    | "showModeToggle"
    | "navRootLabel"
    | "includeSections"
    | "excludeSections"
    | "includeVirtualSections"
  >;
  const renderConfigTab = (overrides: ConfigTabOverrides) => {
    const scopedDefaultSection = overrides.includeSections?.[0] ?? null;
    const activeSection = overrides.activeSection ?? scopedDefaultSection;
    const showRootTab = overrides.showRootTab ?? !overrides.includeSections?.length;
    return renderMeasured(
      state,
      "config",
      {
        tab: state.tab,
        formMode: overrides.formMode,
        activeSection,
        activeSubsection: overrides.activeSubsection,
        schemaSectionCount: countScopedTopLevelSchemaProperties(
          commonConfigProps.schema,
          overrides.includeSections,
          overrides.excludeSections,
        ),
        hasSearch: Boolean(overrides.searchQuery?.trim()),
      },
      () =>
        renderConfig({
          ...commonConfigProps,
          includeVirtualSections: false,
          ...overrides,
          activeSection,
          showRootTab,
        }),
    );
  };
  const configSelection = normalizeMainConfigSelection(
    state.configActiveSection,
    state.configActiveSubsection,
  );
  const communicationsSelection = normalizeScopedConfigSelection(
    state.communicationsActiveSection,
    state.communicationsActiveSubsection,
    COMMUNICATION_SECTION_KEYS,
  );
  const appearanceSelection = normalizeScopedConfigSelection(
    state.appearanceActiveSection,
    state.appearanceActiveSubsection,
    APPEARANCE_SECTION_KEYS,
  );
  const automationSelection = normalizeScopedConfigSelection(
    state.automationActiveSection,
    state.automationActiveSubsection,
    AUTOMATION_SECTION_KEYS,
  );
  const infrastructureSelection = normalizeScopedConfigSelection(
    state.infrastructureActiveSection,
    state.infrastructureActiveSubsection,
    INFRASTRUCTURE_SECTION_KEYS,
  );
  const aiAgentsSelection = normalizeScopedConfigSelection(
    state.aiAgentsActiveSection,
    state.aiAgentsActiveSubsection,
    AI_AGENTS_SECTION_KEYS,
  );
  const renderConfigTabForActiveTab = () => {
    switch (state.tab) {
      case "config": {
        state.configSettingsMode = "quick";
        // Quick Settings mode — opinionated card layout
        if (state.configSettingsMode === "quick") {
          const configObj = state.configForm ?? state.configSnapshot?.config ?? {};
          const assistantAvatarOverride =
            localAssistantAvatarOverride ?? resolveAssistantAvatarOverride(configObj);
          const agentsDefaults = ((configObj.agents as Record<string, unknown> | undefined)
            ?.defaults ?? {}) as Record<string, unknown>;
          const activeSession = resolveQuickSettingsSessionRow(state);
          const currentModel =
            typeof activeSession?.model === "string"
              ? activeSession.model
              : typeof agentsDefaults.model === "string"
                ? agentsDefaults.model
                : "default";
          const thinkingLevel =
            typeof activeSession?.thinkingLevel === "string"
              ? activeSession.thinkingLevel
              : typeof agentsDefaults.thinkingLevel === "string"
                ? agentsDefaults.thinkingLevel
                : "off";
          const fastMode =
            typeof activeSession?.fastMode === "boolean"
              ? activeSession.fastMode
              : agentsDefaults.fastMode === true;
          return renderQuickSettings({
            currentModel,
            thinkingLevel,
            fastMode,
            onModelChange: () => {
              state.configSettingsMode = "advanced";
              state.aiAgentsActiveSection = "models";
              state.setTab("aiAgents");
            },
            onThinkingChange: (level) => {
              void patchSession(state, state.sessionKey, { thinkingLevel: level }).then(() =>
                requestHostUpdate?.(),
              );
            },
            onFastModeToggle: () => {
              void patchSession(state, state.sessionKey, { fastMode: !fastMode }).then(() =>
                requestHostUpdate?.(),
              );
            },
            channels: extractQuickSettingsChannels(state),
            onChannelConfigure: () => {
              state.setTab("channels");
            },
            automation: {
              cronJobCount: state.cronJobs?.length ?? 0,
              skillCount: state.skillsReport?.skills?.length ?? 0,
              mcpServerCount: extractMcpServerCount(state),
            },
            onManageCron: () => {
              state.setTab("cron");
            },
            onBrowseSkills: () => {
              state.setTab("skills");
            },
            onConfigureMcp: () => {
              state.setTab("mcp");
            },
            security: extractQuickSettingsSecurity(state),
            onSecurityConfigure: () => {
              state.configSettingsMode = "advanced";
              state.configActiveSection = "auth";
              requestHostUpdate?.();
            },
            onBrowserEnabledToggle: (enabled) => {
              updateConfigFormValue(state, ["browser", "enabled"], enabled);
              requestHostUpdate?.();
            },
            onToolProfileChange: (profile) => {
              updateConfigFormValue(state, ["tools", "profile"], profile);
              requestHostUpdate?.();
            },
            theme: state.theme,
            themeMode: state.themeMode,
            hasCustomTheme: Boolean(state.settings.customTheme),
            customThemeLabel: state.settings.customTheme?.label ?? null,
            borderRadius: state.settings.borderRadius,
            textScale: state.settings.textScale ?? 100,
            setTheme: (theme, context) => state.setTheme(theme, context),
            onOpenCustomThemeImport: () => {
              state.setTab("appearance");
              state.appearanceFormMode = "form";
              state.appearanceSearchQuery = "";
              state.appearanceActiveSection = "__appearance__";
              state.appearanceActiveSubsection = null;
              state.openCustomThemeImport();
              requestHostUpdate?.();
            },
            setThemeMode: (mode, context) => state.setThemeMode(mode, context),
            setBorderRadius: (value) => state.setBorderRadius(value),
            setTextScale: (value) => state.setTextScale(value),
            userAvatar: state.userAvatar ?? null,
            onUserAvatarChange: (avatar) => state.applyLocalUserIdentity?.({ avatar }),
            assistantAvatar: configAssistantAvatar,
            assistantAvatarUrl: configAssistantAvatarUrl,
            assistantAvatarSource: configAssistantAvatarSource,
            assistantAvatarStatus: configAssistantAvatarStatus,
            assistantAvatarReason: configAssistantAvatarReason,
            assistantAvatarOverride,
            assistantAvatarUploadBusy: state.assistantAvatarUploadBusy,
            assistantAvatarUploadError: state.assistantAvatarUploadError,
            onAssistantAvatarOverrideChange: (dataUrl) => {
              setAssistantAvatarOverride(state, dataUrl);
              state.chatAvatarUrl = dataUrl;
              state.chatAvatarSource = dataUrl;
              state.chatAvatarStatus = "data";
              state.chatAvatarReason = null;
              state.assistantAvatarUploadError = null;
              requestHostUpdate?.();
            },
            onAssistantAvatarClearOverride: () => {
              setAssistantAvatarOverride(state, null);
              state.chatAvatarUrl = null;
              state.chatAvatarSource = null;
              state.chatAvatarStatus = null;
              state.chatAvatarReason = null;
              state.assistantAvatarUploadError = null;
              void state.loadAssistantIdentity?.().finally(() => requestHostUpdate?.());
              requestHostUpdate?.();
            },
            basePath: state.basePath ?? "",
            configObject: configObj,
            savedConfigObject:
              (state.configSnapshot?.config as Record<string, unknown> | null) ?? {},
            configDirty: state.configFormDirty,
            configSaving: state.configSaving,
            configApplying: state.configApplying,
            configReady: Boolean(state.configSnapshot?.hash),
            onSelectPreset: (presetId) => {
              const preset = getPresetById(presetId);
              if (!preset) {
                return;
              }
              stageConfigPreset(state, preset.patch);
              requestHostUpdate?.();
            },
            onResetConfig: () => resetConfigPendingChanges(state),
            onSaveConfig: () => void saveConfig(state),
            onApplyConfig: () => void applyConfig(state),
            connected: state.connected,
            gatewayUrl: state.settings.gatewayUrl,
            assistantName: state.assistantName,
            version: state.hello?.server?.version ?? "",
          });
        }
        // Advanced mode — full config form with accordion groups
        return renderConfigTab({
          formMode: state.configFormMode,
          searchQuery: state.configSearchQuery,
          activeSection: configSelection.activeSection,
          activeSubsection: configSelection.activeSubsection,
          onFormModeChange: (mode) => (state.configFormMode = mode),
          onSearchChange: (query) => (state.configSearchQuery = query),
          onSectionChange: (section) => {
            state.configActiveSection = section;
            state.configActiveSubsection = null;
          },
          onSubsectionChange: (section) => (state.configActiveSubsection = section),
          showModeToggle: true,
          settingsLayout: "accordion",
          onBackToQuick: () => {
            state.configSettingsMode = "quick";
            requestHostUpdate?.();
          },
          excludeSections: [
            ...COMMUNICATION_SECTION_KEYS,
            ...AUTOMATION_SECTION_KEYS,
            ...INFRASTRUCTURE_SECTION_KEYS,
            ...AI_AGENTS_SECTION_KEYS,
            "ui",
            "wizard",
          ],
        });
      }
      case "channels":
        return renderLazyView(lazyChannels, (m) =>
          m.renderChannels({
            connected: state.connected,
            loading: state.channelsLoading,
            snapshot: state.channelsSnapshot,
            lastError: state.channelsError,
            lastSuccessAt: state.channelsLastSuccess,
            whatsappMessage: state.whatsappLoginMessage,
            whatsappQrDataUrl: state.whatsappLoginQrDataUrl,
            whatsappConnected: state.whatsappLoginConnected,
            whatsappBusy: state.whatsappBusy,
            configSchema: state.configSchema,
            configSchemaLoading: state.configSchemaLoading,
            configForm: state.configForm,
            configUiHints: state.configUiHints,
            configSaving: state.configSaving,
            configFormDirty: state.configFormDirty,
            nostrProfileFormState: state.nostrProfileFormState,
            nostrProfileAccountId: state.nostrProfileAccountId,
            onRefresh: (probe) => void loadChannels(state, probe),
            onWhatsAppStart: (force) => void state.handleWhatsAppStart(force),
            onWhatsAppWait: () => void state.handleWhatsAppWait(),
            onWhatsAppLogout: () => void state.handleWhatsAppLogout(),
            onConfigPatch: (path, value) => updateConfigFormValue(state, path, value),
            onConfigSave: () => void state.handleChannelConfigSave(),
            onConfigReload: () => void state.handleChannelConfigReload(),
            onNostrProfileEdit: (accountId, profile) =>
              state.handleNostrProfileEdit(accountId, profile),
            onNostrProfileCancel: () => state.handleNostrProfileCancel(),
            onNostrProfileFieldChange: (field, value) =>
              state.handleNostrProfileFieldChange(field, value),
            onNostrProfileSave: () => void state.handleNostrProfileSave(),
            onNostrProfileImport: () => void state.handleNostrProfileImport(),
            onNostrProfileToggleAdvanced: () => state.handleNostrProfileToggleAdvanced(),
          }),
        );
      case "communications":
        return renderConfigTab({
          formMode: state.communicationsFormMode,
          searchQuery: state.communicationsSearchQuery,
          activeSection: communicationsSelection.activeSection,
          activeSubsection: communicationsSelection.activeSubsection,
          onFormModeChange: (mode) => (state.communicationsFormMode = mode),
          onSearchChange: (query) => (state.communicationsSearchQuery = query),
          onSectionChange: (section) => {
            state.communicationsActiveSection = section;
            state.communicationsActiveSubsection = null;
          },
          onSubsectionChange: (section) => (state.communicationsActiveSubsection = section),
          navRootLabel: "Communication",
          includeSections: [...COMMUNICATION_SECTION_KEYS],
          includeVirtualSections: true,
          webPush: {
            supported: state.webPushSupported,
            permission: state.webPushPermission,
            subscribed: state.webPushSubscribed,
            loading: state.webPushLoading,
          },
          onWebPushSubscribe: () => void state.handleWebPushSubscribe(),
          onWebPushUnsubscribe: () => void state.handleWebPushUnsubscribe(),
          onWebPushTest: () => void state.handleWebPushTest(),
        });
      case "appearance":
        return renderConfigTab({
          formMode: state.appearanceFormMode,
          searchQuery: state.appearanceSearchQuery,
          activeSection: appearanceSelection.activeSection,
          activeSubsection: appearanceSelection.activeSubsection,
          onFormModeChange: (mode) => (state.appearanceFormMode = mode),
          onSearchChange: (query) => (state.appearanceSearchQuery = query),
          onSectionChange: (section) => {
            state.appearanceActiveSection = section;
            state.appearanceActiveSubsection = null;
          },
          onSubsectionChange: (section) => (state.appearanceActiveSubsection = section),
          navRootLabel: t("tabs.appearance"),
          includeSections: [...APPEARANCE_SECTION_KEYS],
          includeVirtualSections: true,
        });
      case "automation":
        return renderConfigTab({
          formMode: state.automationFormMode,
          searchQuery: state.automationSearchQuery,
          activeSection: automationSelection.activeSection,
          activeSubsection: automationSelection.activeSubsection,
          onFormModeChange: (mode) => (state.automationFormMode = mode),
          onSearchChange: (query) => (state.automationSearchQuery = query),
          onSectionChange: (section) => {
            state.automationActiveSection = section;
            state.automationActiveSubsection = null;
          },
          onSubsectionChange: (section) => (state.automationActiveSubsection = section),
          navRootLabel: "Automation",
          includeSections: [...AUTOMATION_SECTION_KEYS],
        });
      case "mcp":
        return renderMcp({
          configObject:
            state.configForm ??
            ((state.configSnapshot?.config as Record<string, unknown> | null) || {}),
          configDirty: state.configFormDirty,
          configSaving: state.configSaving,
          configApplying: state.configApplying,
          connected: state.connected,
          onSaveConfig: () => void saveConfig(state),
          onApplyConfig: () => void applyConfig(state),
          onServerEnabledChange: (name, enabled) => {
            updateMcpServerEnabled(state, name, enabled);
            requestHostUpdate?.();
          },
          editor: renderConfigTab({
            formMode: "form",
            searchQuery: "",
            activeSection: "mcp",
            activeSubsection: null,
            onFormModeChange: () => undefined,
            onSearchChange: () => undefined,
            onSectionChange: () => {
              state.infrastructureActiveSection = "mcp";
              state.infrastructureActiveSubsection = null;
            },
            onSubsectionChange: (section) => (state.infrastructureActiveSubsection = section),
            navRootLabel: "MCP",
            includeSections: ["mcp"],
          }),
        });
      case "infrastructure":
        return renderConfigTab({
          formMode: state.infrastructureFormMode,
          searchQuery: state.infrastructureSearchQuery,
          activeSection: infrastructureSelection.activeSection,
          activeSubsection: infrastructureSelection.activeSubsection,
          onFormModeChange: (mode) => (state.infrastructureFormMode = mode),
          onSearchChange: (query) => (state.infrastructureSearchQuery = query),
          onSectionChange: (section) => {
            state.infrastructureActiveSection = section;
            state.infrastructureActiveSubsection = null;
          },
          onSubsectionChange: (section) => (state.infrastructureActiveSubsection = section),
          navRootLabel: "Infrastructure",
          includeSections: [...INFRASTRUCTURE_SECTION_KEYS],
        });
      case "aiAgents":
        return renderConfigTab({
          formMode: state.aiAgentsFormMode,
          searchQuery: state.aiAgentsSearchQuery,
          activeSection: aiAgentsSelection.activeSection,
          activeSubsection: aiAgentsSelection.activeSubsection,
          onFormModeChange: (mode) => (state.aiAgentsFormMode = mode),
          onSearchChange: (query) => (state.aiAgentsSearchQuery = query),
          onSectionChange: (section) => {
            state.aiAgentsActiveSection = section;
            state.aiAgentsActiveSubsection = null;
          },
          onSubsectionChange: (section) => (state.aiAgentsActiveSubsection = section),
          navRootLabel: "AI & Agents",
          includeSections: [...AI_AGENTS_SECTION_KEYS],
        });
      default:
        return nothing;
    }
  };
  const loadAgentPanelDataForSelectedAgent = (agentId: string | null) => {
    if (!agentId) {
      return;
    }
    switch (state.agentsPanel) {
      case "files":
        void loadAgentFiles(state, agentId);
        return;
      case "skills":
        void loadAgentSkills(state, agentId);
        return;
      case "tools":
        void loadToolsCatalog(state, agentId);
        void refreshVisibleToolsEffectiveForCurrentSession(state);
      case "overview":
      case "channels":
      case "cron":
    }
  };
  const refreshAgentsPanelSupplementalData = (panel: AppViewState["agentsPanel"]) => {
    if (panel === "channels") {
      void loadChannels(state, false);
      return;
    }
    if (panel === "cron") {
      void state.loadCron();
    }
  };
  const resetAgentFilesState = (clearLoading = false) => {
    state.agentFilesList = null;
    state.agentFilesError = null;
    state.agentFileActive = null;
    state.agentFileContents = {};
    state.agentFileDrafts = {};
    if (clearLoading) {
      state.agentFilesLoading = false;
    }
  };
  const resetAgentSelectionPanelState = () => {
    resetAgentFilesState(true);
    state.agentSkillsReport = null;
    state.agentSkillsError = null;
    state.agentSkillsAgentId = null;
    state.toolsCatalogResult = null;
    state.toolsCatalogError = null;
    state.toolsCatalogLoading = false;
    resetToolsEffectiveState(state);
  };
  if (
    CHAT_WORKSPACE_FILE_RAIL_ENABLED &&
    isChat &&
    state.connected &&
    state.agentsList &&
    !chatWorkspaceFiles.loading &&
    !chatWorkspaceFiles.error &&
    chatWorkspaceFiles.list?.agentId !== chatAgentId
  ) {
    loadChatWorkspaceFiles();
  }
  const refreshChatWorkspaceFiles = () => {
    loadChatWorkspaceFiles({ force: true });
  };
  function loadChatWorkspaceFiles(opts?: { force?: boolean }) {
    if (!state.client || !state.connected || chatWorkspaceFiles.loading) {
      return;
    }
    const requestId = chatWorkspaceFiles.requestId + 1;
    chatWorkspaceFiles.requestId = requestId;
    chatWorkspaceFiles.loading = true;
    chatWorkspaceFiles.error = null;
    if (opts?.force) {
      chatWorkspaceFiles.list = null;
    }
    const requestState = chatWorkspaceFiles;
    void (async () => {
      try {
        const res = await state.client?.request<AgentsFilesListResult | null>("agents.files.list", {
          agentId: chatAgentId,
        });
        const current = currentChatWorkspaceFilesState();
        if (current !== requestState || current.requestId !== requestId) {
          return;
        }
        current.list = res ?? null;
        if (current.activeName && !res?.files.some((file) => file.name === current.activeName)) {
          current.activeName = null;
        }
      } catch (err) {
        const current = currentChatWorkspaceFilesState();
        if (current === requestState && current.requestId === requestId) {
          current.error = String(err);
        }
      } finally {
        const current = currentChatWorkspaceFilesState();
        if (current === requestState && current.requestId === requestId) {
          current.loading = false;
        }
        requestHostUpdate?.();
      }
    })();
  }
  const openChatWorkspaceFile = (name: string) => {
    chatWorkspaceFiles.activeName = name;
    const previousRequest = chatWorkspaceFileOpenRequests.get(state);
    const openRequest = {
      agentId: chatAgentId,
      id: (previousRequest?.id ?? 0) + 1,
      name,
      sessionKey: state.sessionKey,
    };
    chatWorkspaceFileOpenRequests.set(state, openRequest);
    const isCurrentOpenRequest = () => {
      const currentRequest = chatWorkspaceFileOpenRequests.get(state);
      const currentFiles = currentChatWorkspaceFilesState();
      return (
        currentRequest?.id === openRequest.id &&
        currentRequest.agentId === resolveChatWorkspaceAgentId() &&
        currentRequest.name === name &&
        currentRequest.sessionKey === state.sessionKey &&
        currentFiles?.activeName === name
      );
    };
    void (async () => {
      if (!state.client || !state.connected) {
        return;
      }
      chatWorkspaceFiles.error = null;
      try {
        const res = await state.client.request<AgentsFilesGetResult | null>("agents.files.get", {
          agentId: chatAgentId,
          name,
        });
        const content = res?.file?.content;
        if (typeof content !== "string") {
          if (isCurrentOpenRequest()) {
            chatWorkspaceFiles.error = `Failed to load ${name}`;
            requestHostUpdate?.();
          }
          return;
        }
        if (!isCurrentOpenRequest()) {
          return;
        }
        state.handleOpenSidebar({
          kind: "markdown",
          content: buildWorkspaceFileSidebarContent(name, content),
          rawText: content,
        });
      } catch (err) {
        if (isCurrentOpenRequest()) {
          chatWorkspaceFiles.error = String(err);
        }
      } finally {
        requestHostUpdate?.();
      }
    })();
  };

  return html`
    ${renderCommandPalette({
      open: state.paletteOpen,
      query: state.paletteQuery,
      activeIndex: state.paletteActiveIndex,
      onToggle: () => {
        state.paletteOpen = !state.paletteOpen;
      },
      onQueryChange: (q) => {
        state.paletteQuery = q;
      },
      onActiveIndexChange: (i) => {
        state.paletteActiveIndex = i;
      },
      onNavigate: (tab) => {
        navigateProductTab(tab as import("./navigation.ts").Tab);
      },
      onSlashCommand: (cmd) => {
        state.setTab("chat" as import("./navigation.ts").Tab);
        state.handleChatDraftChange(cmd.endsWith(" ") ? cmd : `${cmd} `);
      },
    })}
    <div
      class="shell ${isChat ? "shell--chat" : ""} ${navCollapsed
        ? "shell--nav-collapsed"
        : ""} ${navDrawerOpen ? "shell--nav-drawer-open" : ""} ${state.onboarding
        ? "shell--onboarding"
        : ""}"
      style=${styleMap(
        state.chatMessageMaxWidth ? { "--chat-message-max-width": state.chatMessageMaxWidth } : {},
      )}
    >
      <button
        type="button"
        class="shell-nav-backdrop"
        aria-label="${t("nav.collapse")}"
        @click=${() => {
          state.navDrawerOpen = false;
        }}
      ></button>
      <header
        class="topbar"
        ?inert=${state.onboarding}
        aria-hidden=${state.onboarding ? "true" : nothing}
      >
        <div class="topnav-shell">
          <button
            type="button"
            class="sidebar-menu-trigger topbar-nav-toggle"
            @click=${() => {
              state.navDrawerOpen = !navDrawerOpen;
            }}
            title="${navDrawerOpen ? t("nav.collapse") : t("nav.expand")}"
            aria-label="${navDrawerOpen ? t("nav.collapse") : t("nav.expand")}"
            aria-expanded=${navDrawerOpen}
          >
            <span class="nav-collapse-toggle__icon" aria-hidden="true">${icons.menu}</span>
          </button>
          <div class="topnav-shell__content">
            <dashboard-header
              .tab=${state.tab}
              .basePath=${state.basePath}
              .agentLabel=${dashboardHeaderContext.agentLabel}
              @navigate=${(event: CustomEvent<Tab>) => {
                navigateProductTab(event.detail);
              }}
            ></dashboard-header>
          </div>
          <div class="topnav-shell__actions">
            <button
              class="topbar-search"
              @click=${() => {
                state.paletteOpen = !state.paletteOpen;
              }}
              title=${t("chat.commandPaletteTitle")}
              aria-label=${t("chat.openCommandPalette")}
            >
              <span class="topbar-search__label">${t("common.search")}</span>
              <kbd class="topbar-search__kbd">⌘K</kbd>
            </button>
            <div class="topbar-status">${renderTopbarThemeModeToggle(state)}</div>
          </div>
        </div>
      </header>
      <div class="shell-nav">
        <aside class="sidebar ${navCollapsed ? "sidebar--collapsed" : ""}">
          <div class="sidebar-shell">
            <div class="sidebar-shell__header">
              <div class="sidebar-brand">
                ${navCollapsed
                  ? nothing
                  : html`
                      <img
                        class="sidebar-brand__logo"
                        src="${agentLogoUrl(basePath)}"
                        alt="迭界AI"
                      />
                      <span class="sidebar-brand__copy">
                        <span class="sidebar-brand__eyebrow">主系统</span>
                        <span class="sidebar-brand__title">迭界AI</span>
                      </span>
                    `}
              </div>
              <button
                type="button"
                class="nav-collapse-toggle"
                @click=${() =>
                  state.applySettings({
                    ...state.settings,
                    navCollapsed: !state.settings.navCollapsed,
                  })}
                title="${navCollapsed ? t("nav.expand") : t("nav.collapse")}"
                aria-label="${navCollapsed ? t("nav.expand") : t("nav.collapse")}"
              >
                <span class="nav-collapse-toggle__icon" aria-hidden="true"
                  >${navCollapsed ? icons.panelLeftOpen : icons.panelLeftClose}</span
                >
              </button>
            </div>
            <div class="sidebar-shell__body">
              ${renderSidebarSessions(state)}
              <nav class="sidebar-nav">
                ${TAB_GROUPS.map((group) => {
                  const isGroupCollapsed = state.settings.navGroupsCollapsed[group.label] ?? false;
                  const showItems = navCollapsed || !isGroupCollapsed;
                  const groupLabel = group.label === "main" ? "主导航" : t(`nav.${group.label}`);

                  return html`
                    <section class="nav-section ${!showItems ? "nav-section--collapsed" : ""}">
                      ${!navCollapsed
                        ? html`
                            <button
                              class="nav-section__label"
                              @click=${() => {
                                const next = { ...state.settings.navGroupsCollapsed };
                                next[group.label] = !isGroupCollapsed;
                                state.applySettings({
                                  ...state.settings,
                                  navGroupsCollapsed: next,
                                });
                              }}
                              aria-expanded=${showItems}
                            >
                              <span class="nav-section__label-text">${groupLabel}</span>
                              <span class="nav-section__chevron"> ${icons.chevronDown} </span>
                            </button>
                          `
                        : nothing}
                      <div class="nav-section__items">
                        ${group.tabs.map((tab) =>
                          renderTab(state, tab, { collapsed: navCollapsed }),
                        )}
                      </div>
                    </section>
                  `;
                })}
              </nav>
            </div>
            <div class="sidebar-shell__footer">
              <div class="sidebar-utility-group">
                <div class="sidebar-mode-switch">${renderTopbarThemeModeToggle(state)}</div>
                ${(() => {
                  const version = state.hello?.server?.version ?? "";
                  return version
                    ? html`
                        <div class="sidebar-version" title=${`v${version}`}>
                          ${!navCollapsed
                            ? html`
                                <span class="sidebar-version__label">${t("common.version")}</span>
                                <span class="sidebar-version__text">v${version}</span>
                                ${renderSidebarConnectionStatus(state)}
                              `
                            : html` ${renderSidebarConnectionStatus(state)} `}
                        </div>
                      `
                    : nothing;
                })()}
              </div>
            </div>
          </div>
        </aside>
      </div>
      <main
        class="content ${isChat ? "content--chat" : ""} ${state.tab === "logs"
          ? "content--logs"
          : ""} ${state.tab === "workboard" ? "content--workboard" : ""}"
      >
        ${state.updateStatusBanner
          ? html`<div class="callout ${state.updateStatusBanner.tone}" role="alert">
              ${state.updateStatusBanner.text}
            </div>`
          : nothing}
        ${state.updateAvailable &&
        state.updateAvailable.latestVersion !== state.updateAvailable.currentVersion &&
        !isUpdateBannerDismissed(state.updateAvailable)
          ? html`<div class="update-banner callout danger" role="alert">
              <strong>${t("chat.updateAvailable")}</strong> v${state.updateAvailable.latestVersion}
              (${t("chat.runningVersion", { version: state.updateAvailable.currentVersion })}).
              <button
                class="btn btn--sm update-banner__btn"
                ?disabled=${state.updateRunning || !state.connected}
                @click=${() => runUpdate(state)}
              >
                ${state.updateRunning ? t("chat.updating") : t("chat.updateNow")}
              </button>
              <button
                class="update-banner__close"
                type="button"
                title=${t("common.dismiss")}
                aria-label=${t("chat.dismissUpdateBanner")}
                @click=${() => {
                  dismissUpdateBanner(state.updateAvailable);
                  state.updateAvailable = null;
                }}
              >
                ${icons.x}
              </button>
            </div>`
          : nothing}
        ${state.tab === "config" || isChat
          ? nothing
          : html`<section
              class=${chatHeaderHidden
                ? "content-header content-header--chat-hidden"
                : "content-header"}
              ?inert=${chatHeaderHidden}
              aria-hidden=${chatHeaderHidden ? "true" : nothing}
            >
              <div>
                <div class="page-title">${displayTitleForTab(state.tab)}</div>
                <div class="page-sub">${subtitleForTab(state.tab)}</div>
              </div>
              <div class="page-meta">
                ${headerError ? html`<div class="pill danger">${headerError}</div>` : nothing}
              </div>
            </section>`}
        ${state.tab === "businessOverview"
          ? renderBusinessOverviewPage(state, requestHostUpdate)
          : nothing}
        ${state.tab === "observation" ? renderObservationPage(state, requestHostUpdate) : nothing}
        ${state.tab === "attribution" ? renderAttributionPage(state, requestHostUpdate) : nothing}
        ${state.tab === "aics"
          ? renderRoleExecutionProductPage(state, navigateProductTab)
          : nothing}
        ${state.tab === "goals"
          ? renderGoalManagementProductPage(state, navigateProductTab, requestHostUpdate)
          : nothing}
        ${state.tab === "company"
          ? renderCompanyManagementProductPage(state, navigateProductTab, requestHostUpdate)
          : nothing}
        ${state.tab === "projects"
          ? renderProjectManagementProductPage(state, navigateProductTab)
          : nothing}
        ${renderStandaloneSettingsSectionNav(state)}
        ${state.tab === "overview"
          ? renderOverview({
              connected: state.connected,
              hello: state.hello,
              settings: state.settings,
              password: state.password,
              lastError: state.lastError,
              lastErrorCode: state.lastErrorCode,
              presenceCount,
              sessionsCount,
              cronEnabled: state.cronStatus?.enabled ?? null,
              cronNext,
              lastChannelsRefresh: state.channelsLastSuccess,
              warnQueryToken,
              modelAuthStatus: state.modelAuthStatusResult,
              usageResult: state.usageResult,
              sessionsResult: state.sessionsResult,
              skillsReport: state.skillsReport,
              cronJobs: state.cronJobs,
              cronStatus: state.cronStatus,
              attentionItems: state.attentionItems,
              eventLog: state.eventLog,
              overviewLogLines: state.overviewLogLines,
              showGatewayToken: state.overviewShowGatewayToken,
              showGatewayPassword: state.overviewShowGatewayPassword,
              onSettingsChange: (next) => state.applySettings(next),
              onPasswordChange: (next) => (state.password = next),
              onSessionKeyChange: (next) => {
                switchChatSession(state, next);
              },
              onToggleGatewayTokenVisibility: () => {
                state.overviewShowGatewayToken = !state.overviewShowGatewayToken;
              },
              onToggleGatewayPasswordVisibility: () => {
                state.overviewShowGatewayPassword = !state.overviewShowGatewayPassword;
              },
              onConnect: () => state.connect(),
              onRefresh: () => void state.loadOverview({ refresh: true }),
              onNavigate: (tab) => navigateProductTab(tab as import("./navigation.ts").Tab),
              onRefreshLogs: () => void state.loadOverview({ refresh: true }),
            })
          : nothing}
        ${state.tab === "activity"
          ? renderLazyView(lazyActivity, (m) =>
              m.renderActivity({
                entries: state.activityEntries,
                filterText: state.activityFilterText,
                statusFilters: state.activityStatusFilters,
                toolFilter: state.activityToolFilter,
                expandedIds: state.activityExpandedIds,
                autoFollow: state.activityAutoFollow,
                onFilterTextChange: (next) => (state.activityFilterText = next),
                onToolFilterChange: (next) => (state.activityToolFilter = next),
                onStatusToggle: (status, enabled) => {
                  state.activityStatusFilters = {
                    ...state.activityStatusFilters,
                    [status]: enabled,
                  };
                },
                onToggleAutoFollow: (next) => {
                  state.activityAutoFollow = next;
                  if (next) {
                    state.scheduleActivityScroll(true);
                  }
                },
                onClear: () => {
                  state.activityEntries = [];
                  state.activityExpandedIds = new Set();
                  state.activityAtBottom = true;
                },
                onExpandAll: () => {
                  state.activityExpandedIds = new Set(
                    state.activityEntries.map((entry) => entry.id),
                  );
                },
                onCollapseAll: () => {
                  state.activityExpandedIds = new Set();
                },
                onEntryToggle: (id, open) => {
                  const next = new Set(state.activityExpandedIds);
                  if (open) {
                    next.add(id);
                  } else {
                    next.delete(id);
                  }
                  state.activityExpandedIds = next;
                },
                onScroll: (event) => state.handleActivityScroll(event),
              }),
            )
          : nothing}
        ${state.tab === "instances"
          ? renderLazyView(lazyInstances, (m) =>
              m.renderInstances({
                loading: state.presenceLoading,
                entries: state.presenceEntries,
                lastError: state.presenceError,
                statusMessage: state.presenceStatus,
                onRefresh: () => void loadPresence(state),
              }),
            )
          : nothing}
        ${state.tab === "sessions"
          ? renderLazyView(lazySessions, (m) => {
              return m.renderSessions({
                loading: state.sessionsLoading,
                result: state.sessionsResult,
                error: state.sessionsError,
                activeMinutes: state.sessionsFilterActive,
                limit: state.sessionsFilterLimit,
                includeGlobal: state.sessionsIncludeGlobal,
                includeUnknown: state.sessionsIncludeUnknown,
                showArchived: state.sessionsShowArchived,
                filtersCollapsed: state.sessionsFiltersCollapsed,
                basePath: state.basePath,
                searchQuery: state.sessionsSearchQuery,
                agentIdentityById: state.agentIdentityById,
                sortColumn: state.sessionsSortColumn,
                sortDir: state.sessionsSortDir,
                page: state.sessionsPage,
                pageSize: state.sessionsPageSize,
                selectedKeys: state.sessionsSelectedKeys,
                expandedCheckpointKey: state.sessionsExpandedCheckpointKey,
                checkpointItemsByKey: state.sessionsCheckpointItemsByKey,
                checkpointLoadingKey: state.sessionsCheckpointLoadingKey,
                checkpointBusyKey: state.sessionsCheckpointBusyKey,
                checkpointErrorByKey: state.sessionsCheckpointErrorByKey,
                onFiltersChange: (next) => {
                  state.sessionsFilterActive = next.activeMinutes;
                  state.sessionsFilterLimit = next.limit;
                  state.sessionsIncludeGlobal = next.includeGlobal;
                  state.sessionsIncludeUnknown = next.includeUnknown;
                  state.sessionsShowArchived = next.showArchived;
                  state.sessionsSelectedKeys = new Set();
                  state.sessionsPage = 0;
                  void loadSessions(state, {
                    activeMinutes: parseSessionsFilterInteger(next.activeMinutes),
                    limit: parseSessionsFilterInteger(next.limit),
                    includeGlobal: next.includeGlobal,
                    includeUnknown: next.includeUnknown,
                    showArchived: next.showArchived,
                  });
                },
                onToggleFiltersCollapsed: () => {
                  state.sessionsFiltersCollapsed = !state.sessionsFiltersCollapsed;
                },
                onClearFilters: () => {
                  state.sessionsFilterActive = "";
                  state.sessionsFilterLimit = "";
                  state.sessionsIncludeGlobal = true;
                  state.sessionsIncludeUnknown = true;
                  state.sessionsShowArchived = true;
                  state.sessionsSearchQuery = "";
                  state.sessionsSelectedKeys = new Set();
                  state.sessionsPage = 0;
                  void loadSessions(state, {
                    activeMinutes: 0,
                    limit: 0,
                    includeGlobal: true,
                    includeUnknown: true,
                    showArchived: true,
                  });
                },
                onSearchChange: (q) => {
                  state.sessionsSearchQuery = q;
                  state.sessionsPage = 0;
                },
                onSortChange: (col, dir) => {
                  state.sessionsSortColumn = col;
                  state.sessionsSortDir = dir;
                  state.sessionsPage = 0;
                },
                onPageChange: (p) => {
                  state.sessionsPage = p;
                },
                onPageSizeChange: (s) => {
                  state.sessionsPageSize = s;
                  state.sessionsPage = 0;
                },
                onRefresh: () => void loadSessions(state),
                onPatch: (key, patch) => void patchSession(state, key, patch),
                onToggleSelect: (key) => {
                  const next = new Set(state.sessionsSelectedKeys);
                  if (next.has(key)) {
                    next.delete(key);
                  } else {
                    next.add(key);
                  }
                  state.sessionsSelectedKeys = next;
                },
                onSelectPage: (keys) => {
                  const next = new Set(state.sessionsSelectedKeys);
                  for (const k of keys) {
                    next.add(k);
                  }
                  state.sessionsSelectedKeys = next;
                },
                onDeselectPage: (keys) => {
                  const next = new Set(state.sessionsSelectedKeys);
                  for (const k of keys) {
                    next.delete(k);
                  }
                  state.sessionsSelectedKeys = next;
                },
                onDeselectAll: () => {
                  state.sessionsSelectedKeys = new Set();
                },
                onDeleteSelected: runUiTask(async () => {
                  const keys = [...state.sessionsSelectedKeys];
                  const deleted = await deleteSessionsAndRefresh(state, keys);
                  if (deleted.length > 0) {
                    const next = new Set(state.sessionsSelectedKeys);
                    for (const k of deleted) {
                      next.delete(k);
                    }
                    state.sessionsSelectedKeys = next;
                  }
                }),
                onDeleteSession: runUiTask(async (key) => {
                  const deleted = await deleteSessionsAndRefresh(state, [key]);
                  if (deleted.length > 0) {
                    const next = new Set(state.sessionsSelectedKeys);
                    for (const deletedKey of deleted) {
                      next.delete(deletedKey);
                    }
                    state.sessionsSelectedKeys = next;
                    if (deleted.includes(state.sessionKey)) {
                      const nextSessionKey =
                        state.sessionsResult?.sessions.find(
                          (session) => !deleted.includes(session.key),
                        )?.key ?? null;
                      if (nextSessionKey) {
                        switchChatSession(state, nextSessionKey);
                        state.setTab("chat" as import("./navigation.ts").Tab);
                      } else {
                        await createChatSession(state);
                      }
                    }
                  }
                }),
                isProtectedSession: (key) => isSidebarProtectedRecentSession(state, key),
                onNavigateToChat: (sessionKey) => {
                  switchChatSession(state, sessionKey);
                  state.setTab("chat" as import("./navigation.ts").Tab);
                },
                onToggleCheckpointDetails: (sessionKey) =>
                  void toggleSessionCompactionCheckpoints(state, sessionKey),
                onBranchFromCheckpoint: runUiTask(async (sessionKey, checkpointId) => {
                  const nextKey = await branchSessionFromCheckpoint(
                    state,
                    sessionKey,
                    checkpointId,
                  );
                  if (nextKey) {
                    switchChatSession(state, nextKey);
                    state.setTab("chat" as import("./navigation.ts").Tab);
                  }
                }),
                onRestoreCheckpoint: (sessionKey, checkpointId) =>
                  void restoreSessionFromCheckpoint(state, sessionKey, checkpointId),
              });
            })
          : nothing}
        ${state.tab === "workboard"
          ? renderWorkboardProductPage(state, navigateProductTab, requestHostUpdate)
          : nothing}
        ${state.tab === "usage"
          ? renderBillingAuthorizationProductPage(state, navigateProductTab)
          : nothing}
        ${state.tab === "reviewCenter"
          ? renderReviewCenter({
              state: state.reviewCenter,
              supportContact: state.supportContact,
              onRefresh: () => state.refreshReviewCenter(),
              onLoadSupportContact: () => state.refreshSupportContact(),
              onSelectRoleReview: (reviewId) => state.selectReviewCenterRoleReview(reviewId),
              onSelectCategoryCapabilityReview: (reviewId) =>
                state.selectReviewCenterCategoryCapabilityReview(reviewId),
              onRoleFilterChange: (filter) => state.setReviewCenterRoleFilter(filter),
              onRoleSearchChange: (search) => state.setReviewCenterRoleSearch(search),
              onRoleSortChange: (sort) => state.setReviewCenterRoleSort(sort),
              onRolePageChange: (page) => state.setReviewCenterRolePage(page),
              onRolePageSizeChange: (pageSize) => state.setReviewCenterRolePageSize(pageSize),
              onCategoryFilterChange: (filter) => state.setReviewCenterCategoryFilter(filter),
              onCategorySearchChange: (search) => state.setReviewCenterCategorySearch(search),
              onCategorySortChange: (sort) => state.setReviewCenterCategorySort(sort),
              onCategoryPageChange: (page) => state.setReviewCenterCategoryPage(page),
              onCategoryPageSizeChange: (pageSize) =>
                state.setReviewCenterCategoryPageSize(pageSize),
              onRunRoleValidation: (reviewId) => state.runRoleReviewValidation(reviewId),
              onApproveRole: (reviewId) => state.approveRoleReview(reviewId),
              onRequestRoleChanges: (reviewId) => state.requestRoleReviewChanges(reviewId),
              onRejectRole: (reviewId) => state.rejectRoleReview(reviewId),
              onApproveCategoryCapability: (reviewId) =>
                state.approveCategoryCapabilityReview(reviewId),
              onRequestCategoryCapabilityChanges: (reviewId) =>
                state.requestCategoryCapabilityChanges(reviewId),
              onRejectCategoryCapability: (reviewId) =>
                state.rejectCategoryCapabilityReview(reviewId),
              onSyncCategoryCapabilityToCloud: (reviewId) =>
                state.syncCategoryCapabilityReviewToCloud(reviewId),
            })
          : nothing}
        ${state.tab === "apiManagement"
          ? renderApiManagementProductPage(state, navigateProductTab)
          : nothing}
        ${state.tab === "cron" ? renderCronQuickCreateForTab(state, requestHostUpdate) : nothing}
        ${state.tab === "cron"
          ? renderLazyView(lazyCron, (m) =>
              m.renderCron({
                basePath: state.basePath,
                loading: state.cronLoading,
                status: state.cronStatus,
                jobs: visibleCronJobs,
                jobsLoadingMore: state.cronJobsLoadingMore,
                jobsTotal: state.cronJobsTotal,
                jobsHasMore: state.cronJobsHasMore,
                jobsQuery: state.cronJobsQuery,
                jobsEnabledFilter: state.cronJobsEnabledFilter,
                jobsScheduleKindFilter: state.cronJobsScheduleKindFilter,
                jobsLastStatusFilter: state.cronJobsLastStatusFilter,
                jobsSortBy: state.cronJobsSortBy,
                jobsSortDir: state.cronJobsSortDir,
                editingJobId: state.cronEditingJobId,
                error: state.cronError,
                busy: state.cronBusy,
                form: state.cronForm,
                cronFormCollapsed: state.cronFormCollapsed,
                channels: state.channelsSnapshot?.channelMeta?.length
                  ? state.channelsSnapshot.channelMeta.map((entry) => entry.id)
                  : (state.channelsSnapshot?.channelOrder ?? []),
                channelLabels: state.channelsSnapshot?.channelLabels ?? {},
                channelMeta: state.channelsSnapshot?.channelMeta ?? [],
                runsJobId: state.cronRunsJobId,
                runs: state.cronRuns,
                runsTotal: state.cronRunsTotal,
                runsHasMore: state.cronRunsHasMore,
                runsLoadingMore: state.cronRunsLoadingMore,
                runsScope: state.cronRunsScope,
                runsStatuses: state.cronRunsStatuses,
                runsDeliveryStatuses: state.cronRunsDeliveryStatuses,
                runsStatusFilter: state.cronRunsStatusFilter,
                runsQuery: state.cronRunsQuery,
                runsSortDir: state.cronRunsSortDir,
                fieldErrors: state.cronFieldErrors,
                canSubmit: !hasCronFormErrors(state.cronFieldErrors),
                agentSuggestions: cronAgentSuggestions,
                modelSuggestions: cronModelSuggestions,
                thinkingSuggestions: CRON_THINKING_SUGGESTIONS,
                timezoneSuggestions: CRON_TIMEZONE_SUGGESTIONS,
                deliveryToSuggestions,
                accountSuggestions,
                onFormChange: (patch) => {
                  state.cronForm = normalizeCronFormState({ ...state.cronForm, ...patch });
                  state.cronFieldErrors = validateCronForm(state.cronForm);
                },
                onRefresh: () => void state.loadCron(),
                onAdd: () => {
                  void (async () => {
                    const saved = await addCronJob(state);
                    if (saved) {
                      state.cronFormCollapsed = true;
                    }
                    requestHostUpdate?.();
                  })();
                },
                onEdit: (job) => {
                  state.cronFormCollapsed = false;
                  startCronEdit(state, job);
                },
                onClone: (job) => {
                  state.cronFormCollapsed = false;
                  startCronClone(state, job);
                },
                onCancelEdit: () => {
                  cancelCronEdit(state);
                  state.cronFormCollapsed = true;
                  requestHostUpdate?.();
                },
                onToggleFormCollapsed: (collapsed) => {
                  state.cronFormCollapsed = collapsed;
                  requestHostUpdate?.();
                },
                onToggle: (job, enabled) => void toggleCronJob(state, job, enabled),
                onRun: (job, mode) => void runCronJob(state, job, mode ?? "force"),
                onRemove: (job) => void removeCronJob(state, job),
                onQuickCreate: () => {
                  state.cronQuickCreateOpen = true;
                  state.cronQuickCreateStep = "what";
                  state.cronQuickCreateDraft = createDefaultDraft();
                  requestHostUpdate?.();
                },
                onLoadRuns: runUiTask(async (jobId) => {
                  updateCronRunsFilter(state, { cronRunsScope: "job" });
                  await loadCronRuns(state, jobId);
                }),
                onLoadMoreJobs: () =>
                  void loadCronJobsPage(state, { append: true, tableFilters: true }),
                onJobsFiltersChange: runUiTask(async (patch) => {
                  updateCronJobsFilter(state, patch);
                  const shouldReload =
                    typeof patch.cronJobsQuery === "string" ||
                    Boolean(patch.cronJobsEnabledFilter) ||
                    Boolean(patch.cronJobsScheduleKindFilter) ||
                    Boolean(patch.cronJobsLastStatusFilter) ||
                    Boolean(patch.cronJobsSortBy) ||
                    Boolean(patch.cronJobsSortDir);
                  if (shouldReload) {
                    await loadCronJobsPage(state, { append: false, tableFilters: true });
                  }
                }),
                onJobsFiltersReset: runUiTask(async () => {
                  updateCronJobsFilter(state, {
                    cronJobsQuery: "",
                    cronJobsEnabledFilter: "all",
                    cronJobsScheduleKindFilter: "all",
                    cronJobsLastStatusFilter: "all",
                    cronJobsSortBy: "nextRunAtMs",
                    cronJobsSortDir: "asc",
                  });
                  await loadCronJobsPage(state, { append: false, tableFilters: true });
                }),
                onLoadMoreRuns: () => void loadMoreCronRuns(state),
                onRunsFiltersChange: runUiTask(async (patch) => {
                  updateCronRunsFilter(state, patch);
                  if (state.cronRunsScope === "all") {
                    await loadCronRuns(state, null);
                    return;
                  }
                  await loadCronRuns(state, state.cronRunsJobId);
                }),
                onNavigateToChat: (sessionKey) => {
                  switchChatSession(state, sessionKey);
                  state.setTab("chat" as import("./navigation.ts").Tab);
                },
              }),
            )
          : nothing}
        ${state.tab === "agents"
          ? renderLazyView(lazyAgents, (m) =>
              m.renderAgents({
                basePath: state.basePath ?? "",
                loading: state.agentsLoading,
                error: state.agentsError,
                agentsList: state.agentsList,
                selectedAgentId: resolvedAgentId,
                activePanel: state.agentsPanel,
                config: {
                  form: configValue,
                  loading: state.configLoading,
                  saving: state.configSaving,
                  dirty: state.configFormDirty,
                },
                channels: {
                  snapshot: state.channelsSnapshot,
                  loading: state.channelsLoading,
                  error: state.channelsError,
                  lastSuccess: state.channelsLastSuccess,
                },
                cron: {
                  status: state.cronStatus,
                  jobs: state.cronJobs,
                  loading: state.cronLoading,
                  error: state.cronError,
                },
                agentFiles: {
                  list: state.agentFilesList,
                  loading: state.agentFilesLoading,
                  error: state.agentFilesError,
                  active: state.agentFileActive,
                  contents: state.agentFileContents,
                  drafts: state.agentFileDrafts,
                  saving: state.agentFileSaving,
                },
                agentIdentityLoading: state.agentIdentityLoading,
                agentIdentityError: state.agentIdentityError,
                agentIdentityById: state.agentIdentityById,
                agentSkills: {
                  report: state.agentSkillsReport,
                  loading: state.agentSkillsLoading,
                  error: state.agentSkillsError,
                  agentId: state.agentSkillsAgentId,
                  filter: state.skillsFilter,
                },
                toolsCatalog: {
                  loading: state.toolsCatalogLoading,
                  error: state.toolsCatalogError,
                  result: state.toolsCatalogResult,
                },
                toolsEffective: {
                  loading: state.toolsEffectiveLoading,
                  error: state.toolsEffectiveError,
                  result: state.toolsEffectiveResult,
                },
                runtimeSessionKey: state.sessionKey,
                runtimeSessionMatchesSelectedAgent: toolsPanelUsesActiveSession,
                modelCatalog: state.chatModelCatalog ?? [],
                onRefresh: runUiTask(async () => {
                  await loadAgents(state);
                  const agentIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
                  if (agentIds.length > 0) {
                    void loadAgentIdentities(state, agentIds);
                  }
                  loadAgentPanelDataForSelectedAgent(resolveSelectedAgentId());
                  refreshAgentsPanelSupplementalData(state.agentsPanel);
                }),
                onSelectAgent: (agentId) => {
                  if (state.agentsSelectedId === agentId) {
                    return;
                  }
                  state.agentsSelectedId = agentId;
                  resetAgentSelectionPanelState();
                  void loadAgentIdentity(state, agentId);
                  loadAgentPanelDataForSelectedAgent(agentId);
                },
                onSelectPanel: (panel) => {
                  state.agentsPanel = panel;
                  if (
                    panel === "files" &&
                    resolvedAgentId &&
                    state.agentFilesList?.agentId !== resolvedAgentId
                  ) {
                    resetAgentFilesState();
                    void loadAgentFiles(state, resolvedAgentId);
                  }
                  if (panel === "skills" && resolvedAgentId) {
                    void loadAgentSkills(state, resolvedAgentId);
                  }
                  if (panel === "tools" && resolvedAgentId) {
                    if (
                      state.toolsCatalogResult?.agentId !== resolvedAgentId ||
                      state.toolsCatalogError
                    ) {
                      void loadToolsCatalog(state, resolvedAgentId);
                    }
                    if (resolvedAgentId === chatAgentId) {
                      const toolsRequestKey = buildToolsEffectiveRequestKey(state, {
                        agentId: resolvedAgentId,
                        sessionKey: state.sessionKey,
                      });
                      if (
                        state.toolsEffectiveResultKey !== toolsRequestKey ||
                        state.toolsEffectiveError
                      ) {
                        void loadToolsEffective(state, {
                          agentId: resolvedAgentId,
                          sessionKey: state.sessionKey,
                        });
                      }
                    } else {
                      resetToolsEffectiveState(state);
                    }
                  }
                  refreshAgentsPanelSupplementalData(panel);
                },
                onLoadFiles: (agentId) => void loadAgentFiles(state, agentId),
                onSelectFile: (name) => {
                  state.agentFileActive = name;
                  if (!resolvedAgentId) {
                    return;
                  }
                  void loadAgentFileContent(state, resolvedAgentId, name);
                },
                onFileDraftChange: (name, content) => {
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
                },
                onFileReset: (name) => {
                  const base = state.agentFileContents[name] ?? "";
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: base };
                },
                onFileSave: (name) => {
                  if (!resolvedAgentId) {
                    return;
                  }
                  const content =
                    state.agentFileDrafts[name] ?? state.agentFileContents[name] ?? "";
                  void saveAgentFile(state, resolvedAgentId, name, content);
                },
                onToolsProfileChange: (agentId, profile, clearAllow) => {
                  const basePathItem = resolveAgentToolsPath(
                    agentId,
                    Boolean(profile || clearAllow),
                  );
                  if (!basePathItem) {
                    return;
                  }
                  if (profile) {
                    updateConfigFormValue(state, [...basePathItem, "profile"], profile);
                  } else {
                    removeConfigFormValue(state, [...basePathItem, "profile"]);
                  }
                  if (clearAllow) {
                    removeConfigFormValue(state, [...basePathItem, "allow"]);
                  }
                },
                onToolsOverridesChange: (agentId, alsoAllow, deny) => {
                  const basePathCandidate = resolveAgentToolsPath(
                    agentId,
                    alsoAllow.length > 0 || deny.length > 0,
                  );
                  if (!basePathCandidate) {
                    return;
                  }
                  if (alsoAllow.length > 0) {
                    updateConfigFormValue(state, [...basePathCandidate, "alsoAllow"], alsoAllow);
                  } else {
                    removeConfigFormValue(state, [...basePathCandidate, "alsoAllow"]);
                  }
                  if (deny.length > 0) {
                    updateConfigFormValue(state, [...basePathCandidate, "deny"], deny);
                  } else {
                    removeConfigFormValue(state, [...basePathCandidate, "deny"]);
                  }
                },
                onConfigReload: () => void loadConfig(state, { discardPendingChanges: true }),
                onConfigSave: () => void saveAgentsConfig(state),
                onChannelsRefresh: () => void loadChannels(state, false),
                onCronRefresh: () => void state.loadCron(),
                onCronRunNow: (jobId) => {
                  const job = state.cronJobs.find((entry) => entry.id === jobId);
                  if (!job) {
                    return;
                  }
                  void runCronJob(state, job, "force");
                },
                onSkillsFilterChange: (next) => (state.skillsFilter = next),
                onSkillsRefresh: () => {
                  if (resolvedAgentId) {
                    void loadAgentSkills(state, resolvedAgentId);
                  }
                },
                onAgentSkillToggle: (agentId, skillName, enabled) => {
                  const index = ensureAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const list = (getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null)
                    ?.agents?.list;
                  const entry = Array.isArray(list)
                    ? (list[index] as { skills?: unknown })
                    : undefined;
                  const normalizedSkill = skillName.trim();
                  if (!normalizedSkill) {
                    return;
                  }
                  const allSkills =
                    state.agentSkillsReport?.skills?.map((skill) => skill.name).filter(Boolean) ??
                    [];
                  const existing = Array.isArray(entry?.skills)
                    ? normalizeStringEntries(entry.skills)
                    : undefined;
                  const base = existing ?? allSkills;
                  const next = new Set(base);
                  if (enabled) {
                    next.add(normalizedSkill);
                  } else {
                    next.delete(normalizedSkill);
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], [...next]);
                },
                onAgentSkillsClear: (agentId) => {
                  const index = findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  removeConfigFormValue(state, ["agents", "list", index, "skills"]);
                },
                onAgentSkillsDisableAll: (agentId) => {
                  const index = ensureAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], []);
                },
                onModelChange: (agentId, modelId) => {
                  const index = modelId ? ensureAgentIndex(agentId) : findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const modelEntry = resolveAgentModelFormEntry(index);
                  const { basePath: basePathEntry, existing } = modelEntry;
                  if (!modelId) {
                    removeConfigFormValue(state, basePathEntry);
                  } else if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                    const fallbacks = (existing as { fallbacks?: unknown }).fallbacks;
                    const next = {
                      primary: modelId,
                      ...(Array.isArray(fallbacks) ? { fallbacks } : {}),
                    };
                    updateConfigFormValue(state, basePathEntry, next);
                  } else {
                    updateConfigFormValue(state, basePathEntry, modelId);
                  }
                  void refreshVisibleToolsEffectiveForCurrentSession(state);
                },
                onModelFallbacksChange: (agentId, fallbacks) => {
                  const normalized = normalizeStringEntries(fallbacks);
                  const currentConfig = getCurrentConfigValue();
                  const resolvedConfig = resolveAgentConfig(currentConfig, agentId);
                  const effectivePrimary =
                    resolveModelPrimary(resolvedConfig.entry?.model) ??
                    resolveModelPrimary(resolvedConfig.defaults?.model);
                  const effectiveFallbacks = resolveEffectiveModelFallbacks(
                    resolvedConfig.entry?.model,
                    resolvedConfig.defaults?.model,
                  );
                  const index =
                    normalized.length > 0
                      ? effectivePrimary
                        ? ensureAgentIndex(agentId)
                        : -1
                      : (effectiveFallbacks?.length ?? 0) > 0 || findAgentIndex(agentId) >= 0
                        ? ensureAgentIndex(agentId)
                        : -1;
                  if (index < 0) {
                    return;
                  }
                  const { basePath: basePathResult, existing } = resolveAgentModelFormEntry(index);
                  const resolvePrimary = () => {
                    if (typeof existing === "string") {
                      return existing.trim() || null;
                    }
                    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                      const primary = (existing as { primary?: unknown }).primary;
                      if (typeof primary === "string") {
                        const trimmed = primary.trim();
                        return trimmed || null;
                      }
                    }
                    return null;
                  };
                  const primary = resolvePrimary() ?? effectivePrimary;
                  if (normalized.length === 0) {
                    if (primary) {
                      updateConfigFormValue(state, basePathResult, primary);
                    } else {
                      removeConfigFormValue(state, basePathResult);
                    }
                    return;
                  }
                  if (!primary) {
                    return;
                  }
                  updateConfigFormValue(state, basePathResult, { primary, fallbacks: normalized });
                },
                onSetDefault: (agentId) => {
                  stageDefaultAgentConfigEntry(state, agentId);
                },
              }),
            )
          : nothing}
        ${state.tab === "skills" ? renderToolSupplyFourPage(state, navigateProductTab) : nothing}
        ${state.tab === "nodes"
          ? renderLazyView(lazyNodes, (m) =>
              m.renderNodes({
                loading: state.nodesLoading,
                nodes: state.nodes,
                devicesLoading: state.devicesLoading,
                devicesError: state.devicesError,
                devicesList: state.devicesList,
                configForm:
                  state.configForm ??
                  (state.configSnapshot?.config as Record<string, unknown> | null),
                configLoading: state.configLoading,
                configSaving: state.configSaving,
                configDirty: state.configFormDirty,
                configFormMode: state.configFormMode,
                execApprovalsLoading: state.execApprovalsLoading,
                execApprovalsSaving: state.execApprovalsSaving,
                execApprovalsDirty: state.execApprovalsDirty,
                execApprovalsSnapshot: state.execApprovalsSnapshot,
                execApprovalsForm: state.execApprovalsForm,
                execApprovalsSelectedAgent: state.execApprovalsSelectedAgent,
                execApprovalsTarget: state.execApprovalsTarget,
                execApprovalsTargetNodeId: state.execApprovalsTargetNodeId,
                onRefresh: () => void loadNodes(state),
                onDevicesRefresh: () => void loadDevices(state),
                onDeviceApprove: (requestId) => void approveDevicePairing(state, requestId),
                onDeviceReject: (requestId) => void rejectDevicePairing(state, requestId),
                onDeviceRotate: (deviceId, role, scopes) =>
                  void rotateDeviceToken(state, { deviceId, role, scopes }),
                onDeviceRevoke: (deviceId, role) =>
                  void revokeDeviceToken(state, { deviceId, role }),
                onLoadConfig: () => void loadConfig(state, { discardPendingChanges: true }),
                onLoadExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  void loadExecApprovals(state, target);
                },
                onBindDefault: (nodeId) => {
                  if (nodeId) {
                    updateConfigFormValue(state, ["tools", "exec", "node"], nodeId);
                  } else {
                    removeConfigFormValue(state, ["tools", "exec", "node"]);
                  }
                },
                onBindAgent: (agentIndex, nodeId) => {
                  const basePathLocal = ["agents", "list", agentIndex, "tools", "exec", "node"];
                  if (nodeId) {
                    updateConfigFormValue(state, basePathLocal, nodeId);
                  } else {
                    removeConfigFormValue(state, basePathLocal);
                  }
                },
                onSaveBindings: () => void saveConfig(state),
                onExecApprovalsTargetChange: (kind, nodeId) => {
                  state.execApprovalsTarget = kind;
                  state.execApprovalsTargetNodeId = nodeId;
                  state.execApprovalsSnapshot = null;
                  state.execApprovalsForm = null;
                  state.execApprovalsDirty = false;
                  state.execApprovalsSelectedAgent = null;
                },
                onExecApprovalsSelectAgent: (agentId) => {
                  state.execApprovalsSelectedAgent = agentId;
                },
                onExecApprovalsPatch: (path, value) =>
                  updateExecApprovalsFormValue(state, path, value),
                onExecApprovalsRemove: (path) => removeExecApprovalsFormValue(state, path),
                onSaveExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  void saveExecApprovals(state, target);
                },
              }),
            )
          : nothing}
        ${state.tab === "chat"
          ? renderMeasured(
              state,
              "chat",
              {
                messageCount: state.chatMessages.length,
                toolMessageCount: state.chatToolMessages.length,
                streamSegmentCount: state.chatStreamSegments.length,
                queueCount: state.chatQueue.length,
              },
              () =>
                renderChat({
                  sessionKey: state.sessionKey,
                  onSessionKeyChange: (next) => {
                    switchChatSession(state, next);
                  },
                  thinkingLevel: state.chatThinkingLevel,
                  showThinking,
                  showToolCalls,
                  loading: state.chatLoading,
                  sending: state.chatSending,
                  compactionStatus: state.compactionStatus,
                  fallbackStatus: state.fallbackStatus,
                  assistantAvatarUrl: chatAvatarUrl,
                  messages: state.chatMessages,
                  sideResult: state.chatSideResult,
                  toolMessages: state.chatToolMessages,
                  streamSegments: state.chatStreamSegments,
                  stream: state.chatStream,
                  streamStartedAt: state.chatStreamStartedAt,
                  draft: state.chatMessage,
                  aicsMode: state.aicsConversationMode,
                  aicsStage: state.aicsConversationStage,
                  accountGoalMode: (
                    state.aicsMainFlow?.readModel as Record<string, unknown> | null | undefined
                  )?.accountGoalMode as Parameters<typeof renderChat>[0]["accountGoalMode"],
                  onAicsModeChange: (mode) => state.setAicsConversationMode(mode),
                  developerModePanel:
                    state.aicsConversationMode === "developer"
                      ? renderBuildSessionWizard(state, state.buildSession, requestHostUpdate)
                      : nothing,
                  onNavigate: navigateProductTab,
                  queue: state.chatQueue,
                  realtimeTalkActive: state.realtimeTalkActive,
                  realtimeTalkStatus: state.realtimeTalkStatus,
                  realtimeTalkDetail: state.realtimeTalkDetail,
                  realtimeTalkTranscript: state.realtimeTalkTranscript,
                  realtimeTalkConversation: state.realtimeTalkConversation,
                  realtimeTalkOptionsOpen: state.realtimeTalkOptionsOpen,
                  realtimeTalkOptions: state.realtimeTalkOptions,
                  connected: state.connected,
                  canSend: state.connected,
                  disabledReason: chatDisabledReason,
                  error: chatViewError,
                  runStatus: state.chatRunStatus,
                  onDismissError: () => dismissChatError(state),
                  sessions: state.sessionsResult,
                  composerControls: renderGuardedChatControls(state),
                  workspaceFiles: CHAT_WORKSPACE_FILE_RAIL_ENABLED
                    ? {
                        agentId: chatAgentId,
                        list:
                          chatWorkspaceFiles.list?.agentId === chatAgentId
                            ? chatWorkspaceFiles.list
                            : null,
                        loading: chatWorkspaceFiles.loading,
                        error: chatWorkspaceFiles.error,
                        activeName: chatWorkspaceFiles.activeName,
                        onRefresh: refreshChatWorkspaceFiles,
                        onOpenFile: openChatWorkspaceFile,
                      }
                    : undefined,
                  autoExpandToolCalls: false,
                  onRefresh: () => {
                    state.chatSideResult = null;
                    state.resetToolStream();
                    void refreshChat(state, { awaitHistory: true, scheduleScroll: false });
                  },
                  onChatScroll: (event) => state.handleChatScroll(event),
                  getDraft: () => state.chatMessage,
                  onDraftChange: (next) => state.handleChatDraftChange(next),
                  onRequestUpdate: requestHostUpdate,
                  onHistoryKeydown: (input) => state.handleChatInputHistoryKey(input),
                  attachments: state.chatAttachments,
                  onAttachmentsChange: (next) => (state.chatAttachments = next),
                  onSend: () => void state.handleSendChat(),
                  onCompact: () => void state.handleSendChat("/compact", { restoreDraft: true }),
                  onOpenSessionCheckpoints: () => {
                    state.sessionsExpandedCheckpointKey = state.sessionKey;
                    state.setTab("sessions" as import("./navigation.ts").Tab);
                    void loadSessions(state, {
                      ...createChatSessionsLoadOverrides(state),
                      ...scopedAgentListParamsForSession(state, state.sessionKey),
                    });
                  },
                  onToggleRealtimeTalk: () => void state.toggleRealtimeTalk(),
                  onToggleRealtimeTalkOptions: () => {
                    state.realtimeTalkOptionsOpen = !state.realtimeTalkOptionsOpen;
                  },
                  onRealtimeTalkOptionsChange: (next) => state.updateRealtimeTalkOptions(next),
                  canAbort: hasAbortableSessionRun(state),
                  onAbort: () => void state.handleAbortChat({ preserveDraft: true }),
                  onQueueRemove: (id) => state.removeQueuedMessage(id),
                  onQueueRetry: (id) => void state.retryQueuedChatMessage(id),
                  onQueueSteer: (id) => void state.steerQueuedChatMessage(id),
                  onDismissSideResult: () => {
                    state.chatSideResult = null;
                  },
                  onNewSession: () => void createChatSession(state),
                  onClearHistory: runUiTask(async () => {
                    if (!state.client || !state.connected) {
                      return;
                    }
                    const hadActiveRun = hasAbortableSessionRun(state);
                    try {
                      await state.client.request("sessions.reset", {
                        key: state.sessionKey,
                        ...scopedAgentParamsForSession(state, state.sessionKey),
                      });
                      state.chatMessages = [];
                      state.chatSideResult = null;
                      reconcileChatRunLifecycle(
                        state as unknown as Parameters<typeof reconcileChatRunLifecycle>[0],
                        {
                          outcome: hadActiveRun ? "interrupted" : undefined,
                          sessionStatus: "killed",
                          runId: state.chatRunId,
                          sessionKey: state.sessionKey,
                          clearLocalRun: true,
                          clearChatStream: true,
                          clearToolStream: true,
                          clearSideResultTerminalRuns: true,
                          clearRunStatus: !hadActiveRun,
                        },
                      );
                      await loadChatHistory(state);
                    } catch (err) {
                      state.lastError = String(err);
                      state.chatError = state.lastError;
                    }
                  }),
                  agentsList: state.agentsList,
                  currentAgentId: chatAgentId,
                  fullMessageAgentId: scopedAgentParamsForSession(state, state.sessionKey).agentId,
                  onAgentChange: (agentId: string) => {
                    switchChatSession(state, buildAgentMainSessionKey({ agentId }));
                  },
                  onNavigateToAgent: () => {
                    state.agentsSelectedId = resolvedAgentId;
                    state.setTab("agents" as import("./navigation.ts").Tab);
                  },
                  onSessionSelect: (key: string) => {
                    switchChatSession(state, key);
                  },
                  showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
                  onScrollToBottom: () => state.scrollToBottom(),
                  // Sidebar props for tool output viewing
                  sidebarOpen: state.sidebarOpen,
                  sidebarContent: state.sidebarContent,
                  sidebarError: state.sidebarError,
                  splitRatio: state.splitRatio,
                  canvasPluginSurfaceUrl: state.hello?.pluginSurfaceUrls?.canvas ?? null,
                  onOpenSidebar: (content) => state.handleOpenSidebar(content),
                  onCloseSidebar: () => state.handleCloseSidebar(),
                  onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
                  assistantName: state.assistantName,
                  assistantAvatar: effectiveAssistantAvatar,
                  userName: state.userName ?? null,
                  userAvatar: state.userAvatar ?? null,
                  localMediaPreviewRoots: state.localMediaPreviewRoots,
                  embedSandboxMode: state.embedSandboxMode,
                  allowExternalEmbedUrls: state.allowExternalEmbedUrls,
                  assistantAttachmentAuthToken: resolveAssistantAttachmentAuthToken(state),
                  basePath: state.basePath ?? "",
                }),
            )
          : nothing}
        ${isConfigSettingsTab(state.tab)
          ? renderSettingsWorkspace(state, renderConfigTabForActiveTab())
          : nothing}
        ${state.tab === "debug"
          ? renderSettingsWorkspace(
              state,
              renderLazyView(lazyDebug, (m) =>
                m.renderDebug({
                  loading: state.debugLoading,
                  status: state.debugStatus,
                  health: state.debugHealth,
                  models: state.debugModels,
                  heartbeat: state.debugHeartbeat,
                  eventLog: state.eventLog,
                  methods: (state.hello?.features?.methods ?? []).toSorted(),
                  callMethod: state.debugCallMethod,
                  callParams: state.debugCallParams,
                  callResult: state.debugCallResult,
                  callError: state.debugCallError,
                  onCallMethodChange: (next) => (state.debugCallMethod = next),
                  onCallParamsChange: (next) => (state.debugCallParams = next),
                  onRefresh: () => void loadDebug(state),
                  onCall: () => void callDebugMethod(state),
                }),
              ),
            )
          : nothing}
        ${state.tab === "logs"
          ? renderSettingsWorkspace(
              state,
              renderLazyView(lazyLogs, (m) =>
                m.renderLogs({
                  loading: state.logsLoading,
                  error: state.logsError,
                  file: state.logsFile,
                  entries: state.logsEntries,
                  filterText: state.logsFilterText,
                  levelFilters: state.logsLevelFilters,
                  autoFollow: state.logsAutoFollow,
                  truncated: state.logsTruncated,
                  onFilterTextChange: (next) => (state.logsFilterText = next),
                  onLevelToggle: (level, enabled) => {
                    state.logsLevelFilters = { ...state.logsLevelFilters, [level]: enabled };
                  },
                  onToggleAutoFollow: (next) => (state.logsAutoFollow = next),
                  onRefresh: () => void loadLogs(state, { reset: true }),
                  onExport: (lines, label) => state.exportLogs(lines, label),
                  onScroll: (event) => state.handleLogsScroll(event),
                }),
              ),
            )
          : nothing}
        ${state.tab === "dreams"
          ? renderMemoryEvolutionProductPage(state, navigateProductTab)
          : nothing}
      </main>
      ${renderExecApprovalPrompt(state)} ${renderGatewayUrlConfirmation(state)}
      ${renderDreamingRestartConfirmation({
        open: state.dreamingRestartConfirmOpen,
        loading: state.dreamingRestartConfirmLoading,
        onConfirm: confirmDreamingRestart,
        onCancel: cancelDreamingRestart,
        hasError: Boolean(state.dreamingStatusError),
      })}
      ${nothing}
    </div>
  `;
}
