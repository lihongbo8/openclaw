/**
 * Quick Settings view — opinionated card layout for the most common settings.
 * Replaces the raw schema-driven form as the default settings experience.
 *
 * Each card answers a "what do I want to do?" question with status + actions.
 */

import { html, nothing, type TemplateResult } from "lit";
import { icons } from "../icons.ts";
import type { BorderRadiusStop, TextScaleStop } from "../storage.ts";
import type { ThemeTransitionContext } from "../theme-transition.ts";
import type { ThemeMode, ThemeName } from "../theme.ts";
import {
  CONFIG_PRESETS,
  detectActivePreset,
  getPresetById,
  type ConfigPresetId,
} from "./config-presets.ts";

// ── Types ──

export type QuickSettingsChannel = {
  id: string;
  label: string;
  connected: boolean;
  detail?: string;
};

export type QuickSettingsAutomation = {
  cronJobCount: number;
  skillCount: number;
  mcpServerCount: number;
};

export type QuickSettingsSecurity = {
  gatewayAuth: string;
  execPolicy: string;
  deviceAuth: boolean;
  browserEnabled: boolean;
  toolProfile: string;
};

export type QuickSettingsProps = {
  // Model & Thinking
  currentModel: string;
  thinkingLevel: string;
  fastMode: boolean;
  onModelChange?: () => void;
  onThinkingChange?: (level: string) => void;
  onFastModeToggle?: () => void;

  // Channels
  channels: QuickSettingsChannel[];
  onChannelConfigure?: (channelId: string) => void;

  // Automations
  automation: QuickSettingsAutomation;
  onManageCron?: () => void;
  onBrowseSkills?: () => void;
  onConfigureMcp?: () => void;

  // Security
  security: QuickSettingsSecurity;
  onSecurityConfigure?: () => void;
  onBrowserEnabledToggle?: (enabled: boolean) => void;
  onToolProfileChange?: (profile: string) => void;

  // Appearance
  theme: ThemeName;
  themeMode: ThemeMode;
  hasCustomTheme: boolean;
  customThemeLabel?: string | null;
  borderRadius: number;
  textScale: number;
  setTheme: (theme: ThemeName, context?: ThemeTransitionContext) => void;
  onOpenCustomThemeImport?: () => void;
  setThemeMode: (mode: ThemeMode, context?: ThemeTransitionContext) => void;
  setBorderRadius: (value: number) => void;
  setTextScale: (value: number) => void;
  userAvatar?: string | null;
  onUserAvatarChange?: (next: string | null) => void;

  // Presets
  configObject?: Record<string, unknown>;
  savedConfigObject?: Record<string, unknown>;
  configDirty?: boolean;
  configSaving?: boolean;
  configApplying?: boolean;
  configReady?: boolean;
  onSelectPreset?: (presetId: ConfigPresetId) => void;
  onResetConfig?: () => void;
  onSaveConfig?: () => void;
  onApplyConfig?: () => void;

  // Connection
  connected: boolean;
  gatewayUrl: string;
  assistantName: string;
  assistantAvatar?: string | null;
  assistantAvatarUrl?: string | null;
  assistantAvatarSource?: string | null;
  assistantAvatarStatus?: "none" | "local" | "remote" | "data" | null;
  assistantAvatarReason?: string | null;
  assistantAvatarOverride?: string | null;
  assistantAvatarUploadBusy?: boolean;
  assistantAvatarUploadError?: string | null;
  onAssistantAvatarOverrideChange?: (dataUrl: string) => void | Promise<void>;
  onAssistantAvatarClearOverride?: () => void | Promise<void>;
  basePath?: string | null;
  version: string;
};

// ── Theme options ──

type ThemeOption = { id: ThemeName; label: string };
const BUILTIN_THEME_OPTIONS: ThemeOption[] = [
  { id: "claw", label: "Claw" },
  { id: "knot", label: "Knot" },
  { id: "dash", label: "Dash" },
];

const BORDER_RADIUS_STOPS: Array<{ value: BorderRadiusStop; label: string }> = [
  { value: 0, label: "None" },
  { value: 25, label: "Slight" },
  { value: 50, label: "Default" },
  { value: 75, label: "Round" },
  { value: 100, label: "Full" },
];

const TEXT_SCALE_OPTIONS: Array<{ value: TextScaleStop; label: string }> = [
  { value: 90, label: "S" },
  { value: 100, label: "M" },
  { value: 110, label: "L" },
  { value: 125, label: "XL" },
  { value: 140, label: "XXL" },
];

type ProfileSettings = {
  bootstrapMaxChars: number;
  bootstrapTotalMaxChars: number;
  contextInjection: "always" | "continuation-skip";
};

const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  bootstrapMaxChars: 20_000,
  bootstrapTotalMaxChars: 60_000,
  contextInjection: "always",
};

function resolveProfileSettings(config?: Record<string, unknown>): ProfileSettings {
  const agents = config?.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  const bootstrapMaxChars =
    typeof defaults?.bootstrapMaxChars === "number" && Number.isFinite(defaults.bootstrapMaxChars)
      ? Math.floor(defaults.bootstrapMaxChars)
      : DEFAULT_PROFILE_SETTINGS.bootstrapMaxChars;
  const bootstrapTotalMaxChars =
    typeof defaults?.bootstrapTotalMaxChars === "number" &&
    Number.isFinite(defaults.bootstrapTotalMaxChars)
      ? Math.floor(defaults.bootstrapTotalMaxChars)
      : DEFAULT_PROFILE_SETTINGS.bootstrapTotalMaxChars;
  const contextInjection =
    defaults?.contextInjection === "continuation-skip" ? "continuation-skip" : "always";
  return { bootstrapMaxChars, bootstrapTotalMaxChars, contextInjection };
}

function profileSettingsEqual(a: ProfileSettings, b: ProfileSettings): boolean {
  return (
    a.bootstrapMaxChars === b.bootstrapMaxChars &&
    a.bootstrapTotalMaxChars === b.bootstrapTotalMaxChars &&
    a.contextInjection === b.contextInjection
  );
}

function formatCharBudget(value: number): string {
  return `${value.toLocaleString()} chars`;
}

function formatContextInjectionLabel(mode: ProfileSettings["contextInjection"]): string {
  return mode === "always" ? "Every turn" : "Skip safe follow-ups";
}

function describeContextInjection(mode: ProfileSettings["contextInjection"]): string {
  return mode === "always"
    ? "Reinject workspace bootstrap context on every turn."
    : "Skip bootstrap reinjection after a completed safe follow-up.";
}

function renderProfileStat(params: {
  label: string;
  value: string;
  previousValue: string;
  note: string;
}) {
  const changed = params.value !== params.previousValue;
  return html`
    <div class="qs-profile-stat ${changed ? "qs-profile-stat--changed" : ""}">
      <div class="qs-profile-stat__header">
        <span class="qs-profile-stat__label">${params.label}</span>
        <span class="qs-profile-stat__value">${params.value}</span>
      </div>
      <div class="qs-profile-stat__sub">
        ${changed ? `Was ${params.previousValue}` : "Matches current default"}
      </div>
      <div class="qs-profile-stat__note muted">${params.note}</div>
    </div>
  `;
}

// ── Card renderers ──

function renderCardHeader(icon: TemplateResult, title: string, action?: TemplateResult) {
  return html`
    <div class="qs-card__header">
      <div class="qs-card__header-left">
        <span class="qs-card__icon">${icon}</span>
        <h3 class="qs-card__title">${title}</h3>
      </div>
      ${action ? action : nothing}
    </div>
  `;
}

function renderAppearanceCard(props: QuickSettingsProps) {
  const importedThemeName = props.hasCustomTheme
    ? (props.customThemeLabel ?? "Imported theme")
    : "Import";
  const themeOptions: ThemeOption[] = [
    ...BUILTIN_THEME_OPTIONS,
    { id: "custom", label: importedThemeName },
  ];
  return html`
    <div class="qs-card qs-card--appearance">
      ${renderCardHeader(icons.spark, "Appearance")}
      <div class="qs-card__body">
        <div class="qs-row">
          <span class="qs-row__label">Theme</span>
          <div class="qs-segmented">
            ${themeOptions.map(
              (opt) => html`
                <button
                  class="qs-segmented__btn ${opt.id === props.theme
                    ? "qs-segmented__btn--active"
                    : ""}"
                  @click=${(e: Event) => {
                    if (opt.id === "custom" && !props.hasCustomTheme) {
                      props.onOpenCustomThemeImport?.();
                      return;
                    }
                    if (opt.id !== props.theme) {
                      props.setTheme(opt.id, {
                        element: (e.currentTarget as HTMLElement) ?? undefined,
                      });
                    }
                  }}
                >
                  ${opt.label}
                </button>
              `,
            )}
          </div>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">Mode</span>
          <div class="qs-segmented">
            ${(["light", "dark", "system"] as ThemeMode[]).map(
              (mode) => html`
                <button
                  class="qs-segmented__btn ${mode === props.themeMode
                    ? "qs-segmented__btn--active"
                    : ""}"
                  @click=${(e: Event) => {
                    if (mode !== props.themeMode) {
                      props.setThemeMode(mode, {
                        element: (e.currentTarget as HTMLElement) ?? undefined,
                      });
                    }
                  }}
                >
                  ${mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              `,
            )}
          </div>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">Roundness</span>
          <div class="qs-segmented">
            ${BORDER_RADIUS_STOPS.map(
              (stop) => html`
                <button
                  class="qs-segmented__btn qs-segmented__btn--compact ${stop.value ===
                  props.borderRadius
                    ? "qs-segmented__btn--active"
                    : ""}"
                  @click=${() => props.setBorderRadius(stop.value)}
                >
                  ${stop.label}
                </button>
              `,
            )}
          </div>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">Text size</span>
          <div class="qs-segmented">
            ${TEXT_SCALE_OPTIONS.map(
              (stop) => html`
                <button
                  class="qs-segmented__btn qs-segmented__btn--compact ${stop.value ===
                  props.textScale
                    ? "qs-segmented__btn--active"
                    : ""}"
                  title=${`${stop.value}%`}
                  @click=${() => props.setTextScale(stop.value)}
                >
                  ${stop.label}
                </button>
              `,
            )}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPresetsCard(props: QuickSettingsProps) {
  const draftConfig = props.configObject ?? props.savedConfigObject ?? {};
  const savedConfig = props.savedConfigObject ?? {};
  const selectedPresetId = detectActivePreset(draftConfig);
  const savedPresetId = detectActivePreset(savedConfig);
  const selectedPreset = selectedPresetId ? getPresetById(selectedPresetId) : undefined;
  const savedPreset = savedPresetId ? getPresetById(savedPresetId) : undefined;
  const draftSettings = resolveProfileSettings(draftConfig);
  const savedSettings = resolveProfileSettings(savedConfig);
  const hasPendingProfileChange = !profileSettingsEqual(draftSettings, savedSettings);
  const hasPendingConfigChange = props.configDirty === true;
  const canCommit =
    props.connected &&
    props.configReady === true &&
    props.configSaving !== true &&
    props.configApplying !== true;
  const stateBanner = hasPendingProfileChange
    ? html`
        <div class="qs-profile-state qs-profile-state--pending" aria-live="polite">
          <span class="qs-status-dot"></span>
          <div class="qs-profile-state__text">
            <span class="qs-profile-state__title"
              >${selectedPreset?.label ?? "Custom"} is selected but not saved yet.</span
            >
            <span class="qs-profile-state__copy"
              >Save Profile writes it as the default. Apply Now writes it and reloads the current
              session.</span
            >
          </div>
        </div>
      `
    : savedPreset
      ? html`
          <div class="qs-profile-state qs-profile-state--ok" aria-live="polite">
            <span class="qs-status-dot qs-status-dot--ok"></span>
            <div class="qs-profile-state__text">
              <span class="qs-profile-state__title"
                >${savedPreset.label} is your current default.</span
              >
              <span class="qs-profile-state__copy"
                >Profiles only change bootstrap size and follow-up reinjection behavior.</span
              >
            </div>
          </div>
        `
      : html`
          <div class="qs-profile-state" aria-live="polite">
            <span class="qs-status-dot"></span>
            <div class="qs-profile-state__text">
              <span class="qs-profile-state__title">Custom bootstrap settings are active.</span>
              <span class="qs-profile-state__copy"
                >Choose a built-in profile to replace the current custom values.</span
              >
            </div>
          </div>
        `;
  const panelTitle = selectedPreset?.label ?? "Custom Profile";
  const panelDescription =
    selectedPreset?.detail ?? "This config does not currently match one of the built-in profiles.";
  const panelImpact =
    selectedPreset?.impact ??
    "Pick a profile to stage a focused change to bootstrap size and follow-up behavior.";
  const commitCopy = hasPendingProfileChange
    ? "Save Profile writes this as the default. Apply Now writes it and reloads the current session."
    : "Other staged config edits are pending. Saving here will commit all staged config changes.";

  return html`
    <div class="qs-card qs-card--span-all">
      ${renderCardHeader(
        icons.zap,
        "Context Profile",
        hasPendingProfileChange
          ? html`<span class="qs-badge qs-badge--warn">Pending</span>`
          : savedPreset
            ? html`<span class="qs-badge qs-badge--ok">Saved</span>`
            : html`<span class="qs-badge">Custom</span>`,
      )}
      <div class="qs-card__body qs-profiles">
        <div class="qs-profiles__copy">
          <div class="qs-profiles__eyebrow">Bootstrap Context</div>
          <p class="qs-profiles__intro">
            Choose how much local context each run receives. Profiles do not change models, tools,
            channels, or themes.
          </p>
          ${stateBanner}
          <div class="qs-presets-grid">
            ${CONFIG_PRESETS.map((preset) => {
              const presetDefaults = ((preset.patch.agents as Record<string, unknown> | undefined)
                ?.defaults ?? {}) as Record<string, unknown>;
              const presetContext =
                presetDefaults.contextInjection === "continuation-skip"
                  ? "continuation-skip"
                  : "always";
              return html`
                <button
                  type="button"
                  class="qs-preset ${preset.id === selectedPresetId ? "qs-preset--active" : ""}"
                  aria-pressed=${preset.id === selectedPresetId}
                  @click=${() => props.onSelectPreset?.(preset.id)}
                >
                  <div class="qs-preset__head">
                    <div class="qs-preset__identity">
                      <span class="qs-preset__icon">${preset.icon}</span>
                      <div class="qs-preset__identity-copy">
                        <span class="qs-preset__label">${preset.label}</span>
                        <span class="qs-preset__desc muted">${preset.description}</span>
                      </div>
                    </div>
                    <div class="qs-preset__badges">
                      ${preset.id === savedPresetId
                        ? html`<span class="qs-badge qs-badge--ok">Current</span>`
                        : nothing}
                      ${hasPendingProfileChange && preset.id === selectedPresetId
                        ? html`<span class="qs-badge qs-badge--warn">Selected</span>`
                        : nothing}
                    </div>
                  </div>
                  <div class="qs-preset__meta">
                    <span
                      >${formatCharBudget(Number(presetDefaults.bootstrapMaxChars ?? 0))} per
                      file</span
                    >
                    <span
                      >${formatCharBudget(Number(presetDefaults.bootstrapTotalMaxChars ?? 0))}
                      total</span
                    >
                    <span>${formatContextInjectionLabel(presetContext)}</span>
                  </div>
                </button>
              `;
            })}
          </div>
        </div>

        <div class="qs-profile-panel">
          <div class="qs-profile-panel__eyebrow">
            ${selectedPreset ? "Selected Profile" : "Current Values"}
          </div>
          <div class="qs-profile-panel__title">${panelTitle}</div>
          <p class="qs-profile-panel__copy">${panelDescription}</p>
          <div class="qs-profile-panel__impact">${panelImpact}</div>

          <div class="qs-profile-panel__stats">
            ${renderProfileStat({
              label: "Bootstrap Per File",
              value: formatCharBudget(draftSettings.bootstrapMaxChars),
              previousValue: formatCharBudget(savedSettings.bootstrapMaxChars),
              note: "Maximum context injected from any single bootstrap file.",
            })}
            ${renderProfileStat({
              label: "Bootstrap Total",
              value: formatCharBudget(draftSettings.bootstrapTotalMaxChars),
              previousValue: formatCharBudget(savedSettings.bootstrapTotalMaxChars),
              note: "Total combined context allowed across all bootstrap files.",
            })}
            ${renderProfileStat({
              label: "Follow-up Turns",
              value: formatContextInjectionLabel(draftSettings.contextInjection),
              previousValue: formatContextInjectionLabel(savedSettings.contextInjection),
              note: describeContextInjection(draftSettings.contextInjection),
            })}
          </div>

          ${hasPendingConfigChange
            ? html`
                <div class="qs-profile-panel__actions">
                  <div class="qs-profile-panel__actions-copy muted">${commitCopy}</div>
                  <div class="qs-profile-panel__actions-row">
                    <button
                      class="btn btn--sm"
                      ?disabled=${props.configSaving === true || props.configApplying === true}
                      @click=${props.onResetConfig}
                    >
                      Discard
                    </button>
                    <button
                      class="btn btn--sm primary"
                      ?disabled=${!canCommit}
                      @click=${props.onSaveConfig}
                    >
                      ${props.configSaving === true
                        ? "Saving…"
                        : hasPendingProfileChange
                          ? "Save Profile"
                          : "Save Changes"}
                    </button>
                    <button
                      class="btn btn--sm"
                      ?disabled=${!canCommit}
                      @click=${props.onApplyConfig}
                    >
                      ${props.configApplying === true ? "Applying…" : "Apply Now"}
                    </button>
                  </div>
                </div>
              `
            : html`
                <div class="qs-profile-panel__footer muted" aria-live="polite">
                  ${savedPreset
                    ? "Saved and ready. Choose another profile to stage a change."
                    : "Current values are custom. Choose a profile to stage a change."}
                </div>
              `}
        </div>
      </div>
    </div>
  `;
}

function renderGatewayCard(props: QuickSettingsProps) {
  return html`
    <div class="qs-card qs-card--gateway">
      ${renderCardHeader(
        icons.radio,
        "Gateway",
        html`<span class="qs-badge ${props.connected ? "qs-badge--ok" : "qs-badge--warn"}">
          ${props.connected ? "Connected" : "Offline"}
        </span>`,
      )}
      <div class="qs-card__body">
        <div class="qs-row">
          <span class="qs-row__label">Gateway URL</span>
          <span class="qs-row__value"><code>${props.gatewayUrl || "-"}</code></span>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">Status</span>
          <span class="qs-row__value">
            <span class="qs-status-dot ${props.connected ? "qs-status-dot--ok" : ""}"></span>
            ${props.connected ? "Connected" : "Offline"}
          </span>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">Version</span>
          <span class="qs-row__value">${props.version || "-"}</span>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">Assistant</span>
          <span class="qs-row__value">${props.assistantName || "-"}</span>
        </div>
      </div>
    </div>
  `;
}

// ── Main render ──

export function renderQuickSettings(props: QuickSettingsProps) {
  return html`
    <div class="qs-container">
      <div class="qs-header">
        <h2 class="qs-header__title">${icons.settings} Settings</h2>
      </div>

      <div class="qs-grid">
        ${renderPresetsCard(props)} ${renderAppearanceCard(props)} ${renderGatewayCard(props)}
      </div>
    </div>
  `;
}
