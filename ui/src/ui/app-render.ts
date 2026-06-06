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
import {
  captureSessionToWorkboard,
  getWorkboardState,
  loadWorkboard,
  type WorkboardCard,
  type WorkboardEvent,
  type WorkboardTaskSummary,
} from "./controllers/workboard.ts";
import { getCronJobPayload } from "./cron-payload.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "./external-link.ts";
import { formatTimeMs } from "./format.ts";
import { formatRelativeTimestamp } from "./format.ts";
import { icons } from "./icons.ts";
import { createLazyView, renderLazyView } from "./lazy-view.ts";
import {
  BUYER_STOREFRONT_URL,
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
import "./components/dashboard-header.ts";
import {
  buildAgentMainSessionKey,
  isSessionKeyTiedToAgent,
  isSubagentSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
} from "./session-key.ts";
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
import type { AicsMarketplaceRole } from "./views/aics.ts";
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

function roleStatusLabel(role: AicsMarketplaceRole) {
  const status = normalizeOptionalString(role.status) ?? "";
  if (role.entitlementId) {
    return "已授权";
  }
  if (status.includes("update") || status.includes("可更新")) {
    return "可更新";
  }
  if (status.includes("installed") || status.includes("已安装")) {
    return "已安装";
  }
  return status || "可授权";
}

function roleTaskStatusLabel(status: string) {
  switch (status) {
    case "triage":
    case "backlog":
    case "todo":
    case "scheduled":
    case "ready":
    case "queued":
      return "排单中";
    case "running":
      return "运行中";
    case "review":
      return "待确认";
    case "blocked":
      return "已阻塞";
    case "done":
    case "completed":
      return "已完成";
    case "failed":
    case "cancelled":
    case "timed_out":
      return "已失败";
    default:
      return "待同步";
  }
}

type RoleTaskColumnId = "queued" | "running" | "review" | "failed";

type RoleTaskBoardCard = {
  id: string;
  title: string;
  status: string;
  detail: string;
  source: string;
  meta: string;
  labels: string[];
};

const ROLE_TASK_COLUMNS: Array<{
  id: RoleTaskColumnId;
  title: string;
  empty: string;
}> = [
  { id: "queued", title: "排队中", empty: "暂无排队任务" },
  { id: "running", title: "运行中", empty: "暂无运行任务" },
  { id: "review", title: "待确认", empty: "暂无待确认任务" },
  { id: "failed", title: "已失败", empty: "暂无失败任务" },
];

function roleTaskColumnIdForStatus(label: string): RoleTaskColumnId | null {
  switch (label) {
    case "排单中":
    case "待同步":
      return "queued";
    case "运行中":
      return "running";
    case "待确认":
      return "review";
    case "已失败":
    case "已阻塞":
      return "failed";
    default:
      return null;
  }
}

function isRoleTaskFailureLabel(label: string) {
  return label === "已失败" || label === "已阻塞";
}

function roleTaskMetricCount(
  cards: readonly WorkboardCard[],
  tasksByCardId: ReadonlyMap<string, WorkboardTaskSummary>,
  predicate: (label: string) => boolean,
) {
  return cards.filter((card) => {
    const task = tasksByCardId.get(card.id);
    return predicate(roleTaskStatusLabel(task?.status ?? card.status));
  }).length;
}

function roleTaskWorkboardNotice(error: string | null | undefined) {
  const message = normalizeOptionalString(error);
  if (!message) {
    return null;
  }
  if (/unknown method:\s*workboard\.cards\.list/i.test(message)) {
    return { tone: "info", message: "调度数据待接入，当前仅展示看板结构。" };
  }
  return { tone: "error", message };
}

function roleTaskCardSource(card: WorkboardCard) {
  if (card.sourceUrl) {
    return "来源：外部链接";
  }
  if (card.sessionKey) {
    return "来源：主对话";
  }
  return "来源：调度层";
}

function roleTaskCardDetail(card: WorkboardCard, task: WorkboardTaskSummary | undefined) {
  const detail =
    normalizeOptionalString(task?.progressSummary) ??
    normalizeOptionalString(task?.terminalSummary) ??
    normalizeOptionalString(task?.error) ??
    normalizeOptionalString(card.notes);
  if (!detail) {
    return "等待调度层处理";
  }
  return detail.split(/\r?\n/)[0]?.trim() || "等待调度层处理";
}

function roleTaskBoardCardFromWorkboard(
  card: WorkboardCard,
  task: WorkboardTaskSummary | undefined,
): RoleTaskBoardCard {
  const status = roleTaskStatusLabel(task?.status ?? card.status);
  const labels = card.labels.slice(0, 2);
  if (card.priority === "urgent" || card.priority === "high") {
    labels.unshift(card.priority === "urgent" ? "紧急" : "高优先级");
  }
  return {
    id: card.id,
    title: card.title || "未命名岗位任务",
    status,
    detail: roleTaskCardDetail(card, task),
    source: roleTaskCardSource(card),
    meta: card.updatedAt ? `更新 ${formatRelativeTimestamp(card.updatedAt)}` : "待同步",
    labels,
  };
}

function roleTaskEventTitle(event: WorkboardEvent, card: WorkboardCard) {
  switch (event.kind) {
    case "created":
      return `${card.title} 已加入队列`;
    case "moved":
      return `${card.title} 状态更新为 ${roleTaskStatusLabel(event.toStatus ?? card.status)}`;
    case "dispatch":
      return `${card.title} 已进入调度`;
    case "execution_updated":
    case "attempt_updated":
      return `${card.title} 执行状态已更新`;
    case "comment_added":
      return `${card.title} 新增确认记录`;
    case "archived":
      return `${card.title} 已归档`;
    default:
      return `${card.title} 调度记录已更新`;
  }
}

function roleTaskEventTime(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return "待同步";
  }
  return new Date(value ?? 0).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function renderRoleTaskMetric(params: {
  label: string;
  value: string | number;
  title: string;
  tone?: "normal" | "active" | "review" | "danger";
}) {
  return html`
    <article class="role-task-board__metric role-task-board__metric--${params.tone ?? "normal"}">
      <span>${params.label}</span>
      <strong>${params.value}</strong>
      <small>${params.title}</small>
    </article>
  `;
}

function renderRoleTaskBoardCard(card: RoleTaskBoardCard) {
  return html`
    <article class="role-task-board-card">
      <div class="role-task-board-card__top">
        <strong>${card.title}</strong>
        <span>${card.status}</span>
      </div>
      <p>${card.detail}</p>
      <div class="role-task-board-card__meta">
        <span>${card.source}</span>
        <span>${card.meta}</span>
      </div>
      ${card.labels.length
        ? html`
            <div class="role-task-board-card__labels">
              ${card.labels.map((label) => html`<span>${label}</span>`)}
            </div>
          `
        : nothing}
    </article>
  `;
}

function renderRoleTaskColumn(
  column: (typeof ROLE_TASK_COLUMNS)[number],
  cards: readonly RoleTaskBoardCard[],
) {
  return html`
    <section class="role-task-board-column" aria-label=${column.title}>
      <header>
        <span>${column.title}</span>
        <strong>${cards.length}</strong>
      </header>
      <div class="role-task-board-column__cards">
        ${cards.length
          ? cards.map(renderRoleTaskBoardCard)
          : html`<div class="role-task-board__empty">${column.empty}</div>`}
      </div>
    </section>
  `;
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

function renderMyRolesProductPage(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const roles = state.aicsMarketplace.roles;
  const authorized = roles.filter(
    (role) => role.entitlementId || roleStatusLabel(role) === "已授权",
  );
  const updatable = roles.filter((role) => roleStatusLabel(role) === "可更新");
  const items: MainSystemItem[] = roles.slice(0, 12).map((role) => ({
    title: role.title,
    status: roleStatusLabel(role),
    meta: role.detail,
    icon: role.entitlementId ? "check" : "brain",
    action: {
      label: "授权",
      title: "在主对话中授权该岗位。",
      onClick: () => state.useAicsMarketplaceRole(role),
    },
  }));

  return renderMainSystemShell({
    title: "我的岗位",
    status: state.aicsMarketplace.loading ? "同步中" : roles.length ? "已同步" : "待同步",
    icon: "brain",
    loading: state.aicsMarketplace.loading,
    error: state.aicsMarketplace.error,
    emptyLabel: "暂无岗位",
    metrics: [
      { label: "已同步授权", value: roles.length, title: "已同步到本机的岗位授权。" },
      { label: "已授权", value: authorized.length, title: "已购买或已授权的岗位。" },
      { label: "可更新", value: updatable.length, title: "存在新版本的岗位。" },
      { label: "岗位列表", value: roles.length, title: "本机可调度的岗位列表。" },
    ],
    items,
    actions: [
      {
        label: "同步",
        title: "同步云端已授权岗位。",
        icon: "loader",
        onClick: () => state.refreshAicsMarketplaceRoles(),
        disabled: state.aicsMarketplace.loading,
      },
    ],
    onNavigate,
  });
}

function renderRoleMarketplaceProductPage(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const syncedRoles = state.aicsMarketplace.roles.length;

  return renderMainSystemShell({
    title: "岗位商城",
    status: state.aicsMarketplace.loading ? "同步中" : "同一账号",
    icon: "globe",
    loading: false,
    error: state.aicsMarketplace.error,
    emptyLabel: "",
    metrics: [
      {
        label: "账号体系",
        value: "通用",
        title: "使用同一迭界AI账号访问本地端、使用者中心、开发者中心和岗位商城。",
      },
      { label: "已同步授权", value: syncedRoles, title: "当前账号已同步到本机的岗位授权。" },
    ],
    items: [
      { title: "打开岗位商城", status: "同一账号", icon: "externalLink" },
      {
        title: "同步授权",
        status: state.aicsMarketplace.loading ? "同步中" : "待同步",
        icon: "loader",
      },
    ],
    actions: [
      {
        label: "打开商城",
        title: "打开岗位商城，使用同一迭界AI账号继续浏览或授权岗位。",
        icon: "externalLink",
        onClick: () =>
          window.open(BUYER_STOREFRONT_URL, EXTERNAL_LINK_TARGET, "noopener,noreferrer"),
      },
      {
        label: "同步",
        title: "同步已授权岗位。",
        icon: "loader",
        onClick: () => state.refreshAicsMarketplaceRoles(),
        disabled: state.aicsMarketplace.loading,
      },
    ],
    onNavigate,
  });
}

function renderRoleTasksProductPage(
  state: AppViewState,
  onNavigate: (tab: Tab) => void,
  requestHostUpdate: () => void,
) {
  const auth =
    (state.hello as { auth?: { role?: string; scopes?: string[] } } | null)?.auth ?? null;
  const pluginEnabled = isPluginEnabledInConfigSnapshot(state.configSnapshot, "workboard", {
    enabledByDefault: false,
  });
  const workboardState = getWorkboardState(state);
  if (pluginEnabled) {
    void loadWorkboard({
      host: state,
      client: state.client,
      requestUpdate: requestHostUpdate,
    });
  }
  const cards = workboardState.cards.filter((card) => !card.metadata?.archivedAt);
  const authorizedRoles = state.aicsMarketplace.roles.filter(
    (role) => role.entitlementId || roleStatusLabel(role) === "已授权",
  ).length;
  const queuedCount = roleTaskMetricCount(
    cards,
    workboardState.tasksByCardId,
    (label) => label === "排单中" || label === "待同步",
  );
  const runningCount = roleTaskMetricCount(
    cards,
    workboardState.tasksByCardId,
    (label) => label === "运行中",
  );
  const reviewCount = roleTaskMetricCount(
    cards,
    workboardState.tasksByCardId,
    (label) => label === "待确认",
  );
  const failedCount = roleTaskMetricCount(cards, workboardState.tasksByCardId, (label) =>
    isRoleTaskFailureLabel(label),
  );
  const boardCards = new Map<RoleTaskColumnId, RoleTaskBoardCard[]>(
    ROLE_TASK_COLUMNS.map((column) => [column.id, []]),
  );

  for (const card of cards) {
    const task = workboardState.tasksByCardId.get(card.id);
    const status = roleTaskStatusLabel(task?.status ?? card.status);
    const columnId = roleTaskColumnIdForStatus(status);
    if (columnId) {
      boardCards.get(columnId)?.push(roleTaskBoardCardFromWorkboard(card, task));
    }
  }

  const recentEvents = cards
    .flatMap((card) =>
      (card.events ?? []).map((event) => ({
        id: `${card.id}:${event.id}`,
        at: event.at,
        title: roleTaskEventTitle(event, card),
      })),
    )
    .sort((left, right) => (right.at ?? 0) - (left.at ?? 0))
    .slice(0, 6);
  const authorizationStatus = state.aicsMarketplace.loading
    ? "同步中"
    : state.aicsMarketplace.error
      ? "同步异常"
      : "云端授权已同步";
  const workboardStatus = pluginEnabled
    ? hasOperatorWriteAccess(auth)
      ? "调度就绪"
      : "只读"
    : "待接入";
  const workboardNotice = roleTaskWorkboardNotice(workboardState.error);
  const dataNotice =
    workboardNotice ??
    (!pluginEnabled ? { tone: "info", message: "调度数据待接入，当前仅展示看板结构。" } : null);

  return html`
    <section class="role-task-board" aria-label="岗位任务">
      <header class="role-task-board__heading">
        <h1>岗位任务</h1>
        <p>调度看板，集中查看岗位队列、执行状态、确认点与授权同步。</p>
      </header>
      <div class="role-task-board__bar">
        <div class="role-task-board__signals">
          <span class="role-task-board__signal role-task-board__signal--active">
            ${icons.folder} 调度看板
          </span>
          <span class="role-task-board__signal">${workboardStatus}</span>
          <span class="role-task-board__signal">${authorizationStatus}</span>
        </div>
        <div class="role-task-board__actions">
          <button
            class="role-task-board__button role-task-board__button--primary"
            type="button"
            title="从主对话发起岗位任务。"
            @click=${() => onNavigate("chat")}
          >
            ${icons.messageSquare} 发起任务
          </button>
          <button
            class="role-task-board__button"
            type="button"
            title="同步云端授权。"
            ?disabled=${state.aicsMarketplace.loading}
            @click=${() => state.refreshAicsMarketplaceRoles()}
          >
            ${icons.loader} 同步云端授权
          </button>
          <button
            class="role-task-board__button"
            type="button"
            title="查看对话和执行记录。"
            @click=${() => onNavigate("sessions")}
          >
            ${icons.fileText} 查看执行记录
          </button>
        </div>
      </div>

      ${dataNotice
        ? html`<div class="role-task-board__notice role-task-board__notice--${dataNotice.tone}">
            ${dataNotice.message}
          </div>`
        : nothing}
      ${state.aicsMarketplace.error
        ? html`<div class="role-task-board__notice role-task-board__notice--error">
            ${state.aicsMarketplace.error}
          </div>`
        : nothing}

      <div class="role-task-board__metrics">
        ${renderRoleTaskMetric({
          label: "已授权岗位",
          value: authorizedRoles,
          title: "可被调度的岗位数量",
          tone: "active",
        })}
        ${renderRoleTaskMetric({
          label: "排队中",
          value: queuedCount,
          title: "等待分配或等待资源",
        })}
        ${renderRoleTaskMetric({
          label: "运行中",
          value: runningCount,
          title: "正在执行任务",
          tone: "active",
        })}
        ${renderRoleTaskMetric({
          label: "待确认",
          value: reviewCount,
          title: "需要你确认后继续",
          tone: "review",
        })}
        ${renderRoleTaskMetric({
          label: "已失败",
          value: failedCount,
          title: "需要复核或重试",
          tone: "danger",
        })}
      </div>

      <div class="role-task-board__main">
        <div class="role-task-board__columns">
          ${ROLE_TASK_COLUMNS.map((column) =>
            renderRoleTaskColumn(column, boardCards.get(column.id) ?? []),
          )}
        </div>
        <aside class="role-task-board__status" aria-label="调度状态">
          <header>
            <h2>调度状态</h2>
            <span>${workboardState.loading ? "同步中" : "实时"}</span>
          </header>
          <dl>
            <div>
              <dt>授权状态</dt>
              <dd>${authorizationStatus}</dd>
            </div>
            <div>
              <dt>任务队列</dt>
              <dd>${cards.length} 个任务等待或执行中</dd>
            </div>
            <div>
              <dt>执行中</dt>
              <dd>${runningCount} 个岗位正在运行</dd>
            </div>
            <div>
              <dt>需确认</dt>
              <dd>${reviewCount} 个确认点</dd>
            </div>
            <div>
              <dt>费用预估</dt>
              <dd>今日预计 ¥0.00</dd>
            </div>
          </dl>
        </aside>
      </div>

      <section class="role-task-board__recent" aria-label="最近调度">
        <header>
          <h2>最近调度</h2>
          <span>${recentEvents.length ? `${recentEvents.length} 条` : "暂无"}</span>
        </header>
        ${recentEvents.length
          ? html`
              <ol>
                ${recentEvents.map(
                  (event) => html`
                    <li>
                      <time>${roleTaskEventTime(event.at)}</time>
                      <span>${event.title}</span>
                    </li>
                  `,
                )}
              </ol>
            `
          : html`<div class="role-task-board__empty role-task-board__empty--wide">
              暂无调度记录
            </div>`}
      </section>
    </section>
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
        title: "等待调度层评估的记忆候选。",
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
        titleHelp: "只显示调度层候选，不由岗位直接写入。",
      },
      { title: "已确认记忆", status: formatMainSystemCount(status?.promotedTotal), icon: "check" },
      { title: "自动归档低风险记忆", status: status?.enabled ? "已开启" : "待接入", icon: "book" },
      { title: "待人工确认高风险记忆", status: "待接入", icon: "eye" },
      { title: "岗位优化候选", status: "待接入", icon: "spark" },
      { title: "调度层总结入库", status: "待接入", icon: "fileText" },
    ],
    actions: [{ label: "设置", title: "打开设置。", icon: "settings", tab: "config" }],
    onNavigate,
  });
}

function renderBillingAuthorizationProductPage(
  state: AppViewState,
  onNavigate: (tab: Tab) => void,
) {
  const totals = state.usageCostSummary?.totals ?? state.usageResult?.totals ?? null;
  const installedRoles = state.aicsMarketplace.roles.length;
  return renderMainSystemShell({
    title: "费用与授权",
    status: state.usageLoading ? "同步中" : totals ? "已同步" : "待同步",
    icon: "barChart",
    loading: state.usageLoading,
    error: state.usageError,
    emptyLabel: "暂无费用记录",
    metrics: [
      { label: "授权岗位", value: installedRoles, title: "已经同步到本机的岗位数量。" },
      { label: "授权费", value: "待接入", title: "岗位授权费用。" },
      {
        label: "对话用量",
        value: formatMainSystemNumber(totals?.totalTokens),
        title: "主系统和岗位执行产生的用量。",
      },
      {
        label: "安全计费",
        value: formatMainSystemCost(totals?.totalCost),
        title: "只展示安全摘要。",
      },
    ],
    items: [
      {
        title: "岗位授权状态",
        status: installedRoles ? `${installedRoles}` : "暂无",
        icon: "check",
      },
      { title: "授权费", status: "待接入", icon: "barChart" },
      { title: "对话用量", status: formatMainSystemNumber(totals?.totalTokens), icon: "activity" },
      { title: "开发者应收", status: "待接入", icon: "fileText" },
      { title: "平台应收", status: "待接入", icon: "fileText" },
      { title: "安全计费摘要", status: formatMainSystemCost(totals?.totalCost), icon: "eye" },
    ],
    actions: [],
    onNavigate,
  });
}

function renderToolsProductPage(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const toolCount =
    state.toolsCatalogResult?.groups.reduce((count, group) => count + group.tools.length, 0) ??
    null;
  const skillCount =
    state.skillsReport?.skills.filter((skill) => skill.eligible && !skill.disabled).length ?? null;
  const callCount = state.usageResult?.aggregates?.tools?.totalCalls ?? null;
  return renderMainSystemShell({
    title: "已安装工具",
    status:
      state.toolsCatalogLoading || state.skillsLoading
        ? "同步中"
        : toolCount != null || skillCount != null
          ? "已接入"
          : "待同步",
    icon: "zap",
    loading: state.toolsCatalogLoading || state.skillsLoading,
    error: state.toolsCatalogError ?? state.skillsError,
    emptyLabel: "暂无已安装工具",
    metrics: [
      {
        label: "已安装工具",
        value: formatMainSystemCount(toolCount ?? skillCount),
        title: "当前已安装并可展示的工具数量。",
      },
      { label: "岗位工具", value: "待选择", title: "选择岗位后显示可调用工具。" },
      {
        label: "调用记录",
        value: formatMainSystemCount(callCount),
        title: "来自安全用量摘要的工具调用次数。",
      },
      { label: "风险门控", value: "待接入", title: "高风险工具调用审批。" },
    ],
    items: [
      { title: "已安装工具", status: formatMainSystemCount(toolCount ?? skillCount), icon: "zap" },
      { title: "岗位工具", status: "待选择", icon: "wrench" },
      { title: "工具调用记录", status: formatMainSystemCount(callCount), icon: "fileText" },
    ],
    actions: [{ label: "设置", title: "打开设置。", icon: "settings", tab: "config" }],
    onNavigate,
  });
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
        title="删除对话记录"
        aria-label=${`删除对话记录：${label}`}
        ?disabled=${state.sessionsLoading}
        @click=${async (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
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
            onAdvancedSettings: () => {
              state.configSettingsMode = "advanced";
              requestHostUpdate?.();
            },
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
        ${state.tab === "aics" ? renderMyRolesProductPage(state, navigateProductTab) : nothing}
        ${state.tab === "marketplace"
          ? renderRoleMarketplaceProductPage(state, navigateProductTab)
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
          ? renderRoleTasksProductPage(state, navigateProductTab, requestHostUpdate)
          : nothing}
        ${state.tab === "usage"
          ? renderBillingAuthorizationProductPage(state, navigateProductTab)
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
