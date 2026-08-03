export async function completeRequest<T>(options: {
  run: () => Promise<T>;
  onSuccess: (value: T) => void;
  onFailure: (error: unknown) => void;
  onTransportFailure: (error: unknown) => void;
  release: () => void;
}): Promise<void> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await options.run() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  try {
    if (outcome.ok) options.onSuccess(outcome.value);
    else options.onFailure(outcome.error);
  } catch (error) {
    options.onTransportFailure(error);
  } finally {
    options.release();
  }
}
