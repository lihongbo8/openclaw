import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state.js";
import {
  createSession,
  loadSession,
  listSessions,
  startBriefing,
  submitBrief,
  confirmSession,
  generatePackage,
  resetBuildSession,
  type BuildSessionPageState,
  type BuildSessionBrief,
} from "../controllers/build-session.js";

// ═══ 多步岗位生成向导 ═══
//
// 流程: 输入需求 → 自动匹配品类能力 → 确认brief → 生成 → 校验 → 完成

export function renderBuildSessionWizard(
  state: AppViewState,
  bs: BuildSessionPageState,
  requestHostUpdate?: () => void,
) {
  const step = bs.step;

  const update = () => requestHostUpdate?.();

  return html`
    <div style="padding:16px;max-width:700px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="font-size:18px;margin:0">🧪 生成新岗位</h2>
        ${step !== "idle"
          ? html`
              <button
                @click=${() => {
                  resetBuildSession(bs);
                  update();
                }}
                style="padding:4px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
              >
                ← 返回
              </button>
            `
          : nothing}
      </div>

      ${bs.error
        ? html`
            <div
              style="padding:10px 14px;background:#fff5f5;border:1px solid #e53e3e;border-radius:6px;color:#c53030;margin-bottom:12px;font-size:13px"
            >
              ${bs.error}
            </div>
          `
        : nothing}
      ${renderStep(state, bs, update)}
      ${bs.loading
        ? html`
            <div
              style="text-align:center;padding:12px;color:var(--text-secondary,#666);font-size:13px"
            >
              ⏳ 处理中...
            </div>
          `
        : nothing}
    </div>
  `;
}

function renderStep(state: AppViewState, bs: BuildSessionPageState, update: () => void) {
  switch (bs.step) {
    case "idle":
      return renderIdleStep(state, bs, update);
    case "briefing":
      return renderBriefingStep(state, bs, update);
    case "confirming":
      return renderConfirmingStep(state, bs, update);
    case "generating":
      return renderGeneratingStep(bs);
    case "validating":
      return renderValidatingStep(bs);
    case "completed":
      return renderCompletedStep(bs, update);
    case "failed":
      return renderFailedStep(bs, update);
    default:
      return html`<p style="text-align:center;color:var(--text-secondary,#666)">未知步骤</p>`;
  }
}

// ---- Step: idle（需求输入 + 会话列表）----

function renderIdleStep(state: AppViewState, bs: BuildSessionPageState, update: () => void) {
  return html`
    <!-- 需求输入 -->
    <div
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:16px;margin-bottom:16px"
    >
      <h3 style="font-size:15px;margin:0 0 8px 0">告诉我你要什么岗位</h3>
      <p style="font-size:12px;color:var(--text-secondary,#888);margin:0 0 10px 0">
        用自然语言描述岗位需求，系统自动匹配品类和能力。例如：<br />
        "需要一个电商美工岗位，负责产品主图、详情页、Banner设计，输出符合平台规范的视觉素材"
      </p>
      <textarea
        .value=${bs.requirements}
        @input=${(e: InputEvent) => {
          bs.requirements = (e.target as HTMLTextAreaElement).value;
        }}
        rows="4"
        placeholder="输入岗位需求描述..."
        style="width:100%;padding:8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical;box-sizing:border-box"
      ></textarea>
      <button
        @click=${async () => {
          if (!bs.requirements.trim()) return;
          await createSession(state, bs);
          update();
        }}
        style="margin-top:10px;padding:8px 20px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600"
        ?disabled=${bs.loading || !bs.requirements.trim()}
      >
        🚀 开始匹配 →
      </button>
    </div>

    <!-- 现有会话列表 -->
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3 style="font-size:14px;margin:0">或继续之前的会话</h3>
        <button
          @click=${async () => {
            await listSessions(state, bs);
            update();
          }}
          style="padding:3px 8px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:3px;cursor:pointer;font-size:11px"
        >
          刷新
        </button>
      </div>
      ${bs.sessions.length === 0
        ? html`
            <p
              style="text-align:center;color:var(--text-secondary,#999);padding:20px;font-size:13px"
            >
              暂无历史会话
            </p>
          `
        : html`
            ${bs.sessions.slice(0, 10).map(
              (s) => html`
                <div
                  @click=${async () => {
                    await loadSession(state, bs, s.sessionId);
                    update();
                  }}
                  style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid var(--border-color,#e0e0e0);border-radius:6px;margin-bottom:6px;cursor:pointer;transition:background .1s"
                  @mouseenter=${(e: Event) => {
                    (e.target as HTMLElement).style.background = "var(--bg-hover,#f0f4ff)";
                  }}
                  @mouseleave=${(e: Event) => {
                    (e.target as HTMLElement).style.background = "";
                  }}
                >
                  <div>
                    <div style="font-size:13px;font-weight:500">
                      ${s.brief?.roleTitle ?? s.userRequirements.slice(0, 40)}
                    </div>
                    <div style="font-size:11px;color:var(--text-secondary,#999)">
                      ${s.state} · ${new Date(s.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <span
                    style="font-size:11px;padding:2px 8px;border-radius:8px;background:${stateColorBg(
                      s.state,
                    )};color:${stateColorText(s.state)}"
                    >${stateLabel(s.state)}</span
                  >
                </div>
              `,
            )}
          `}
    </div>
  `;
}

// ---- Step: briefing（匹配结果展示）----

function renderBriefingStep(state: AppViewState, bs: BuildSessionPageState, update: () => void) {
  const s = bs.session;
  return html`
    <div
      style="border:1px solid #3182ce;border-radius:8px;padding:16px;margin-bottom:12px;background:#f0f7ff"
    >
      <h3 style="font-size:15px;margin:0 0 4px 0">✅ 品类匹配完成</h3>
      <p style="font-size:12px;color:var(--text-secondary,#666);margin:0 0 8px 0">
        系统已根据你的需求自动匹配品类和能力。请确认后进入 brief 编辑。
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
        <div>
          <strong>匹配品类</strong>
          <span style="margin-left:8px;color:#3182ce;font-weight:600"
            >${s?.matchedTemplate ?? "通用"}</span
          >
        </div>
        <div>
          <strong>需求</strong>
          <span style="margin-left:8px">${(s?.userRequirements ?? "").slice(0, 30)}...</span>
        </div>
      </div>
      ${bs.availableTemplates.length > 0
        ? html`
            <div style="margin-top:8px;font-size:12px;color:var(--text-secondary,#888)">
              可选品类：${bs.availableTemplates.map((t) => t.label).join("、")}
            </div>
          `
        : nothing}
    </div>
    <button
      @click=${async () => {
        await startBriefing(state, bs);
        update();
      }}
      style="padding:8px 20px;background:#38a169;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600"
    >
      确认匹配，继续 → 编辑 Brief
    </button>
  `;
}

// ---- Step: confirming（brief 编辑表单）----

function renderConfirmingStep(state: AppViewState, bs: BuildSessionPageState, update: () => void) {
  const bf = bs.briefForm;
  const set = (field: keyof BuildSessionBrief, value: unknown) => {
    (bf as Record<string, unknown>)[field] = value;
  };
  const strArray = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];

  return html`
    <div
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:16px;margin-bottom:12px"
    >
      <h3 style="font-size:15px;margin:0 0 12px 0">📝 编辑岗位 Brief</h3>

      <div style="display:grid;gap:8px">
        <input
          placeholder="岗位名称（必填）"
          .value=${bf.roleTitle ?? ""}
          @input=${(e: InputEvent) => set("roleTitle", (e.target as HTMLInputElement).value)}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
        />
        <textarea
          placeholder="岗位描述"
          .value=${bf.roleDescription ?? ""}
          rows="2"
          @input=${(e: InputEvent) =>
            set("roleDescription", (e.target as HTMLTextAreaElement).value)}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical"
        ></textarea>
        <input
          placeholder="品类"
          .value=${bf.targetCategory ?? ""}
          @input=${(e: InputEvent) => set("targetCategory", (e.target as HTMLInputElement).value)}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
        />
        <textarea
          placeholder="核心职责（每行一项）"
          .value=${strArray(bf.coreResponsibilities).join("\n")}
          rows="3"
          @input=${(e: InputEvent) =>
            set(
              "coreResponsibilities",
              (e.target as HTMLTextAreaElement).value.split("\n").filter(Boolean),
            )}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical"
        ></textarea>
        <textarea
          placeholder="任务示例（每行一项）"
          .value=${strArray(bf.taskExamples).join("\n")}
          rows="3"
          @input=${(e: InputEvent) =>
            set(
              "taskExamples",
              (e.target as HTMLTextAreaElement).value.split("\n").filter(Boolean),
            )}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical"
        ></textarea>
        <textarea
          placeholder="能力需求（每行一项，如 image.generation）"
          .value=${strArray(bf.requiredCapabilities).join("\n")}
          rows="2"
          @input=${(e: InputEvent) =>
            set(
              "requiredCapabilities",
              (e.target as HTMLTextAreaElement).value.split("\n").filter(Boolean),
            )}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical"
        ></textarea>
      </div>
    </div>

    <div style="display:flex;gap:8px">
      <button
        @click=${async () => {
          await submitBrief(state, bs);
          update();
        }}
        style="padding:8px 20px;background:#3182ce;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600"
      >
        💾 保存 Brief →
      </button>
      <button
        @click=${async () => {
          await confirmSession(state, bs, "用户确认 brief");
          update();
        }}
        style="padding:8px 20px;background:#38a169;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600"
        ?disabled=${!bf.roleTitle}
      >
        ✅ 确认并生成
      </button>
      <button
        @click=${async () => {
          await confirmSession(state, bs, "用户确认 brief");
          await generatePackage(state, bs);
          update();
        }}
        style="padding:8px 20px;background:#805ad5;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600"
        ?disabled=${!bf.roleTitle || bs.loading}
      >
        ⚡ 一键确认+生成
      </button>
    </div>
  `;
}

// ---- Step: generating（加载中）----

function renderGeneratingStep(bs: BuildSessionPageState) {
  return html`
    <div style="text-align:center;padding:40px">
      <div style="font-size:40px;margin-bottom:12px">⚙️</div>
      <p style="font-size:15px;font-weight:600;margin:0 0 4px 0">正在生成岗位包...</p>
      <p style="font-size:12px;color:var(--text-secondary,#666)">
        ${bs.session?.matchedTemplate ? `品类: ${bs.session.matchedTemplate}` : ""}
        ${bs.session?.brief ? `· 岗位: ${bs.session.brief.roleTitle}` : ""}
      </p>
    </div>
  `;
}

// ---- Step: validating（校验结果）----

function renderValidatingStep(bs: BuildSessionPageState) {
  const errors = bs.generateResult?.validationErrors ?? bs.session?.validationErrors ?? [];
  return html`
    <div style="text-align:center;padding:30px">
      <div style="font-size:40px;margin-bottom:12px">🔍</div>
      <p style="font-size:15px;font-weight:600">校验中...</p>
      ${errors.length > 0
        ? html`
            <div
              style="text-align:left;margin-top:12px;padding:12px;background:#fffaf0;border:1px solid #dd6b20;border-radius:6px"
            >
              ${errors.map((e) => html`<div style="font-size:13px;color:#c05621">⚠️ ${e}</div>`)}
            </div>
          `
        : nothing}
    </div>
  `;
}

// ---- Step: completed（成功）----

function renderCompletedStep(bs: BuildSessionPageState, update: () => void) {
  const pkg = bs.generateResult;
  const files = pkg?.files ?? [];
  return html`
    <div
      style="border:1px solid #38a169;border-radius:8px;padding:16px;margin-bottom:12px;background:#f0fff4"
    >
      <h3 style="font-size:16px;margin:0 0 4px 0;color:#38a169">✅ 岗位包生成完成！</h3>
      <p style="font-size:12px;color:var(--text-secondary,#666);margin:0">
        会话状态: ${bs.session?.state ?? "completed"}
        ${pkg?.packageDir
          ? html`· 输出目录:
              <code
                style="font-size:11px;background:var(--bg-secondary,#eee);padding:1px 4px;border-radius:3px"
                >${pkg.packageDir}</code
              >`
          : nothing}
      </p>
    </div>

    ${files.length > 0
      ? html`
          <div
            style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:16px;margin-bottom:12px"
          >
            <h4 style="font-size:14px;margin:0 0 8px 0">生成文件</h4>
            <div style="display:grid;gap:4px">
              ${files.map(
                (f) => html`
                  <div
                    style="font-size:13px;padding:4px 0;border-bottom:1px solid var(--border-color,#f0f0f0)"
                  >
                    📄 ${f}
                  </div>
                `,
              )}
            </div>
          </div>
        `
      : nothing}
    ${(pkg?.validationErrors ?? []).length > 0
      ? html`
          <div
            style="padding:12px;background:#fffaf0;border:1px solid #dd6b20;border-radius:6px;margin-bottom:12px"
          >
            <strong style="font-size:13px;color:#c05621">校验警告</strong>
            ${pkg!.validationErrors!.map(
              (e) => html`<div style="font-size:12px;color:#c05621">⚠️ ${e}</div>`,
            )}
          </div>
        `
      : nothing}

    <button
      @click=${() => {
        resetBuildSession(bs);
        update();
      }}
      style="padding:8px 20px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px"
    >
      创建另一个岗位
    </button>
  `;
}

// ---- Step: failed（失败）----

function renderFailedStep(bs: BuildSessionPageState, update: () => void) {
  return html`
    <div
      style="border:1px solid #e53e3e;border-radius:8px;padding:16px;margin-bottom:12px;background:#fff5f5"
    >
      <h3 style="font-size:16px;margin:0 0 4px 0;color:#c53030">❌ 生成失败</h3>
      <p style="font-size:13px;color:var(--text-secondary,#666);margin:4px 0">
        ${bs.session?.blockedReason ?? bs.error ?? "未知错误"}
      </p>
      ${bs.session?.validationErrors.length
        ? html`
            <div style="margin-top:8px">
              ${bs.session.validationErrors.map(
                (e) => html`<div style="font-size:12px;color:#c53030">⚠️ ${e}</div>`,
              )}
            </div>
          `
        : nothing}
    </div>
    <button
      @click=${() => {
        resetBuildSession(bs);
        update();
      }}
      style="padding:8px 20px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px"
    >
      ← 重新开始
    </button>
  `;
}

// ======================================================================
// Helpers
// ======================================================================

function stateLabel(s: string): string {
  switch (s) {
    case "created":
      return "待处理";
    case "briefing":
      return "匹配中";
    case "confirming":
      return "待确认";
    case "generating":
      return "生成中";
    case "validating":
      return "校验中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return s;
  }
}

function stateColorBg(s: string): string {
  switch (s) {
    case "completed":
      return "#c6f6d5";
    case "failed":
      return "#fed7d7";
    case "confirming":
      return "#fefcbf";
    default:
      return "#e2e8f0";
  }
}

function stateColorText(s: string): string {
  switch (s) {
    case "completed":
      return "#276749";
    case "failed":
      return "#9b2c2c";
    case "confirming":
      return "#975a16";
    default:
      return "#4a5568";
  }
}
