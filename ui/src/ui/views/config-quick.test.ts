/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderQuickSettings, type QuickSettingsProps } from "./config-quick.ts";

const configQuickCss = readFileSync(join(process.cwd(), "ui/src/styles/config-quick.css"), "utf8");
const layoutCss = readFileSync(join(process.cwd(), "ui/src/styles/layout.css"), "utf8");

function expectButtonByText(container: Element, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected button labelled ${text}`);
  }
  return button;
}

function expectRowByLabel(container: Element, text: string): HTMLElement {
  const row = Array.from(container.querySelectorAll<HTMLElement>(".qs-row")).find(
    (candidate) => candidate.querySelector(".qs-row__label")?.textContent?.trim() === text,
  );
  if (!(row instanceof HTMLElement)) {
    throw new Error(`Expected quick settings row "${text}"`);
  }
  return row;
}

function createProps(overrides: Partial<QuickSettingsProps> = {}): QuickSettingsProps {
  return {
    currentModel: "gpt-5.5",
    thinkingLevel: "off",
    fastMode: false,
    onModelChange: vi.fn(),
    onThinkingChange: vi.fn(),
    onFastModeToggle: vi.fn(),
    channels: [],
    onChannelConfigure: vi.fn(),
    automation: {
      cronJobCount: 0,
      skillCount: 0,
      mcpServerCount: 0,
    },
    onManageCron: vi.fn(),
    onBrowseSkills: vi.fn(),
    onConfigureMcp: vi.fn(),
    security: {
      gatewayAuth: "Unknown",
      execPolicy: "Allowlist",
      deviceAuth: true,
      browserEnabled: true,
      toolProfile: "coding",
    },
    onSecurityConfigure: vi.fn(),
    onBrowserEnabledToggle: vi.fn(),
    onToolProfileChange: vi.fn(),
    theme: "claw",
    themeMode: "system",
    hasCustomTheme: false,
    customThemeLabel: null,
    borderRadius: 50,
    textScale: 100,
    setTheme: vi.fn(),
    onOpenCustomThemeImport: vi.fn(),
    setThemeMode: vi.fn(),
    setBorderRadius: vi.fn(),
    setTextScale: vi.fn(),
    userAvatar: null,
    onUserAvatarChange: vi.fn(),
    configObject: {},
    onSelectPreset: vi.fn(),
    connected: true,
    gatewayUrl: "ws://localhost:18789",
    assistantName: "OpenClaw",
    assistantAvatar: null,
    assistantAvatarUrl: null,
    assistantAvatarSource: null,
    assistantAvatarStatus: null,
    assistantAvatarReason: null,
    assistantAvatarOverride: null,
    assistantAvatarUploadBusy: false,
    assistantAvatarUploadError: null,
    onAssistantAvatarOverrideChange: vi.fn(),
    onAssistantAvatarClearOverride: vi.fn(),
    basePath: "",
    version: "2026.4.22",
    ...overrides,
  };
}

function collectQuickSettingsCardKinds(container: Element): string[] {
  const kinds: string[] = [];
  for (const card of container.querySelectorAll(".qs-card")) {
    const kind = Array.from(card.classList).find(
      (className) => className.startsWith("qs-card--") && className !== "qs-card--span-all",
    );
    if (kind) {
      kinds.push(kind);
    }
  }
  return kinds;
}

describe("renderQuickSettings", () => {
  it("keeps Settings containers shrink-safe inside the shell content grid", () => {
    expect(layoutCss).toMatch(/\.content\s*\{[^}]*min-width:\s*0;/su);
    expect(configQuickCss).toMatch(/\.settings-workspace\s*\{[^}]*min-width:\s*0;/su);
    expect(configQuickCss).toMatch(/\.settings-workspace__body\s*\{[^}]*min-width:\s*0;/su);
    expect(configQuickCss).toMatch(/\.qs-container\s*\{[^}]*box-sizing:\s*border-box;/su);
    expect(configQuickCss).toMatch(/\.qs-grid\s*\{[^}]*min-width:\s*0;/su);
  });

  it("shows only Context Profile, Appearance, and Gateway in Settings", () => {
    const container = document.createElement("div");

    render(renderQuickSettings(createProps()), container);

    expect(container.querySelectorAll(".qs-card--span-all")).toHaveLength(1);
    expect(collectQuickSettingsCardKinds(container)).toEqual([
      "qs-card--appearance",
      "qs-card--gateway",
    ]);
    expect(container.textContent).toContain("Context Profile");
    expect(container.textContent).toContain("Appearance");
    expect(container.textContent).toContain("Gateway");
    expect(container.textContent).toContain("Bootstrap Context");
    expect(container.textContent).not.toContain("Custom Configuration");
    expect(container.textContent).not.toContain("启动上下文");
    expect(container.textContent).not.toContain("Advanced");
    expect(container.textContent).not.toContain("Model & Thinking");
    expect(container.textContent).not.toContain("Channels");
    expect(container.textContent).not.toContain("Automations");
    expect(container.textContent).not.toContain("Security");
    expect(container.textContent).not.toContain("Personal");
    expect(
      Array.from(container.querySelectorAll(".qs-card__title")).map((node) =>
        node.textContent?.trim(),
      ),
    ).toEqual(["Context Profile", "Appearance", "Gateway"]);
  });

  it("shows the current bootstrap default when config omits the explicit limit", () => {
    const container = document.createElement("div");

    render(renderQuickSettings(createProps({ configObject: {} })), container);

    const stat = Array.from(container.querySelectorAll<HTMLElement>(".qs-profile-stat")).find(
      (candidate) =>
        candidate.querySelector(".qs-profile-stat__label")?.textContent?.trim() ===
        "Bootstrap Per File",
    );
    expect(stat?.querySelector(".qs-profile-stat__value")?.textContent?.trim()).toBe(
      "20,000 chars",
    );
  });

  it("lets operators change text size from Appearance settings", () => {
    const setTextScale = vi.fn();
    const container = document.createElement("div");

    render(renderQuickSettings(createProps({ textScale: 125, setTextScale })), container);

    const textSizeRow = expectRowByLabel(container, "Text size");
    const active = Array.from(textSizeRow.querySelectorAll("button")).find((button) =>
      button.classList.contains("qs-segmented__btn--active"),
    );
    expect(active?.textContent?.trim()).toBe("XL");

    expectButtonByText(textSizeRow, "XXL").click();
    expect(setTextScale).toHaveBeenCalledWith(140);
  });

  it("routes custom theme clicks into the tweakcn importer until a custom theme exists", () => {
    const setTheme = vi.fn();
    const onOpenCustomThemeImport = vi.fn();
    const container = document.createElement("div");

    render(
      renderQuickSettings(
        createProps({
          hasCustomTheme: false,
          setTheme,
          onOpenCustomThemeImport,
        }),
      ),
      container,
    );

    expectButtonByText(container, "Import").click();

    expect(onOpenCustomThemeImport).toHaveBeenCalledTimes(1);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("shows Gateway connection information without exposing gateway configuration", () => {
    const container = document.createElement("div");

    render(
      renderQuickSettings(
        createProps({
          connected: false,
          gatewayUrl: "ws://localhost:1234",
          assistantName: "Nova",
          version: "2026.6.14",
        }),
      ),
      container,
    );

    expect(expectRowByLabel(container, "Gateway URL").textContent).toContain("ws://localhost:1234");
    expect(expectRowByLabel(container, "Status").textContent).toContain("Offline");
    expect(expectRowByLabel(container, "Version").textContent).toContain("2026.6.14");
    expect(expectRowByLabel(container, "Assistant").textContent).toContain("Nova");
    expect(container.textContent).not.toContain("Gateway auth");
    expect(container.textContent).not.toContain("Exec policy");
  });
});
