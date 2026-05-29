import { describe, it, expect, vi } from "vitest";
import { registerWebhooks } from "../src/webhook.js";

describe("registerWebhooks", () => {
  it("enqueues a job from a pull_request event payload", async () => {
    let handler: (ctx: any) => Promise<void> = async () => {};
    const app = { on: vi.fn((_events: string[], h: any) => { handler = h; }) } as any;
    const queue = { enqueue: vi.fn() } as any;

    registerWebhooks(app, queue);

    expect(app.on).toHaveBeenCalledWith(
      ["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"],
      expect.any(Function),
    );

    await handler({
      payload: {
        repository: { owner: { login: "o" }, name: "r" },
        pull_request: { number: 7, head: { sha: "h7" }, base: { sha: "b7" } },
        installation: { id: 42 },
      },
    });

    expect(queue.enqueue).toHaveBeenCalledWith({
      owner: "o", repo: "r", pr: 7, headSha: "h7", baseSha: "b7", installationId: 42,
    });
  });

  it("logs webhook event with action and pr metadata", async () => {
    let handler: (ctx: any) => Promise<void> = async () => {};
    const app = { on: vi.fn((_e: string[], h: any) => { handler = h; }) } as any;
    const queue = { enqueue: vi.fn() } as any;
    const events: Record<string, unknown>[] = [];

    registerWebhooks(app, queue, (e) => events.push(e));

    await handler({
      payload: {
        action: "synchronize",
        repository: { owner: { login: "o" }, name: "r" },
        pull_request: { number: 7, head: { sha: "h7" }, base: { sha: "b7" } },
        installation: { id: 42 },
      },
    });

    expect(events).toContainEqual({
      event: "webhook", action: "synchronize", repo: "o/r", pr: 7, headSha: "h7", installationId: 42,
    });
  });

  it("logs webhook_skipped when installation is missing and does not enqueue", async () => {
    let handler: (ctx: any) => Promise<void> = async () => {};
    const app = { on: vi.fn((_e: string[], h: any) => { handler = h; }) } as any;
    const queue = { enqueue: vi.fn() } as any;
    const events: Record<string, unknown>[] = [];

    registerWebhooks(app, queue, (e) => events.push(e));

    await handler({
      payload: {
        action: "opened",
        repository: { owner: { login: "o" }, name: "r" },
        pull_request: { number: 1, head: { sha: "h" }, base: { sha: "b" } },
      },
    });

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({ event: "webhook_skipped", reason: "no_installation", repo: "o/r", pr: 1 }),
    );
  });
});
