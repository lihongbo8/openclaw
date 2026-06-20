import { html, nothing } from "lit";
import type { SupportContactState } from "../controllers/support-contact.ts";

export function renderSupportContactCard(
  state: SupportContactState | undefined,
  contextText: string,
  onLoad?: () => void | Promise<void>,
) {
  if (!state) return nothing;
  if (!state.contact && !state.loading && !state.error) {
    queueMicrotask(() => {
      void onLoad?.();
    });
  }
  const contact = state.contact;
  if (!contact) {
    if (state.loading) {
      return html`
        <section
          style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:12px;background:var(--bg-elevated,#fff);display:grid;gap:7px"
        >
          <div style="font-size:13px;font-weight:750;color:var(--text-primary,#111)">
            遇到问题可联系
          </div>
          <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
            正在读取加群信息...
          </div>
        </section>
      `;
    }
    if (state.error) {
      return html`
        <section
          style="border:1px solid #fecaca;border-radius:8px;padding:12px;background:#fff5f5;display:grid;gap:7px"
        >
          <div style="font-size:13px;font-weight:750;color:#991b1b">遇到问题可联系</div>
          <div style="font-size:12px;color:#991b1b;line-height:1.55">
            联系方式读取失败：${state.error}。请在 API 管理完成本地连接检查，或在 AICS 插件配置
            supportContact。
          </div>
        </section>
      `;
    }
    return nothing;
  }
  return html`
    <section
      style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:12px;background:var(--bg-elevated,#fff);display:grid;gap:7px"
    >
      <div style="font-size:13px;font-weight:750;color:var(--text-primary,#111)">
        遇到问题可联系
      </div>
      <div
        style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--text-primary,#111)"
      >
        <strong>${contact.displayName}</strong>
        <span style="color:var(--text-secondary,#666)">微信：${contact.wechatId}</span>
      </div>
      <div style="font-size:12px;color:var(--text-secondary,#666);line-height:1.55">
        ${contextText || contact.purpose}
      </div>
      ${contact.serviceHours
        ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">
            时间：${contact.serviceHours}
          </div>`
        : nothing}
      ${contact.note
        ? html`<div style="font-size:12px;color:var(--text-secondary,#666)">${contact.note}</div>`
        : nothing}
    </section>
  `;
}
