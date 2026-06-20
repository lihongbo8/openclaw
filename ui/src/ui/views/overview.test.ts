/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { UiSettings } from "../storage.ts";
import { renderOverview, type OverviewProps } from "./overview.ts";

function createSettings(): UiSettings {
  return {
    gatewayUrl: "ws://127.0.0.1:18789",
    token: "token",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    theme: "claw",
    themeMode: "system",
    chatShowThinking: true,
    chatShowToolCalls: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navWidth: 220,
    navGroupsCollapsed: {},
    borderRadius: 50,
    locale: "en",
  };
}

function createProps(overrides: Partial<OverviewProps> = {}): OverviewProps {
  return {
    connected: false,
    hello: null,
    settings: createSettings(),
    password: "password",
    lastError: null,
    lastErrorCode: null,
    presenceCount: 0,
    sessionsCount: null,
    cronEnabled: null,
    cronNext: null,
    lastChannelsRefresh: null,
    warnQueryToken: false,
    modelAuthStatus: null,
    usageResult: null,
    sessionsResult: null,
    skillsReport: null,
    cronJobs: [],
    cronStatus: null,
    attentionItems: [],
    eventLog: [],
    overviewLogLines: [],
    showGatewayToken: false,
    showGatewayPassword: false,
    onSettingsChange: () => undefined,
    onPasswordChange: () => undefined,
    onSessionKeyChange: () => undefined,
    onToggleGatewayTokenVisibility: () => undefined,
    onToggleGatewayPasswordVisibility: () => undefined,
    onConnect: () => undefined,
    onRefresh: () => undefined,
    onNavigate: () => undefined,
    onRefreshLogs: () => undefined,
    ...overrides,
  };
}

describe("renderOverview", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("wraps gateway credential inputs in a real submit form", async () => {
    const container = document.createElement("div");
    const onConnect = vi.fn();

    render(renderOverview(createProps({ onConnect })), container);
    await Promise.resolve();

    const passwordInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="password"]'),
    );
    expect(passwordInputs).toHaveLength(2);
    const form = passwordInputs[0]?.closest("form");
    expect(form).toBeInstanceOf(HTMLFormElement);
    expect(passwordInputs.every((input) => input.closest("form") === form)).toBe(true);

    form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});
