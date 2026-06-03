import { html, nothing, type TemplateResult } from "lit";
import { icons, type IconName } from "../icons.ts";
import type { Tab } from "../navigation.ts";

export type MainSystemMetric = {
  label: string;
  value: string | number;
  title: string;
};

export type MainSystemItem = {
  title: string;
  status?: string;
  meta?: string;
  titleHelp?: string;
  icon?: IconName;
  action?: {
    label: string;
    title: string;
    onClick: () => void;
    disabled?: boolean;
  };
};

export type MainSystemAction = {
  label: string;
  title: string;
  icon: IconName;
  tab?: Tab;
  onClick?: () => void;
  disabled?: boolean;
};

export type MainSystemShellProps = {
  title: string;
  status: string;
  icon: IconName;
  metrics: MainSystemMetric[];
  items: MainSystemItem[];
  loading?: boolean;
  error?: string | null;
  emptyLabel: string;
  actions: MainSystemAction[];
  onNavigate: (tab: Tab) => void;
};

function renderHelp(text: string) {
  return html`<span class="main-system-shell__help" title=${text} aria-label=${text}
    >${icons.info}</span
  >`;
}

function renderMetric(metric: MainSystemMetric) {
  return html`
    <div class="main-system-shell__metric" title=${metric.title}>
      <span>${metric.label}</span>
      <strong>${metric.value}</strong>
    </div>
  `;
}

function renderItem(item: MainSystemItem) {
  const icon = item.icon ? icons[item.icon] : icons.circle;
  return html`
    <article class="main-system-shell__item">
      <span class="main-system-shell__item-icon" aria-hidden="true">${icon}</span>
      <div class="main-system-shell__item-main">
        <div class="main-system-shell__item-title">
          <span>${item.title}</span>
          ${item.titleHelp ? renderHelp(item.titleHelp) : nothing}
        </div>
        ${item.meta ? html`<div class="main-system-shell__item-meta">${item.meta}</div>` : nothing}
      </div>
      ${item.action
        ? html`
            <button
              class="main-system-shell__item-action"
              type="button"
              title=${item.action.title}
              ?disabled=${item.action.disabled}
              @click=${item.action.onClick}
            >
              ${item.action.label}
            </button>
          `
        : nothing}
      ${item.status
        ? html`<span class="main-system-shell__item-status">${item.status}</span>`
        : nothing}
    </article>
  `;
}

function renderAction(action: MainSystemAction, onNavigate: (tab: Tab) => void) {
  return html`
    <button
      class="main-system-shell__action"
      type="button"
      title=${action.title}
      ?disabled=${action.disabled || (!action.tab && !action.onClick)}
      @click=${() => {
        if (action.onClick) {
          action.onClick();
        } else if (action.tab) {
          onNavigate(action.tab);
        }
      }}
    >
      <span class="main-system-shell__action-icon" aria-hidden="true">${icons[action.icon]}</span>
      <span>${action.label}</span>
    </button>
  `;
}

export function renderMainSystemShell(props: MainSystemShellProps): TemplateResult {
  return html`
    <section class="main-system-shell" aria-label=${props.title}>
      <header class="main-system-shell__header">
        <div class="main-system-shell__title">
          <span class="main-system-shell__title-icon" aria-hidden="true">${icons[props.icon]}</span>
          <div>
            <h1>${props.title}</h1>
            <span>${props.status}</span>
          </div>
        </div>
        <div class="main-system-shell__actions">
          ${props.actions.map((action) => renderAction(action, props.onNavigate))}
        </div>
      </header>

      ${props.error
        ? html`<div class="main-system-shell__notice main-system-shell__notice--error">
            ${props.error}
          </div>`
        : nothing}

      <div class="main-system-shell__metrics">${props.metrics.map(renderMetric)}</div>

      <div class="main-system-shell__list" aria-busy=${props.loading ? "true" : "false"}>
        ${props.loading
          ? html`<div class="main-system-shell__empty">同步中</div>`
          : props.items.length
            ? props.items.map(renderItem)
            : html`<div class="main-system-shell__empty">${props.emptyLabel}</div>`}
      </div>
    </section>
  `;
}
