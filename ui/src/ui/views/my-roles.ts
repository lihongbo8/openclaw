import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state.js";
import { aicsMainFlow, selectAuthorizedRoleForDispatch } from "../controllers/aics-main-flow.js";
import type { MyRolesPageState, RoleArtifactPreview } from "../controllers/my-roles.js";
import {
  closeDetail,
  runExecution,
  selectRole,
  setDetailTab,
  setQuery,
  setStatusFilter,
  setViewMode,
} from "../controllers/my-roles.js";
import type { ToolSupplyControlReadModel } from "../controllers/tool-supply-control.js";
import type { Tab } from "../navigation.js";
import { renderSupportContactCard } from "./support-contact.ts";

type ExecutionRecord = Record<string, unknown>;
type RoleAssetRecord = Record<string, unknown>;

const STATUS_LABELS: Record<string, string> = {
  ready: "待执行",
  running: "正在执行",
  needs_human_confirm: "执行前检查中",
  blocked: "已阻塞",
  failed: "执行失败",
  completed: "已完成",
};

const ROLE_OUTCOME_LABELS: Record<string, string> = {
  succeeded: "成功",
  completed: "成功",
  failed: "失败",
  blocked: "阻塞",
  timed_out: "超时",
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

function userFacingText(value: unknown, fallback = "-"): string {
  return text(value, fallback)
    .replace(/\bactor_context\b/giu, "账号上下文")
    .replace(/\ballowedTools\b/giu, "允许调用的工具")
    .replace(/\ballowedSkills\b/giu, "允许调用的 Skill")
    .replace(/\bcategoryCapabilityId\b/giu, "品类能力包")
    .replace(/\bdispatch_request\b/giu, "执行队列")
    .replace(/\broleListingId\b/giu, "岗位商品")
    .replace(/\bentitlementId\b/giu, "授权凭证")
    .replace(/生成\s+ledgerRef/gu, "生成费用凭证")
    .replace(/\bledgerRef\b/gu, "费用凭证")
    .replace(/\bauditRef\b/gu, "审计记录")
    .replace(/\bartifactRefs\b/gu, "业务产物")
    .replace(/\bTaskPackage\b/g, "派发任务")
    .replace(/\bRoleResult\b/g, "岗位执行结果")
    .replace(/\bmissing_api_binding\b/giu, "缺少 API 连接")
    .replace(/API Key/giu, "API 密钥")
    .replace(/API 密钥\s+后/gu, "API 密钥后")
    .replace(/模型\s+Provider/giu, "模型服务")
    .replace(/\bProvider\b/giu, "模型服务")
    .replace(/artifact:[^\s；,，。)）]+/gu, "业务产物")
    .replace(/ledger:[^\s；,，。)）]+/gu, "账本记录")
    .replace(/audit:[^\s；,，。)）]+/gu, "审计记录")
    .replace(/未声明\s+允许调用的工具/gu, "未声明允许调用的工具")
    .replace(/未声明\s+允许调用的 Skill/gu, "未声明允许调用的 Skill");
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordList(value: unknown): RoleAssetRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is RoleAssetRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function createToolSupplyLabelMap(model: ToolSupplyControlReadModel | null | undefined) {
  return new Map(
    [...(model?.localTools ?? []), ...(model?.skills ?? [])].map((item) => [item.id, item.label]),
  );
}

function humanizeCapabilityRef(ref: string, labels: Map<string, string>) {
  const known = labels.get(ref);
  if (known) return known;
  const builtInLabels: Record<string, string> = {
    "core.openai.image.generate": "图片生成",
    "core.workspace.detail.write": "详情页写入",
    "core.artifact.quality.check": "产物质量检查",
    "core.artifact.package.bundle": "产物打包",
    "img:gen": "图片生成能力",
    "ws:write": "详情页写入能力",
    "quality:check": "质量检查能力",
    "file:pack": "打包交付能力",
  };
  if (builtInLabels[ref]) return builtInLabels[ref];
  return ref
    .replace(/^tool:/u, "")
    .replace(/^skill:/u, "")
    .replace(/^plugin:/u, "")
    .replace(/^cloud:/u, "")
    .replace(/^unique:/u, "");
}

function capabilityLabels(value: unknown, labels: Map<string, string>) {
  return list(value).map((item) => humanizeCapabilityRef(item, labels));
}

function apiConnectionEntries(state: AppViewState): Array<Record<string, unknown>> {
  const readModel = (state.apiConnections?.readModel ?? {}) as Record<string, unknown>;
  const groups = (readModel.groups ?? {}) as Record<string, unknown>;
  return Array.isArray(readModel.entries)
    ? (readModel.entries as Array<Record<string, unknown>>)
    : Object.values(groups).flatMap((group) =>
        Array.isArray(group) ? (group as Array<Record<string, unknown>>) : [],
      );
}

function roleExecutionApiModelLabel(state: AppViewState): string {
  const entries = apiConnectionEntries(state).filter((entry) => entry.kind === "model");
  const usable = entries.find((entry) => {
    const consumers = list(entry.consumers);
    const secret = record(entry.secret) ?? {};
    const enabled = entry.enabled !== false && text(entry.status, "available") !== "disabled";
    const configured = secret.status === "configured" || entry.authMode === "plaintext";
    return (
      enabled && configured && (consumers.includes("role_execution") || consumers.includes("model"))
    );
  });
  if (!usable) return "";
  const metadata = record(usable.metadata) ?? {};
  const model = text(metadata.defaultModel, "");
  return `${text(usable.name, text(usable.provider, "模型"))}${model ? ` / ${model}` : ""}`;
}

function modelUsageLabel(modelUsage: Record<string, unknown> | null | undefined): string {
  if (!modelUsage) return "";
  const provider = text(modelUsage.provider, "");
  const model = text(modelUsage.model, "");
  if (provider || model) return `${provider || "模型"} / ${model || "未记录"}`;
  const totalTokens = numberValue(modelUsage.totalTokens);
  const inputTokens = numberValue(modelUsage.inputTokens);
  const outputTokens = numberValue(modelUsage.outputTokens);
  const hasCostCents =
    typeof modelUsage.costCents === "number" && Number.isFinite(modelUsage.costCents);
  return totalTokens || inputTokens || outputTokens || hasCostCents ? "已记录模型用量" : "";
}

function ledgerFeeEvidenceLabel(
  ledgerReadback: Record<string, unknown> | null | undefined,
): string {
  if (!ledgerReadback) return "";
  const hasAuthorizationFee =
    typeof ledgerReadback.authorizationFeeCents === "number" &&
    Number.isFinite(ledgerReadback.authorizationFeeCents);
  const hasExecutionFee =
    typeof ledgerReadback.executionFeeCents === "number" &&
    Number.isFinite(ledgerReadback.executionFeeCents);
  if (!hasAuthorizationFee && !hasExecutionFee) return "账本已读回";
  const authorizationFee = hasAuthorizationFee
    ? numberValue(ledgerReadback.authorizationFeeCents)
    : 0;
  const executionFee = hasExecutionFee ? numberValue(ledgerReadback.executionFeeCents) : 0;
  return `账本已读回 · 授权 ¥${(authorizationFee / 100).toFixed(2)} · 执行 ¥${(executionFee / 100).toFixed(2)}`;
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function yuanLabelFromCents(value: unknown, decimals = 2): string {
  return hasFiniteNumber(value) ? `¥${(value / 100).toFixed(decimals)}` : "未记录";
}

function costSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    local_ledger: "本地账本",
    local_zero_price: "本地零价账本",
    cloud_ledger: "云端账本",
  };
  return labels[source] ?? source.replace(/_/gu, " ");
}

function ledgerStatusLabel(status: unknown): string {
  const normalized = text(status, "");
  const labels: Record<string, string> = {
    posted: "已入账",
    pending: "待入账",
    failed: "入账失败",
    reversed: "已冲正",
    cancelled: "已取消",
  };
  return labels[normalized] ?? userFacingText(normalized, "已读回");
}

function costSummaryLabel(costSummary: Record<string, unknown> | null | undefined): string {
  if (!costSummary) return "";
  const parts = [
    `授权 ${yuanLabelFromCents(costSummary.authorizationFeeCents)}`,
    `执行 ${yuanLabelFromCents(costSummary.executionFeeCents)}`,
  ];
  if (hasFiniteNumber(costSummary.modelUsageCostCents)) {
    parts.push(`模型 ${yuanLabelFromCents(costSummary.modelUsageCostCents, 4)}`);
  }
  if (hasFiniteNumber(costSummary.totalCostCents)) {
    parts.push(`合计 ${yuanLabelFromCents(costSummary.totalCostCents, 4)}`);
  }
  const source = text(costSummary.source, "");
  return source ? `${parts.join(" · ")} · ${costSourceLabel(source)}` : parts.join(" · ");
}

function feeEvidenceLabel(
  modelUsage: Record<string, unknown> | null | undefined,
  ledgerReadback?: Record<string, unknown> | null,
): string {
  const hasCostCents =
    Boolean(modelUsage) &&
    typeof modelUsage?.costCents === "number" &&
    Number.isFinite(modelUsage.costCents);
  if (hasCostCents) return `¥${(numberValue(modelUsage?.costCents) / 100).toFixed(4)}`;
  return ledgerFeeEvidenceLabel(ledgerReadback) || "无真实费用金额";
}

function noModelUsageReason(executionEvidence: Record<string, unknown>): string {
  if (executionEvidence.modelUsageNotApplicable !== true) return "";
  return (
    text(executionEvidence.modelUsageNotApplicableReason, "") ||
    "本次执行未调用模型，因此无模型费用证据。"
  );
}

type BlockerTarget = "skills" | "apiManagement" | "usage" | "workboard";

function blockerHelp(code: string): { missing: string; action: string; target: BlockerTarget } {
  const map: Record<string, { missing: string; action: string; target: BlockerTarget }> = {
    missing_task_package: {
      missing: "还没有派发单",
      action: "先到任务调度点击“检查并派发”。",
      target: "workboard",
    },
    missing_dispatch_to_role_request: {
      missing: "还没有执行队列项",
      action: "先到任务调度生成派发单和执行队列项。",
      target: "workboard",
    },
    authorization_required: {
      missing: "缺少岗位授权",
      action: "到费用与授权确认岗位授权和授权凭证。",
      target: "usage",
    },
    execution_confirmation_required: {
      missing: "未确认执行",
      action: "点击“确认并运行”，系统会先完成执行确认和费用凭证检查。",
      target: "usage",
    },
    cost_not_confirmed: {
      missing: "未确认费用",
      action: "到费用与授权确认本次执行费用。",
      target: "usage",
    },
    missing_category_binding: {
      missing: "还没有组成品类能力",
      action: "联系系统开发者完成该岗位的品类能力配置。",
      target: "skills",
    },
    missing_tool_binding: {
      missing: "品类能力缺少可执行工具",
      action: "联系系统开发者为该品类能力补齐工具。",
      target: "skills",
    },
    missing_skill_binding: {
      missing: "品类能力缺少工作能力",
      action: "联系系统开发者为该品类能力补齐工作能力。",
      target: "skills",
    },
    tool_skill_not_ready: {
      missing: "岗位能力未就绪",
      action: "联系系统开发者检查品类能力、权限、依赖和启用状态。",
      target: "skills",
    },
    missing_api_binding: {
      missing: "缺少 API 绑定",
      action: "到 API 管理添加模型 API 密钥，并勾选“岗位执行”或通用模型池。",
      target: "apiManagement",
    },
    skill_disabled: {
      missing: "岗位工作能力已停用",
      action: "联系系统开发者启用对应能力。",
      target: "skills",
    },
    skill_missing_dependency: {
      missing: "岗位工作能力缺少依赖",
      action: "联系系统开发者补齐对应 API 或本地环境。",
      target: "skills",
    },
    plugin_tool_disabled: {
      missing: "插件工具已禁用",
      action: "到 OpenClaw 插件或配置里启用插件工具。",
      target: "skills",
    },
    missing_tool_permission: {
      missing: "缺少工具权限",
      action: "联系系统开发者到能力配置里处理权限。",
      target: "skills",
    },
    unique_capability_pending: {
      missing: "特殊能力待确认",
      action: "等待能力审核或在 OpenClaw 配置中补齐对应能力。",
      target: "skills",
    },
    cloud_capability_not_authorized: {
      missing: "岗位能力未授权",
      action: "等待岗位能力授权后再运行。",
      target: "skills",
    },
    high_risk_needs_human_approval: {
      missing: "高风险能力待批准",
      action: "联系系统开发者在能力配置里完成批准。",
      target: "skills",
    },
    unsupported_capability_route: {
      missing: "能力路线不支持",
      action: "联系系统开发者补齐可用能力；没有现成能力时走开发流程。",
      target: "skills",
    },
  };
  return (
    map[code] ?? {
      missing: "待处理项",
      action: "先处理这个阻塞项，再重新检查执行条件。",
      target: "skills",
    }
  );
}

function uniqueCapabilityLabel(value: unknown): string {
  return text(value, "") ? "特殊岗位能力" : "特殊岗位能力";
}

function uniqueCapabilityStatusLabel(value: unknown): string {
  const raw = text(value, "");
  const map: Record<string, string> = {
    pending: "待确认",
    pending_review: "待确认",
    approved: "已批准",
    rejected: "已拒绝",
    blocked: "已阻塞",
    needs_human_confirm: "待人工确认",
  };
  return map[raw] ?? "待确认";
}

function renderBlockerHelp(
  reasons: Array<Record<string, unknown>>,
  onNavigate: (tab: Tab) => void,
) {
  return reasons.length
    ? html`<div style="display:grid;gap:8px">
        ${reasons.map((reason) => {
          const code = text(reason.code, "");
          const help = blockerHelp(code);
          const message = userFacingText(reason.message, "");
          return html`<div
            style="border:1px solid #fed7d7;background:#fff5f5;border-radius:6px;padding:9px;display:grid;gap:6px"
          >
            <div style="font-size:12px;font-weight:750;color:#c53030">缺少：${help.missing}</div>
            ${message
              ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">${message}</div>`
              : nothing}
            <div style="font-size:12px;color:var(--text-secondary,#666)">
              怎么办：${help.action}
            </div>
            <button type="button" class="secondary" @click=${() => onNavigate(help.target)}>
              去处理
            </button>
          </div>`;
        })}
      </div>`
    : html`<div style="color:#2f855a">执行预检通过，可以运行当前任务。</div>`;
}

function formatDate(value: unknown): string {
  const n = numberValue(value);
  return n ? new Date(n).toLocaleString() : "-";
}

function statusLabel(status: unknown): string {
  return STATUS_LABELS[text(status, "ready")] ?? text(status, "ready");
}

function roleOutcomeLabel(outcome: unknown): string {
  const value = text(outcome, "");
  return value ? (ROLE_OUTCOME_LABELS[value] ?? "已返回结果") : "已返回结果";
}

function statusColor(status: unknown): string {
  return STATUS_COLORS[text(status, "ready")] ?? "#718096";
}

function pageErrorHelp(message: string): { action: string; target?: Tab } | null {
  if (!message.trim()) return null;
  const lower = message.toLowerCase();
  if (
    lower.includes("401") ||
    lower.includes("402") ||
    lower.includes("429") ||
    lower.includes("unauthorized") ||
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("billing") ||
    lower.includes("insufficient_quota") ||
    message.includes("限流") ||
    message.includes("余额") ||
    message.includes("额度") ||
    message.includes("图片 API") ||
    message.includes("OpenAI") ||
    message.includes("API Key") ||
    message.includes("API 管理") ||
    message.includes("Provider")
  ) {
    return {
      action: "下一步：到 API 管理检查模型服务、API 密钥、余额和限流状态，点测试通过后再回来运行。",
      target: "apiManagement",
    };
  }
  if (
    message.includes("费用") ||
    message.includes("授权") ||
    message.includes("ledgerRef") ||
    message.includes("entitlement")
  ) {
    return {
      action: "下一步：到费用与授权确认岗位授权和本次执行费用凭证。",
      target: "usage",
    };
  }
  if (
    lower.includes("readback") ||
    message.includes("审计") ||
    message.includes("账本") ||
    message.includes("audit") ||
    message.includes("ledger")
  ) {
    return {
      action: "下一步：先刷新岗位执行读回证据；仍缺失时联系系统开发者处理审计或账本写回。",
    };
  }
  return {
    action: "下一步：按错误提示处理后，刷新岗位执行再重试。",
  };
}

function renderPageErrorHelp(message: string, onNavigate: (tab: Tab) => void) {
  const help = pageErrorHelp(message);
  if (!help) return nothing;
  return html`
    <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="color:#744210">${help.action}</span>
      ${help.target
        ? html`<button
            type="button"
            class="secondary"
            style="font-size:12px;padding:4px 8px"
            @click=${() => onNavigate(help.target!)}
          >
            去处理
          </button>`
        : nothing}
    </div>
  `;
}

function renderModelUsageEvidence(
  modelUsage: Record<string, unknown> | null | undefined,
  ledgerReadback?: Record<string, unknown> | null,
  modelUsageNotApplicableReason = "",
) {
  const feeLabel = feeEvidenceLabel(modelUsage, ledgerReadback);
  if (modelUsageNotApplicableReason) {
    return html`
      <div
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:8px;font-size:12px;display:grid;gap:4px"
      >
        <div style="font-weight:700;color:var(--text-primary,#333)">模型用量证据</div>
        <div style="color:#2f855a">无需模型费用证据</div>
        <div style="color:var(--text-secondary,#666)">${modelUsageNotApplicableReason}</div>
        <div style="color:var(--text-secondary,#666)">费用证据：${feeLabel}</div>
      </div>
    `;
  }
  if (!modelUsage) {
    return html`
      <div
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:8px;font-size:12px;display:grid;gap:4px"
      >
        <div style="font-weight:700;color:var(--text-primary,#333)">模型用量证据</div>
        <div style="color:var(--text-secondary,#666)">无模型用量证据</div>
        <div style="color:var(--text-secondary,#666)">费用证据：${feeLabel}</div>
      </div>
    `;
  }
  const inputTokens = numberValue(modelUsage.inputTokens);
  const outputTokens = numberValue(modelUsage.outputTokens);
  const totalTokens = numberValue(modelUsage.totalTokens);
  const provider = text(modelUsage.provider, "");
  const model = text(modelUsage.model, "");
  const hasUsageEvidence = Boolean(inputTokens || outputTokens || totalTokens || provider || model);
  return html`
    <div
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:8px;font-size:12px;display:grid;gap:4px"
    >
      <div style="font-weight:700;color:var(--text-primary,#333)">模型用量证据</div>
      ${hasUsageEvidence
        ? nothing
        : html`<div style="color:var(--text-secondary,#666)">无模型用量证据</div>`}
      ${provider || model
        ? html`<div style="color:var(--text-secondary,#666)">
            模型：${provider || "模型服务"} / ${model || "未记录"}
          </div>`
        : nothing}
      <div style="color:var(--text-secondary,#666)">
        模型用量：输入 ${inputTokens || 0} / 输出 ${outputTokens || 0} / 合计
        ${totalTokens || inputTokens + outputTokens || 0}
      </div>
      <div style="color:var(--text-secondary,#666)">费用证据：${feeLabel}</div>
    </div>
  `;
}

function checkItem(label: string, ok: boolean, value: string, missing: string) {
  return html`
    <div style="display:flex;justify-content:space-between;gap:8px">
      <span>${label}</span>
      <span style="color:${ok ? "#2f855a" : "#c53030"}">${ok ? value : missing}</span>
    </div>
  `;
}

function executionClosureStatusLabel(status: string) {
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

function executionClosureStatusColor(status: string) {
  if (status === "completed" || status === "ready_to_run") return "#2f855a";
  if (status === "running") return "#805ad5";
  if (status === "blocked" || status === "failed") return "#c53030";
  return "#b7791f";
}

function executionClosureTargetLabel(tab: string) {
  const labels: Record<string, string> = {
    apiManagement: "API 管理",
    usage: "费用与授权",
    skills: "能力配置",
    workboard: "任务调度",
    aics: "岗位执行",
  };
  return labels[tab] ?? "对应页面";
}

function executionClosureTarget(tab: unknown): Tab | null {
  const target = text(tab, "");
  return ["apiManagement", "usage", "skills", "workboard", "aics"].includes(target)
    ? (target as Tab)
    : null;
}

function engineStatusLabel(status: unknown) {
  if (status === "ready") return "已就绪";
  if (status === "completed") return "已完成";
  if (status === "running") return "运行中";
  if (status === "blocked") return "需处理";
  if (status === "waiting") return "等待中";
  return "未观察";
}

function engineStatusColor(status: unknown) {
  if (status === "ready" || status === "completed") return "#2f855a";
  if (status === "running") return "#805ad5";
  if (status === "blocked") return "#c53030";
  return "#b7791f";
}

function engineDisplayLabel(item: Record<string, unknown>) {
  const id = text(item.id, "");
  if (id.includes("role_development")) return "岗位供给";
  if (id.includes("tool_skill_development")) return "工具 / Skill 供给";
  if (id.includes("category_capability")) return "品类能力";
  if (id.includes("role_execution")) return "岗位运行";
  if (id.includes("tool_skill_execution")) return "工具 / Skill 运行";
  return text(item.label, "能力状态");
}

function renderRoleExecutionEngineReadiness(
  flow: Record<string, unknown> | null | undefined,
  onNavigate: (tab: Tab) => void,
) {
  const engine = record(flow?.engineReadiness);
  if (!engine) return nothing;
  const supply = record(engine.supply);
  const runtime = record(engine.runtime);
  const items = [
    record(supply.roleDevelopment),
    record(supply.toolSkillDevelopment),
    record(supply.categoryCapability),
    record(runtime.roleExecution),
    record(runtime.toolSkillExecution),
  ].filter((item): item is Record<string, unknown> => Boolean(item));
  const blockers = recordList(engine.blockers);
  const overallStatus = text(engine.overallStatus, "unknown");
  const color = engineStatusColor(overallStatus);
  const target =
    executionClosureTarget(blockers[0]?.targetTab) ?? executionClosureTarget(items[0]?.targetTab);

  return html`
    <section
      data-testid="my-roles-engine-readiness"
      style="border:1px solid ${overallStatus === "blocked"
        ? "#fed7d7"
        : "#c6f6d5"};border-radius:8px;padding:12px;background:${overallStatus === "blocked"
        ? "#fff5f5"
        : "#f0fff4"};margin-bottom:14px;display:grid;gap:10px"
    >
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div>
          <div style="font-size:12px;color:var(--text-secondary,#666)">能力与运行状态</div>
          <strong style="font-size:14px;color:${color}">${engineStatusLabel(overallStatus)}</strong>
          <div
            style="font-size:12px;color:var(--text-secondary,#666);line-height:1.5;margin-top:3px"
          >
            ${userFacingText(engine.userMessage, "等待读取岗位供给、能力供给和执行运行状态。")}
          </div>
        </div>
        ${target
          ? html`<button
              type="button"
              style="padding:5px 10px;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-elevated,#fff);font-size:12px;cursor:pointer"
              @click=${() => onNavigate(target)}
            >
              ${userFacingText(engine.nextAction, "去处理")}
            </button>`
          : nothing}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
        ${items.map((item) => {
          const blockedReasons = list(item.blockedReasons);
          const itemStatus = text(item.status, "unknown");
          return html`
            <div
              style="border:1px solid var(--border-color,#e0e0e0);border-radius:7px;background:var(--bg-elevated,#fff);padding:9px;font-size:12px;display:grid;gap:4px"
            >
              <div style="display:flex;justify-content:space-between;gap:8px">
                <strong>${engineDisplayLabel(item)}</strong>
                <span style="color:${engineStatusColor(itemStatus)}">
                  ${engineStatusLabel(itemStatus)}
                </span>
              </div>
              <div style="color:var(--text-secondary,#666);line-height:1.45">
                ${userFacingText(item.summary, "等待读取状态。")}
              </div>
              ${blockedReasons.length
                ? html`<div style="color:#c53030;line-height:1.45">
                    卡点：${blockedReasons
                      .slice(0, 2)
                      .map((reason) => userFacingText(reason, "需要处理"))
                      .join("；")}
                  </div>`
                : nothing}
            </div>
          `;
        })}
      </div>
    </section>
  `;
}

function businessArtifactLabel(ref: string, index: number): string {
  const value = ref.trim();
  if (!value) return "业务产物 " + (index + 1);
  const externalRecordLabel = externalRecordArtifactLabel(value);
  if (externalRecordLabel) return externalRecordLabel;
  const protocolLabel = protocolArtifactLabel(value);
  if (protocolLabel) return protocolLabel;
  const fileName = value.split(/[\\/]/u).pop() || value;
  switch (fileName) {
    case "hero.png":
      return "图片 hero.png";
    case "detail.html":
      return "详情页 detail.html";
    case "execution-summary.json":
      return "执行摘要";
    case "artifact-manifest.json":
      return "产物清单";
    case "artifacts.zip":
      return "打包文件 artifacts.zip";
    default:
      return fileName || "业务产物 " + (index + 1);
  }
}

function externalRecordArtifactLabel(ref: string): string {
  if (!/^(external_record|external|record):/iu.test(ref)) return "";
  const parts = ref
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  const readableId = parts.length >= 3 ? parts.slice(2).join(" ") : "";
  return readableId ? `外部记录 ${readableId}` : "外部记录";
}

function protocolArtifactLabel(ref: string): string {
  if (/^artifact:role-result:/iu.test(ref)) {
    return /summary$/iu.test(ref) ? "执行摘要" : "执行结果";
  }
  if (/^artifact:/iu.test(ref)) return "业务产物";
  return "";
}

function businessArtifactListLabel(refs: string[]): string {
  return refs.map((ref, index) => businessArtifactLabel(ref, index)).join(" / ");
}

function artifactPreviewKey(executionId: string, ref: string): string {
  return `${executionId}::${ref}`;
}

function executionIdForArtifactPreview(execution: ExecutionRecord): string {
  const result = record(execution.result);
  return text(result?.id, "") || text(execution.executionId, "") || text(execution.id, "");
}

function formatBytes(value: number): string {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function dataUrlText(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return "";
  const meta = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  try {
    if (meta.includes(";base64")) {
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(payload);
  } catch {
    return "";
  }
}

function executionSummaryFromArtifact(
  ref: string,
  preview: RoleArtifactPreview | undefined,
): Record<string, unknown> | null {
  const isSummaryJson =
    /(^|[/\\])execution-summary\.json$/iu.test(ref) || preview?.name === "execution-summary.json";
  if (!isSummaryJson || !preview?.dataUrl) return null;
  try {
    const parsed = JSON.parse(dataUrlText(preview.dataUrl));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function renderExecutionSummaryArtifact(summary: Record<string, unknown>) {
  const deliverables = Array.isArray(summary.deliverables) ? summary.deliverables.length : 0;
  return html`
    <div
      style="border:1px solid #c6f6d5;border-radius:6px;padding:8px;background:#f0fff4;display:grid;gap:4px"
    >
      <div style="font-weight:700;color:#2f855a">执行摘要</div>
      <div style="color:var(--text-secondary,#666);line-height:1.55">
        ${text(summary.title, "未命名任务")} · ${text(summary.roleTitle, "执行岗位")} ·
        ${text(summary.category, "通用品类")}
      </div>
      ${text(summary.taskText, "")
        ? html`<div style="color:var(--text-secondary,#666);line-height:1.55">
            ${text(summary.taskText)}
          </div>`
        : nothing}
      <div style="color:var(--text-secondary,#666)">交付物：${deliverables} 个</div>
    </div>
  `;
}

function renderBusinessArtifactCard(
  ref: string,
  index: number,
  preview: RoleArtifactPreview | undefined,
) {
  const fileName =
    preview?.name || (ref.includes("/") ? ref.split("/").pop() : "") || `artifact-${index + 1}`;
  const displayName = businessArtifactLabel(ref, index);
  const mimeType = preview?.mimeType || "";
  const isImage = mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/iu.test(ref);
  const isHtml = mimeType.startsWith("text/html") || /\.html?$/iu.test(ref);
  const isZip = mimeType === "application/zip" || /\.zip$/iu.test(ref);
  const isExternalRecord = /^(external_record|external|record):/iu.test(ref);
  const isProtocolArtifact = /^artifact:/iu.test(ref);
  const statusLabel = preview
    ? preview.ok
      ? "可用"
      : "读取失败"
    : isExternalRecord
      ? "已回读"
      : isProtocolArtifact
        ? "已记录"
        : "读取中";
  const secondaryLabel = isExternalRecord
    ? "外部系统回读记录"
    : isProtocolArtifact
      ? "执行结果引用"
      : mimeType || businessArtifactLabel(ref, index);
  const dataUrl = preview?.dataUrl ?? "";
  const executionSummary = executionSummaryFromArtifact(ref, preview);
  return html`
    <div
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:10px;font-size:12px;display:grid;gap:8px;background:var(--bg-elevated,#fff)"
      title=${displayName}
    >
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <span style="display:grid;gap:2px;min-width:0">
          <span style="font-weight:700;color:var(--text-primary,#222)">${displayName}</span>
          <span style="color:var(--text-secondary,#666);word-break:break-all">
            ${secondaryLabel} ${preview ? ` · ${formatBytes(preview.sizeBytes)}` : ""}
          </span>
        </span>
        <span style="color:${preview?.ok === false ? "#c53030" : "#2f855a"};white-space:nowrap">
          ${statusLabel}
        </span>
      </div>
      ${preview?.error
        ? html`<div style="color:#c53030;line-height:1.45">${preview.error}</div>`
        : nothing}
      ${preview?.ok === false
        ? html`<div style="color:#744210;line-height:1.45">
            下一步：先刷新岗位执行结果；如果仍然读取失败，重新运行任务或联系系统开发者检查本次执行工作区。
          </div>`
        : nothing}
      ${executionSummary ? renderExecutionSummaryArtifact(executionSummary) : nothing}
      ${isImage && dataUrl
        ? html`<img
            src=${dataUrl}
            alt=${displayName}
            style="width:100%;max-height:260px;object-fit:contain;border:1px solid var(--border-color,#e0e0e0);border-radius:6px;background:#fff"
          />`
        : nothing}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${isHtml && dataUrl
          ? html`<a
              class="secondary"
              style="font-size:12px;padding:6px 10px;text-decoration:none"
              href=${dataUrl}
              target="_blank"
              rel="noopener noreferrer"
              >打开详情页</a
            >`
          : nothing}
        ${dataUrl
          ? html`<a
              class="secondary"
              style="font-size:12px;padding:6px 10px;text-decoration:none"
              href=${dataUrl}
              download=${fileName}
            >
              ${isZip ? "下载打包文件" : "下载产物"}
            </a>`
          : nothing}
      </div>
    </div>
  `;
}

function auditEvidenceLabel(ref: string, index: number): string {
  const value = ref.trim();
  return value ? `审计记录 ${index + 1}` : "审计记录 " + (index + 1);
}

function ledgerEvidenceLabel(ref: string): string {
  const value = ref.trim();
  return value ? "账本记录" : "账本记录";
}

function resultLocationLabel(artifactRefs: string[]): string {
  if (!artifactRefs.length) return "";
  const labels = artifactRefs.slice(0, 3).map((ref, index) => businessArtifactLabel(ref, index));
  const suffix = artifactRefs.length > labels.length ? ` 等 ${artifactRefs.length} 个结果` : "";
  return `${labels.join(" / ")}${suffix}`;
}

function evidenceSummaryDisplayValue(item: Record<string, unknown>): string {
  const label = text(item.label, "");
  const value = text(item.value, "");
  if (label.includes("业务产物")) return businessArtifactLabel(value, 0);
  if (label.includes("审计") && value.trim()) return "已读回";
  if (label.includes("账本") && value.trim()) return "已读回";
  return value;
}

function renderExecutionClosureCard(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const readModel = record(state.aicsMainFlow?.readModel);
  const closure = record(readModel?.executionClosure);
  if (!closure) return nothing;

  const status = text(closure.status, "not_ready");
  const evidence = record(closure.evidenceReadback) ?? {};
  const businessResult = record(closure.businessResult);
  const artifactRefs = list(businessResult?.artifactRefs);
  const summary = text(businessResult?.summary, "");
  const missingEvidence = list(closure.missingEvidence);
  const readinessChecks = recordList(closure.readinessChecks);
  const evidenceSummary = recordList(closure.evidenceSummary);
  const modelUsageStatus = text(evidence.modelUsageStatus, "");
  const modelUsageMessage = text(evidence.modelUsageMessage, "");
  const productionFinalGate = record(closure.productionFinalGate);
  const productionOperatorChecklist = recordList(productionFinalGate?.operatorChecklist);
  const productionOperatorSteps = recordList(productionFinalGate?.operatorSteps);
  const productionRequiredInputs = list(productionFinalGate?.requiredInputs);
  const recoveryActions = Array.isArray(closure.recoveryActions)
    ? closure.recoveryActions.filter((item): item is Record<string, unknown> =>
        Boolean(record(item)),
      )
    : [];
  const canRun = closure.canRun === true;
  const tone = executionClosureStatusColor(status);
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

  return html`
    <section
      data-testid="execution-closure-card"
      style="border:1px solid ${border};border-radius:8px;background:${background};padding:14px;margin-bottom:14px;display:grid;gap:12px"
    >
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div style="display:grid;gap:5px">
          <div style="font-size:12px;color:var(--text-secondary,#666)">闭环完成卡</div>
          <h2 style="font-size:16px;margin:0;color:var(--text-primary,#222)">
            岗位执行闭环 · ${executionClosureStatusLabel(status)}
          </h2>
          <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
            ${status === "completed"
              ? "业务结果、产物、审计、账本和模型费用证据已全部读回，可进入下一轮观察。"
              : status === "ready_to_run"
                ? "派发单、授权、费用确认、岗位能力和 API 已满足，运行前仍需人工最终确认。"
                : status === "running"
                  ? "岗位正在真实运行，等待执行步骤、产物和证据回写。"
                  : "当前闭环还不能算完成，请按下方缺口和修复入口处理。"}
          </div>
        </div>
        <span style="font-size:12px;font-weight:700;color:${tone};white-space:nowrap">
          ${canRun ? "可运行" : "不可运行"} · ${executionClosureStatusLabel(status)}
        </span>
      </div>

      ${readinessChecks.length
        ? html`
            <div style="display:grid;gap:6px">
              <div style="font-size:12px;font-weight:700;color:var(--text-primary,#222)">
                运行前条件
              </div>
              <div
                style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;font-size:12px"
              >
                ${readinessChecks.map((check) =>
                  checkItem(
                    text(check.label, "条件"),
                    check.status === "passed",
                    "已满足",
                    text(check.detail, "缺失"),
                  ),
                )}
              </div>
            </div>
          `
        : nothing}

      <div
        style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;font-size:12px"
      >
        ${checkItem("执行结果", evidence.hasRoleResult === true, "已回写", "缺失")}
        ${checkItem("业务产物", evidence.hasBusinessArtifact === true, "已读回", "缺失")}
        ${checkItem("审计读回", evidence.hasAudit === true, "完整", "缺失")}
        ${checkItem("账本读回", evidence.hasLedger === true, "完整", "缺失")}
        ${checkItem(
          "模型费用",
          evidence.hasModelUsage === true,
          modelUsageStatus === "not_applicable" ? "无需" : "有证据",
          "缺失",
        )}
      </div>
      ${modelUsageStatus === "not_applicable" && modelUsageMessage
        ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">
            模型费用说明：${modelUsageMessage}
          </div>`
        : nothing}
      ${summary
        ? html`
            <div
              style="border:1px solid rgba(47,133,90,.25);border-radius:7px;background:var(--bg-elevated,#fff);padding:10px;font-size:12px;line-height:1.55;color:var(--text-secondary,#666)"
            >
              <strong style="color:var(--text-primary,#222)">业务结果：</strong>${summary}
              ${artifactRefs.length
                ? html`<div style="margin-top:4px">
                    产物：${businessArtifactListLabel(artifactRefs)}
                  </div>`
                : nothing}
            </div>
          `
        : nothing}
      ${evidenceSummary.length
        ? html`
            <div style="display:grid;gap:6px">
              <div style="font-size:12px;font-weight:700;color:var(--text-primary,#222)">
                证据摘要
              </div>
              <div
                style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;font-size:12px"
              >
                ${evidenceSummary.map((item) =>
                  checkItem(
                    text(item.label, "证据"),
                    item.status === "available",
                    evidenceSummaryDisplayValue(item) || "已读回",
                    evidenceSummaryDisplayValue(item) || "缺失",
                  ),
                )}
              </div>
            </div>
          `
        : nothing}
      ${missingEvidence.length
        ? html`
            <div
              style="border:1px solid #fed7d7;border-radius:7px;background:#fff5f5;padding:10px;font-size:12px;color:#c53030;line-height:1.55"
            >
              <strong>证据缺口：</strong>${missingEvidence.join("；")}
            </div>
          `
        : nothing}
      ${productionFinalGate
        ? html`
            <div
              style="border:1px solid #fbd38d;border-radius:7px;background:#fffaf0;padding:10px;font-size:12px;color:#744210;line-height:1.55;display:grid;gap:4px"
            >
              <strong>云端 SaaS 最终验收：未执行（本地版可跳过）</strong>
              <span
                >云端必须结果：${text(
                  productionFinalGate.requiredVerdict,
                  "production_plus_passed",
                )}</span
              >
              <span>${text(productionFinalGate.reason, "云端 SaaS 最终验收还未执行。")}</span>
              <span
                >下一步：${text(
                  productionFinalGate.nextAction,
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
                            ${text(item.label, "准备项")}：${text(item.detail, "待确认")}
                            ${item.requiredInput ? `（需要：${text(item.requiredInput)}）` : ""}
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
                        const requiredInputs = list(item.requiredInputs);
                        return html`
                          <span>
                            ${text(item.step, "操作步骤")}：${text(item.action, "待处理")}
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
                ? html`<span>先跑 readiness：${text(productionFinalGate.readinessCommand)}</span>`
                : nothing}
              ${productionFinalGate.finalCommand
                ? html`<span>最终验收：${text(productionFinalGate.finalCommand)}</span>`
                : nothing}
              ${productionFinalGate.secretHandling
                ? html`<span>密钥处理：${text(productionFinalGate.secretHandling)}</span>`
                : nothing}
            </div>
          `
        : nothing}
      ${recoveryActions.length
        ? html`
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              ${recoveryActions.map((action) => {
                const target = executionClosureTarget(action.targetTab);
                const label = text(
                  action.label,
                  target ? `去${executionClosureTargetLabel(target)}` : "去处理",
                );
                return html`
                  <button
                    type="button"
                    class="secondary"
                    style="font-size:12px;padding:6px 10px"
                    title=${text(action.reason, label)}
                    ?disabled=${!target}
                    @click=${() => target && onNavigate(target)}
                  >
                    ${label}
                  </button>
                `;
              })}
            </div>
          `
        : html`
            <div style="display:flex;gap:8px;flex-wrap:wrap">
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
                @click=${() => onNavigate("apiManagement")}
              >
                检查 API
              </button>
            </div>
          `}
    </section>
  `;
}

function renderExecutionPreRunChecklist(params: {
  execution: ExecutionRecord;
  canRun: boolean;
  modelLabel: string;
  toolSkillReady: boolean;
}) {
  const { execution, canRun, modelLabel, toolSkillReady } = params;
  const entitlementId = text(execution.entitlementId, "");
  const ledgerRef = text(execution.ledgerRef, "");
  const hasExecutionConfirmation = execution.confirmExecution === true;
  const hasCostConfirmation = execution.costConfirmed === true && Boolean(ledgerRef);
  const modelReady = Boolean(modelLabel) || canRun;
  const capabilityReady = toolSkillReady || canRun;
  const roleLabel = text(execution.roleTitle, "未绑定执行岗位");
  const taskLabel = text(execution.taskText, text(execution.title, "未命名任务"));
  const outputLabel = text(execution.expectedOutput, "完成后回写业务产物");
  const costLabel = hasCostConfirmation
    ? "费用已确认，会写入账本记录"
    : canRun
      ? "可能产生费用，运行前会再次确认"
      : "待费用与授权确认";
  const modelDisplayLabel = modelLabel || (canRun ? "已满足" : "待 API 管理绑定模型服务");
  const capabilityDisplayLabel = capabilityReady ? "工具 / Skill 已满足" : "工具 / Skill 待处理";
  const authorizationDisplayLabel = entitlementId ? "已授权" : "待费用与授权确认";
  const costRiskLabel = hasCostConfirmation
    ? "费用已确认，执行会写入账本记录"
    : canRun
      ? "可能产生费用，运行前会再次确认"
      : "待费用与授权确认";
  return html`
    <div
      style="border:1px solid ${canRun
        ? "#c6f6d5"
        : "var(--border-color,#e0e0e0)"};border-radius:6px;padding:8px;font-size:12px;display:grid;gap:5px;background:${canRun
        ? "#f0fff4"
        : "var(--bg-elevated,#fff)"}"
    >
      <div style="font-weight:700;color:var(--text-primary,#333)">执行前核对</div>
      <div
        style="border:1px solid ${canRun ? "#9ae6b4" : "#e2e8f0"};background:${canRun
          ? "#f0fff4"
          : "var(--bg-secondary,#f8fafc)"};border-radius:6px;padding:7px;line-height:1.5;color:var(--text-secondary,#666);display:grid;gap:3px"
      >
        <strong style="color:var(--text-primary,#333)">运行前确认</strong>
        <span>执行岗位：${roleLabel}</span>
        <span>执行任务：${taskLabel}</span>
        <span>目标产物：${outputLabel}</span>
        <span>授权是否有效：${authorizationDisplayLabel}</span>
        <span>使用模型：${modelDisplayLabel}</span>
        <span>是否会产生费用：${costRiskLabel}</span>
        <span>费用影响：${costLabel}</span>
        <span>能力条件：${capabilityDisplayLabel}</span>
      </div>
      ${checkItem("授权凭证", Boolean(entitlementId), "已授权", "待授权")}
      ${checkItem("模型服务", modelReady, modelLabel || "已满足", "待绑定")}
      ${checkItem("工具 / Skill", capabilityReady, "已满足", "待处理")}
      ${checkItem("人工确认", hasExecutionConfirmation, "已确认", "待确认")}
      ${checkItem("费用凭证", hasCostConfirmation, "已确认", "待确认")}
      ${canRun
        ? html`<div
            style="border:1px solid #f6ad55;background:#fffaf0;border-radius:6px;padding:7px;color:#744210;line-height:1.45"
          >
            点击执行可能调用真实模型、工具或 Skill
            并产生费用；系统会再次弹窗确认。执行成功后必须读回业务产物、审计记录、账本记录和模型费用证据，工具-only
            任务必须明确说明未调用模型。
          </div>`
        : nothing}
      <div style="color:var(--text-secondary,#666);line-height:1.45">
        运行后必须回写：业务产物、审计记录、账本记录、模型费用证据或未调用模型说明；缺任一项都会显示阻塞，不报成功。
      </div>
    </div>
  `;
}

function executionEvidenceParts(execution: ExecutionRecord) {
  const result = record(execution.result);
  const artifactRefs = list(execution.artifactRefs);
  const executionEvidence = record(result?.executionEvidence) ?? {};
  const auditReadback = record(executionEvidence.auditReadback);
  const ledgerReadback = record(executionEvidence.ledgerReadback);
  const modelUsage = record(executionEvidence.modelUsage);
  const costSummary = record(executionEvidence.costSummary);
  const humanConfirmationRef = text(executionEvidence.humanConfirmationRef, "");
  const businessDeliverables = recordList(executionEvidence.businessDeliverables);
  const modelUsageNotApplicableReason = noModelUsageReason(executionEvidence);
  const auditRefs = artifactRefs.filter((artifact) => artifact.startsWith("audit:"));
  const ledgerArtifactRefs = artifactRefs.filter((artifact) => artifact.startsWith("ledger:"));
  const ledgerRef = text(executionEvidence.ledgerRef, "") || ledgerArtifactRefs[0] || "";
  const businessArtifactRefs = artifactRefs.filter(isBusinessArtifactRef);
  return {
    result,
    artifactRefs,
    executionEvidence,
    auditReadback,
    ledgerReadback,
    modelUsage,
    costSummary,
    humanConfirmationRef,
    businessDeliverables,
    modelUsageNotApplicableReason,
    auditRefs,
    ledgerRef,
    businessArtifactRefs,
  };
}

function isBusinessArtifactRef(ref: string): boolean {
  return (
    !ref.startsWith("audit:") && !ref.startsWith("ledger:") && !ref.startsWith("memory_candidate:")
  );
}

function executionClosedLoopEvidenceComplete(execution: ExecutionRecord): boolean {
  const {
    auditReadback,
    ledgerReadback,
    businessArtifactRefs,
    modelUsage,
    costSummary,
    humanConfirmationRef,
    modelUsageNotApplicableReason,
  } = executionEvidenceParts(execution);
  const hasModelEvidence = Boolean(modelUsage || modelUsageNotApplicableReason);
  const hasHumanConfirmation =
    execution.confirmExecution === true ? Boolean(humanConfirmationRef) : true;
  return Boolean(
    auditReadback &&
    ledgerReadback &&
    costSummary &&
    hasHumanConfirmation &&
    businessArtifactRefs.length > 0 &&
    hasModelEvidence,
  );
}

function executionDisplayStatusLabel(execution: ExecutionRecord): string {
  const status = text(execution.status, "ready");
  if (status === "completed" && !executionClosedLoopEvidenceComplete(execution)) {
    return "已阻塞";
  }
  if (status === "completed") return "已完成";
  if (status === "failed" || status === "timed_out") return "执行失败";
  if (status === "blocked") {
    if (executionNeedsApiConfiguration(execution)) return "需要配置 API";
    if (executionNeedsCostConfirmation(execution)) return "需要确认费用";
    return "已阻塞";
  }
  if (status === "running") return runningExecutionStatusLabel(execution);
  if (status === "needs_human_confirm") {
    if (executionNeedsCostConfirmation(execution)) return "需要确认费用";
    return "执行前检查中";
  }
  if (status === "ready") {
    if (executionNeedsApiConfiguration(execution)) return "需要配置 API";
    if (executionNeedsCostConfirmation(execution)) return "需要确认费用";
    if (execution.canRun === false) return "执行前检查中";
    return "待执行";
  }
  return statusLabel(status);
}

function executionDisplayStatusColor(execution: ExecutionRecord): string {
  const status = text(execution.status, "ready");
  if (status === "completed" && !executionClosedLoopEvidenceComplete(execution)) {
    return "#c53030";
  }
  return statusColor(status);
}

function runningExecutionStatusLabel(execution: ExecutionRecord): string {
  const message = executionStatusText(execution);
  if (/生成|图片|文案|页面|报告|打包|产物/iu.test(message)) return "正在生成结果";
  if (/检查|验收|质检|读回|readback|审计|账本|证据|validation/iu.test(message)) {
    return "正在检查结果";
  }
  return "正在执行";
}

function executionNeedsApiConfiguration(execution: ExecutionRecord): boolean {
  if (execution.apiBindingReady === false) return true;
  return /缺少 API|API 绑定|API 管理|API Key|Provider|missing_api_binding/iu.test(
    executionStatusText(execution),
  );
}

function executionNeedsCostConfirmation(execution: ExecutionRecord): boolean {
  if (execution.costConfirmed === false) return true;
  const ledgerRef = text(execution.ledgerRef, "");
  if (
    execution.confirmExecution === true &&
    !ledgerRef &&
    text(execution.status, "") !== "completed"
  ) {
    return true;
  }
  return /费用确认|确认本次费用|costConfirmed|费用凭证/iu.test(executionStatusText(execution));
}

function executionStatusText(execution: ExecutionRecord): string {
  const result = record(execution.result);
  return [
    text(execution.status, ""),
    text(execution.currentStep, ""),
    text(execution.blockedReason, ""),
    text(result?.summary, ""),
    text(result?.blockedReason, ""),
    text(record(result?.executionEvidence)?.recoverySuggestion, ""),
  ].join("\n");
}

function renderExecutionPostRunEvidenceSummary(
  execution: ExecutionRecord,
  onNavigate?: (tab: Tab) => void,
) {
  const {
    result,
    auditReadback,
    ledgerReadback,
    auditRefs,
    ledgerRef,
    businessArtifactRefs,
    modelUsage,
    costSummary,
    humanConfirmationRef,
    businessDeliverables,
    modelUsageNotApplicableReason,
    executionEvidence,
  } = executionEvidenceParts(execution);
  const recoverySuggestion = userFacingText(executionEvidence.recoverySuggestion, "");
  const hasAnyEvidence =
    Boolean(result) ||
    Boolean(ledgerRef) ||
    Boolean(ledgerReadback) ||
    Boolean(costSummary) ||
    Boolean(humanConfirmationRef) ||
    Boolean(auditReadback) ||
    auditRefs.length > 0 ||
    businessArtifactRefs.length > 0;
  if (!hasAnyEvidence) return nothing;

  const outcome = text(result?.outcome, text(execution.status, ""));
  const succeeded = outcome === "succeeded" || text(execution.status, "") === "completed";
  const hasBusinessArtifact = businessArtifactRefs.length > 0;
  const hasAuditEvidence = auditRefs.length > 0 || Boolean(auditReadback);
  const hasLedgerEvidence = Boolean(ledgerRef || ledgerReadback);
  const hasCostSummary = Boolean(costSummary);
  const hasHumanConfirmation =
    execution.confirmExecution === true ? Boolean(humanConfirmationRef) : true;
  const hasModelEvidence = Boolean(modelUsage || modelUsageNotApplicableReason);
  const hasFullEvidence =
    hasBusinessArtifact &&
    hasAuditEvidence &&
    hasLedgerEvidence &&
    hasCostSummary &&
    hasHumanConfirmation &&
    hasModelEvidence;
  const evidenceOk = succeeded && hasFullEvidence;
  const hasCostCents =
    Boolean(modelUsage) &&
    typeof modelUsage?.costCents === "number" &&
    Number.isFinite(modelUsage.costCents);
  const hasFeeEvidence =
    hasCostCents || Boolean(ledgerReadback) || Boolean(modelUsageNotApplicableReason);
  const totalTokens = numberValue(modelUsage?.totalTokens);
  const resultLocation = resultLocationLabel(businessArtifactRefs);
  const auditEvidenceRefs = auditRefs.length
    ? auditRefs
    : text(auditReadback?.auditRecordId, "")
      ? [`audit:${text(auditReadback?.auditRecordId, "")}`]
      : [];
  const ledgerEvidenceRef = ledgerRef || text(ledgerReadback?.ledgerRef, "");
  const missingItems = [
    !hasBusinessArtifact ? "业务产物缺失" : "",
    !hasAuditEvidence ? "审计记录未读回" : "",
    !hasLedgerEvidence ? "账本记录未读回" : "",
    !hasCostSummary ? "费用摘要缺失" : "",
    !hasModelEvidence ? "模型费用证据缺失" : "",
  ].filter(Boolean);
  return html`
    <div
      style="border:1px solid ${evidenceOk
        ? "#c6f6d5"
        : "#fed7d7"};border-radius:6px;padding:8px;font-size:12px;display:grid;gap:5px;background:${succeeded
        ? evidenceOk
          ? "#f0fff4"
          : "#fff5f5"
        : "#fff5f5"}"
    >
      <div style="font-weight:700;color:var(--text-primary,#333)">执行后证据 · 执行结果回读</div>
      <div style="font-weight:700;color:${evidenceOk ? "#2f855a" : "#c53030"}">
        ${evidenceOk ? "闭环证据完整" : "闭环证据不完整"}
      </div>
      ${text(result?.summary, "")
        ? html`<div style="color:var(--text-secondary,#666);line-height:1.45">
            成果：${userFacingText(result?.summary)}
          </div>`
        : nothing}
      ${resultLocation
        ? html`<div
            style="border:1px solid rgba(49,130,206,.25);border-radius:6px;background:#ebf8ff;padding:7px;color:#2b6cb0;line-height:1.45"
          >
            结果位置：${resultLocation}。打开“详情”可查看、打开或下载。
          </div>`
        : nothing}
      <div style="display:grid;gap:3px;color:var(--text-secondary,#666)">
        ${checkItem("业务产物", hasBusinessArtifact, `${businessArtifactRefs.length} 个`, "缺失")}
        ${checkItem("审计记录", hasAuditEvidence, auditReadback ? "已读回" : "已记录", "缺失")}
        ${checkItem("账本记录", hasLedgerEvidence, ledgerReadback ? "已读回" : "已记录", "缺失")}
        ${checkItem("费用摘要", hasCostSummary, costSummaryLabel(costSummary), "缺失")}
        ${execution.confirmExecution === true
          ? checkItem("人工确认", Boolean(humanConfirmationRef), "已确认", "缺失")
          : nothing}
        ${checkItem(
          "费用证据",
          hasFeeEvidence,
          modelUsageNotApplicableReason
            ? `无需模型费用证据 · ${modelUsageNotApplicableReason}`
            : `${feeEvidenceLabel(modelUsage, ledgerReadback)}${
                totalTokens ? ` · 模型用量 ${totalTokens}` : ""
              }`,
          "缺真实费用金额",
        )}
      </div>
      ${businessArtifactRefs.length || auditEvidenceRefs.length || ledgerEvidenceRef
        ? html`
            <div style="display:grid;gap:3px;color:var(--text-secondary,#666);line-height:1.45">
              ${businessArtifactRefs.length
                ? html`<div>业务产物：${businessArtifactListLabel(businessArtifactRefs)}</div>`
                : nothing}
              ${auditEvidenceRefs.length
                ? html`<div>
                    审计：${auditEvidenceRefs
                      .map((ref, index) => auditEvidenceLabel(ref, index))
                      .join(" / ")}
                  </div>`
                : nothing}
              ${ledgerEvidenceRef
                ? html`<div>账本：${ledgerEvidenceLabel(ledgerEvidenceRef)}</div>`
                : nothing}
              ${costSummary ? html`<div>费用摘要：${costSummaryLabel(costSummary)}</div>` : nothing}
              ${humanConfirmationRef ? html`<div>人工确认：已确认</div>` : nothing}
              ${text(auditReadback?.summary, "")
                ? html`<div>${userFacingText(auditReadback?.summary)}</div>`
                : nothing}
            </div>
          `
        : nothing}
      ${businessDeliverables.length
        ? html`
            <div style="display:grid;gap:3px;color:var(--text-secondary,#666);line-height:1.45">
              <div style="font-weight:700;color:var(--text-primary,#333)">业务明细</div>
              ${businessDeliverables.map(
                (deliverable) => html`
                  <div>
                    ${text(deliverable.label, "业务产物")}：${text(deliverable.summary, "已生成")}
                  </div>
                `,
              )}
            </div>
          `
        : nothing}
      ${missingItems.length
        ? html`
            <div
              style="border:1px solid #fed7d7;background:#fff5f5;border-radius:6px;padding:7px;color:#c53030;line-height:1.45"
            >
              <strong>缺口：</strong>${missingItems.join("；")}。缺任一项都不能算执行完成。
            </div>
            ${onNavigate
              ? html`<div style="display:flex;gap:8px;flex-wrap:wrap">
                  ${!hasModelEvidence
                    ? html`<button
                        type="button"
                        class="secondary"
                        @click=${() => onNavigate("apiManagement")}
                      >
                        去 API 管理
                      </button>`
                    : nothing}
                  ${!hasLedgerEvidence || !hasCostSummary
                    ? html`<button
                        type="button"
                        class="secondary"
                        @click=${() => onNavigate("usage")}
                      >
                        去费用与授权
                      </button>`
                    : nothing}
                  ${!hasBusinessArtifact || !hasAuditEvidence
                    ? html`<button
                        type="button"
                        class="secondary"
                        @click=${() => onNavigate("workboard")}
                      >
                        回到任务调度
                      </button>`
                    : nothing}
                </div>`
              : nothing}
          `
        : nothing}
      ${recoverySuggestion
        ? html`
            <div
              style="border:1px solid #f6ad55;background:#fffaf0;border-radius:6px;padding:7px;color:#744210;line-height:1.45"
            >
              下一步：${recoverySuggestion}
            </div>
          `
        : nothing}
    </div>
  `;
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

function requestViewUpdate(state: AppViewState): void {
  (
    state as unknown as { requestUpdate?: () => void; requestHostUpdate?: () => void }
  ).requestHostUpdate?.();
  (
    state as unknown as { requestUpdate?: () => void; requestHostUpdate?: () => void }
  ).requestUpdate?.();
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

function renderMainFlowRoleExecutionCard(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const flow = state.aicsMainFlow.readModel;
  const latest = (flow?.latest ?? {}) as Record<string, unknown>;
  const executions = recordList(state.myRoles.readModel?.executions);
  const latestCompletedExecution = executions.find(
    (execution) => text(execution.status, "") === "completed" || Boolean(record(execution.result)),
  );
  let task = latest.taskPackage as Record<string, unknown> | null | undefined;
  let request = latest.dispatchToRoleRequest as Record<string, unknown> | null | undefined;
  let result = latest.roleResult as Record<string, unknown> | null | undefined;
  if (!task && !request && !result && latestCompletedExecution) {
    task = {
      id: text(latestCompletedExecution.taskPackageId, ""),
      title: text(latestCompletedExecution.title, "已完成岗位任务"),
      taskText: text(latestCompletedExecution.taskText, ""),
      expectedOutput: text(latestCompletedExecution.expectedOutput, ""),
      status: "completed",
    };
    request = {
      id: text(latestCompletedExecution.dispatchRequestId, text(latestCompletedExecution.id, "")),
      roleListingId: text(latestCompletedExecution.roleListingId, ""),
      roleTitle: text(latestCompletedExecution.roleTitle, ""),
      entitlementId: text(latestCompletedExecution.entitlementId, ""),
      allowedTools: list(latestCompletedExecution.allowedTools),
      allowedSkills: list(latestCompletedExecution.allowedSkills),
      confirmExecution: latestCompletedExecution.confirmExecution === true,
      costConfirmed: latestCompletedExecution.costConfirmed === true,
      ledgerRef: text(latestCompletedExecution.ledgerRef, ""),
      status: "completed",
    };
    result = record(latestCompletedExecution.result);
  }
  if (
    latestCompletedExecution &&
    (Boolean(result) ||
      text(request?.status, "") === "completed" ||
      text(task?.status, "") === "completed")
  ) {
    request = {
      ...(request ?? {}),
      id: text(request?.id, "") || text(latestCompletedExecution.dispatchRequestId, ""),
      roleListingId:
        text(request?.roleListingId, "") || text(latestCompletedExecution.roleListingId, ""),
      roleTitle: text(request?.roleTitle, "") || text(latestCompletedExecution.roleTitle, ""),
      entitlementId:
        text(request?.entitlementId, "") || text(latestCompletedExecution.entitlementId, ""),
      allowedTools: list(request?.allowedTools).length
        ? request?.allowedTools
        : list(latestCompletedExecution.allowedTools),
      allowedSkills: list(request?.allowedSkills).length
        ? request?.allowedSkills
        : list(latestCompletedExecution.allowedSkills),
      confirmExecution:
        request?.confirmExecution === true || latestCompletedExecution.confirmExecution === true,
      costConfirmed:
        request?.costConfirmed === true || latestCompletedExecution.costConfirmed === true,
      ledgerRef: text(request?.ledgerRef, "") || text(latestCompletedExecution.ledgerRef, ""),
      status: "completed",
    };
    result = result ?? record(latestCompletedExecution.result);
  }
  const preflight = (flow?.executionPreflight ?? {}) as Record<string, unknown>;
  const blockedReasons = Array.isArray(preflight.blockedReasons)
    ? (preflight.blockedReasons as Array<Record<string, unknown>>)
    : [];
  const summary = (state.myRoles.readModel?.summary ?? {}) as Record<string, unknown>;
  const selectedModelRef =
    summary.selectedModelRef && typeof summary.selectedModelRef === "object"
      ? (summary.selectedModelRef as Record<string, unknown>)
      : null;
  const selectedModelLabel = selectedModelRef
    ? `${text(selectedModelRef.provider, "模型服务")} / ${text(selectedModelRef.model, "未选模型")}`
    : "";
  const resultEvidence = record(result?.executionEvidence);
  const resultModelUsage = record(resultEvidence?.modelUsage);
  const evidenceModelLabel = modelUsageLabel(resultModelUsage);
  const completedEvidence = latestCompletedExecution
    ? executionEvidenceParts(latestCompletedExecution)
    : null;
  const completedModelUsage = completedEvidence?.modelUsage;
  const completedEvidenceModelLabel = modelUsageLabel(completedModelUsage);
  const roleExecutionModelLabel = roleExecutionApiModelLabel(state);
  const effectiveModelLabel =
    selectedModelLabel ||
    roleExecutionModelLabel ||
    evidenceModelLabel ||
    completedEvidenceModelLabel;
  const requestId = text(request?.id, "");
  const taskId = text(task?.id, "");
  const flowError = text(state.aicsMainFlow.error, "");
  const readiness = (flow?.readiness ?? {}) as Record<string, unknown>;
  const canEnter = readiness.canEnterRoleExecution === true;
  const toolSupplyLabels = createToolSupplyLabelMap(state.toolSupplyControl?.readModel);
  const allowedTools = capabilityLabels(request?.allowedTools, toolSupplyLabels);
  const allowedSkills = capabilityLabels(request?.allowedSkills, toolSupplyLabels);
  const executionDone =
    Boolean(result?.id) || request?.status === "completed" || task?.status === "completed";
  const canRun = preflight.canRun === true && !executionDone;
  const authorizedRole = selectAuthorizedRoleForDispatch(state);
  const hasRunnableApiBinding =
    preflight.hasApiBinding !== false && request?.apiBindingReady !== false;
  const hasRunnableToolSkill =
    preflight.hasToolSkillReadiness !== false && request?.toolSkillReady !== false;
  const canConfirmAndRun = Boolean(
    requestId &&
    taskId &&
    authorizedRole &&
    hasRunnableApiBinding &&
    hasRunnableToolSkill &&
    !executionDone,
  );
  const confirmAndRunTitle = executionDone
    ? "当前任务已完成。"
    : !requestId || !taskId
      ? "需要先到任务调度生成派发单和执行队列。"
      : !authorizedRole
        ? "需要先完成岗位授权后才能运行。"
        : !hasRunnableApiBinding
          ? "需要先到 API 管理补齐岗位执行所需连接。"
          : !hasRunnableToolSkill
            ? "需要先到能力配置处理工具或 Skill。"
            : "确认授权和费用，并运行已派发的岗位任务。";
  const hasRoleAuthorization = Boolean(request?.entitlementId || authorizedRole || executionDone);
  const toolSkillReady =
    executionDone ||
    request?.toolSkillReady === true ||
    preflight.hasToolSkillReadiness === true ||
    (allowedTools.length > 0 && allowedSkills.length > 0);
  const costImpactLabel =
    executionDone || request?.costConfirmed === true
      ? "本次费用已确认"
      : canRun || canConfirmAndRun
        ? "运行前会确认费用，可能调用真实模型、工具或 Skill"
        : "待费用确认";
  const toolSkillLabel = toolSkillReady
    ? [
        allowedTools.length ? `工具：${allowedTools.join("、")}` : "工具：已满足",
        allowedSkills.length ? `Skill：${allowedSkills.join("、")}` : "Skill：已满足",
      ].join(" · ")
    : "工具或 Skill 尚未满足";
  const completedExecutionForEvidence = executionDone
    ? (latestCompletedExecution ?? {
        id: requestId || taskId || "completed-execution",
        status: "completed",
        result,
        artifactRefs: Array.isArray(result?.artifactRefs) ? result.artifactRefs : [],
      })
    : null;

  return html`
    <section
      style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);margin-bottom:14px"
    >
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div>
          <div style="font-size:13px;font-weight:700;margin-bottom:4px">
            ${executionDone ? "已完成任务" : "待执行任务"}
          </div>
          <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
            这里只运行已由任务调度派发的岗位任务；检查执行条件不会绕过调度层。
          </div>
        </div>
        <button
          type="button"
          @click=${() => state.refreshAicsMainFlowReadModel?.()}
          style="padding:5px 10px;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-secondary,#eee);font-size:12px;cursor:pointer"
        >
          检查执行条件
        </button>
      </div>

      <div style="margin-top:12px">${renderRoleExecutionEngineReadiness(flow, onNavigate)}</div>

      <div
        style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:12px"
      >
        ${metric(
          "派发任务",
          executionDone ? "已完成" : taskId ? "已派发" : "缺失",
          taskId || executionDone ? "#2f855a" : "#c53030",
        )}
        ${metric(
          "执行队列",
          executionDone ? "已完成" : requestId ? "已进入" : "缺失",
          requestId || executionDone ? "#2f855a" : "#c53030",
        )}
        ${metric(
          "岗位能力",
          toolSkillReady ? "已就绪" : "待处理",
          toolSkillReady ? "#2f855a" : "#c53030",
        )}
        ${metric(
          "API 绑定",
          executionDone || preflight.hasApiBinding === true
            ? effectiveModelLabel || "已就绪"
            : "阻塞",
          executionDone || preflight.hasApiBinding === true ? "#2f855a" : "#c53030",
        )}
        ${metric(
          "人工确认",
          executionDone || request?.confirmExecution === true ? "已确认" : "待确认",
          executionDone || request?.confirmExecution === true ? "#2f855a" : "#b7791f",
        )}
        ${metric(
          "费用授权",
          executionDone || request?.costConfirmed === true ? "已确认" : "待确认",
          executionDone || request?.costConfirmed === true ? "#2f855a" : "#b7791f",
        )}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
        <div
          data-testid="openclaw-aics-execution-token-gate"
          style="font-size:12px;line-height:1.65;color:var(--text-secondary,#666)"
        >
          <div>
            <strong style="color:var(--text-primary,#333)">执行任务：</strong>${text(
              task?.title,
              "未生成",
            )}
          </div>
          <div>
            <strong style="color:var(--text-primary,#333)">执行岗位：</strong>${text(
              request?.roleTitle,
              "未绑定授权岗位",
            )}
          </div>
          <div>
            <strong style="color:var(--text-primary,#333)">授权状态：</strong>${hasRoleAuthorization
              ? "已授权"
              : "未完成岗位授权"}
          </div>
          <div>
            <strong style="color:var(--text-primary,#333)">工具 / Skill：</strong>${toolSkillLabel}
          </div>
          <div>
            <strong style="color:var(--text-primary,#333)">使用模型：</strong
            >${effectiveModelLabel || "等待 API 管理绑定岗位执行模型"}
          </div>
          <div>
            <strong style="color:var(--text-primary,#333)">费用影响：</strong>${costImpactLabel}
          </div>
          <div>
            <strong style="color:var(--text-primary,#333)">结果：</strong>${userFacingText(
              result?.summary,
              "尚未运行",
            )}
          </div>
          <div
            style="margin-top:6px;padding:7px;border:1px solid #bee3f8;background:#ebf8ff;border-radius:6px;color:#2a4365;line-height:1.55"
          >
            执行边界：只运行任务调度已经派发的岗位任务。做完结果必须读回业务产物、审计记录、账本记录和模型费用证据，缺任一项都不能算完成。
          </div>
        </div>
        <div style="font-size:12px;line-height:1.65;color:var(--text-secondary,#666)">
          ${completedExecutionForEvidence
            ? renderExecutionPostRunEvidenceSummary(completedExecutionForEvidence, onNavigate)
            : renderBlockerHelp(blockedReasons, onNavigate)}
        </div>
      </div>

      ${flowError
        ? html`<div
            style="margin-top:10px;padding:8px 10px;border:1px solid #fed7d7;background:#fff5f5;color:#c53030;border-radius:4px;font-size:12px;line-height:1.5"
          >
            ${flowError}
          </div>`
        : nothing}

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button
          type="button"
          @click=${async () => {
            if (!requestId) return;
            const ok = await aicsMainFlow.confirmAndRunExecution(state, requestId);
            state.refreshAicsMainFlowReadModel?.();
            state.refreshMyRolesReadModel?.();
            state.refreshApiConnectionsReadModel?.();
            if (ok) state.checkClosedLoopReadiness?.();
          }}
          style="padding:6px 12px;background:${canConfirmAndRun
            ? "#38a169"
            : "#a0aec0"};color:#fff;border:none;border-radius:4px;cursor:${canConfirmAndRun
            ? "pointer"
            : "not-allowed"};font-size:12px"
          title=${confirmAndRunTitle}
          ?disabled=${!canConfirmAndRun}
        >
          ${executionDone ? "已完成" : authorizedRole ? "确认并运行" : "先完成岗位授权"}
        </button>
        <button
          type="button"
          @click=${() => onNavigate("usage")}
          style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
        >
          去费用与授权
        </button>
        ${canRun
          ? html`<span style="font-size:12px;color:#2f855a;align-self:center">
              执行条件已通过，点击主按钮即可运行。
            </span>`
          : html`<span style="font-size:12px;color:var(--text-secondary,#666);align-self:center">
              主按钮会先检查授权、费用、API、工具和 Skill。
            </span>`}
        <button
          type="button"
          @click=${() => onNavigate("workboard")}
          style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
          ?disabled=${canEnter}
        >
          返回派发中心
        </button>
      </div>
    </section>
  `;
}

export function renderMyRolesPage(state: AppViewState, onNavigate: (tab: Tab) => void) {
  const ps = state.myRoles;
  const readModel = (ps.readModel ?? {}) as Record<string, unknown>;
  const summary = (readModel.summary ?? {}) as Record<string, unknown>;
  const instanceStoreError = text(summary.instanceStoreError, "");
  const executions = (readModel.executions ?? []) as ExecutionRecord[];
  const roleAssets = [...recordList(readModel.roles), ...recordList(readModel.roleAssets)].filter(
    (role, index, roles) => {
      const key = text(role.roleListingId, "") || text(role.roleKey, "") || text(role.id, "");
      return (
        Boolean(key) &&
        roles.findIndex((candidate) => {
          const candidateKey =
            text(candidate.roleListingId, "") ||
            text(candidate.roleKey, "") ||
            text(candidate.id, "");
          return candidateKey === key;
        }) === index
      );
    },
  );
  const authorizedRoleAssets = roleAssets.filter(
    (role) => text(role.entitlementStatus, "") === "authorized",
  );
  const roleAssetsError = text(readModel.roleAssetsError, "");
  const blockedReasons = (readModel.blockedReasons ?? []) as Array<Record<string, unknown>>;
  const toolSupplyState = state.toolSupplyControl ?? {
    readModel: null,
    loading: false,
    error: null,
  };
  const toolSupply = toolSupplyState.readModel;
  const toolSupplyMetrics = toolSupply?.metrics;
  const toolSupplyRisks = toolSupply?.risks ?? [];
  const hasIncompleteExecutions =
    executions.length === 0 ||
    executions.some((execution) => text(execution.status, "ready") !== "completed");
  const visibleBlockedReasons = hasIncompleteExecutions ? blockedReasons : [];
  const visibleToolSupplyRisks = hasIncompleteExecutions ? toolSupplyRisks : [];
  if (!toolSupply && !toolSupplyState.loading && !toolSupplyState.error && state.connected) {
    queueMicrotask(() => {
      if (
        state.tab === "aics" &&
        state.connected &&
        !state.toolSupplyControl?.readModel &&
        !state.toolSupplyControl?.loading &&
        !state.toolSupplyControl?.error
      ) {
        void state.refreshToolSupplyControlReadModel?.();
      }
    });
  }

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
    <div
      data-testid="openclaw-aics-local-operator"
      style="padding:16px;max-width:1180px;margin:0 auto"
    >
      <div
        style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px"
      >
        <div>
          <h1 style="font-size:20px;margin:0">岗位执行 · 执行控制台</h1>
          <p style="font-size:12px;color:var(--text-secondary,#666);margin:4px 0 0 0">
            查看已派发岗位任务的运行状态、阻塞原因、执行结果和产物；未派发任务不能在这里直接运行。
          </p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <button
            type="button"
            @click=${() => {
              state.refreshAicsMainFlowReadModel?.();
              state.refreshMyRolesReadModel?.();
            }}
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
            返回派发中心
          </button>
        </div>
      </div>

      ${ps.error
        ? html`<div
            style="padding:10px;background:#fff5f5;border:1px solid #e53e3e;border-radius:6px;color:#c53030;margin-bottom:12px;font-size:13px;line-height:1.55"
          >
            <div>${ps.error}</div>
            ${renderPageErrorHelp(ps.error, onNavigate)}
          </div>`
        : nothing}
      ${ps.message
        ? html`<div
            style="padding:10px;background:#f0fff4;border:1px solid #9ae6b4;border-radius:6px;color:#276749;margin-bottom:12px;font-size:13px;line-height:1.55;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"
          >
            <span>${ps.message}</span>
            <button
              type="button"
              class="secondary"
              style="font-size:12px;padding:5px 9px"
              @click=${() => onNavigate("apiManagement")}
            >
              查看闭环检查
            </button>
          </div>`
        : nothing}
      ${renderSupportContactCard(
        state.supportContact,
        "岗位授权、API 绑定、执行预检、审计或账本卡住时，联系系统开发者处理。",
        () => state.refreshSupportContact?.(),
      )}
      ${renderExecutionClosureCard(state, onNavigate)}
      ${instanceStoreError
        ? html`
            <section
              style="border:1px solid #fed7d7;background:#fff5f5;border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;color:#c53030;line-height:1.55;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"
            >
              <span>
                岗位运行历史库暂时不可读：${instanceStoreError}。已继续显示已授权岗位和执行队列；运行历史、步骤和产物回看可能不完整。
              </span>
              <button
                type="button"
                @click=${() => state.repairRoleInstanceStore?.()}
                style="padding:5px 10px;border:1px solid #feb2b2;border-radius:4px;background:#fff;color:#c53030;cursor:pointer;font-size:12px"
                ?disabled=${ps.loading}
              >
                修复运行历史库
              </button>
            </section>
          `
        : nothing}
      ${renderMainFlowRoleExecutionCard(state, onNavigate)}
      <section
        style="border:1px solid var(--border-color,#e0e0e0);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);margin-bottom:14px;display:grid;gap:10px"
      >
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
          <div>
            <div style="font-size:13px;font-weight:700;margin-bottom:4px">执行能力供给</div>
            <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
              运行前必须通过岗位授权、能力权限、API 绑定和岗位能力校验。
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
            <button
              type="button"
              @click=${() => onNavigate("skills")}
              style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
            >
              能力配置
            </button>
            <button
              type="button"
              @click=${() => onNavigate("apiManagement")}
              style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
              title=${visibleToolSupplyRisks.some((risk) => risk.reason === "missing_api_binding")
                ? "处理缺失的 API 绑定。"
                : "当前已完成任务没有缺失 API 绑定。"}
              ?disabled=${!visibleToolSupplyRisks.some(
                (risk) => risk.reason === "missing_api_binding",
              )}
            >
              API 绑定
            </button>
            <button
              type="button"
              @click=${() => state.refreshToolSupplyControlReadModel?.()}
              style="padding:6px 12px;background:var(--bg-secondary,#eee);border:1px solid var(--border-color,#ccc);border-radius:4px;cursor:pointer;font-size:12px"
              ?disabled=${toolSupplyState.loading}
            >
              ${toolSupplyState.loading ? "读取中..." : "刷新能力状态"}
            </button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px">
          ${metric("本地能力组件", toolSupplyMetrics?.localTools ?? "未同步")}
          ${metric("工作能力", toolSupplyMetrics?.skills ?? "未同步")}
          ${metric("岗位能力", toolSupplyMetrics?.cloudCapabilities ?? "未同步")}
          ${metric("可用能力", toolSupplyMetrics?.available ?? "未同步", "#2f855a")}
          ${metric(
            "阻塞能力",
            toolSupplyMetrics?.blocked ?? "未同步",
            Number(toolSupplyMetrics?.blocked ?? 0) ? "#c53030" : "#2f855a",
          )}
        </div>
        ${visibleToolSupplyRisks.length
          ? html`<div style="display:grid;gap:6px">
              ${visibleToolSupplyRisks.slice(0, 4).map((risk) => {
                const help = blockerHelp(risk.reason);
                return html`
                  <div
                    style="border:1px solid #fed7d7;background:#fff5f5;border-radius:6px;padding:8px;font-size:12px;display:grid;gap:4px"
                  >
                    <div style="font-weight:750;color:#c53030">缺少：${help.missing}</div>
                    <div style="color:var(--text-secondary,#666)">怎么办：${help.action}</div>
                  </div>
                `;
              })}
            </div>`
          : html`<div style="font-size:12px;color:#2f855a">
              ${hasIncompleteExecutions
                ? "当前执行能力供给没有阻塞项。"
                : "已完成任务已有业务产物、审计和账本证据；当前能力供给变化不影响本次执行结果。"}
            </div>`}
      </section>
      ${!ps.readModel && !ps.loading
        ? html`
            <div
              style="padding:18px;text-align:center;color:var(--text-secondary,#666);border:1px dashed var(--border-color,#ccc);border-radius:8px;margin-bottom:14px"
            >
              <div style="font-size:15px;margin-bottom:8px">岗位执行控制台尚未加载</div>
              <button
                type="button"
                @click=${() => state.refreshMyRolesReadModel?.()}
                style="padding:6px 14px;background:var(--accent-color,#3366ff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px"
              >
                加载岗位执行
              </button>
            </div>
          `
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

      ${visibleBlockedReasons.length
        ? html`
            <section
              style="border:1px solid #fed7d7;background:#fff5f5;border-radius:8px;padding:12px;margin-bottom:14px"
            >
              <div style="font-size:13px;font-weight:700;color:#c53030;margin-bottom:6px">
                执行层阻塞
              </div>
              ${renderBlockerHelp(visibleBlockedReasons, onNavigate)}
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
              ${authorizedRoleAssets.length
                ? html`
                    <div style="font-size:13px;margin-bottom:10px">
                      已同步 ${authorizedRoleAssets.length}
                      个已授权岗位；先在任务调度页点击「检查并派发」，这里才会出现执行队列。
                    </div>
                    <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">
                      ${authorizedRoleAssets
                        .slice(0, 3)
                        .map(
                          (role) => html`
                            <span
                              style="border:1px solid var(--border-color,#ddd);border-radius:999px;padding:4px 9px;font-size:12px;background:var(--bg-elevated,#fff)"
                            >
                              ${text(role.title, text(role.roleListingId, "已授权岗位"))}${text(
                                role.priceLabel,
                                "",
                              )
                                ? ` · ${text(role.priceLabel)}`
                                : ""}
                            </span>
                          `,
                        )}
                    </div>
                    <div style="margin-top:12px">
                      <button
                        type="button"
                        @click=${() => onNavigate("workboard")}
                        style="padding:6px 14px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px"
                      >
                        去任务调度
                      </button>
                    </div>
                  `
                : html`
                    <div style="font-size:13px">
                      ${roleAssetsError
                        ? `我的岗位同步失败：${roleAssetsError}`
                        : "先完成岗位上架和 0 元授权，再到任务调度页点击「检查并派发」。"}
                    </div>
                    ${roleAssetsError
                      ? nothing
                      : html`<div style="margin-top:12px">
                          <button
                            type="button"
                            @click=${() => onNavigate("usage")}
                            style="padding:6px 14px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px"
                          >
                            去费用与授权
                          </button>
                        </div>`}
                  `}
            </div>
          `
        : html`
            <div style="display:grid;grid-template-columns:1fr;gap:10px">
              ${filtered.map((execution) => renderExecutionCard(state, ps, execution, onNavigate))}
            </div>
          `}
      ${selectedExecution ? renderDetailDrawer(state, ps, selectedExecution, onNavigate) : nothing}
    </div>
  `;
}

function renderExecutionCard(
  state: AppViewState,
  ps: MyRolesPageState,
  execution: ExecutionRecord,
  onNavigate: (tab: Tab) => void,
) {
  const status = text(execution.status, "ready");
  const progress = numberValue(execution.progress);
  const blockedReason = text(execution.blockedReason, "");
  const selectedModelRef =
    execution.selectedModelRef &&
    typeof execution.selectedModelRef === "object" &&
    !Array.isArray(execution.selectedModelRef)
      ? (execution.selectedModelRef as Record<string, unknown>)
      : null;
  const selectedModelLabel = selectedModelRef
    ? `${text(selectedModelRef.provider, "模型服务")} / ${text(selectedModelRef.model, "未选模型")}`
    : "";
  const canRun = execution.canRun === true && !ps.runningExecutionId;
  const { modelUsage, modelUsageNotApplicableReason } = executionEvidenceParts(execution);
  const hasClosedLoopEvidence = executionClosedLoopEvidenceComplete(execution);
  const displayStatusColor = executionDisplayStatusColor(execution);
  const displayStatusLabel = executionDisplayStatusLabel(execution);
  const evidenceModelLabel = modelUsageNotApplicableReason
    ? "本次未调用模型"
    : modelUsageLabel(modelUsage);
  const roleExecutionModelLabel = roleExecutionApiModelLabel(state);
  const toolSupplyLabels = createToolSupplyLabelMap(state.toolSupplyControl?.readModel);
  const allowedTools = capabilityLabels(execution.allowedTools, toolSupplyLabels);
  const allowedSkills = capabilityLabels(execution.allowedSkills, toolSupplyLabels);
  return html`
    <section
      style="border:1px solid ${ps.selectedRoleKey === execution.id
        ? "var(--accent-color,#3366ff)"
        : "var(--border-color,#e0e0e0)"};border-left:4px solid ${displayStatusColor};border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);display:grid;gap:10px"
    >
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div style="min-width:0">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <strong style="font-size:15px">${text(execution.title, "未命名执行任务")}</strong>
            <span
              style="font-size:11px;padding:2px 8px;border-radius:999px;background:${displayStatusColor};color:#fff"
              >${displayStatusLabel}</span
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
            @click=${() => {
              selectRole(ps, text(execution.id));
              requestViewUpdate(state);
            }}
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
            ${ps.runningExecutionId === execution.id ? "执行中..." : "确认并运行"}
          </button>
          ${hasClosedLoopEvidence
            ? html`<button
                type="button"
                @click=${() => onNavigate("apiManagement")}
                style="padding:5px 10px;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-secondary,#eee);font-size:12px;cursor:pointer"
              >
                查看闭环检查
              </button>`
            : nothing}
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
          <div>
            <strong style="color:var(--text-primary,#333)">岗位能力：</strong
            >${allowedTools.length && allowedSkills.length
              ? "已通过品类能力准备好"
              : "等待系统开发者配置品类能力"}
          </div>
          <div>
            <strong style="color:var(--text-primary,#333)">执行模型：</strong
            >${selectedModelLabel ||
            roleExecutionModelLabel ||
            evidenceModelLabel ||
            "等待 API 管理绑定岗位执行模型"}
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
            ? html`<div style="font-size:12px;color:#c53030">
                阻塞：${userFacingText(blockedReason)}
              </div>`
            : html`<div style="font-size:12px;color:#2f855a">岗位授权能力已通过调度投影校验</div>`}
          ${renderExecutionPostRunEvidenceSummary(execution, onNavigate)}
          ${status === "completed"
            ? nothing
            : renderExecutionPreRunChecklist({
                execution,
                canRun,
                modelLabel:
                  selectedModelLabel || roleExecutionModelLabel || evidenceModelLabel || "",
                toolSkillReady: allowedTools.length > 0 && allowedSkills.length > 0,
              })}
        </div>
      </div>
    </section>
  `;
}

function renderDetailDrawer(
  state: AppViewState,
  ps: MyRolesPageState,
  execution: ExecutionRecord,
  onNavigate: (tab: Tab) => void,
) {
  const tabs = ["overview", "steps", "artifacts", "boundary"] as const;
  const tabLabels: Record<(typeof tabs)[number], string> = {
    overview: "概览",
    steps: "步骤",
    artifacts: "产物",
    boundary: "边界",
  };
  const {
    result,
    executionEvidence,
    auditReadback,
    ledgerReadback,
    modelUsage,
    costSummary,
    humanConfirmationRef,
    modelUsageNotApplicableReason,
    auditRefs,
    ledgerRef,
    businessArtifactRefs,
  } = executionEvidenceParts(execution);
  const recoverySuggestion = userFacingText(executionEvidence.recoverySuggestion, "");
  const failureHelp = pageErrorHelp(
    [text(execution.blockedReason, ""), text(result?.summary, ""), recoverySuggestion]
      .filter(Boolean)
      .join(" "),
  );
  const hasEvidenceSummary = Boolean(
    ledgerRef ||
    ledgerReadback ||
    costSummary ||
    humanConfirmationRef ||
    auditRefs.length ||
    auditReadback ||
    businessArtifactRefs.length,
  );
  const hasBusinessArtifact = businessArtifactRefs.length > 0;
  const hasAuditEvidence = auditRefs.length > 0 || Boolean(auditReadback);
  const hasLedgerEvidence = Boolean(ledgerRef || ledgerReadback);
  const hasModelEvidence = Boolean(modelUsage || modelUsageNotApplicableReason);
  const hasHumanConfirmation =
    execution.confirmExecution === true ? Boolean(humanConfirmationRef) : true;
  const hasFullEvidence =
    hasBusinessArtifact &&
    hasAuditEvidence &&
    hasLedgerEvidence &&
    Boolean(costSummary) &&
    hasHumanConfirmation &&
    hasModelEvidence;
  const detailStatusLabel = executionDisplayStatusLabel(execution);
  const toolSupplyLabels = createToolSupplyLabelMap(state.toolSupplyControl?.readModel);
  const allowedTools = capabilityLabels(execution.allowedTools, toolSupplyLabels);
  const allowedSkills = capabilityLabels(execution.allowedSkills, toolSupplyLabels);
  const artifactExecutionId = executionIdForArtifactPreview(execution);
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
            ${text(execution.roleTitle)} / ${detailStatusLabel}
          </div>
        </div>
        <button
          type="button"
          @click=${() => {
            closeDetail(ps);
            requestViewUpdate(state);
          }}
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
              @click=${() => {
                setDetailTab(ps, tab);
                requestViewUpdate(state);
              }}
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
              <div>
                <strong>执行队列：</strong>${text(execution.dispatchRequestId)
                  ? "已进入执行队列"
                  : "未进入执行队列"}
              </div>
              <div>
                <strong>派发状态：</strong>${text(execution.taskPackageId)
                  ? "已收到派发任务"
                  : "未收到派发任务"}
              </div>
              <div><strong>更新时间：</strong>${formatDate(execution.updatedAt)}</div>
              <div><strong>能力匹配：</strong>${text(execution.capabilitySummary)}</div>
              ${result
                ? html`<div>
                    <strong>执行结果：</strong>${roleOutcomeLabel(result.outcome)} /
                    ${userFacingText(result.summary)}
                  </div>`
                : nothing}
              ${hasEvidenceSummary
                ? html`
                    <div
                      style="border:1px solid ${hasFullEvidence
                        ? "#c6f6d5"
                        : "#fed7d7"};border-radius:6px;padding:8px;background:${hasFullEvidence
                        ? "#f0fff4"
                        : "#fff5f5"};display:grid;gap:4px"
                    >
                      <div style="font-weight:700;color:${hasFullEvidence ? "#2f855a" : "#c53030"}">
                        ${hasFullEvidence ? "闭环证据完整" : "闭环证据不完整"}
                      </div>
                      <div style="color:var(--text-secondary,#666)">
                        账本：${ledgerRef || text(ledgerReadback?.ledgerRef, "")
                          ? ledgerReadback
                            ? "已读回"
                            : "已记录"
                          : "缺失"}
                        ·
                        审计：${auditRefs.length
                          ? auditReadback
                            ? "已读回"
                            : "已记录"
                          : text(auditReadback?.auditRecordId, "")
                            ? "已读回"
                            : "缺失"}
                        · 业务产物：${businessArtifactRefs.length || 0} 个 ·
                        费用摘要：${costSummary ? costSummaryLabel(costSummary) : "缺失"}
                        ${execution.confirmExecution === true
                          ? ` · 人工确认：${humanConfirmationRef ? "已确认" : "缺失"}`
                          : ""}
                      </div>
                    </div>
                  `
                : nothing}
            </div>
          `
        : ps.detailTab === "steps"
          ? html`
              <div style="display:grid;gap:8px">
                ${[
                  ["派发预检", "派发预检确认后才能生成派发单。"],
                  ["生成派发单", "派发单和执行队列项已进入岗位执行层。"],
                  [
                    text(execution.currentStep, "等待执行"),
                    text(result?.summary, "等待执行器返回执行结果。"),
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
                  ${text(result?.summary, "")
                    ? html`
                        <div
                          style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:10px;font-size:12px;display:grid;gap:5px;background:var(--bg-elevated,#fff)"
                        >
                          <div style="font-weight:700;color:var(--text-primary,#333)">成果摘要</div>
                          <div
                            style="color:var(--text-secondary,#666);line-height:1.6;white-space:pre-wrap"
                          >
                            ${text(result?.summary)}
                          </div>
                        </div>
                      `
                    : nothing}
                  ${ledgerRef
                    ? html`
                        <div
                          style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:8px;font-size:12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center"
                          title="账本记录"
                        >
                          <span style="display:grid;gap:2px;min-width:0">
                            <span>账本记录</span>
                            <span style="color:var(--text-secondary,#666)"
                              >费用和执行账本证据已写入。</span
                            >
                          </span>
                          <span style="color:#2f855a">${ledgerReadback ? "已读回" : "已记录"}</span>
                        </div>
                      `
                    : nothing}
                  ${ledgerReadback
                    ? html`
                        <div
                          style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:8px;font-size:12px;display:grid;gap:4px;background:var(--bg-elevated,#fff)"
                        >
                          <div style="font-weight:700;color:var(--text-primary,#333)">账本读回</div>
                          <div style="color:var(--text-secondary,#666)">
                            状态：${ledgerStatusLabel(ledgerReadback.status)} · 授权费用
                            ¥${(numberValue(ledgerReadback.authorizationFeeCents) / 100).toFixed(2)}
                            · 执行费用
                            ¥${(numberValue(ledgerReadback.executionFeeCents) / 100).toFixed(2)}
                          </div>
                        </div>
                      `
                    : nothing}
                  ${costSummary
                    ? html`
                        <div
                          style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:8px;font-size:12px;display:grid;gap:4px;background:var(--bg-elevated,#fff)"
                        >
                          <div style="font-weight:700;color:var(--text-primary,#333)">费用摘要</div>
                          <div style="color:var(--text-secondary,#666)">
                            ${costSummaryLabel(costSummary)}
                          </div>
                        </div>
                      `
                    : nothing}
                  ${humanConfirmationRef
                    ? html`
                        <div
                          style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:8px;font-size:12px;display:grid;gap:4px;background:var(--bg-elevated,#fff)"
                        >
                          <div style="font-weight:700;color:var(--text-primary,#333)">人工确认</div>
                          <div style="color:var(--text-secondary,#666)">已确认本次执行</div>
                        </div>
                      `
                    : nothing}
                  ${result
                    ? renderModelUsageEvidence(
                        modelUsage,
                        ledgerReadback,
                        modelUsageNotApplicableReason,
                      )
                    : nothing}
                  ${recoverySuggestion
                    ? html`
                        <div
                          style="border:1px solid #fed7d7;border-radius:6px;padding:8px;font-size:12px;background:#fff5f5;color:#c53030;display:grid;gap:4px"
                        >
                          <div style="font-weight:700">恢复建议</div>
                          <div style="line-height:1.55">${userFacingText(recoverySuggestion)}</div>
                        </div>
                      `
                    : nothing}
                  ${auditRefs.length
                    ? auditRefs.map(
                        (audit, index) => html`
                          <div
                            style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:8px;font-size:12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center"
                            title=${auditEvidenceLabel(audit, index)}
                          >
                            <span style="display:grid;gap:2px;min-width:0">
                              <span>审计：${auditEvidenceLabel(audit, index)}</span>
                              <span style="color:var(--text-secondary,#666)"
                                >执行审计证据已写入。</span
                              >
                            </span>
                            <span style="color:#2f855a"
                              >${auditReadback ? "已读回" : "已记录"}</span
                            >
                          </div>
                        `,
                      )
                    : nothing}
                  ${auditReadback
                    ? html`
                        <div
                          style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:8px;font-size:12px;display:grid;gap:4px;background:var(--bg-elevated,#fff)"
                        >
                          <div style="font-weight:700;color:var(--text-primary,#333)">审计读回</div>
                          <div style="color:var(--text-secondary,#666)">
                            状态：${text(auditReadback.status)}
                          </div>
                          ${text(auditReadback.summary, "")
                            ? html`<div style="color:var(--text-secondary,#666);line-height:1.55">
                                ${userFacingText(auditReadback.summary)}
                              </div>`
                            : nothing}
                        </div>
                      `
                    : nothing}
                  ${businessArtifactRefs.length
                    ? businessArtifactRefs.map((artifact, index) =>
                        renderBusinessArtifactCard(
                          artifact,
                          index,
                          artifactExecutionId
                            ? ps.artifactPreviews[artifactPreviewKey(artifactExecutionId, artifact)]
                            : undefined,
                        ),
                      )
                    : !ledgerRef && !auditRefs.length
                      ? html`<div
                          style="font-size:13px;color:var(--text-secondary,#666);text-align:center;padding:24px"
                        >
                          暂无产物。执行完成后会显示产物引用。
                        </div>`
                      : nothing}
                </div>
              `
            : html`
                <div style="display:grid;gap:10px;font-size:12px">
                  <section
                    style="border:1px solid var(--border-color,#e0e0e0);border-radius:6px;padding:10px"
                  >
                    <div style="font-weight:700;margin-bottom:6px">岗位能力状态</div>
                    <div style="color:var(--text-secondary,#666)">
                      ${allowedTools.length && allowedSkills.length
                        ? "已通过岗位绑定的品类能力准备执行。"
                        : "等待系统开发者完成品类能力配置。"}
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
                      ${userFacingText(
                        execution.blockedReason,
                        "无阻塞；仍必须通过调度层和岗位授权能力执行。",
                      )}
                    </div>
                    ${uniqueRequest
                      ? html`<div style="margin-top:6px;color:#c05621">
                          独特能力申请：${uniqueCapabilityLabel(uniqueRequest.missingCapability)} /
                          ${uniqueCapabilityStatusLabel(uniqueRequest.status)}
                        </div>`
                      : nothing}
                    ${recoverySuggestion
                      ? html`<div style="margin-top:6px;color:#c53030">
                          恢复建议：${recoverySuggestion}
                        </div>`
                      : nothing}
                    ${failureHelp
                      ? html`
                          <div
                            style="margin-top:8px;border:1px solid #f6ad55;background:#fffaf0;border-radius:6px;padding:8px;color:#744210;display:flex;gap:8px;align-items:center;flex-wrap:wrap"
                          >
                            <span>${failureHelp.action}</span>
                            ${failureHelp.target
                              ? html`<button
                                  type="button"
                                  class="secondary"
                                  style="font-size:12px;padding:5px 9px"
                                  @click=${() => onNavigate(failureHelp.target!)}
                                >
                                  去 API 管理
                                </button>`
                              : nothing}
                          </div>
                        `
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
                    确认并运行
                  </button>
                </div>
              `}
    </aside>
  `;
}
