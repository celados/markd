export type QuitCoordinator = {
  begin: () => void;
  isQuitting: () => boolean;
};

export function createQuitCoordinator(cleanup: () => void): QuitCoordinator {
  let quitting = false;
  return {
    begin: () => {
      if (quitting) return;
      // Update quit and ordinary quit emit different first events; one idempotent edge owns teardown.
      quitting = true;
      cleanup();
    },
    isQuitting: () => quitting,
  };
}
