export class RequestActor {
  #tail: Promise<void> = Promise.resolve();

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation);
    // A failed request is returned to its caller, but cannot poison the actor
    // and prevent later requests from reaching the Vault.
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
