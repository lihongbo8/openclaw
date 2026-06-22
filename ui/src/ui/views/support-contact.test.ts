/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderSupportContactCard } from "./support-contact.ts";

function renderView(template: unknown): HTMLElement {
  const host = document.createElement("div");
  render(template as Parameters<typeof render>[0], host);
  return host;
}

describe("renderSupportContactCard", () => {
  it("keeps the contact area visible while loading", () => {
    const host = renderView(
      renderSupportContactCard(
        {
          loading: true,
          error: null,
          contact: null,
        },
        "岗位闭环卡住时联系。",
      ),
    );

    expect(host.textContent).toContain("遇到问题可联系");
    expect(host.textContent).toContain("正在读取加群信息");
  });

  it("keeps a visible recovery hint when support contact loading fails", () => {
    const host = renderView(
      renderSupportContactCard(
        {
          loading: false,
          error: "401 Unauthorized",
          contact: null,
        },
        "岗位闭环卡住时联系。",
      ),
    );

    expect(host.textContent).toContain("联系方式读取失败：401 Unauthorized");
    expect(host.textContent).toContain("API 管理");
    expect(host.textContent).toContain("supportContact");
  });

  it("queues loading when contact has not been requested yet", async () => {
    const onLoad = vi.fn();
    renderView(
      renderSupportContactCard(
        {
          loading: false,
          error: null,
          contact: null,
        },
        "岗位闭环卡住时联系。",
        onLoad,
      ),
    );

    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(onLoad).toHaveBeenCalledTimes(1);
  });
});
