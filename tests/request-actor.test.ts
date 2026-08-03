import { describe, expect, test } from "vitest";
import { RequestActor } from "../electron/request-actor";

describe("Engine request actor", () => {
  test("runs requests from independent producers in one FIFO", async () => {
    const actor = new RequestActor();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = actor.enqueue(async () => {
      events.push("first:start");
      await gate;
      events.push("first:end");
    });
    const second = actor.enqueue(async () => {
      events.push("second");
    });
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });
});
