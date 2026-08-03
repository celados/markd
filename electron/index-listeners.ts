export type IndexListenerRegistration = {
  active: boolean;
  key: string;
};

export function deliverIndexListener<T>(
  listeners: Map<(event: T) => void, IndexListenerRegistration>,
  listener: (event: T) => void,
  registration: IndexListenerRegistration,
  key: string,
  event: T,
  allowPending = false,
): unknown | null {
  if (
    listeners.get(listener) !== registration ||
    (!registration.active && !allowPending) ||
    registration.key === key
  ) {
    return null;
  }
  try {
    listener(event);
    // The callback may unsubscribe or replace its own registration.
    if (listeners.get(listener) === registration) {
      registration.key = key;
      if (allowPending) registration.active = true;
    }
    return null;
  } catch (error) {
    return error;
  }
}
