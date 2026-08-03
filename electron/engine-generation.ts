export function createEngineGenerationTerminal(
  onTerminal: (message: string) => void,
) {
  let terminal = false;
  return {
    isTerminal: () => terminal,
    terminate: (message: string): boolean => {
      if (terminal) return false;
      terminal = true;
      onTerminal(message);
      return true;
    },
  };
}
