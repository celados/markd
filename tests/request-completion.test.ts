import { describe, expect, test, vi } from "vitest";
import { completeRequest } from "../electron/request-completion";
import { RequestActor } from "../electron/request-actor";

describe("Engine request completion", () => {
  test("releases held events when the response port closes", async () => {
    const onFailure = vi.fn();
    const onTransportFailure = vi.fn();
    const release = vi.fn();

    await completeRequest({
      run: async () => "done",
      onSuccess: () => {
        throw new Error("port closed");
      },
      onFailure,
      onTransportFailure,
      release,
    });

    expect(onFailure).not.toHaveBeenCalled();
    expect(onTransportFailure).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  test("keeps response and release inside the actor transaction", async () => {
    const actor = new RequestActor();
    const order: string[] = [];
    const gate = deferred<void>();
    const first = actor.enqueue(() => completeRequest({
      run: async () => {
        order.push("A:hold");
        await gate.promise;
        return "A";
      },
      onSuccess: () => order.push("A:response"),
      onFailure: () => order.push("A:error"),
      onTransportFailure: () => order.push("A:transport"),
      release: () => order.push("A:release"),
    }));
    const second = actor.enqueue(() => completeRequest({
      run: async () => {
        order.push("B:hold");
        return "B";
      },
      onSuccess: () => order.push("B:response"),
      onFailure: () => order.push("B:error"),
      onTransportFailure: () => order.push("B:transport"),
      release: () => order.push("B:release"),
    }));

    await Promise.resolve();
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual([
      "A:hold",
      "A:response",
      "A:release",
      "B:hold",
      "B:response",
      "B:release",
    ]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
