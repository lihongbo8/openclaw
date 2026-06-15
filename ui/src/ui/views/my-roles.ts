import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state.js";
import type { MyRolesPageState } from "../controllers/my-roles.js";
import {
  closeDetail,
  runExecution,
  selectRole,
  setDetailTab,
  setQuery,
  setStatusFilter,
  setViewMode,
} from "../controllers/my-roles.js";
import type { Tab } from "../navigation.js";

type ExecutionRecord = Record<string, unknown>;

const STATUS_LABELS: Record<string, string> = {
  ready: "待执行",
  running: "执行中",
  needs_human_confirm: "待人工确认",
  blocked: "阻塞",
  failed: "失败",
  completed: "已完成",
};

const STATUS_COLORS: Record<string, string> = {
  ready: "#2b6cb0",
  running: "#805ad5",
  needs_human_confirm: "#b7791f",
  blocked: "#c53030",
  failed: "#e53e3e",
  completed: "#2f855a",
};

function text(value: unknown, fallback = "-"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function formatDate(value: unknown): string {
  const n = numberValue(value);
  return n ? new Date(n).toLocaleString() : "-";
}

function statusLabel(status: unknown): string {
  return STATUS_LABELS[text(status, "ready")] ?? text(status, "ready");
}

function statusColor(status: unknown): string {
  return STATUS_COLORS[text(status, "ready")] ?? "#718096";
}

function metric(label: string, value: unknown, color = "var(--text-primary,#333)") {
  return html`
    <div
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:10px;text-align:center;background:var(--bg-elevated,#fff)"
    >
      <div style="font-size:22px;font-weight:700;color:${color}">${value}</div>
      <div style="font-size:11px;color:var(--text-secondary,#666)">${label}</div>
    </div>
  `;
}

function statusButton(ps: MyRolesPageState, key: string, label: string) {
  const active = ps.statusFilter === key;
  return html`
    <button
      type="button"
      @click=${() => setStatusFilter(ps, key)}
      style="padding:5px 10px;border:1px solid ${active
        ? "var(--accent-color,#3366ff)"
        : "var(--border-color,#ccc)"};border-radius:4px;background:${active
        ? "var(--accent-color,#3366ff)"
        : "var(--bg-elevated,#fff)"};color:${active
        ? "#fff"
        : "var(--text-primary,#333)"};font-size:12px;cursor:pointer"
    >
      ${label}
    </button>
  `;
}

export function renderMyRolesPage(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const ps = state.myRoles;
  if (!ps.readModel && !ps.loading) {
    return html`
      <div style="padding:40px;text-align:center;color:var(--text-secondary,#666)">
        <div style="font-size:16px;margin-bottom:8px">岗位执行控制台尚未加载</div>
        <button
          type="button"
          @click=${() => state.refreshMyRolesReadModel?.()}
          style="padding:6px 14px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px"
        >
          加载岗位执行
        </button>
      </div>
    `;
  }

  const readModel = (ps.readModel ?? {}) as Record<string, unknown>;
  const summary = (readModel.summary ?? {}) as Record<string, unknown>;
  const executions = (readModel.executions ?? []) as ExecutionRecord[];
  const blockedReasons = (readModel.blockedReasons ?? []) as Array<Record<string, unknown>>;

  const filtered = executions.filter((execution) => {
    const status = text(execution.status, "ready");
    if (ps.statusFilter !== "all" && status !== ps.statusFilter) return false;
    if (ps.query.trim()) {
      const q = ps.query.trim().toLowerCase();
      const haystack = [
        execution.title,
        execution.roleTitle,
        execution.sourceGoalTitle,
        execution.planningTitle,
        execution.workBlockTitle,
        execution.taskText,
        execution.expectedOutput,
      ]
        .map((item) => text(item, "").toLowerCase())
        .join(" ");
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const selectedExecution =
    executions.find((execution) => execution.id === ps.selectedRoleKey) ?? null;

  return html`
    <div style="padding:16px;max-width:1180px;margin:0 auto">
      <div
        style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px"
      >
        <div>
          <h1 style="font-size:20px;margin:0">岗位执行</h1>
          <p style="font-size:12px;color:var(--text-secondary,#666);margin:4px 0 0 0">
            执行层只处理已通过任务调度确认的 DispatchToRoleRequest；未授权、缺 actor_context
            或独特能力待确认时必须阻塞。
          </p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <button
            type="button"
            @click=${() => state.refreshMyRolesReadModel?.()}
            style="padding:6px 12px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
            ?disabled=${ps.loading}
          >
            ${ps.loading ? "刷新中..." : "刷新"}
          </button>
          <button
            type="button"
            @click=${() => onNavigate("workboard")}
            style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
          >
            返回任务调度
          </button>
        </div>
      </div>

      ${ps.error
        ? html`<div
            style="padding:10px;background:#fff5f5;border:1px solid #e53e3e;border-radius:6px;color:#c53030;margin-bottom:12px;font-size:13px"
          >
            ${ps.error}
          </div>`
        : nothing}

      <div
        style="display:grid;grid-template-columns:repeat(8,minmax(88px,1fr));gap:8px;margin-bottom:16px"
      >
        ${metric("总任务", numberValue(summary.total))}
        ${metric("待执行", numberValue(summary.ready), "#2b6cb0")}
        ${metric("执行中", numberValue(summary.running), "#805ad5")}
        ${metric("待确认", numberValue(summary.needsHumanConfirm), "#b7791f")}
        ${metric("阻塞", numberValue(summary.blocked), "#c53030")}
        ${metric("失败", numberValue(summary.failed), "#e53e3e")}
        ${metric("完成", numberValue(summary.completed), "#2f855a")}
        ${metric("产物", numberValue(summary.artifactCount), "#3182ce")}
      </div>

      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <input
          placeholder="搜索目标、规划、岗位、任务"
          .value=${ps.query}
          @input=${(event: InputEvent) => setQuery(ps, (event.target as HTMLInputElement).value)}
          style="flex:1;min-width:220px;padding:7px 9px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
        />
        ${statusButton(ps, "all", "全部")} ${statusButton(ps, "ready", "待执行")}
        ${statusButton(ps, "running", "执行中")} ${statusButton(ps, "blocked", "阻塞")}
        ${statusButton(ps, "failed", "失败")} ${statusButton(ps, "completed", "完成")}
        <button
          type="button"
          @click=${() => setViewMode(ps, ps.viewMode === "queue" ? "artifacts" : "queue")}
          style="padding:5px 10px;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-secondary,#eee);font-size:12px;cursor:pointer"
        >
          ${ps.viewMode === "queue" ? "队列视图" : "产物视图"}
        </button>
      </div>

      ${blockedReasons.length
        ? html`
            <section
              style="border:1px solid #fed7d7;background:#fff5f5;border-radius:8px;padding:12px;margin-bottom:14px"
            >
              <div style="font-size:13px;font-weight:700;color:#c53030;margin-bottom:6px">
                执行层阻塞
              </div>
              ${blockedReasons.map(
                (reason) => html`
                  <div style="font-size:12px;color:#c53030;margin-top:3px">
                    ${text(reason.code)}: ${text(reason.message)}
                  </div>
                `,
              )}
            </section>
          `
        : nothing}
      ${filtered.length === 0
        ? html`
            <div
              style="text-align:center;padding:56px;color:var(--text-secondary,#666);border:1px dashed var(--border-color,#ccc);border-radius:8px"
            >
              <div style="font-size:16px;margin-bottom:6px">
                ${executions.length ? "没有匹配的执行任务" : "暂无可执行岗位任务"}
              </div>
              <div style="font-size:13px">
                先在任务调度页确认调度并物化 TaskPackage，岗位执行页才会出现队列。
              </div>
            </div>
          `
        : html`
            <div style="display:grid;grid-template-columns:1fr;gap:10px">
              ${filtered.map((execution) => renderExecutionCard(state, ps, execution))}
            </div>
          `}
      ${selectedExecution ? renderDetailDrawer(state, ps, selectedExecution) : nothing}
    </div>
  `;
}

function renderExecutionCard(
  state: AppViewState,
  ps: MyRolesPageState,
  execution: ExecutionRecord,
) {
  const status = text(execution.status, "ready");
  const progress = numberValue(execution.progress);
  const blockedReason = text(execution.blockedReason, "");
  const canRun = execution.canRun === true && !ps.runningExecutionId;
  return html`
    <section
      style="border:1px solid ${ps.selectedRoleKey === execution.id
        ? "var(--accent-color,#3366ff)"
        : "var(--border-color,#e0e0e0)"};border-left:4px solid ${statusColor(
        status,
      )};border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);display:grid;gap:10px"
    >
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div style="min-width:0">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <strong style="font-size:15px">${text(execution.title, "未命名执行任务")}</strong>
            <span
              style="font-size:11px;padding:2px 8px;border-radius:999px;background:${statusColor(
                status,
              )};color:#fff"
              >${statusLabel(status)}</span
            >
          </div>
          <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:4px">
            ${text(execution.sourceGoalTitle)} / ${text(execution.planningTitle)} /
            ${text(execution.workBlockTitle)}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <button
            type="button"
            @click=${() => selectRole(ps, text(execution.id))}
            style="padding:5px 10px;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-secondary,#eee);font-size:12px;cursor:pointer"
          >
            详情
          </button>
          <button
            type="button"
            @click=${() => runExecution(state, ps, execution)}
            style="padding:5px 10px;border:none;border-radius:4px;background:${canRun
              ? "#2b6cb0"
              : "#a0aec0"};color:#fff;font-size:12px;cursor:${canRun ? "pointer" : "not-allowed"}"
            ?disabled=${!canRun}
          >
            ${ps.runningExecutionId === execution.id ? "执行中..." : "执行已授权任务"}
          </button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1.2fr .8fr;gap:12px">
        <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.6">
          <div>
            <strong style="color:var(--text-primary,#333)">岗位：</strong>${text(
              execution.roleTitle,
            )}
          </div>
          <div>
            <strong style="color:var(--text-primary,#333)">任务：</strong>${text(
              execution.taskText,
            )}
          </div>
          <div>
            <strong style="color:var(--text-primary,#333)">目标产物：</strong>${text(
              execution.expectedOutput,
            )}
          </div>
        </div>
        <div style="display:grid;align-content:start;gap:6px">
          <div
            style="height:8px;border-radius:999px;background:var(--bg-secondary,#edf2f7);overflow:hidden"
          >
            <div
              style="height:100%;width:${Math.max(
                0,
                Math.min(100, progress),
              )}%;background:${statusColor(status)}"
            ></div>
          </div>
          <div
            style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary,#666)"
          >
            <span>${text(execution.currentStep, "等待执行")}</span>
            <span>${progress}%</span>
          </div>
          ${blockedReason
            ? html`<div style="font-size:12px;color:#c53030">阻塞：${blockedReason}</div>`
            : html`<div style="font-size:12px;color:#2f855a">云端授权能力已通过调度投影校验</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderDetailDrawer(state: AppViewState, ps: MyRolesPageState, execution: ExecutionRecord) {
  const tabs = ["overview", "steps", "artifacts", "boundary"] as const;
  const tabLabels: Record<(typeof tabs)[number], string> = {
    overview: "概览",
    steps: "步骤",
    artifacts: "产物",
    boundary: "边界",
  };
  const result = (execution.result ?? null) as Record<string, unknown> | null;
  const artifactRefs = list(execution.artifactRefs);
  const allowedTools = list(execution.allowedTools);
  const allowedSkills = list(execution.allowedSkills);
  const uniqueRequest = (execution.uniqueCapabilityRequest ?? null) as Record<
    string,
    unknown
  > | null;

  return html`
    <aside
      style="position:fixed;top:0;right:0;width:440px;max-width:100vw;height:100vh;background:var(--bg-primary,#fff);box-shadow:-4px 0 20px rgba(0,0,0,.12);z-index:100;overflow-y:auto;padding:20px;display:grid;align-content:start;gap:14px"
    >
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div>
          <h2 style="font-size:16px;margin:0">${text(execution.title, "执行详情")}</h2>
          <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:4px">
            ${text(execution.roleTitle)} / ${statusLabel(execution.status)}
          </div>
        </div>
        <button
          type="button"
          @click=${() => closeDetail(ps)}
          style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-secondary,#666)"
        >
          x
        </button>
      </div>

      <div style="display:flex;gap:4px;border-bottom:1px solid var(--border-color,#e0e0e0)">
        ${tabs.map(
          (tab) => html`
            <button
              type="button"
              @click=${() => setDetailTab(ps, tab)}
              style="padding:7px 10px;border:none;background:none;border-bottom:2px solid ${ps.detailTab ===
              tab
                ? "var(--accent-color,#3366ff)"
                : "transparent"};margin-bottom:-1px;font-size:12px;cursor:pointer;color:${ps.detailTab ===
              tab
                ? "var(--accent-color,#3366ff)"
                : "var(--text-secondary,#666)"}"
            >
              ${tabLabels[tab]}
            </button>
          `,
        )}
      </div>

      ${ps.detailTab === "overview"
        ? html`
            <div style="display:grid;gap:8px;font-size:13px">
              <div><strong>公司目标：</strong>${text(execution.sourceGoalTitle)}</div>
              <div><strong>规划方案：</strong>${text(execution.planningTitle)}</div>
              <div><strong>工作块：</strong>${text(execution.workBlockTitle)}</div>
              <div><strong>调度请求：</strong>${text(execution.dispatchRequestId)}</div>
              <div><strong>任务包：</strong>${text(execution.taskPackageId)}</div>
              <div><strong>更新时间：</strong>${formatDate(execution.updatedAt)}</div>
              <div><strong>能力匹配：</strong>${text(execution.capabilitySummary)}</div>
              ${result
                ? html`<div>
                    <strong>执行结果：</strong>${text(result.outcome)} / ${text(result.summary)}
                  </div>`
                : nothing}
            </div>
          `
        : ps.detailTab === "steps"
          ? html`
              <div style="display:grid;gap:8px">
                ${[
                  ["调度确认", "DispatchProposalReview 已确认后才能物化任务包。"],
                  ["任务物化", "TaskPackage 与 DispatchToRoleRequest 已进入执行层。"],
                  [
                    text(execution.currentStep, "等待执行"),
                    text(result?.summary, "等待执行器返回 RoleResult。"),
                  ],
                ].map(
                  ([title, body], index) => html`
                    <div
                      style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:10px;font-size:12px"
                    >
                      <div style="font-weight:700">${index + 1}. ${title}</div>
                      <div style="color:var(--text-secondary,#666);margin-top:4px">${body}</div>
                    </div>
                  `,
                )}
              </div>
            `
          : ps.detailTab === "artifacts"
            ? html`
                <div style="display:grid;gap:8px">
                  ${artifactRefs.length
                    ? artifactRefs.map(
                        (artifact) => html`
                          <div
                            style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:8px;font-size:12px;display:flex;justify-content:space-between;gap:8px"
                          >
                            <span>${artifact}</span>
                            <span style="color:#2f855a">已记录</span>
                          </div>
                        `,
                      )
                    : html`<div
                        style="font-size:13px;color:var(--text-secondary,#666);text-align:center;padding:24px"
                      >
                        暂无产物。执行完成后会显示 RoleResult artifactRefs。
                      </div>`}
                </div>
              `
            : html`
                <div style="display:grid;gap:10px;font-size:12px">
                  <section
                    style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:10px"
                  >
                    <div style="font-weight:700;margin-bottom:6px">允许工具</div>
                    <div style="color:var(--text-secondary,#666)">
                      ${allowedTools.length ? allowedTools.join(" / ") : "未声明"}
                    </div>
                  </section>
                  <section
                    style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:10px"
                  >
                    <div style="font-weight:700;margin-bottom:6px">允许 Skill</div>
                    <div style="color:var(--text-secondary,#666)">
                      ${allowedSkills.length ? allowedSkills.join(" / ") : "未声明"}
                    </div>
                  </section>
                  <section
                    style="border:1px solid ${execution.blockedReason
                      ? "#fed7d7"
                      : "var(--border-color,#e0e0e0)"};border-radius:6px;padding:10px;background:${execution.blockedReason
                      ? "#fff5f5"
                      : "var(--bg-elevated,#fff)"}"
                  >
                    <div style="font-weight:700;margin-bottom:6px">阻塞边界</div>
                    <div
                      style="color:${execution.blockedReason
                        ? "#c53030"
                        : "var(--text-secondary,#666)"}"
                    >
                      ${text(
                        execution.blockedReason,
                        "无阻塞；仍必须通过调度层和云端授权能力执行。",
                      )}
                    </div>
                    ${uniqueRequest
                      ? html`<div style="margin-top:6px;color:#c05621">
                          独特能力申请：${text(uniqueRequest.missingCapability)} /
                          ${text(uniqueRequest.status)}
                        </div>`
                      : nothing}
                  </section>
                  <button
                    type="button"
                    @click=${() => runExecution(state, ps, execution)}
                    style="padding:8px 10px;border:none;border-radius:4px;background:${execution.canRun ===
                      true && !ps.runningExecutionId
                      ? "#2b6cb0"
                      : "#a0aec0"};color:#fff;font-size:13px;cursor:${execution.canRun === true &&
                    !ps.runningExecutionId
                      ? "pointer"
                      : "not-allowed"}"
                    ?disabled=${execution.canRun !== true || Boolean(ps.runningExecutionId)}
                  >
                    执行已授权任务
                  </button>
                </div>
              `}
    </aside>
  `;
}
