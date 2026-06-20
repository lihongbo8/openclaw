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
import type { ToolSupplyControlReadModel } from "../controllers/tool-supply-control.js";
import { renderSupportContactCard } from "./support-contact.ts";

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
      ${renderSupportContactCard(
        state.supportContact,
        "岗位创建、品类能力、审核或上架卡住时，联系系统开发者处理。",
        () => state.refreshSupportContact?.(),
      )}
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
      return renderCompletedStep(state, bs, update);
    case "failed":
      return renderFailedStep(bs, update);
    default:
      return html`<p style="text-align:center;color:var(--text-secondary,#666)">未知步骤</p>`;
  }
}

// ---- Step: idle（需求输入 + 会话列表）----

function renderIdleStep(state: AppViewState, bs: BuildSessionPageState, update: () => void) {
  const activeSessions = bs.sessions.filter(
    (session) => session.state !== "failed" && session.state !== "cancelled",
  );
  const roleLimitReached = activeSessions.length >= 3;
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
      <div
        style="font-size:12px;color:${roleLimitReached
          ? "#c53030"
          : "var(--text-secondary,#666)"};margin:0 0 10px 0"
      >
        ${`开发席位：${Math.min(activeSessions.length, 3)} / 3${
          roleLimitReached ? "。请先取消或清理已有岗位后再创建新岗位。" : ""
        }`}
      </div>
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
        style="margin-top:10px;padding:8px 20px;background:${roleLimitReached
          ? "#a0aec0"
          : "var(--accent-color,#3366ff)"};color:#fff;border:none;border-radius:4px;cursor:${roleLimitReached
          ? "not-allowed"
          : "pointer"};font-size:13px;font-weight:600"
        title=${roleLimitReached ? "开发者中心暂定最多开发 3 个岗位。" : "开始匹配岗位品类和能力。"}
        ?disabled=${bs.loading || !bs.requirements.trim() || roleLimitReached}
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
  const canGenerateByDevelopment =
    !bs.roleDevelopment ||
    bs.roleDevelopment.canGenerateRolePackage ||
    bs.roleDevelopment.status === "ready_to_generate";
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
          placeholder="目标用户"
          .value=${bf.targetUser ?? ""}
          @input=${(e: InputEvent) => set("targetUser", (e.target as HTMLInputElement).value)}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px"
        />
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
          placeholder="每日 SOP / 日规划（每行一项）"
          .value=${strArray(bf.dailySop).join("\n")}
          rows="2"
          @input=${(e: InputEvent) =>
            set("dailySop", (e.target as HTMLTextAreaElement).value.split("\n").filter(Boolean))}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical"
        ></textarea>
        <textarea
          placeholder="每周 SOP / 周规划（每行一项）"
          .value=${strArray(bf.weeklySop).join("\n")}
          rows="2"
          @input=${(e: InputEvent) =>
            set("weeklySop", (e.target as HTMLTextAreaElement).value.split("\n").filter(Boolean))}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical"
        ></textarea>
        <textarea
          placeholder="每月 SOP / 月规划（每行一项）"
          .value=${strArray(bf.monthlySop).join("\n")}
          rows="2"
          @input=${(e: InputEvent) =>
            set("monthlySop", (e.target as HTMLTextAreaElement).value.split("\n").filter(Boolean))}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical"
        ></textarea>
        <textarea
          placeholder="输入（每行一项）"
          .value=${strArray(bf.inputTypes).join("\n")}
          rows="2"
          @input=${(e: InputEvent) =>
            set("inputTypes", (e.target as HTMLTextAreaElement).value.split("\n").filter(Boolean))}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical"
        ></textarea>
        <textarea
          placeholder="输出 / 执行产物（每行一项）"
          .value=${strArray(bf.outputTypes).join("\n")}
          rows="2"
          @input=${(e: InputEvent) =>
            set("outputTypes", (e.target as HTMLTextAreaElement).value.split("\n").filter(Boolean))}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical"
        ></textarea>
        <textarea
          placeholder="风险边界 / 禁止事项（每行一项）"
          .value=${strArray(bf.forbiddenActions).join("\n")}
          rows="2"
          @input=${(e: InputEvent) =>
            set(
              "forbiddenActions",
              (e.target as HTMLTextAreaElement).value.split("\n").filter(Boolean),
            )}
          style="padding:6px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;font-size:13px;resize:vertical"
        ></textarea>
        <textarea
          placeholder="完成标准 / 质量标准（每行一项）"
          .value=${strArray(bf.qualityStandards).join("\n")}
          rows="2"
          @input=${(e: InputEvent) =>
            set(
              "qualityStandards",
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

    ${renderExecutionContractPreview(bf)}

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
        title=${canGenerateByDevelopment
          ? "岗位定义和能力检查通过后生成岗位包。"
          : "当前岗位还有能力缺口，请先处理能力申请。"}
        ?disabled=${!bf.roleTitle || bs.loading || !canGenerateByDevelopment}
      >
        ${canGenerateByDevelopment ? "⚡ 一键确认+生成" : "先处理能力缺口"}
      </button>
    </div>
    ${renderGenerationReadinessNotice(bs)} ${renderCapabilityAnalysis(state, bs, update)}
  `;
}

function renderGenerationReadinessNotice(bs: BuildSessionPageState) {
  const development = bs.roleDevelopment;
  if (
    !development ||
    development.canGenerateRolePackage ||
    development.status === "ready_to_generate"
  ) {
    return nothing;
  }
  const missing = development.capability?.missing ?? [];
  const disabled = development.capability?.disabled ?? [];
  const nextActions = development.nextActions ?? [];
  return html`
    <section
      style="border:1px solid #fbd38d;border-radius:8px;padding:12px;margin-top:12px;background:#fffaf0;display:grid;gap:8px"
    >
      <div style="font-size:13px;font-weight:750;color:#9c4221">现在还不能生成完整岗位包</div>
      <div style="font-size:12px;color:#744210;line-height:1.55">
        ${development.userStatusLabel ||
        "岗位还有未处理的能力或审核事项。"}系统不会把缺失能力伪装成已具备能力，也不会生成一个执行时会失败的岗位。
      </div>
      ${missing.length
        ? html`<div
            style="font-size:12px;color:#744210;line-height:1.55"
            title=${missing.join("、")}
          >
            需要先处理：${humanizeRefList(missing)}
          </div>`
        : nothing}
      ${disabled.length
        ? html`<div
            style="font-size:12px;color:#2f855a;line-height:1.55"
            title=${disabled.join("、")}
          >
            当前基础版已关闭：${humanizeRefList(disabled)}。这些能力不会进入当前岗位包。
          </div>`
        : nothing}
      ${nextActions.length
        ? html`<div style="font-size:12px;color:#744210;line-height:1.55">
            下一步：${nextActions
              .map((action) => `${action.label}${action.enabled ? "" : "（等待条件满足）"}`)
              .join("、")}
          </div>`
        : nothing}
    </section>
  `;
}

function renderExecutionContractPreview(brief: Partial<BuildSessionBrief>) {
  const workPatternLabels = inferBriefWorkPatterns(brief).map(labelForWorkPattern);
  const outputContractLabels = inferBriefOutputContracts(brief).map(labelForOutputContract);
  return html`
    <section
      style="border:1px solid #c6f6d5;border-radius:8px;padding:12px;margin-bottom:12px;background:#f0fff4;display:grid;gap:8px"
    >
      <div style="font-size:13px;font-weight:750;color:var(--text-primary,#333)">
        执行与交付预览
      </div>
      <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
        系统会把这个岗位做成：${workPatternLabels.join("、")}。
      </div>
      <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
        执行完成后，结果按这些交付物验收：${outputContractLabels.join("、")}。
      </div>
      <div style="font-size:12px;color:#2f855a;line-height:1.55">
        这不是按图片、详情页等单一业务形态写死，而是按通用执行方式和输出契约生成岗位包。
      </div>
    </section>
  `;
}

function inferBriefWorkPatterns(brief: Partial<BuildSessionBrief>): string[] {
  const text = [
    brief.roleDescription,
    ...(brief.coreResponsibilities ?? []),
    ...(brief.taskExamples ?? []),
    ...(brief.outputTypes ?? []),
  ].join(" ");
  const patterns = new Set<string>();
  if (/分析|诊断|复盘|报告|总结|数据|指标/u.test(text)) patterns.add("analyze");
  if (/生成|撰写|创作|设计|图片|文案|详情页|报告/u.test(text)) patterns.add("generate");
  if (/转换|整理|改写|格式/u.test(text)) patterns.add("transform");
  if (/发布|上传|创建工单|修改库存|外部系统/u.test(text)) patterns.add("operate");
  if (patterns.size > 1) patterns.add("composite");
  if (patterns.size === 0) patterns.add("generate");
  return [...patterns];
}

function inferBriefOutputContracts(brief: Partial<BuildSessionBrief>): string[] {
  const text = [
    ...(brief.outputTypes ?? []),
    brief.roleDescription,
    ...(brief.taskExamples ?? []),
  ].join(" ");
  const contracts = new Set<string>();
  if (/图片|图像|海报|视觉|png|jpg|jpeg|webp/u.test(text)) contracts.add("image");
  if (/详情页|页面|html|网页|landing/u.test(text)) contracts.add("html");
  if (/表格|xlsx|csv|数据表/u.test(text)) contracts.add("spreadsheet");
  if (/json|结构化/u.test(text)) contracts.add("json");
  if (/发布|上传|工单|外部记录|record/u.test(text)) contracts.add("external_record");
  if (/打包|zip|压缩包|交付包/u.test(text)) contracts.add("package");
  if (/报告|文档|复盘|总结|方案|草稿|计划/u.test(text)) contracts.add("document");
  if (contracts.size === 0) contracts.add("document");
  return [...contracts];
}

function labelForWorkPattern(pattern: string): string {
  switch (pattern) {
    case "analyze":
      return "分析诊断";
    case "generate":
      return "生成创作";
    case "transform":
      return "整理转换";
    case "operate":
      return "外部操作";
    case "composite":
      return "组合执行";
    default:
      return pattern;
  }
}

function labelForOutputContract(contract: string): string {
  switch (contract) {
    case "image":
      return "图片文件";
    case "html":
      return "页面/详情页";
    case "spreadsheet":
      return "表格";
    case "json":
      return "结构化数据";
    case "external_record":
      return "外部系统记录";
    case "package":
      return "交付包";
    case "document":
      return "文档/报告";
    default:
      return contract;
  }
}

const REF_LABELS: Record<string, string> = {
  "audit.record": "审计记录",
  "data.analyze": "数据分析",
  "document.write": "文档生成",
  "external.publish": "外部发布",
  "gateway.role.read.model": "岗位读模型",
  "gateway.role_read_model": "岗位读模型",
  "human.confirm": "人工确认",
  "image.generation": "图片生成",
  "ledger.summary.read": "账本摘要读取",
  "marketplace.read": "商城数据读取",
  "model.chat.analysis": "模型分析",
  "provider.platform.model_chat_analysis": "模型分析 Provider",
  "skill.platform.marketplace_ops_diagnosis": "商城运营诊断 Skill",
  "tool.platform.audit_record": "审计记录工具",
  "tool.platform.gateway_role_read_model": "岗位读模型工具",
  "tool.platform.ledger_summary_read": "账本摘要读取工具",
  "tool.platform.marketplace_read_model": "商城数据读取工具",
  "tool.platform.template_renderer": "文档模板渲染工具",
};

function humanizeCapabilityRef(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) return "";
  const direct = REF_LABELS[trimmed];
  if (direct) return direct;
  const withoutPrefix = trimmed.replace(/^(tool|skill|provider)\.platform\./u, "");
  return withoutPrefix
    .split(/[._-]+/u)
    .filter(Boolean)
    .map((part) => part.replace(/^\w/u, (char) => char.toUpperCase()))
    .join(" ");
}

function humanizeRefList(refs: string[]): string {
  const labels = refs.map(humanizeCapabilityRef).filter(Boolean);
  return labels.length ? labels.join("、") : "无";
}

function renderCapabilityAnalysis(
  state: AppViewState,
  bs: BuildSessionPageState,
  update: () => void,
) {
  const development = bs.roleDevelopment;
  const payload = bs.capabilityAnalysis as
    | {
        analysis?: {
          categoryName?: string;
          categoryRef?: string;
          requiredCapabilities?: string[];
          neededTools?: string[];
          neededSkills?: string[];
          neededProviders?: string[];
          missingCapabilities?: string[];
          categoryCapabilityReview?: {
            id?: string;
            requestId?: string;
            workflowStatus?: string;
            reviewStatus?: string;
            reviewDecision?: string;
            cloudSyncStatus?: string;
          };
          toolSkillReviews?: Array<{ assetId?: string }>;
        };
      }
    | null
    | undefined;
  const analysis =
    (development?.analysis as NonNullable<typeof payload>["analysis"] | null | undefined) ??
    payload?.analysis;
  if (!analysis) return nothing;
  const capability = development?.capability;
  const productionTodos = [
    ...(capability?.neededTools ?? analysis.neededTools ?? []),
    ...(capability?.neededSkills ?? analysis.neededSkills ?? []),
    ...(capability?.neededProviders ?? analysis.neededProviders ?? []),
  ];
  const missingCapabilities = capability?.missing ?? analysis.missingCapabilities ?? [];
  const disabledCapabilities = capability?.disabled ?? [];
  const basicVersionAction = development?.nextActions?.find(
    (action) => action.kind === "use_basic_version",
  );
  const categoryRequest =
    (development?.categoryCapabilityReview as
      | NonNullable<NonNullable<typeof payload>["analysis"]>["categoryCapabilityReview"]
      | null
      | undefined) ?? analysis.categoryCapabilityReview;
  const workflowStatus = categoryRequest?.workflowStatus ?? "waiting_category_review";
  const reviewStatus = categoryRequest?.reviewStatus ?? "待审核";
  const reviewDecision = categoryRequest?.reviewDecision ?? "";
  const cloudSyncStatus = categoryRequest?.cloudSyncStatus ?? "未同步";
  const categoryRequestSubmitted = Boolean(categoryRequest?.id);
  const categoryRequestNeedsChanges = reviewStatus === "待开发者修改";
  const categoryActivated = reviewStatus === "已通过" && cloudSyncStatus === "已同步";
  const categoryBound = workflowStatus === "category_bound";
  const categoryApprovedWaitingActivation =
    reviewStatus === "已通过" && cloudSyncStatus !== "已同步";
  const relatedToolSupplyTodos = findRelatedToolSupplyTodos({
    bs,
    analysis,
    categoryRequest: categoryRequest as Record<string, unknown> | null | undefined,
    todos: state.toolSupplyControl?.readModel?.systemDevelopmentTodos ?? [],
  });
  const hasReusableCategory = categoryActivated || categoryBound;
  const canSubmitOrRefreshCategoryRequest =
    !hasReusableCategory &&
    !categoryApprovedWaitingActivation &&
    (!categoryRequestSubmitted || categoryRequestNeedsChanges || reviewStatus !== "已通过");
  return html`
    <section
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:12px;margin-top:12px;background:var(--bg-elevated,#fff);display:grid;gap:8px"
    >
      <div style="font-size:13px;font-weight:750">
        ${development?.userStatusLabel ?? "能力分析已生成"}
      </div>
      <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
        识别品类：${analysis.categoryName ?? development?.categoryName ?? "未识别"} ·
        状态：${workflowStatus}
      </div>
      <div
        style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55"
        title=${missingCapabilities.join("、")}
      >
        缺失能力：${humanizeRefList(missingCapabilities)}
      </div>
      ${disabledCapabilities.length
        ? html`<div
            style="font-size:12px;color:#2f855a;line-height:1.55"
            title=${disabledCapabilities.join("、")}
          >
            基础版已关闭：${humanizeRefList(
              disabledCapabilities,
            )}。这些能力不会写入当前岗位包，后续可通过工具/Skill开发补齐。
          </div>`
        : nothing}
      <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
        品类制作待办：${productionTodos.length
          ? `${productionTodos.length} 项，具体在工具与 Skill 模块处理。`
          : "无"}
      </div>
      ${development?.toolSkillDevelopment?.total
        ? html`<div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
            工具/Skill
            制作进度：${development.toolSkillDevelopment.approved}/${development
              .toolSkillDevelopment.total}
            ${development.toolSkillDevelopment.pending
              ? `，剩余 ${development.toolSkillDevelopment.pending} 项待处理。`
              : "，已完成。"}
          </div>`
        : nothing}
      <div
        style="border:1px solid ${hasReusableCategory
          ? "#c6f6d5"
          : categoryApprovedWaitingActivation
            ? "#fbd38d"
            : "#bee3f8"};border-radius:6px;padding:8px;background:${hasReusableCategory
          ? "#f0fff4"
          : categoryApprovedWaitingActivation
            ? "#fffaf0"
            : "#ebf8ff"};display:grid;gap:6px"
      >
        <div style="font-size:12px;font-weight:750;color:var(--text-primary,#333)">
          品类能力申请：${hasReusableCategory
            ? "已有可绑定品类"
            : categoryApprovedWaitingActivation
              ? "审核已通过，等待工具与 Skill 激活"
              : categoryRequestNeedsChanges
                ? "已退回，等待补充资料"
                : categoryRequestSubmitted
                  ? "等待审核中心处理"
                  : "等待开发者提交申请"}
        </div>
        <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
          ${categoryRequest?.requestId ? `申请编号：${categoryRequest.requestId} · ` : ""}
          审核状态：${reviewStatus} · 同步状态：${cloudSyncStatus}
        </div>
        ${relatedToolSupplyTodos.length
          ? html`
              <div
                style="border:1px solid #bee3f8;border-radius:6px;background:#ebf8ff;padding:8px;display:grid;gap:7px"
              >
                <div style="font-size:12px;font-weight:750;color:var(--text-primary,#333)">
                  工具与 Skill 待办：${relatedToolSupplyTodos.length} 项
                </div>
                <div style="display:grid;gap:6px">
                  ${relatedToolSupplyTodos.slice(0, 3).map(
                    (todo) => html`
                      <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.5">
                        <strong style="color:var(--text-primary,#333)" title=${todo.assetId ?? ""}>
                          ${`${todo.assetType === "skill" ? "Skill" : "Tool/API"} · ${humanizeCapabilityRef(todo.assetId ?? "")}`}
                        </strong>
                        · ${todo.reviewStatus} · ${todo.nextAction.label}
                      </div>
                    `,
                  )}
                </div>
                ${relatedToolSupplyTodos.length > 3
                  ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">
                      还有 ${relatedToolSupplyTodos.length - 3} 项，请到工具与 Skill 模块继续处理。
                    </div>`
                  : nothing}
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <button
                    type="button"
                    @click=${async () => {
                      await state.refreshToolSupplyControlReadModel?.();
                      state.setTab?.("skills");
                      update();
                    }}
                    style="padding:6px 12px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
                    ?disabled=${bs.loading}
                  >
                    去工具与 Skill处理
                  </button>
                </div>
              </div>
            `
          : nothing}
        ${development?.nextActions?.length
          ? html`
              <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
                下一步：${development.nextActions
                  .map((action) => `${action.label}${action.enabled ? "" : "（等待中）"}`)
                  .join("、")}
              </div>
            `
          : nothing}
        ${categoryRequestNeedsChanges
          ? html`<div
              style="border:1px solid #fbd38d;border-radius:6px;background:#fffaf0;padding:8px;font-size:12px;color:#9c4221;line-height:1.55"
            >
              审核中心退回原因：${reviewDecision ||
              "资料不完整"}。请补充岗位说明、SOP、输入输出或风险边界后，再点击“提交/刷新品类申请”。
            </div>`
          : nothing}
        ${categoryApprovedWaitingActivation
          ? html`
              <div style="font-size:12px;color:#9c4221;line-height:1.55">
                品类申请已通过，但还不能绑定。请先到「工具与 Skill」完成 Tool / Skill / Provider
                待办，并激活正式品类能力包。
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button
                  type="button"
                  @click=${() => {
                    state.setTab?.("skills");
                    update();
                  }}
                  style="padding:6px 12px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
                  ?disabled=${bs.loading}
                >
                  去工具与 Skill
                </button>
                <button
                  type="button"
                  @click=${async () => {
                    await state.refreshReviewCenter?.();
                    state.setTab?.("reviewCenter");
                    update();
                  }}
                  style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
                  ?disabled=${bs.loading}
                >
                  查看审核队列
                </button>
              </div>
            `
          : nothing}
        ${canSubmitOrRefreshCategoryRequest
          ? html`
              <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
                可以先做基础版继续生成岗位；如果这是核心能力，就提交开发申请，把岗位名称、岗位说明、目标用户、SOP、日周月规划、输入输出和风险边界送到审核中心。
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                ${basicVersionAction
                  ? html`<button
                      type="button"
                      @click=${async () => {
                        await state.reduceRoleDevelopmentScopeToBasic?.();
                        update();
                      }}
                      title=${basicVersionAction.reason}
                      style="padding:6px 12px;background:#2f855a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
                      ?disabled=${bs.loading || !basicVersionAction.enabled}
                    >
                      先做基础版
                    </button>`
                  : nothing}
                <button
                  type="button"
                  @click=${async () => {
                    await state.submitCategoryCapabilityRequest?.();
                    await state.refreshReviewCenter?.();
                    state.setTab?.("reviewCenter");
                    update();
                  }}
                  style="padding:6px 12px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
                  ?disabled=${bs.loading}
                >
                  提交/刷新品类申请
                </button>
                <button
                  type="button"
                  @click=${async () => {
                    await state.refreshReviewCenter?.();
                    state.setTab?.("reviewCenter");
                    update();
                  }}
                  style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
                  ?disabled=${bs.loading}
                >
                  查看审核队列
                </button>
              </div>
            `
          : html`
              ${hasReusableCategory
                ? html`<div style="font-size:12px;color:#2f855a;line-height:1.55">
                    开发者可在岗位生成完成后，从可选品类里自行绑定该品类。
                  </div>`
                : nothing}
            `}
      </div>
    </section>
  `;
}

type ToolSupplyDevelopmentTodo = NonNullable<
  NonNullable<ToolSupplyControlReadModel["systemDevelopmentTodos"]>
>[number];

function findRelatedToolSupplyTodos(params: {
  bs: BuildSessionPageState;
  analysis: Record<string, unknown> | null | undefined;
  categoryRequest: Record<string, unknown> | null | undefined;
  todos: ToolSupplyDevelopmentTodo[];
}): ToolSupplyDevelopmentTodo[] {
  const sessionId = params.bs.sessionId ?? stringField(params.bs.session, "sessionId");
  const roleTitle =
    stringField(
      params.bs.session?.brief as Record<string, unknown> | null | undefined,
      "roleTitle",
    ) ||
    (typeof params.bs.briefForm.roleTitle === "string" ? params.bs.briefForm.roleTitle.trim() : "");
  const categoryReviewId = stringField(params.categoryRequest, "id");
  const requestId = stringField(params.categoryRequest, "requestId");
  const categoryRef = stringField(params.analysis, "categoryRef");

  return params.todos.filter((todo) => {
    if (categoryReviewId && todo.categoryCapabilityReviewId === categoryReviewId) return true;
    if (requestId && todo.sourceRequestId === requestId) return true;
    if (sessionId && todo.sourceListingDraftId === sessionId) return true;
    if (roleTitle && todo.sourceRolePackageId === roleTitle) return true;
    if (categoryRef && todo.targetCategoryRef === categoryRef) return true;
    return false;
  });
}

function stringField(record: Record<string, unknown> | null | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function stringListField(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string[] {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function refAliases(value: string): string[] {
  const ref = value.trim();
  if (!ref) return [];
  return Array.from(new Set([ref, ref.replace(/_/gu, "."), ref.replace(/\./gu, "_")]));
}

function refsInclude(refs: Iterable<string>, value: string): boolean {
  const aliases = new Set(refAliases(value));
  for (const ref of refs) {
    if (aliases.has(ref)) return true;
    for (const alias of refAliases(ref)) {
      if (aliases.has(alias)) return true;
    }
  }
  return false;
}

function categoryCoversDeveloperRole(
  review: Record<string, unknown>,
  category: Record<string, unknown>,
): boolean {
  if (stringField(review, "developerId") !== stringField(category, "developerId")) return false;
  const reviewDraftId = stringField(review, "listingDraftId");
  const categoryDraftId = stringField(category, "listingDraftId");
  const reviewPackageId = stringField(review, "rolePackageId");
  const categoryPackageId = stringField(category, "rolePackageId");
  if (reviewDraftId && reviewDraftId === categoryDraftId) return true;
  if (reviewPackageId && reviewPackageId === categoryPackageId) return true;
  const categoryCapabilities = stringListField(category, "capabilityRefs").length
    ? stringListField(category, "capabilityRefs")
    : stringListField(category, "requiredCapabilities");
  const requiredCapabilities = stringListField(review, "requiredCapabilities");
  if (requiredCapabilities.length) {
    return requiredCapabilities.every((capability) =>
      refsInclude(categoryCapabilities, capability),
    );
  }
  return stringField(review, "category") === stringField(category, "categoryRef");
}

type ListingReadinessItem = {
  label: string;
  done: boolean;
  detail: string;
};

function buildListingReadinessItems(params: {
  packageReady: boolean;
  reviewCategory: string;
  reviewStatus: string;
  validationStatus: string;
  hasBlockingFinding: boolean;
  cloudRoleListingId: string;
}): ListingReadinessItem[] {
  const validationPassed = params.validationStatus === "已通过" && !params.hasBlockingFinding;
  const reviewApproved =
    params.reviewStatus === "已通过" ||
    params.reviewStatus === "已提交上架" ||
    Boolean(params.cloudRoleListingId);
  return [
    {
      label: "岗位包已生成",
      done: params.packageReady,
      detail: params.packageReady ? "已生成，可进入审核。" : "等待生成岗位包。",
    },
    {
      label: "正式品类已绑定",
      done: Boolean(params.reviewCategory),
      detail: params.reviewCategory
        ? `已绑定 ${params.reviewCategory}`
        : "先绑定已激活的正式品类。",
    },
    {
      label: "本地综合检查已通过",
      done: validationPassed || reviewApproved,
      detail:
        validationPassed || reviewApproved
          ? "结构、能力、执行契约和风险检查已通过。"
          : params.hasBlockingFinding
            ? "仍有阻塞项，请按审核中心提示修改。"
            : "提交岗位上架审核后会运行综合检查。",
    },
    {
      label: "人工审核已通过",
      done: reviewApproved,
      detail: reviewApproved ? "已通过，可以由开发者确认上架。" : "综合检查通过后需要人工确认。",
    },
    {
      label: "正式岗位商品已生成",
      done: Boolean(params.cloudRoleListingId),
      detail: params.cloudRoleListingId
        ? "已上架，可进入费用与授权。"
        : "开发者确认上架后生成正式岗位商品。",
    },
  ];
}

function renderListingReadinessChecklist(items: ListingReadinessItem[]) {
  return html`
    <div
      style="border:1px solid #c6f6d5;border-radius:6px;padding:8px;background:#f0fff4;display:grid;gap:6px"
    >
      <div style="font-size:12px;font-weight:750;color:var(--text-primary,#333)">上架准备清单</div>
      ${items.map(
        (item) => html`
          <div style="display:grid;gap:2px;font-size:12px;line-height:1.45">
            <div style="color:${item.done ? "#2f855a" : "#9c4221"};font-weight:650">
              ${item.done ? "已完成" : "待处理"} · ${item.label}
            </div>
            <div style="color:var(--text-secondary,#666)">${item.detail}</div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderPostListingExecutionPath(roleListingId: string) {
  return html`
    <div
      style="border:1px solid #bee3f8;border-radius:6px;padding:8px;background:#ebf8ff;display:grid;gap:6px"
    >
      <div style="font-size:12px;font-weight:750;color:var(--text-primary,#333)">
        执行拿结果路径
      </div>
      <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
        1. 到费用与授权创建 0 元正式授权；2. 到岗位执行派发真实任务；3.
        执行完成后读取图片、详情页、执行摘要、打包文件、审计记录和账本记录。
      </div>
      <div style="font-size:12px;color:#2b6cb0;line-height:1.55;word-break:break-all">
        当前岗位商品：${roleListingId}
      </div>
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

function renderCompletedStep(state: AppViewState, bs: BuildSessionPageState, update: () => void) {
  const pkg = bs.generateResult;
  const files = pkg?.files ?? [];
  const generatedReview =
    pkg?.review && typeof pkg.review === "object" && !Array.isArray(pkg.review)
      ? (pkg.review as Record<string, unknown>)
      : null;
  const generatedReviewId = typeof generatedReview?.id === "string" ? generatedReview.id : "";
  const liveReview =
    generatedReviewId && Array.isArray(state.reviewCenter?.roleReviews)
      ? state.reviewCenter.roleReviews.find((item) => item.id === generatedReviewId)
      : null;
  const review = liveReview
    ? ({ ...generatedReview, ...liveReview } as Record<string, unknown>)
    : generatedReview;
  const listingResult =
    pkg?.listingResult && typeof pkg.listingResult === "object" && !Array.isArray(pkg.listingResult)
      ? (pkg.listingResult as Record<string, unknown>)
      : null;
  const cloud =
    listingResult?.cloud &&
    typeof listingResult.cloud === "object" &&
    !Array.isArray(listingResult.cloud)
      ? (listingResult.cloud as Record<string, unknown>)
      : {};
  const reviewId = typeof review?.id === "string" ? review.id : "";
  const reviewStatus = typeof review?.reviewStatus === "string" ? review.reviewStatus : "待审核";
  const reviewCategory = typeof review?.category === "string" ? review.category : "";
  const reviewDecision = typeof review?.reviewDecision === "string" ? review.reviewDecision : "";
  const validationStatus =
    typeof review?.validationStatus === "string" ? review.validationStatus : "";
  const reviewFindings = Array.isArray(review?.reviewFindings)
    ? review.reviewFindings.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const hasBlockingFinding = reviewFindings.some(
    (finding) => stringField(finding, "severity") === "blocking",
  );
  const requiredCapabilities = Array.isArray(review?.requiredCapabilities)
    ? review.requiredCapabilities.filter((item): item is string => typeof item === "string")
    : [];
  const bindableCategories =
    review && reviewId
      ? [
          ...(Array.isArray(bs.bindableCategoryReviews) ? bs.bindableCategoryReviews : []),
          ...(Array.isArray(state.reviewCenter?.categoryCapabilityReviews)
            ? state.reviewCenter.categoryCapabilityReviews
            : []),
        ]
          .filter(
            (category, index, categories) =>
              categories.findIndex((item) => item.id === category.id) === index,
          )
          .filter(
            (category) =>
              category.reviewStatus === "已通过" &&
              category.cloudSyncStatus === "已同步" &&
              reviewCategory !== category.categoryRef &&
              categoryCoversDeveloperRole(review, category as unknown as Record<string, unknown>),
          )
          .slice(0, 3)
      : [];
  const cloudRoleListingId =
    (typeof review?.cloudRoleListingId === "string" && review.cloudRoleListingId) ||
    (typeof cloud.roleListingId === "string" && cloud.roleListingId) ||
    "";
  const canSubmitListing = Boolean(
    reviewId && reviewStatus === "已通过" && reviewCategory && !cloudRoleListingId,
  );
  const canApproveLocalReview = Boolean(
    reviewId &&
    reviewCategory &&
    !cloudRoleListingId &&
    reviewStatus === "检查中" &&
    validationStatus === "已通过" &&
    !hasBlockingFinding,
  );
  const canSubmitRoleReview = Boolean(
    reviewId &&
    reviewCategory &&
    !cloudRoleListingId &&
    !canApproveLocalReview &&
    reviewStatus !== "已通过" &&
    reviewStatus !== "已提交上架",
  );
  const nextStep = cloudRoleListingId
    ? {
        title: "下一步：去费用与授权创建 0 元正式授权。",
        body: "岗位商品已经生成，进入费用与授权后会显示待授权岗位。",
      }
    : canSubmitListing
      ? {
          title: "下一步：岗位开发者确认上架。",
          body: "本地审核已通过，点击“开发者确认上架”生成正式岗位商品。",
        }
      : canApproveLocalReview
        ? {
            title: "下一步：人工通过本地审核。",
            body: "本地综合检查已通过，需要岗位开发者人工确认后才能上架。",
          }
        : canSubmitRoleReview
          ? {
              title: "下一步：提交岗位上架审核。",
              body: "正式品类已绑定，点击“提交岗位上架审核”进入审核中心队列；审核中心只检查岗位资料、品类绑定和风险边界。",
            }
          : {
              title: "下一步：去审核中心处理本地审核。",
              body:
                reviewStatus === "待审核"
                  ? "审核中心会检查岗位包、绑定品类是否正确、风险和合格性。"
                  : reviewDecision || "当前还不能上架，请先按审核中心提示处理阻塞。",
            };
  const readinessItems = buildListingReadinessItems({
    packageReady: Boolean(pkg?.packageDir || files.length),
    reviewCategory,
    reviewStatus,
    validationStatus,
    hasBlockingFinding,
    cloudRoleListingId,
  });
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
    ${reviewId
      ? html`
          <section
            style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:12px;margin-bottom:12px;background:var(--bg-elevated,#fff);display:grid;gap:8px"
          >
            <div style="font-size:13px;font-weight:750">${nextStep.title}</div>
            <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
              ${nextStep.body}
            </div>
            <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
              审核状态：${reviewStatus}${reviewCategory
                ? ` · 绑定品类：${reviewCategory}`
                : " · 暂未绑定正式品类"}
            </div>
            ${cloudRoleListingId
              ? html`
                  <div style="font-size:12px;color:#2f855a;line-height:1.55;word-break:break-all">
                    岗位商品：${cloudRoleListingId} · 首个真实可执行岗位按 0 元正式授权处理
                  </div>
                `
              : nothing}
            <div
              style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55"
              title=${requiredCapabilities.join("、")}
            >
              能力需求：${requiredCapabilities.length
                ? humanizeRefList(requiredCapabilities)
                : "未声明"}
            </div>
            ${renderListingReadinessChecklist(readinessItems)}
            ${cloudRoleListingId ? renderPostListingExecutionPath(cloudRoleListingId) : nothing}
            ${bindableCategories.length
              ? html`
                  <div
                    style="border:1px solid #bee3f8;border-radius:6px;padding:8px;background:#ebf8ff;display:grid;gap:6px"
                  >
                    <div style="font-size:12px;font-weight:750;color:var(--text-primary,#333)">
                      可选品类
                    </div>
                    <div style="font-size:12px;color:#2b6cb0;line-height:1.55">
                      正式品类已激活，可以绑定。岗位开发者需要先绑定品类，再提交岗位上架审核。
                    </div>
                    ${bindableCategories.map(
                      (category) => html`
                        <div
                          style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"
                        >
                          <span style="font-size:12px;color:var(--text-secondary,#666)">
                            ${category.categoryName} · ${category.categoryRef}
                          </span>
                          <button
                            type="button"
                            @click=${async () => {
                              await state.refreshBuildSessionBindableCategories?.(reviewId);
                              await state.bindRoleReviewCategory?.(reviewId, category.id);
                              await state.refreshReviewCenter?.();
                              await state.refreshBuildSessionBindableCategories?.(reviewId);
                              update();
                            }}
                            style="padding:5px 10px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px"
                            ?disabled=${bs.loading}
                          >
                            绑定品类
                          </button>
                        </div>
                      `,
                    )}
                  </div>
                `
              : nothing}
            ${reviewId && !reviewCategory
              ? html`
                  <div style="font-size:12px;color:#c05621;line-height:1.55">
                    暂未绑定正式品类，岗位不能上架。请先刷新列表并绑定已激活品类。
                  </div>
                  <button
                    type="button"
                    @click=${async () => {
                      await state.refreshBuildSessionBindableCategories?.(reviewId);
                      update();
                    }}
                    style="padding:5px 10px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
                    ?disabled=${bs.loading}
                  >
                    刷新列表
                  </button>
                `
              : nothing}
          </section>
        `
      : nothing}

    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${canApproveLocalReview
        ? html`
            <button
              @click=${async () => {
                await state.approveRoleReview?.(reviewId);
                await state.refreshReviewCenter?.();
                update();
              }}
              title="人工确认本地综合检查结果，允许岗位开发者进入确认上架。"
              style="padding:8px 20px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600"
              ?disabled=${bs.loading}
            >
              人工通过本地审核
            </button>
          `
        : nothing}
      ${reviewId && !cloudRoleListingId && !canSubmitListing && !canApproveLocalReview
        ? html`
            <button
              @click=${async () => {
                if (canSubmitRoleReview) {
                  await state.runRoleReviewValidation?.(reviewId);
                } else {
                  await state.refreshReviewCenter?.();
                }
                state.setTab?.("reviewCenter");
                update();
              }}
              title=${canSubmitRoleReview
                ? "岗位开发者提交岗位上架审核，审核中心检查岗位资料、正式品类和风险边界。"
                : "进入审核中心查看阻塞原因。"}
              style="padding:8px 20px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600"
              ?disabled=${bs.loading}
            >
              ${canSubmitRoleReview ? "提交岗位上架审核" : "去审核中心"}
            </button>
          `
        : nothing}
      ${reviewId
        ? html`
            <button
              @click=${async () => {
                await state.submitDeveloperRoleForListing?.(reviewId);
                update();
              }}
              title=${canSubmitListing
                ? "岗位开发者确认上架，生成正式岗位商品。"
                : cloudRoleListingId
                  ? "岗位商品已上架。"
                  : "需要先绑定正式品类，并由本地审核中心人工通过后，岗位开发者才能上架。"}
              style="padding:8px 20px;background:${canSubmitListing
                ? "#38a169"
                : "#a0aec0"};color:#fff;border:none;border-radius:4px;cursor:${canSubmitListing
                ? "pointer"
                : "not-allowed"};font-size:13px;font-weight:600"
              ?disabled=${bs.loading || !canSubmitListing}
            >
              ${bs.loading ? "处理中..." : cloudRoleListingId ? "已上架" : "开发者确认上架"}
            </button>
          `
        : nothing}
      ${cloudRoleListingId
        ? html`
            <button
              @click=${() => state.setTab?.("usage")}
              style="padding:8px 20px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600"
            >
              去费用与授权
            </button>
            <button
              @click=${() => state.setTab?.("aics")}
              title="完成岗位授权后，进入岗位执行页派发任务并查看执行结果。"
              style="padding:8px 20px;background:#2f855a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600"
            >
              去岗位执行
            </button>
          `
        : nothing}
      <button
        @click=${() => {
          resetBuildSession(bs);
          update();
        }}
        style="padding:8px 20px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:13px"
      >
        创建另一个岗位
      </button>
    </div>
    ${reviewId
      ? html`
          <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:8px">
            审核状态：${reviewStatus}${cloudRoleListingId
              ? ` · 岗位商品：${cloudRoleListingId}`
              : ""}
          </div>
        `
      : nothing}
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
