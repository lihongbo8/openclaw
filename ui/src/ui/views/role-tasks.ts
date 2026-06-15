import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state.js";
import type { Tab } from "../navigation.js";

export function renderRoleTasksPage(state: AppViewState, _onNavigate: (tab: Tab) => void) {
  const mf = (state.aicsMainFlow?.readModel ?? null) as Record<string, unknown> | null;
  const counts = (mf?.counts ?? {}) as Record<string, number>;
  const blockedReasons = (mf?.blockedReasons ?? []) as Array<{
    stage: string;
    code: string;
    message: string;
  }>;
  const latest = (mf?.latest ?? {}) as Record<string, { title?: string; summary?: string } | null>;
  const objects = (mf?.objects ?? {}) as Record<string, Array<Record<string, unknown>>>;
  const dispatchRequests = objects.dispatchToRoleRequests ?? [];
  const roleResults = objects.roleResults ?? [];

  const taskCount = counts.taskPackages ?? 0;
  const runningCount = dispatchRequests.filter((request) => request.status === "running").length;
  const waitingConfirmCount = dispatchRequests.filter(
    (request) => request.confirmExecution !== true || request.costConfirmed !== true,
  ).length;
  const completedCount = roleResults.length || (counts.roleResults ?? 0);
  const pendingCount = Math.max(0, taskCount - completedCount - runningCount - waitingConfirmCount);

  return html`
    <div style="padding:16px;max-width:900px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="font-size:20px;margin:0">岗位任务</h1>
        <button
          @click=${() => state.refreshAicsMainFlowReadModel()}
          style="padding:6px 16px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px"
          ?disabled=${state.aicsMainFlow?.loading}
        >
          ${state.aicsMainFlow?.loading ? "刷新中" : "刷新"}
        </button>
      </div>

      <!-- Kanban columns -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px">
        ${[
          { label: "队列", count: pendingCount, color: "#718096", bg: "#f7fafc" },
          { label: "运行中", count: runningCount, color: "#3182ce", bg: "#ebf8ff" },
          { label: "待确认", count: waitingConfirmCount, color: "#dd6b20", bg: "#fffaf0" },
          { label: "已完成", count: completedCount, color: "#38a169", bg: "#f0fff4" },
          { label: "阻塞", count: blockedReasons.length, color: "#e53e3e", bg: "#fff5f5" },
        ].map(
          (col) => html`
            <div
              style="text-align:center;padding:12px 8px;border-radius:6px;background:${col.bg};border:1px solid var(--border-color,#e0e0e0)"
            >
              <div style="font-size:24px;font-weight:700;color:${col.color}">${col.count}</div>
              <div style="font-size:11px;color:var(--text-secondary,#666)">${col.label}</div>
            </div>
          `,
        )}
      </div>

      <!-- Task list -->
      ${taskCount === 0 && completedCount === 0
        ? html`
            <div style="text-align:center;padding:40px;color:var(--text-secondary,#666)">
              <p style="font-size:16px;margin-bottom:8px">暂无任务</p>
              <p style="font-size:13px">
                先在「任务调度」确认调度并生成 TaskPackage / DispatchToRoleRequest。
              </p>
            </div>
          `
        : html`
            <div style="display:grid;gap:8px">
              ${latest.taskPackage
                ? html`
                    <div
                      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;border-left:4px solid #3182ce"
                    >
                      <div
                        style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"
                      >
                        <strong style="font-size:14px"
                          >任务：${latest.taskPackage.title ?? "待执行"}</strong
                        >
                        <span
                          style="font-size:11px;padding:2px 8px;border-radius:10px;background:#ebf8ff;color:#3182ce"
                          >待执行</span
                        >
                      </div>
                      <div style="font-size:12px;color:var(--text-secondary,#666)">
                        ${latest.dispatchToRoleRequest ? "已生成调度请求" : "等待调度确认"} |
                        来源目标: ${latest.companyGoal?.title ?? "-"}
                      </div>
                    </div>
                  `
                : nothing}
              ${latest.roleResult
                ? html`
                    <div
                      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;border-left:4px solid #38a169"
                    >
                      <div
                        style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"
                      >
                        <strong style="font-size:14px"
                          >最近执行:
                          ${(latest.roleResult as { outcome?: string; summary?: string }).outcome ??
                          "完成"}</strong
                        >
                        <span
                          style="font-size:11px;padding:2px 8px;border-radius:10px;background:#f0fff4;color:#38a169"
                          >已完成</span
                        >
                      </div>
                      <div style="font-size:12px;color:var(--text-secondary,#666)">
                        ${(latest.roleResult as { summary?: string }).summary?.slice(0, 150) ?? ""}
                      </div>
                    </div>
                  `
                : nothing}
            </div>
          `}
      ${blockedReasons.length > 0
        ? html`
            <div
              style="margin-top:16px;padding:12px;border:1px solid #fed7d7;border-radius:6px;background:#fff5f5"
            >
              <strong style="font-size:13px;color:#e53e3e">阻塞原因</strong>
              ${blockedReasons.map(
                (b) =>
                  html`<div style="font-size:12px;color:#c53030;margin-top:4px">
                    [${b.stage}] ${b.message}
                  </div>`,
              )}
            </div>
          `
        : nothing}
    </div>
  `;
}
