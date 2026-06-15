import { html, nothing } from "lit";
import { guard } from "lit/directives/guard.js";
import { styleMap } from "lit/directives/style-map.js";
import { i18n, t } from "../i18n/index.ts";
import { getSafeLocalStorage } from "../local-storage.ts";
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
import { hasOperatorWriteAccess, warnQueryToken } from "./app-settings.ts";
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
import { aicsMainFlow } from "./controllers/aics-main-flow.ts";
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
import type { ToolSupplyControlItem } from "./controllers/tool-supply-control.ts";
import { captureSessionToWorkboard, getWorkboardState } from "./controllers/workboard.ts";
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
import { isPluginEnabledInConfigSnapshot } from "./plugin-activation.ts";
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
  return `$${Math.max(0, Number(value)).toFixed(2)}`;
}

function toolSupplyStatusLabel(status: ToolSupplyControlItem["status"]) {
  switch (status) {
    case "available":
      return "可供给";
    case "blocked":
      return "已阻塞";
    case "disabled":
      return "已禁用";
    case "pending_review":
      return "待审核";
    case "needs_setup":
      return "待配置";
    default:
      return status;
  }
}

function toolSupplyKindLabel(kind: ToolSupplyControlItem["kind"]) {
  switch (kind) {
    case "core_tool":
      return "OpenClaw 核心工具";
    case "plugin_tool":
      return "插件工具";
    case "skill":
      return "Skill";
    case "api_connection":
      return "API 绑定";
    case "cloud_capability":
      return "云端商城能力";
  }
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

function renderBusinessOverviewPage(state: AppViewState, requestHostUpdate?: () => void) {
  const mf = state.aicsMainFlow;
  const readModel = mf?.readModel as Record<string, unknown> | null;
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
      next: "发起经营意图后生成初始观察包",
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
      next: "确认正式 CompanyGoal",
    },
    {
      title: "规划方案",
      count: counts.planningPackages ?? 0,
      ready: readiness.canCreateDispatchProposal === true,
      next: "确认 PlanningPackage 与 RolePlanItem",
    },
    {
      title: "任务调度",
      count: counts.dispatchProposalReviews ?? 0,
      ready: readiness.canMaterializeTaskPackage === true,
      next: "确认调度评审后物化任务包",
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
    <div
      style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(320px,1.2fr);gap:16px;margin-bottom:16px"
    >
      <section style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px">
        <div style="font-weight:700;margin-bottom:6px">发起经营意图</div>
        <div style="font-size:12px;color:var(--text-secondary,#666);margin-bottom:10px">
          这里不会直接定目标或调岗位，只会生成观察层的初始数据包。
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
            ?disabled=${loading || !draft.trim()}
            style="padding:7px 14px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:${loading ||
            !draft.trim()
              ? "not-allowed"
              : "pointer"};font-size:12px;opacity:${loading || !draft.trim() ? 0.55 : 1}"
          >
            发起经营意图
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
                    ${reason.stage} · ${reason.code}：${reason.message}
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

function renderObservationPage(state: AppViewState, requestHostUpdate?: () => void) {
  const mf = state.aicsMainFlow;
  const readModel = mf?.readModel as Record<string, unknown> | null;
  const counts = (readModel?.counts ?? {}) as Record<string, number>;
  const latest = (readModel?.latest ?? {}) as Record<string, unknown>;
  const obs = latest.observationPackage as Record<string, unknown> | null;
  const blocked = ((readModel?.blockedReasons ?? []) as Array<Record<string, unknown>>).filter(
    (r: Record<string, unknown>) => r.stage === "observation",
  );
  const signals = (obs?.signals ?? []) as Array<Record<string, unknown>>;
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
              html`<div style="font-size:13px;color:#c05621">⚠ ${b.message} (${b.code})</div>`,
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
            ? signals.map(
                (s: Record<string, unknown>) => html`<div
                  style="padding:7px 0;font-size:12px;border-bottom:1px solid var(--border-color,#f0f0f0)"
                >
                  <div style="display:flex;justify-content:space-between;gap:8px">
                    <strong>${s.title}</strong
                    ><span style="color:var(--text-secondary,#999)"
                      >${(s.evidenceRefs as Array<unknown>)?.length ?? 0} 证据</span
                    >
                  </div>
                  <div style="color:var(--text-secondary,#777);margin-top:2px">${s.summary}</div>
                </div>`,
              )
            : html`<div
                style="padding:8px;background:#fffaf0;border:1px solid #dd6b20;border-radius:6px;font-size:12px;color:#c05621"
              >
                观察信号为空，不能进入归因分析。请从「经营概览」发起经营意图生成初始观察包。
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
            先在「经营概览」发起经营意图，系统会创建包含意图、观察范围、数据缺口和可信度的初始观察包。
          </p>
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
  const blocked = ((readModel?.blockedReasons ?? []) as Array<Record<string, unknown>>).filter(
    (r: Record<string, unknown>) => r.stage === "observation",
  );
  const canPrepareAttribution = readiness.canPrepareAttribution === true;
  const findings = (attr?.findings ?? []) as Array<Record<string, unknown>>;
  const causeHits = MARKETPLACE_ATTRIBUTION_VIEW_CAUSES.filter((cause) =>
    findings.some(
      (finding) =>
        String(finding.title ?? "").includes(cause) ||
        String(finding.summary ?? "").includes(cause),
    ),
  ).length;

  return html`<div style="padding:16px;max-width:900px;margin:0 auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h1 style="font-size:20px;margin:0">归因分析</h1>
      <div style="display:flex;gap:8px">
        <button
          @click=${() =>
            aicsMainFlow
              .prepareAttribution(
                state,
                "上一轮目标归因报告",
                "归因层复盘上一轮目标完成情况、差距、问题来源、置信度和影响程度。",
              )
              .then(() => requestHostUpdate?.())}
          style="padding:6px 12px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
          ?disabled=${!canPrepareAttribution}
        >
          生成归因报告
        </button>
        <button
          @click=${() => state.refreshAicsMainFlowReadModel?.()}
          style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
        >
          刷新
        </button>
      </div>
    </div>
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
              html`<div style="font-size:13px;color:#c05621">⚠ ${b.message} (${b.code})</div>`,
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
              确认归因报告
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
                <strong>${f.title}</strong
                ><span
                  style="margin-left:8px;color:${f.confidence === "high"
                    ? "#38a169"
                    : f.confidence === "medium"
                      ? "#dd6b20"
                      : "#a0aec0"}"
                  >置信:${f.confidence}</span
                >
                <div style="color:var(--text-secondary,#888);margin-top:2px">${f.summary}</div>
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
          <p style="font-size:12px;margin:0">
            先创建数据分析包（ObservationPackage），系统将自动生成归因报告。
          </p>
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
  _onNavigate: (tab: Tab) => void,
  requestHostUpdate?: () => void,
) {
  const gs = state.goalsState ?? (state.goalsState = createDefaultGoalsPageState());
  const mf = state.aicsMainFlow;
  const readModel = mf?.readModel as Record<string, unknown> | null;
  const view = deriveGoalView(readModel);
  const goal = view.goal;
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
    const target = String(g.target ?? "-");
    const rationale = String(g.rationale ?? "");
    const id = String(g.id ?? "");
    const isConfirmed = status === "confirmed";
    const isRejected = status === "rejected";
    const auditCount = Array.isArray(g.auditRefs) ? g.auditRefs.length : 0;

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
              指标：${metric} | 目标：${target} | 负责人：${owner}
            </div>
            ${rationale
              ? html`<div style="font-size:12px;color:var(--text-secondary,#888);margin-bottom:4px">
                  理由：${rationale}
                </div>`
              : nothing}
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
        <h1 style="font-size:20px;margin:0">目标管理</h1>
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
            @click=${() => {
              openGoalForm(gs);
              requestHostUpdate?.();
            }}
            style="padding:6px 16px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px"
            ?disabled=${!view.canCreate}
          >
            + 创建候选目标
          </button>
        </div>
      </div>

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
              ${goalBlocked.map((b) => html`<div>⚠️ ${b.message}</div>`)}
              <div style="margin-top:4px;font-size:11px;color:var(--text-secondary,#666)">
                目标层被阻塞。请先在「流程看板」中完成前置阶段。
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
                ? "可规划"
                : String(goal.status)
              : "无目标",
            warn: !goal,
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
                  placeholder="目标值（如：首批岗位可授权、可执行、可回写）"
                  .value=${gs.form.target}
                  @input=${(e: InputEvent) => {
                    updateGoalFormField(gs, "target", (e.target as HTMLInputElement).value);
                    requestHostUpdate?.();
                  }}
                  style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
                />
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
            <p style="font-size:16px;margin-bottom:8px">暂无目标</p>
            <p style="font-size:13px">
              公司目标由 AI 从归因报告自动生成候选，经人工确认后进入规划层。
            </p>
            <p style="font-size:12px;color:var(--text-secondary,#999)">
              也点击「创建候选目标」手动提交。
            </p>
          </div>`
        : renderGoalCard(goal)}
    </div>
  `;
}

function renderCompanyManagementProductPage(
  state: AppViewState,
  onNavigate: (tab: Tab) => void,
  _requestHostUpdate?: () => void,
) {
  const workboardState = getWorkboardState(state);
  const flow = buildBusinessFlowProjection(state.businessFlow);
  const activeCards = workboardState.cards.filter((card) => !card.metadata?.archivedAt);
  const cardsByProject = (projectIds: string[]) =>
    activeCards.filter((card) => {
      const projectId = card.metadata?.businessFlow?.projectId;
      return projectId ? projectIds.includes(projectId) : false;
    });
  const doneWeight = (status: string) => {
    switch (status) {
      case "done":
        return 100;
      case "review":
        return 82;
      case "running":
        return 58;
      case "ready":
      case "scheduled":
        return 42;
      case "blocked":
        return 12;
      default:
        return 24;
    }
  };
  const statusLabel = (status: string) => {
    switch (status) {
      case "done":
        return "已完成";
      case "review":
        return "待确认";
      case "running":
        return "执行中";
      case "ready":
        return "可调度";
      case "scheduled":
        return "已排期";
      case "blocked":
        return "阻塞";
      default:
        return "待调度";
    }
  };
  const statusColor = (status: string) => {
    switch (status) {
      case "done":
        return "#2f855a";
      case "review":
        return "#b7791f";
      case "running":
      case "ready":
      case "scheduled":
        return "#2b6cb0";
      case "blocked":
        return "#c53030";
      default:
        return "#4a5568";
    }
  };
  const averageProgress = (cards: typeof activeCards, fallback: number) => {
    if (!cards.length) return fallback;
    return Math.round(cards.reduce((sum, card) => sum + doneWeight(card.status), 0) / cards.length);
  };

  const workstreams = [
    {
      id: "role-supply",
      title: "岗位供给",
      projectIds: ["project-channel-growth"],
      summary: "梳理首批岗位商品的数量、能力标签、上架状态和供给缺口。",
      fallbackProgress: 65,
      roles: [
        { title: "数据分析", progress: 70, status: "执行中", task: "盘点首批岗位供给和能力标签" },
        {
          title: "岗位审核",
          progress: 58,
          status: "待确认",
          task: "复核岗位包、能力目录和上架资料",
        },
        { title: "商城运营", progress: 68, status: "执行中", task: "整理可用岗位商品清单" },
      ],
      tasks: ["首批岗位商品清单", "能力标签和品类归属", "待审核/待补齐岗位列表"],
      blocker: "部分岗位的能力边界和上架资料还需要确认。",
    },
    {
      id: "role-listing-conversion",
      title: "岗位商品表达",
      projectIds: ["project-product-launch"],
      summary: "优化岗位商品的能力说明、授权说明、输出样例和可调用边界。",
      fallbackProgress: 80,
      roles: [
        {
          title: "产品设计",
          progress: 86,
          status: "执行中",
          task: "岗位商品信息架构和授权说明优化",
        },
        {
          title: "商品运营",
          progress: 76,
          status: "执行中",
          task: "岗位标题、能力卖点和价格说明维护",
        },
        { title: "文案策划", progress: 78, status: "可调度", task: "岗位边界、输出样例和授权话术" },
      ],
      tasks: ["首批岗位商品说明结构优化", "岗位能力和输出样例补齐", "授权转化说明重写"],
      blocker: "部分岗位缺少示例产物和失败边界说明。",
    },
    {
      id: "execution-quality",
      title: "执行质量",
      projectIds: ["project-product-launch", "project-ops-rhythm"],
      summary: "跟踪岗位执行成功率、失败原因、产物回写和用户反馈。",
      fallbackProgress: 45,
      roles: [
        { title: "数据分析", progress: 48, status: "待确认", task: "执行成功率和失败模式分析" },
        { title: "岗位执行", progress: 52, status: "执行中", task: "核对产物、审计和记忆候选回写" },
        { title: "客服", progress: 35, status: "待调度", task: "收集授权后使用反馈和问题" },
      ],
      tasks: ["执行成功率看板", "失败原因周复盘", "产物回写与记忆候选检查"],
      blocker: "真实执行样本和用户反馈仍需补齐。",
    },
    {
      id: "authorization-billing",
      title: "授权费用",
      projectIds: ["project-key-account-delivery"],
      summary: "治理岗位授权、执行确认、费用确认和 ledger 记录。",
      fallbackProgress: 40,
      roles: [
        { title: "费用治理", progress: 45, status: "待调度", task: "检查授权和费用确认闸门" },
        { title: "平台运营", progress: 38, status: "待确认", task: "核对一次授权费和岗位运行计费" },
        { title: "数据分析", progress: 42, status: "执行中", task: "追踪授权转化和费用消耗" },
      ],
      tasks: ["授权状态检查", "费用确认闸门", "ledger 和审计引用回写"],
      blocker: "真实支付不在 v1，本轮只做授权和费用确认闭环。",
    },
    {
      id: "review-governance",
      title: "审核治理",
      projectIds: ["project-delivery-process", "project-ops-rhythm"],
      summary: "处理岗位审核、能力目录、云端岗位桥和本地调度之间的确认点。",
      fallbackProgress: 70,
      roles: [
        { title: "审核运营", progress: 72, status: "执行中", task: "岗位上架和能力审核阻塞处理" },
        {
          title: "云端岗位桥",
          progress: 74,
          status: "执行中",
          task: "同步授权、审计和执行 token 状态",
        },
        {
          title: "系统设置",
          progress: 64,
          status: "待确认",
          task: "确认本地 workspace、API 和执行策略",
        },
      ],
      tasks: ["审核阻塞清单", "能力目录匹配", "云端桥接和本地调度确认点"],
      blocker: "部分云端授权和本地执行状态仍需人工确认。",
    },
  ].map((workstream) => {
    const cards = cardsByProject(workstream.projectIds);
    const relatedProjects = flow.projects.filter((project) =>
      workstream.projectIds.includes(project.id),
    );
    const blockedCards = cards.filter((card) => card.status === "blocked");
    const reviewCards = cards.filter((card) => card.status === "review");
    return {
      ...workstream,
      cards,
      relatedProjects,
      progress: averageProgress(cards, workstream.fallbackProgress),
      status: blockedCards.length
        ? "阻塞"
        : reviewCards.length
          ? "待确认"
          : cards.some((card) => card.status === "running")
            ? "执行中"
            : "推进中",
    };
  });

  const totalRoles = workstreams.reduce((sum, item) => sum + item.roles.length, 0);
  const dispatchableCount = activeCards.filter((card) =>
    ["todo", "scheduled", "ready", "running", "review"].includes(card.status),
  ).length;
  const blockedCount = workstreams.filter((item) => item.status === "阻塞").length;
  const confirmationCount = workstreams.filter((item) => item.status === "待确认").length;

  return html`
    <div style="padding:16px;max-width:1180px;margin:0 auto">
      <div
        style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px"
      >
        <div>
          <h1 style="font-size:20px;margin:0;color:#c53030">公司管理看板</h1>
          <p style="margin:6px 0 0 0;color:var(--text-secondary,#666);font-size:13px">
            按目标拆解后的工作块查看岗位承接、任务状态、完成度和阻塞点。
          </p>
        </div>
        <button
          @click=${() => {
            state.refreshAicsMainFlowReadModel();
          }}
          style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
        >
          刷新
        </button>
      </div>

      <div
        style="display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:10px;margin-bottom:18px"
      >
        ${[
          { label: "工作块", value: workstreams.length, title: "目标拆解后的经营工作单元。" },
          { label: "承接岗位", value: totalRoles, title: "当前工作块下需要参与的岗位。" },
          {
            label: "可推进任务",
            value: dispatchableCount || "待接入",
            title: "任务中心里可继续推进的关联任务。",
          },
          {
            label: "待确认",
            value: confirmationCount || "无",
            title: "需要人工确认的工作块或任务。",
          },
          { label: "阻塞", value: blockedCount || "无", title: "已阻塞的工作块数量。" },
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

      <div
        style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:18px"
      >
        ${workstreams.map(
          (workstream) => html`
            <section
              style="border:1px solid var(--border-color,#e2e8f0);border-radius:10px;background:var(--bg-elevated,#fff);overflow:hidden"
            >
              <div
                style="padding:14px 14px 12px 14px;border-bottom:1px solid var(--border-color,#edf2f7)"
              >
                <div
                  style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"
                >
                  <div>
                    <h2 style="font-size:16px;margin:0;color:var(--text-primary,#222)">
                      ${workstream.title}
                    </h2>
                    <p
                      style="font-size:12px;line-height:1.5;color:var(--text-secondary,#666);margin:5px 0 0 0"
                    >
                      ${workstream.summary}
                    </p>
                  </div>
                  <span
                    style="flex:0 0 auto;font-size:12px;color:${workstream.status === "阻塞"
                      ? "#c53030"
                      : workstream.status === "待确认"
                        ? "#b7791f"
                        : "#2b6cb0"};font-weight:600"
                  >
                    ${workstream.status}
                  </span>
                </div>
                <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
                  <div
                    style="height:8px;flex:1;background:var(--bg-secondary,#edf2f7);border-radius:999px;overflow:hidden"
                  >
                    <div
                      style="height:100%;width:${workstream.progress}%;background:${workstream.progress >=
                      70
                        ? "#38a169"
                        : workstream.progress >= 45
                          ? "#3182ce"
                          : "#dd6b20"};border-radius:999px"
                    ></div>
                  </div>
                  <strong style="font-size:13px;color:var(--text-primary,#222)"
                    >${workstream.progress}%</strong
                  >
                </div>
                <div
                  style="display:flex;gap:8px;margin-top:10px;font-size:11px;color:var(--text-secondary,#666)"
                >
                  <span>${workstream.roles.length} 个岗位</span>
                  <span>${workstream.tasks.length} 个拆解任务</span>
                  <span
                    >${workstream.cards.length
                      ? `${workstream.cards.length} 条任务中心记录`
                      : "待调度"}</span
                  >
                </div>
              </div>

              <div style="padding:12px 14px">
                <h3 style="font-size:12px;margin:0 0 8px 0;color:var(--text-secondary,#666)">
                  岗位承接
                </h3>
                <div style="display:grid;gap:8px">
                  ${workstream.roles.map(
                    (role) => html`
                      <div
                        style="border:1px solid var(--border-color,#edf2f7);border-radius:7px;padding:9px;background:var(--bg-secondary,#f8fafc)"
                      >
                        <div style="display:flex;justify-content:space-between;gap:8px">
                          <strong style="font-size:13px">${role.title}</strong>
                          <span style="font-size:11px;color:${statusColor(role.status)}"
                            >${role.status}</span
                          >
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;margin-top:7px">
                          <div
                            style="height:6px;flex:1;background:#e2e8f0;border-radius:999px;overflow:hidden"
                          >
                            <div
                              style="height:100%;width:${role.progress}%;background:#4a90e2;border-radius:999px"
                            ></div>
                          </div>
                          <span style="font-size:11px;color:var(--text-secondary,#666)"
                            >${role.progress}%</span
                          >
                        </div>
                        <div style="font-size:11px;color:var(--text-secondary,#666);margin-top:6px">
                          ${role.task}
                        </div>
                      </div>
                    `,
                  )}
                </div>
              </div>

              <div style="padding:0 14px 12px 14px">
                <h3 style="font-size:12px;margin:0 0 8px 0;color:var(--text-secondary,#666)">
                  任务状态
                </h3>
                <div style="display:grid;gap:6px">
                  ${(workstream.cards.length
                    ? workstream.cards
                    : workstream.tasks.map((task, index) => ({
                        id: `${workstream.id}-${index}`,
                        title: task,
                        status: index === 0 ? "running" : index === 1 ? "ready" : "todo",
                      }))
                  ).map(
                    (task) => html`
                      <div
                        style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;border-bottom:1px solid var(--border-color,#edf2f7);padding:5px 0"
                      >
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                          >${task.title}</span
                        >
                        <span style="flex:0 0 auto;color:${statusColor(task.status)}"
                          >${statusLabel(task.status)}</span
                        >
                      </div>
                    `,
                  )}
                </div>
                <div
                  style="font-size:11px;color:${workstream.status === "阻塞"
                    ? "#c53030"
                    : "#805ad5"};margin-top:10px"
                >
                  ${workstream.blocker}
                </div>
              </div>
            </section>
          `,
        )}
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
          @click=${() => onNavigate("projects")}
          style="padding:8px 12px;border:1px solid var(--border-color,#ccc);border-radius:6px;background:var(--bg-elevated,#fff);cursor:pointer;font-size:13px"
        >
          查看项目承接
        </button>
        <button
          @click=${() => onNavigate("workboard")}
          style="padding:8px 12px;border:1px solid var(--border-color,#ccc);border-radius:6px;background:var(--bg-elevated,#fff);cursor:pointer;font-size:13px"
        >
          查看岗位任务
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
                ? "已确认 CompanyGoal，可以生成岗位供给、授权转化、执行质量、费用审核四个经营工作块。"
                : "请先在「公司目标」确认 CompanyGoal；未确认目标不能进入经营拆解。"}
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
  const workboardState = getWorkboardState(state);
  const flow = buildBusinessFlowProjection(state.businessFlow);
  const cards = workboardState.cards
    .filter((card) => !card.metadata?.archivedAt)
    .filter((card) => card.metadata?.businessFlow?.projectId === flow.selectedProject.id);
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

function renderWorkboardProductPage(state: AppViewState, requestHostUpdate?: () => void) {
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

  const proposal = ((readModel?.latest as Record<string, unknown> | undefined)
    ?.dispatchProposalReview ?? null) as Record<string, unknown> | null;
  const columns = [
    {
      key: "backlog",
      label: "Backlog",
      count: rolePlanItems.filter(
        (item) => item.status === "confirmed" || item.status === "prepared",
      ).length,
      color: "#718096",
    },
    {
      key: "assigned",
      label: "Assigned",
      count: requests.filter((item) => item.status === "ready").length,
      color: "#3182ce",
    },
    {
      key: "running",
      label: "Running",
      count: requests.filter((item) => item.status === "running").length,
      color: "#805ad5",
    },
    {
      key: "review",
      label: "Review",
      count: taskPackages.filter((item) => item.status === "materialized").length,
      color: "#b7791f",
    },
    { key: "revision", label: "Revision", count: 0, color: "#dd6b20" },
    {
      key: "human",
      label: "Human Confirm",
      count: uniqueRequests.length + requests.filter((item) => item.status === "blocked").length,
      color: "#c05621",
    },
    {
      key: "done",
      label: "Done",
      count: results.filter((item) => item.status === "completed").length,
      color: "#38a169",
    },
    {
      key: "failed",
      label: "Failed",
      count: results.filter((item) => item.status === "failed" || item.outcome === "failed").length,
      color: "#e53e3e",
    },
  ];

  return html`
    <div style="padding:16px;max-width:1180px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <h1 style="font-size:20px;margin:0">任务调度</h1>
          <p style="font-size:12px;color:var(--text-secondary,#666);margin:4px 0 0 0">
            调度层是运营项目经理系统：读取品类能力，拆结构化任务包，跟踪状态、返工、人工确认和结果汇总。
          </p>
        </div>
        <div style="display:flex;gap:8px">
          <button
            @click=${() =>
              aicsMainFlow
                .createDispatchProposal(
                  state,
                  "本地调度方案",
                  "风险动作必须人工确认；缺少独特能力时阻塞。",
                  "确认后才能物化 TaskPackage。",
                )
                .then(() => requestHostUpdate?.())}
            style="padding:6px 12px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
            ?disabled=${!readiness.canCreateDispatchProposal}
          >
            创建调度方案
          </button>
          <button
            @click=${() =>
              proposal?.id
                ? aicsMainFlow
                    .confirmDispatch(state, String(proposal.id))
                    .then(() => requestHostUpdate?.())
                : undefined}
            style="padding:6px 12px;background:#38a169;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
            ?disabled=${!proposal || proposal.status === "confirmed"}
          >
            确认调度
          </button>
          <button
            @click=${() =>
              aicsMainFlow
                .materializeTaskPackage(
                  state,
                  "结构化岗位任务包",
                  "岗位 + 动作 + 输入 + 输出要求 + 截止时间 + 风险限制",
                )
                .then(() => requestHostUpdate?.())}
            style="padding:6px 12px;background:#805ad5;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
            ?disabled=${!readiness.canMaterializeTaskPackage}
          >
            生成任务包
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

      ${error
        ? html`<div
            style="padding:12px;background:#fff5f5;border:1px solid #e53e3e;border-radius:6px;color:#e53e3e;margin-bottom:12px;font-size:13px"
          >
            ${error}
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
          <h2 style="font-size:15px;margin:0 0 10px 0">岗位任务包</h2>
          ${rolePlanItems.length === 0
            ? html`<div
                style="font-size:13px;color:var(--text-secondary,#666);padding:18px;text-align:center"
              >
                暂无 RolePlanItem。确认规划方案后，调度层才能拆岗位任务。
              </div>`
            : rolePlanItems.map((item) => {
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
                      品类：${match?.category ?? item.category ?? "通用品类"} ·
                      能力：${item.roleCapabilityRef}
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
                      : nothing}
                  </div>
                `;
              })}
        </section>

        <section
          style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff)"
        >
          <h2 style="font-size:15px;margin:0 0 10px 0">独特能力申请</h2>
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
                      <strong>${req.missingCapability}</strong><span>${req.status}</span>
                    </div>
                    <div style="margin-top:4px;color:#744210">
                      类型：${req.capabilityType} · 风险：${req.riskLevel}
                    </div>
                    <div style="margin-top:4px;color:#744210">
                      工具：${((req.neededTools as string[]) ?? []).join(" / ") || "—"}
                    </div>
                    <div style="margin-top:4px;color:#744210">
                      Skill：${((req.neededSkills as string[]) ?? []).join(" / ") || "—"}
                    </div>
                    <div style="margin-top:4px;color:#744210">${req.reason}</div>
                  </div>
                `,
              )}
        </section>
      </div>

      <div
        style="border:1px dashed var(--border-color,#ccc);border-radius:8px;padding:12px;font-size:12px;color:var(--text-secondary,#666)"
      >
        边界：调度层只读取品类通用能力和已确认的独特能力；能力 = 工具权限 +
        Skill。缺能力时只能生成申请，不能直接执行岗位。
      </div>
    </div>
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
  _onNavigate: (tab: Tab) => void,
) {
  const roles = state.aicsMarketplace.roles ?? [];
  const authorized = roles.filter((r) => r.entitlementId);
  const pendingRoleListingId = state.aicsRoleBuilder.form.roleListingId;
  const pendingEntitlementId = state.aicsRoleBuilder.form.entitlementId;
  const totals = state.usageCostSummary?.totals ?? state.usageResult?.totals ?? null;
  const mf = state.aicsMainFlow?.readModel as Record<string, unknown> | null;
  const execCount = (mf?.counts as Record<string, number>)?.roleResults ?? 0;

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
            ${totals?.totalTokens
              ? formatMainSystemNumber(totals.totalTokens)
              : execCount > 0
                ? `${execCount * 1400}`
                : "-"}
          </div>
        </div>
        <div
          style="text-align:center;padding:12px;border:1px solid var(--border-color,#e0e0e0);border-radius:6px"
        >
          <div style="font-size:11px;color:var(--text-secondary,#666)">费用</div>
          <div style="font-size:24px;font-weight:700">
            ${totals?.totalCost
              ? formatMainSystemCost(totals.totalCost)
              : execCount > 0
                ? `~¥${((execCount * 1400 * 0.42) / 1000000).toFixed(2)}`
                : "¥0.00"}
          </div>
        </div>
      </div>

      <section
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;margin-bottom:18px;background:var(--bg-elevated,#fff)"
      >
        <div
          style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px"
        >
          <div>
            <h2 style="font-size:15px;margin:0">正式 0 元授权</h2>
            <p style="font-size:12px;color:var(--text-secondary,#666);margin:4px 0 0 0">
              首批岗位按云端正式授权处理，生成 RoleEntitlement；不是本地 mock。
            </p>
          </div>
          <button
            type="button"
            @click=${() => state.refreshAicsMarketplaceRoles?.()}
            style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
            ?disabled=${state.aicsMarketplace.loading}
          >
            ${state.aicsMarketplace.loading ? "同步中..." : "同步我的岗位"}
          </button>
        </div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">
          <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
            云端岗位编号 roleListingId
            <input
              .value=${pendingRoleListingId}
              @input=${(event: InputEvent) =>
                state.updateAicsRoleBuilderField(
                  "roleListingId",
                  (event.target as HTMLInputElement).value,
                )}
              placeholder="例如 djrole_xxx 或首批岗位商品编号"
              style="padding:8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
            />
          </label>
          <button
            type="button"
            @click=${() =>
              state.authorizeAicsMarketplaceRole?.(state.aicsRoleBuilder.form.roleListingId)}
            style="padding:8px 12px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
            ?disabled=${state.aicsMarketplace.loading || !pendingRoleListingId.trim()}
          >
            ${state.aicsMarketplace.loading ? "处理中..." : "创建 0 元正式授权"}
          </button>
        </div>
        <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:10px">
          当前执行授权：${pendingEntitlementId
            ? html`<span style="color:#2f855a">${pendingEntitlementId}</span>`
            : html`<span style="color:#c53030">未生成 entitlementId</span>`}
        </div>
      </section>

      <h2 style="font-size:15px;margin:0 0 8px 0">岗位授权</h2>
      ${authorized.length === 0
        ? html`<p style="color:var(--text-secondary,#666);font-size:13px;margin-bottom:16px">
            暂无
          </p>`
        : html`
            <div style="display:grid;gap:4px;margin-bottom:16px">
              ${authorized.map(
                (r) => html`
                  <div
                    style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:10px;display:flex;justify-content:space-between"
                  >
                    <span style="font-size:13px;font-weight:600">${r.title ?? "岗位"}</span>
                    <span style="font-size:11px;color:#38a169"
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

function renderApiManagementProductPage(state: AppViewState, onNavigate: (tab: Tab) => void) {
  void onNavigate;
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
    { value: "model", label: "模型" },
    { value: "tool", label: "工具" },
    { value: "skill", label: "Skill" },
    { value: "marketplace", label: "商城" },
    { value: "dispatch", label: "调度" },
    { value: "main_chat", label: "主对话框" },
    { value: "voice", label: "语音" },
    { value: "image", label: "图片" },
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
              <option value="env">使用环境变量</option>
              <option value="oauth">OAuth / 云端授权</option>
              <option value="local">本地服务</option>
            </select>
          </label>
          <label style="display:grid;gap:4px;font-size:12px;color:var(--text-secondary,#666)">
            ${form.connectionMode === "env" ? "环境变量名" : "API Key"}
            <input
              type=${form.connectionMode === "direct" ? "password" : "text"}
              .value=${form.connectionMode === "direct" ? form.secretValue : form.secretEnvId}
              ?disabled=${form.connectionMode === "local"}
              @input=${(event: Event) =>
                state.updateApiConnectionFormField?.(
                  form.connectionMode === "direct" ? "secretValue" : "secretEnvId",
                  (event.currentTarget as HTMLInputElement).value,
                )}
              placeholder=${form.connectionMode === "env" ? "DEEPSEEK_API_KEY" : "sk-..."}
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
            (form.connectionMode === "env" && !form.secretEnvId.trim())}
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

function renderToolsProductPage(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const model = state.toolSupplyControl.readModel;
  const metrics = model?.metrics;
  const saving = state.toolSupplyControl.saving;
  const loading = state.toolSupplyControl.loading;
  const error = state.toolSupplyControl.error;
  const message = state.toolSupplyControl.message;
  const toolRisks = model?.risks ?? [];
  const canAutoSync = state.connected && Boolean(state.client);
  if (!model && !loading && !error && canAutoSync) {
    queueMicrotask(() => {
      if (
        state.tab === "skills" &&
        state.connected &&
        state.client &&
        !state.toolSupplyControl.readModel &&
        !state.toolSupplyControl.loading &&
        !state.toolSupplyControl.error
      ) {
        void state.refreshToolSupplyControlReadModel();
      }
    });
  }
  const scrollToSection = (id: string) => {
    const target = document.getElementById(id);
    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  };
  const openApiPrefill = (item?: ToolSupplyControlItem) => {
    state.resetApiConnectionForm();
    state.updateApiConnectionFormField("templateId", "tool-skill-api");
    state.updateApiConnectionFormField("kind", "tool_skill");
    if (item) {
      state.updateApiConnectionFormField("name", `${item.label} API`);
      state.updateApiConnectionFormField("provider", item.skillKey ?? item.pluginId ?? item.label);
      state.updateApiConnectionFormField(
        "bindingPath",
        item.configBindings?.[0] ?? (item.skillKey ? `skills.entries.${item.skillKey}.apiKey` : ""),
      );
    } else {
      state.updateApiConnectionFormField("name", "工具 / Skill API");
    }
    onNavigate("apiManagement");
    window.setTimeout(() => {
      const appRoot = document.querySelector("openclaw-app")?.shadowRoot ?? document;
      const formElement = appRoot.querySelector<HTMLElement>("[data-api-connection-form]");
      if (typeof formElement?.scrollIntoView === "function") {
        formElement.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }, 80);
  };
  const searchClawHubSkills = async () => {
    const query = state.clawhubSearchQuery.trim();
    if (state.clawhubSearchLoading) {
      return;
    }
    if (!query) {
      state.clawhubSearchError = "请输入 Skill 关键词。";
      return;
    }
    if (!state.client || !state.connected) {
      state.clawhubSearchError = "Gateway 未连接，暂时不能搜索 Skill。";
      return;
    }
    state.clawhubSearchResults = null;
    state.clawhubSearchError = null;
    state.clawhubSearchLoading = true;
    try {
      const result = await state.client.request<{
        results?: Array<{ slug: string; displayName: string; summary?: string; version?: string }>;
      }>("skills.search", { query, limit: 8 });
      state.clawhubSearchResults = (result?.results ?? []).map((entry) => ({
        ...entry,
        score: 0,
      }));
    } catch (err) {
      state.clawhubSearchError = err instanceof Error ? err.message : "Skill 搜索失败";
    } finally {
      state.clawhubSearchLoading = false;
    }
  };
  const installClawHubSkill = async (slug: string) => {
    if (state.clawhubInstallSlug) {
      return;
    }
    if (!state.client || !state.connected) {
      state.clawhubInstallMessage = { kind: "error", text: "Gateway 未连接，暂时不能安装 Skill。" };
      return;
    }
    state.clawhubInstallSlug = slug;
    state.clawhubInstallMessage = null;
    try {
      await state.client.request("skills.install", { source: "clawhub", slug });
      state.clawhubInstallMessage = { kind: "success", text: `Skill 已安装：${slug}` };
      await state.refreshToolSupplyControlReadModel();
    } catch (err) {
      state.clawhubInstallMessage = {
        kind: "error",
        text: err instanceof Error ? err.message : "Skill 安装失败",
      };
    } finally {
      state.clawhubInstallSlug = null;
    }
  };
  const primaryButtonStyle =
    "border:1px solid var(--accent-color,#2563eb);border-radius:6px;padding:9px 12px;background:var(--accent-color,#2563eb);color:#fff;font-weight:700;cursor:pointer";
  const secondaryButtonStyle =
    "border:1px solid var(--border-color,#d0d0d0);border-radius:6px;padding:9px 12px;background:var(--bg-elevated,#fff);color:var(--text-primary,#111);font-weight:650;cursor:pointer";
  const disabledButtonStyle = "opacity:.55;cursor:not-allowed";
  const renderSkillInstallPanel = () => html`
    <div id="skill-install-center" style="display:grid;gap:10px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input
          style="min-width:220px;flex:1;border:1px solid var(--border-color,#d0d0d0);border-radius:6px;padding:10px 11px;background:var(--input-bg,#fff);color:var(--text-color,#111)"
          .value=${state.clawhubSearchQuery}
          placeholder="搜索 Skill，例如 search、browser、image"
          @input=${(event: Event) => {
            state.clawhubSearchQuery = (event.target as HTMLInputElement).value;
            state.clawhubSearchError = null;
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === "Enter") {
              void searchClawHubSkills();
            }
          }}
        />
        <button
          type="button"
          style=${`${primaryButtonStyle};${state.clawhubSearchLoading ? disabledButtonStyle : ""}`}
          @click=${() => void searchClawHubSkills()}
          ?disabled=${state.clawhubSearchLoading}
        >
          ${state.clawhubSearchLoading ? "搜索中" : "搜索 Skill"}
        </button>
      </div>
      ${state.clawhubSearchError
        ? html`<div
            style="border:1px solid #feb2b2;background:#fff5f5;color:#c53030;border-radius:6px;padding:10px"
          >
            ${state.clawhubSearchError}
          </div>`
        : nothing}
      ${state.clawhubInstallMessage
        ? html`<div
            style="border:1px solid ${state.clawhubInstallMessage.kind === "error"
              ? "#feb2b2"
              : "#9ae6b4"};background:${state.clawhubInstallMessage.kind === "error"
              ? "#fff5f5"
              : "#f0fff4"};color:${state.clawhubInstallMessage.kind === "error"
              ? "#c53030"
              : "#276749"};border-radius:6px;padding:10px"
          >
            ${state.clawhubInstallMessage.text}
          </div>`
        : nothing}
      ${state.clawhubSearchResults
        ? state.clawhubSearchResults.length
          ? html`<div style="display:grid;gap:8px">
              ${state.clawhubSearchResults.map(
                (result) => html`
                  <div
                    style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:10px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center"
                  >
                    <div style="min-width:0">
                      <strong>${result.displayName}</strong>
                      <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:4px">
                        ${result.summary || result.slug}${result.version
                          ? ` · v${result.version}`
                          : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      style=${`${secondaryButtonStyle};${state.clawhubInstallSlug ? disabledButtonStyle : ""}`}
                      @click=${() => void installClawHubSkill(result.slug)}
                      ?disabled=${Boolean(state.clawhubInstallSlug)}
                    >
                      ${state.clawhubInstallSlug === result.slug ? "安装中" : "安装"}
                    </button>
                  </div>
                `,
              )}
            </div>`
          : html`<p style="margin:0;color:var(--text-secondary,#666);font-size:12px">
              没有找到匹配的 Skill。
            </p>`
        : nothing}
    </div>
  `;
  const renderMetric = (label: string, value: string | number, hint: string) => html`
    <div
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:12px;min-width:0"
    >
      <div style="font-size:12px;color:var(--text-secondary,#666)">${label}</div>
      <div style="font-size:22px;font-weight:750;margin-top:4px">${value}</div>
      <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:4px">${hint}</div>
    </div>
  `;
  const renderStatusPill = (item: ToolSupplyControlItem) => html`
    <span
      style="font-size:12px;font-weight:700;border:1px solid var(--border-color,#ddd);border-radius:999px;padding:3px 8px;color:${item.status ===
      "available"
        ? "#276749"
        : item.status === "blocked"
          ? "#c53030"
          : item.status === "disabled"
            ? "#718096"
            : "#b7791f"}"
      >${toolSupplyStatusLabel(item.status)}</span
    >
  `;
  const renderRows = (
    title: string,
    subtitle: string,
    items: ToolSupplyControlItem[] | undefined,
    actions: (item: ToolSupplyControlItem) => unknown,
  ) => html`
    <section style="display:grid;gap:10px">
      <div>
        <h3 style="margin:0;font-size:16px">${title}</h3>
        <p style="margin:4px 0 0;color:var(--text-secondary,#666);font-size:12px">${subtitle}</p>
      </div>
      ${(items ?? []).length
        ? html`
            <div style="display:grid;gap:8px">
              ${(items ?? []).slice(0, 18).map(
                (item) => html`
                  <div
                    style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start"
                  >
                    <div style="min-width:0">
                      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                        <strong>${item.label}</strong>
                        ${renderStatusPill(item)}
                        <span style="font-size:12px;color:var(--text-secondary,#666)"
                          >${toolSupplyKindLabel(item.kind)} · ${item.source}</span
                        >
                      </div>
                      ${item.description
                        ? html`<div
                            style="margin-top:5px;font-size:12px;color:var(--text-secondary,#666)"
                          >
                            ${item.description}
                          </div>`
                        : nothing}
                      <div style="margin-top:6px;font-size:12px;color:var(--text-secondary,#666)">
                        ${[
                          item.pluginId ? `plugin: ${item.pluginId}` : "",
                          item.skillKey ? `skill: ${item.skillKey}` : "",
                          item.configBindings?.length
                            ? `binding: ${item.configBindings.slice(0, 2).join(", ")}`
                            : "",
                          item.missing?.length
                            ? `missing: ${item.missing.slice(0, 3).join(", ")}`
                            : "",
                          (item.blockedReasons ?? []).length
                            ? `blocked: ${item.blockedReasons.join(", ")}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join("；") || "OpenClaw 运行时可见。"}
                      </div>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                      ${actions(item)}
                    </div>
                  </div>
                `,
              )}
            </div>
          `
        : html`<p style="margin:0;color:var(--text-secondary,#666);font-size:12px">
            ${loading
              ? "正在读取 OpenClaw 工具与 Skill..."
              : model
                ? "暂无数据。"
                : "尚未读取 OpenClaw 工具与 Skill，页面会自动读取本地能力投影。"}
          </p>`}
    </section>
  `;
  return html`
    <div style="display:grid;gap:18px">
      <header
        style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"
      >
        <div>
          <h2 style="margin:0;font-size:24px">工具供给与管控中心</h2>
          <p style="margin:6px 0 0;color:var(--text-secondary,#666)">
            统一管理 OpenClaw 工具、Skill、API 绑定和云端商城能力，调度前先看这里的授权与阻塞原因。
          </p>
        </div>
      </header>
      <section
        style="border:1px solid var(--border-color,#d8dde6);border-radius:8px;padding:16px;background:var(--bg-elevated,#fff);display:grid;gap:16px"
      >
        <div
          style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"
        >
          <div>
            <h3 style="margin:0;font-size:17px">能力接入操作台</h3>
            <p style="margin:5px 0 0;color:var(--text-secondary,#666);font-size:12px">
              在这里接入工具、安装 Skill、重新评估可用性，并处理调度前的授权阻塞。
            </p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" style=${primaryButtonStyle} @click=${() => openApiPrefill()}>
              新增工具供给
            </button>
            <button
              type="button"
              style=${`${secondaryButtonStyle};${loading ? disabledButtonStyle : ""}`}
              @click=${() => void state.refreshToolSupplyControlReadModel()}
              ?disabled=${loading}
            >
              ${loading ? "评估中" : "重新评估"}
            </button>
            <button
              type="button"
              style=${`${secondaryButtonStyle};${!model ? disabledButtonStyle : ""}`}
              @click=${() => scrollToSection("tool-supply-risk-section")}
              ?disabled=${!model}
            >
              处理阻塞
            </button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
          <div
            style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:12px;display:grid;gap:8px"
          >
            <strong>1. 添加工具</strong>
            <p style="margin:0;color:var(--text-secondary,#666);font-size:12px;line-height:1.45">
              通过 API 供给或插件工具接入，不在本地伪造工具。保存后进入 API
              管理，可测试、编辑、删除连接。
            </p>
            <button type="button" style=${primaryButtonStyle} @click=${() => openApiPrefill()}>
              添加工具 API
            </button>
          </div>
          <div
            style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:12px;display:grid;gap:8px"
          >
            <strong>2. 添加 Skill</strong>
            <p style="margin:0;color:var(--text-secondary,#666);font-size:12px;line-height:1.45">
              搜索 OpenClaw Skill，安装后再绑定 API、依赖和启用状态。
            </p>
            ${renderSkillInstallPanel()}
          </div>
          <div
            style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:12px;display:grid;gap:8px"
          >
            <strong>3. 评估与管理</strong>
            <p style="margin:0;color:var(--text-secondary,#666);font-size:12px;line-height:1.45">
              合并工具、Skill、API、云端能力，给出缺 API、禁用、待审、云端未授权等阻塞原因。
            </p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button
                type="button"
                style=${`${secondaryButtonStyle};${loading ? disabledButtonStyle : ""}`}
                @click=${() => void state.refreshToolSupplyControlReadModel()}
                ?disabled=${loading}
              >
                ${loading ? "评估中" : "评估全部"}
              </button>
              <button
                type="button"
                style=${`${secondaryButtonStyle};${!model ? disabledButtonStyle : ""}`}
                @click=${() => scrollToSection("tool-supply-risk-section")}
                ?disabled=${!model}
              >
                查看风险
              </button>
            </div>
          </div>
        </div>
      </section>
      ${error
        ? html`<div
            style="border:1px solid #feb2b2;background:#fff5f5;color:#c53030;border-radius:6px;padding:12px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"
          >
            <span>${error}</span>
            <button
              type="button"
              class="secondary"
              @click=${() => void state.refreshToolSupplyControlReadModel()}
              ?disabled=${loading}
            >
              重试读取
            </button>
          </div>`
        : nothing}
      ${message
        ? html`<div
            style="border:1px solid #9ae6b4;background:#f0fff4;color:#276749;border-radius:6px;padding:10px"
          >
            ${message}
          </div>`
        : nothing}
      ${!model
        ? html`<section
            style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:18px;display:grid;gap:8px;background:var(--bg-elevated,#fff)"
          >
            <strong
              >${loading
                ? "正在读取 OpenClaw 工具与 Skill..."
                : "尚未读取 OpenClaw 工具与 Skill"}</strong
            >
            <p style="margin:0;color:var(--text-secondary,#666);font-size:13px">
              ${loading
                ? "正在读取本地工具目录、Skill 状态、API 绑定和云端能力投影。"
                : error
                  ? "读取失败。请检查 Gateway 是否为最新进程，或点击“重试读取”。"
                  : "页面会自动读取本地工具目录、Skill 状态、API 绑定和云端能力投影。"}
            </p>
          </section>`
        : nothing}
      <section
        style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px"
      >
        ${renderMetric(
          "本地工具",
          metrics?.localTools ?? (loading ? "读取中" : "尚未读取"),
          "核心工具与插件工具",
        )}
        ${renderMetric(
          "Skill",
          metrics?.skills ?? (loading ? "读取中" : "尚未读取"),
          "OpenClaw Skill 状态",
        )}
        ${renderMetric(
          "API 绑定",
          metrics?.apiConnections ?? (loading ? "读取中" : "尚未读取"),
          "统一 API 供给中心",
        )}
        ${renderMetric(
          "云端能力",
          metrics?.cloudCapabilities ?? (loading ? "读取中" : "尚未读取"),
          "商城授权与独特申请",
        )}
        ${renderMetric(
          "阻塞/风险",
          `${metrics?.blocked ?? 0}/${metrics?.risks ?? 0}`,
          "影响调度和岗位执行",
        )}
      </section>
      ${renderRows(
        "本地工具权限",
        "来自 tools.catalog 和插件工具目录；高风险工具需要人工批准，插件工具受 plugins.entries.<id>.enabled 控制。",
        model?.localTools,
        (item) => html`
          ${item.kind === "plugin_tool" && item.pluginId
            ? html`<button
                type="button"
                class="secondary"
                @click=${() =>
                  void state.setToolSupplyPluginEnabled(item.pluginId!, item.status === "disabled")}
                ?disabled=${saving}
              >
                ${item.status === "disabled" ? "启用插件" : "禁用插件"}
              </button>`
            : nothing}
          ${item.grantStatus === "blocked"
            ? html`<button
                type="button"
                class="secondary"
                @click=${() => void state.setToolSupplyGrant(item, "approved")}
                ?disabled=${saving}
              >
                解除阻断
              </button>`
            : nothing}
          ${item.risk === "high" && item.grantStatus !== "approved"
            ? html`<button
                type="button"
                class="secondary"
                @click=${() => void state.setToolSupplyGrant(item, "approved")}
                ?disabled=${saving}
              >
                批准使用
              </button>`
            : nothing}
          <button
            type="button"
            class="secondary"
            @click=${() => void state.setToolSupplyGrant(item, "pending_review")}
            ?disabled=${saving}
          >
            管理权限
          </button>
          ${item.risk === "high" || item.grantStatus === "approved"
            ? html`<button
                type="button"
                class="secondary"
                @click=${() => void state.setToolSupplyGrant(item, "blocked")}
                ?disabled=${saving}
              >
                暂停供给
              </button>`
            : nothing}
        `,
      )}
      ${renderRows(
        "Skill 管控",
        "复用 OpenClaw skills.status / skills.update；缺依赖、禁用、缺 API 都会阻塞调度。",
        model?.skills,
        (item) => html`
          ${item.skillKey
            ? html`
                <button
                  type="button"
                  class="secondary"
                  @click=${() =>
                    void state.setToolSupplySkillEnabled(
                      item.skillKey!,
                      item.status === "disabled",
                    )}
                  ?disabled=${saving}
                >
                  ${item.status === "disabled" ? "启用" : "禁用"}
                </button>
                <button type="button" class="secondary" @click=${() => openApiPrefill(item)}>
                  绑定 API
                </button>
              `
            : nothing}
        `,
      )}
      ${renderRows(
        "云端品类能力",
        "云端商城是审核、授权、计费的权威来源；本地只显示状态，不能伪造云端授权。",
        model?.cloudCapabilities,
        (item) => html`
          ${item.status !== "available"
            ? html`<button
                type="button"
                class="secondary"
                @click=${() =>
                  void state.prepareToolSupplyUniqueCapabilityRequest({
                    title: item.label,
                    capabilityRef: item.id,
                    category: item.description,
                    reason: "本地端调度前发现云端能力未授权或独特能力待审核。",
                  })}
                ?disabled=${saving}
              >
                准备独特能力申请
              </button>`
            : nothing}
        `,
      )}
      ${renderRows(
        "API 绑定",
        "这里读取 API 供给中心的绑定状态；配置和 SecretRef 仍在 API 管理页维护。",
        model?.apiBindings,
        (item) => html`
          <button type="button" class="secondary" @click=${() => openApiPrefill(item)}>
            去 API 管理
          </button>
        `,
      )}
      <section id="tool-supply-risk-section" style="display:grid;gap:10px">
        <div>
          <h3 style="margin:0;font-size:16px">风险与阻塞</h3>
          <p style="margin:4px 0 0;color:var(--text-secondary,#666);font-size:12px">
            这些 reason 会直接影响任务调度和岗位执行，不阻塞整个 OpenClaw。
          </p>
        </div>
        ${toolRisks.length
          ? html`
              <div style="display:grid;gap:8px">
                ${toolRisks.slice(0, 24).map(
                  (risk) => html`
                    <div
                      style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:10px"
                    >
                      <div
                        style="font-size:12px;font-weight:750;color:${risk.severity === "blocking"
                          ? "#c53030"
                          : "#b7791f"}"
                      >
                        ${risk.severity} · ${risk.reason} · ${risk.label}
                      </div>
                      <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:4px">
                        ${risk.message}
                      </div>
                    </div>
                  `,
                )}
              </div>
            `
          : html`<p style="margin:0;color:var(--text-secondary,#666);font-size:12px">
              暂无风险项。
            </p>`}
      </section>
    </div>
  `;
}

const CONFIG_SETTINGS_TABS = [
  "config",
  "channels",
  "communications",
  "appearance",
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
        ${state.tab === "aics" ? renderMyRolesPage(state, navigateProductTab) : nothing}
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
              const workboardState = getWorkboardState(state);
              const workboardEnabled = isPluginEnabledInConfigSnapshot(
                state.configSnapshot,
                "workboard",
                {
                  enabledByDefault: false,
                },
              );
              const operatorCanWrite = hasOperatorWriteAccess(
                (state.hello as { auth?: { role?: string; scopes?: string[] } } | null)?.auth ??
                  null,
              );
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
                workboardSessionKeys: new Set(
                  workboardState.cards
                    .flatMap((card) => [card.sessionKey, card.execution?.sessionKey])
                    .filter((key): key is string => typeof key === "string" && key.length > 0),
                ),
                workboardBusySessionKey: [...workboardState.capturingSessionKeys][0] ?? null,
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
                onAddToWorkboard:
                  workboardEnabled && operatorCanWrite
                    ? runUiTask(async (session) => {
                        await captureSessionToWorkboard({
                          host: state,
                          client: state.client,
                          session,
                          requestUpdate: requestHostUpdate,
                        });
                        state.setTab("workboard" as import("./navigation.ts").Tab);
                      })
                    : undefined,
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
          ? renderWorkboardProductPage(state, requestHostUpdate)
          : nothing}
        ${state.tab === "usage"
          ? renderBillingAuthorizationProductPage(state, navigateProductTab)
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
        ${state.tab === "skills" ? renderToolsProductPage(state, navigateProductTab) : nothing}
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
                  onAicsModeChange: (mode) => state.setAicsConversationMode(mode),
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
