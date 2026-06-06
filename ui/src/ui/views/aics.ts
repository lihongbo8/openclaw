import { html } from "lit";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../external-link.ts";
import { icons } from "../icons.ts";
import { BUYER_STOREFRONT_URL, type Tab } from "../navigation.ts";

export type AicsRoleBuilderForm = {
  requestZh: string;
  roleBuildBriefJson: string;
  cloudAccessToken: string;
  executionId: string;
  executionToken: string;
  roleListingId: string;
  entitlementId: string;
  deviceId: string;
  workspaceRef: string;
  localGatewayId: string;
  developerId: string;
  outputRoot: string;
  timeoutMs: string;
};

export type AicsRoleBuilderState = {
  form: AicsRoleBuilderForm;
  running: boolean;
  tokenRunning: boolean;
  auditRunning: boolean;
  result: unknown;
  error: string | null;
};

export type AicsMarketplaceRole = {
  id: string;
  title: string;
  detail?: string;
  status?: string;
  roleListingId?: string;
  entitlementId?: string;
};

export type AicsMarketplaceState = {
  roles: AicsMarketplaceRole[];
  loading: boolean;
  error: string | null;
  result: unknown;
};

export type AicsDashboardProps = {
  connected: boolean;
  version: string;
  roleBuilder: AicsRoleBuilderState;
  marketplace: AicsMarketplaceState;
  onNavigate: (tab: Tab) => void;
  onRoleBuilderFieldChange: (field: keyof AicsRoleBuilderForm, value: string) => void;
  onMarketplaceRolesRefresh: () => void;
  onMarketplaceRoleUse: (role: AicsMarketplaceRole) => void;
  onDeveloperModeStart: () => void;
  onExecutionTokenRequest: () => void;
  onExecutionAuditRead: () => void;
  onRoleBuilderRun: () => void;
};

function renderStatusPill(connected: boolean) {
  return html`
    <span class="aics-status ${connected ? "aics-status--ok" : "aics-status--warn"}">
      <span class="aics-status__dot"></span>
      ${connected ? "本机连接已就绪" : "本机连接未就绪"}
    </span>
  `;
}

function renderHelp(text: string) {
  return html`
    <span
      class="aics-help"
      title=${text}
      aria-label=${text}
      data-tooltip=${text}
      role="img"
      tabindex="0"
    >
      ${icons.info}
    </span>
  `;
}

function renderTitleWithHelp(title: string, help: string) {
  return html`
    <span class="aics-title-row">
      <span>${title}</span>
      ${renderHelp(help)}
    </span>
  `;
}

function resolveSchedulerState(props: AicsDashboardProps) {
  const running =
    props.roleBuilder.running || props.roleBuilder.tokenRunning || props.roleBuilder.auditRunning;
  const blockingError = props.roleBuilder.error ?? props.marketplace.error;
  return {
    currentTask: props.roleBuilder.running
      ? "岗位生成"
      : props.roleBuilder.tokenRunning
        ? "授权请求"
        : props.roleBuilder.auditRunning
          ? "安全回读"
          : "空闲",
    queue: props.marketplace.loading ? "同步中" : "0",
    runningRole: running ? "运行中" : "无",
    pending: blockingError ? "需处理" : "0",
    risk: props.roleBuilder.tokenRunning || props.roleBuilder.auditRunning ? "校验中" : "正常",
    next: blockingError ? "检查连接" : props.marketplace.roles.length ? "可派单" : "同步岗位",
  };
}

function renderSchedulerPanel(props: AicsDashboardProps) {
  const state = resolveSchedulerState(props);
  const rows = [
    ["当前任务", state.currentTask, "调度层当前处理的任务。", icons.activity],
    ["队列", state.queue, "等待调度的任务数量。", icons.folder],
    ["运行岗位", state.runningRole, "正在执行的岗位。", icons.brain],
    ["待确认", state.pending, "等待人工确认或处理的事项。", icons.eye],
    ["风险门控", state.risk, "高风险动作审批状态。", icons.check],
    ["下一步", state.next, "调度层建议的下一步。", icons.chevronRight],
  ] as const;
  return html`
    <aside class="aics-scheduler" aria-label="调度层状态">
      <div class="aics-scheduler__title">
        <strong>调度层状态</strong>
      </div>
      <div class="aics-scheduler__list">
        ${rows.map(
          ([label, value, help, icon]) => html`
            <div class="aics-scheduler__row" title=${help} data-tooltip=${help}>
              <span class="aics-scheduler__icon" aria-hidden="true">${icon}</span>
              <span>${label}</span>
              <strong>${value}</strong>
            </div>
          `,
        )}
      </div>
    </aside>
  `;
}

function renderRoleWorkbench(props: AicsDashboardProps) {
  const marketplace = props.marketplace;
  const hasRoles = marketplace.roles.length > 0;
  return html`
    <section class="aics-workbench" aria-label="调度层">
      <div class="aics-boundary-grid" aria-label="调度层">
        <article class="aics-panel">
          <div class="aics-panel__icon" aria-hidden="true">${icons.brain}</div>
          <h2>${renderTitleWithHelp("已同步授权", "已经同步到本机的岗位授权。")}</h2>
          <strong class="aics-panel__metric">${marketplace.roles.length}</strong>
          <div class="aics-runner__actions">
            <button
              class="aics-runner__secondary"
              type="button"
              title="同步授权"
              aria-label="同步授权"
              ?disabled=${marketplace.loading}
              @click=${props.onMarketplaceRolesRefresh}
            >
              <span aria-hidden="true">${marketplace.loading ? icons.loader : icons.refresh}</span>
              <span>${marketplace.loading ? "同步中" : "同步"}</span>
            </button>
          </div>
        </article>

        <article class="aics-panel">
          <div class="aics-panel__icon" aria-hidden="true">${icons.check}</div>
          <h2>${renderTitleWithHelp("已授权岗位", "已经允许调度层使用的岗位。")}</h2>
          <strong class="aics-panel__metric">${marketplace.roles.length}</strong>
        </article>

        <article class="aics-panel">
          <div class="aics-panel__icon" aria-hidden="true">${icons.refresh}</div>
          <h2>${renderTitleWithHelp("可更新岗位", "有新版资料可同步的岗位。")}</h2>
          <strong class="aics-panel__metric">0</strong>
        </article>

        <article class="aics-panel">
          <div class="aics-panel__icon" aria-hidden="true">${icons.eye}</div>
          <h2>${renderTitleWithHelp("等待确认", "调度层拦截后等待人工确认的事项。")}</h2>
          <strong class="aics-panel__metric"
            >${marketplace.error || props.roleBuilder.error ? "1" : "0"}</strong
          >
        </article>

        <article class="aics-context-panel aics-context-panel--wide">
          <div class="aics-context-panel__mark" aria-hidden="true">${icons.folder}</div>
          <h2>${renderTitleWithHelp("可调度岗位", "来自本机已同步的岗位。")}</h2>
          ${marketplace.error
            ? html`<div class="aics-runner__error">${marketplace.error}</div>`
            : hasRoles
              ? html`
                  <div class="aics-api-grid">
                    ${marketplace.roles.map(
                      (role) => html`
                        <div class="aics-api-grid__item">
                          <span>${role.title}</span>
                          <button
                            class="aics-runner__secondary"
                            type="button"
                            title="授权岗位"
                            aria-label=${`授权岗位：${role.title}`}
                            @click=${() => props.onMarketplaceRoleUse(role)}
                          >
                            <span aria-hidden="true">${icons.messageSquare}</span>
                            <span>授权</span>
                          </button>
                        </div>
                      `,
                    )}
                  </div>
                `
              : html`<div class="aics-runner__empty">暂无已授权岗位。</div>`}
        </article>

        <article class="aics-panel">
          <div class="aics-panel__icon" aria-hidden="true">${icons.fileText}</div>
          <h2>${renderTitleWithHelp("反馈资料", "岗位执行返回后由调度层整理。")}</h2>
          <strong class="aics-panel__metric">${props.roleBuilder.result ? "1" : "0"}</strong>
        </article>
      </div>
    </section>
  `;
}

export function renderAicsMarketplace(props: AicsDashboardProps) {
  return html`
    <section class="aics-page">
      <section class="aics-hero" aria-labelledby="aics-marketplace-title">
        <div class="aics-hero__main">
          <div class="aics-kicker">迭界AI</div>
          <h1 id="aics-marketplace-title">
            ${renderTitleWithHelp("岗位商城", "使用同一迭界AI账号浏览和授权岗位。")}
          </h1>
          <div class="aics-hero__meta">
            ${renderStatusPill(props.connected)}
            <span class="aics-chip">版本 ${props.version || "unknown"}</span>
          </div>
        </div>
        <div class="aics-hero__actions">
          <a
            class="aics-action"
            href=${BUYER_STOREFRONT_URL}
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="打开云端岗位商城"
            aria-label="打开云端岗位商城"
          >
            <span class="aics-action__icon" aria-hidden="true"> ${icons.externalLink} </span>
            <span class="aics-action__copy">
              <span class="aics-action__label">打开云端岗位商城</span>
            </span>
          </a>
        </div>
      </section>
    </section>
  `;
}

export function renderAicsDashboard(props: AicsDashboardProps) {
  const version = props.version || "unknown";

  return html`
    <section class="aics-page">
      <section class="aics-hero" aria-labelledby="aics-title">
        <div class="aics-hero__main">
          <div class="aics-kicker">迭界AI</div>
          <h1 id="aics-title">
            ${renderTitleWithHelp("我的岗位", "调度层负责派单、确认和状态更新。")}
          </h1>
          <div class="aics-hero__meta">
            ${renderStatusPill(props.connected)}
            <span class="aics-chip">版本 ${version}</span>
          </div>
        </div>
        <div class="aics-hero__actions">${renderSchedulerPanel(props)}</div>
      </section>

      ${renderRoleWorkbench(props)}
    </section>
  `;
}
