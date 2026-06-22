import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import { invalidateModelCatalogCache, loadModels } from "./models.ts";

describe("loadModels", () => {
  it("requests the configured model list view", async () => {
    const request = vi.fn(async () => ({
      models: [
        { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed", provider: "minimax" },
      ],
    }));

    const models = await loadModels({ request } as unknown as GatewayBrowserClient);

    expect(request).toHaveBeenCalledWith("models.list", { view: "configured" });
    expect(models).toEqual([
      { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed", provider: "minimax" },
    ]);
  });

  it("reuses the configured model list while the cache is fresh", async () => {
    const request = vi.fn(async () => ({
      models: [{ id: "gpt-5.5", name: "GPT-5.5", provider: "openai" }],
    }));
    const client = { request } as unknown as GatewayBrowserClient;

    const first = await loadModels(client);
    const second = await loadModels(client);

    expect(request).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("reloads configured models after the cache is invalidated", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        models: [{ id: "gpt-5.5", name: "GPT-5.5", provider: "openai" }],
      })
      .mockResolvedValueOnce({
        models: [
          { id: "gpt-5.5", name: "GPT-5.5", provider: "openai" },
          { id: "codex-bengalfox", name: "codex-bengalfox", provider: "openai" },
        ],
      });
    const client = { request } as unknown as GatewayBrowserClient;

    const first = await loadModels(client);
    invalidateModelCatalogCache(client);
    const second = await loadModels(client);

    expect(request).toHaveBeenCalledTimes(2);
    expect(first.map((model) => model.id)).toEqual(["gpt-5.5"]);
    expect(second.map((model) => model.id)).toEqual(["gpt-5.5", "codex-bengalfox"]);
  });
});
