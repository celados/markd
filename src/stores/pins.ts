import { create } from "@octanejs/zustand";
import { toast } from "@octanejs/sonner";
import { ipc } from "@/lib/ipc";

type PinsState = {
  pins: string[];
  stale: string[];
  loading: boolean;
  load: () => Promise<void>;
  pin: (rel: string) => Promise<void>;
  unpin: (rel: string) => Promise<void>;
  toggle: (rel: string) => Promise<void>;
  clear: () => void;
};

const showError = (error: unknown) =>
  toast.error(error instanceof Error ? error.message : String(error));

export const usePins = create<PinsState>((set, get) => ({
  pins: [],
  stale: [],
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      set(await ipc.pinsList());
    } catch (error) {
      showError(error);
    } finally {
      set({ loading: false });
    }
  },

  pin: async (rel) => {
    try {
      set(await ipc.pinNote(rel));
    } catch (error) {
      showError(error);
    }
  },

  unpin: async (rel) => {
    try {
      set(await ipc.unpinNote(rel));
    } catch (error) {
      showError(error);
    }
  },

  toggle: async (rel) => {
    if (get().pins.includes(rel)) {
      await get().unpin(rel);
    } else {
      await get().pin(rel);
    }
  },

  clear: () => set({ pins: [], stale: [], loading: false }),
}));
