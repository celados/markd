import { expect, test, vi } from "vitest";
import { createQuitCoordinator } from "../electron/quit-coordinator";

test("update and ordinary quit share one idempotent teardown edge", () => {
  const cleanup = vi.fn();
  const coordinator = createQuitCoordinator(cleanup);

  expect(coordinator.isQuitting()).toBe(false);
  coordinator.begin();
  coordinator.begin();

  expect(coordinator.isQuitting()).toBe(true);
  expect(cleanup).toHaveBeenCalledOnce();
});
