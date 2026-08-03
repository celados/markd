import { describe, expect, test } from "vitest";
import { deliverIndexListener } from "../electron/index-listeners";

describe("Vault Index listener fanout", () => {
  test("does not mark a throwing listener consumed or starve later listeners", () => {
    const received: string[] = [];
    const throwing = () => {
      throw new Error("renderer failed");
    };
    const healthy = (event: string) => received.push(event);
    const throwingRegistration = { active: true, key: "" };
    const healthyRegistration = { active: true, key: "" };
    const listeners = new Map([
      [throwing, throwingRegistration],
      [healthy, healthyRegistration],
    ]);

    expect(deliverIndexListener(
      listeners, throwing, throwingRegistration, "1:1:1", "change",
    )).toBeInstanceOf(Error);
    expect(deliverIndexListener(
      listeners, healthy, healthyRegistration, "1:1:1", "change",
    )).toBeNull();
    expect(received).toEqual(["change"]);
    expect(throwingRegistration.key).toBe("");
    expect(healthyRegistration.key).toBe("1:1:1");
  });

  test("does not deliver deltas before baseline or resurrect self-unsubscription", () => {
    const received: string[] = [];
    let unsubscribe = () => {};
    const listener = (event: string) => {
      received.push(event);
      unsubscribe();
    };
    const registration = { active: false, key: "" };
    const listeners = new Map([[listener, registration]]);
    unsubscribe = () => listeners.delete(listener);

    expect(deliverIndexListener(
      listeners, listener, registration, "1:1:1", "delta",
    )).toBeNull();
    expect(received).toEqual([]);
    expect(deliverIndexListener(
      listeners, listener, registration, "1:2:0", "baseline", true,
    )).toBeNull();
    expect(received).toEqual(["baseline"]);
    expect(listeners.has(listener)).toBe(false);
    expect(deliverIndexListener(
      listeners, listener, registration, "1:2:1", "later",
    )).toBeNull();
    expect(received).toEqual(["baseline"]);
  });

  test("activates a pending listener only after a successful replacement", () => {
    const received: string[] = [];
    const listener = (event: string) => received.push(event);
    const registration = { active: false, key: "" };
    const listeners = new Map([[listener, registration]]);

    expect(deliverIndexListener(
      listeners, listener, registration, "2:1:1", "change",
    )).toBeNull();
    expect(registration.active).toBe(false);
    expect(deliverIndexListener(
      listeners, listener, registration, "2:2:0", "replacement", true,
    )).toBeNull();
    expect(registration).toEqual({ active: true, key: "2:2:0" });
    expect(deliverIndexListener(
      listeners, listener, registration, "2:2:1", "change",
    )).toBeNull();
    expect(received).toEqual(["replacement", "change"]);
  });
});
