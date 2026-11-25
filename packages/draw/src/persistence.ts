import type { DrawController, DrawDocument } from "./core.js";
import { decodeDrawDocument, encodeDrawDocument } from "./json.js";

/** Host storage for encoded document bytes. Concurrent writers are outside this contract. */
export type DrawPersistenceAdapter = {
  load(documentId: string): Promise<string | undefined>;
  save(documentId: string, snapshot: string): Promise<void>;
};

export type DrawPersistenceStatus = "saved" | "saving" | "failed";

export type DrawPersistenceState = {
  readonly status: DrawPersistenceStatus;
  readonly documentId: string;
  readonly error?: unknown;
};

export type DrawPersistence = {
  /** Decode a stored snapshot. Missing documents return undefined; invalid bytes throw. */
  load(documentId: string): Promise<DrawDocument | undefined>;
  /** Encode and queue the latest snapshot. In-flight saves finish; waiting snapshots collapse to this one. */
  save(documentId: string, snapshot: DrawDocument): void;
  /** Send the newest unsaved snapshot after a failure. No-op while a save is already running. */
  retry(documentId: string): void;
  /** Resolves when the latest queued snapshot is stored. Rejects if the latest attempt failed. */
  flush(documentId: string): Promise<void>;
  getState(documentId: string): DrawPersistenceState;
  subscribe(documentId: string, listener: (state: DrawPersistenceState) => void): () => void;
  /** Save each later commit. Opening a controller is not an edit, so the current snapshot is not written. */
  bind(controller: DrawController, documentId: string): () => void;
};

type Waiter = { resolve: () => void; reject: (error: unknown) => void };

type Slot = {
  documentId: string;
  inflight: { bytes: string; token: symbol } | null;
  queued: string | null;
  lastSaved: string | null;
  status: DrawPersistenceStatus;
  error: unknown;
  listeners: Set<(state: DrawPersistenceState) => void>;
  waiters: Waiter[];
};

function requireId(documentId: string): void {
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new TypeError("Draw document id must be a non-empty string");
  }
}

function stateOf(slot: Slot): DrawPersistenceState {
  return slot.status === "failed"
    ? { status: slot.status, documentId: slot.documentId, error: slot.error }
    : { status: slot.status, documentId: slot.documentId };
}

/**
 * Optional document storage. Editing a controller does not require an adapter.
 * Saves for one document never overlap; a newer snapshot replaces one that has not started.
 * After a failure, later edits stay queued until `retry` so a failing adapter is not called on every edit.
 */
export function createDrawPersistence(adapter: DrawPersistenceAdapter): DrawPersistence {
  const slots = new Map<string, Slot>();

  function slotFor(documentId: string): Slot {
    requireId(documentId);
    let slot = slots.get(documentId);
    if (!slot) {
      slot = {
        documentId,
        inflight: null,
        queued: null,
        lastSaved: null,
        status: "saved",
        error: undefined,
        listeners: new Set(),
        waiters: [],
      };
      slots.set(documentId, slot);
    }
    return slot;
  }

  function notify(slot: Slot): void {
    const state = stateOf(slot);
    for (const listener of [...slot.listeners]) listener(state);
  }

  function settle(slot: Slot, ok: boolean, error?: unknown): void {
    const waiting = slot.waiters.splice(0);
    for (const waiter of waiting) {
      if (ok) waiter.resolve();
      else waiter.reject(error ?? new Error("Draw save failed"));
    }
  }

  function begin(slot: Slot, bytes: string): void {
    const token = Symbol();
    const changed = slot.status !== "saving";
    slot.inflight = { bytes, token };
    slot.status = "saving";
    slot.error = undefined;
    if (changed) notify(slot);
    let result: Promise<void>;
    try {
      result = Promise.resolve(adapter.save(slot.documentId, bytes));
    } catch (error) {
      result = Promise.reject(error);
    }
    result.then(
      () => { if (slot.inflight?.token === token) succeed(slot, bytes); },
      (error: unknown) => { if (slot.inflight?.token === token) fail(slot, bytes, error); },
    );
  }

  function succeed(slot: Slot, bytes: string): void {
    slot.lastSaved = bytes;
    slot.inflight = null;
    const next = slot.queued;
    slot.queued = null;
    if (next && next !== bytes) {
      begin(slot, next);
      return;
    }
    slot.status = "saved";
    slot.error = undefined;
    settle(slot, true);
    notify(slot);
  }

  function fail(slot: Slot, bytes: string, error: unknown): void {
    slot.inflight = null;
    slot.queued = slot.queued ?? bytes;
    slot.status = "failed";
    slot.error = error;
    settle(slot, false, error ?? new Error("Draw save failed"));
    notify(slot);
  }

  function enqueue(slot: Slot, bytes: string): void {
    if (slot.inflight) {
      slot.queued = bytes === slot.inflight.bytes ? null : bytes;
      return;
    }
    if (bytes === slot.lastSaved) {
      slot.queued = null;
      if (slot.status !== "saved") {
        slot.status = "saved";
        slot.error = undefined;
        settle(slot, true);
        notify(slot);
      }
      return;
    }
    // Keep the newest bytes, but do not start another attempt until retry.
    if (slot.status === "failed") {
      slot.queued = bytes;
      return;
    }
    begin(slot, bytes);
  }
  return {
    async load(documentId) {
      requireId(documentId);
      const bytes = await adapter.load(documentId);
      if (bytes === undefined) return undefined;
      const document = decodeDrawDocument(bytes);
      const slot = slotFor(documentId);
      if (!slot.inflight && !slot.queued && slot.status !== "failed") slot.lastSaved = encodeDrawDocument(document);
      return document;
    },
    save(documentId, snapshot) {
      enqueue(slotFor(documentId), encodeDrawDocument(snapshot));
    },
    retry(documentId) {
      const slot = slotFor(documentId);
      if (slot.inflight || !slot.queued) return;
      const bytes = slot.queued;
      slot.queued = null;
      if (bytes === slot.lastSaved) {
        slot.status = "saved";
        slot.error = undefined;
        settle(slot, true);
        notify(slot);
        return;
      }
      begin(slot, bytes);
    },
    flush(documentId) {
      const slot = slotFor(documentId);
      if (slot.inflight) {
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        slot.waiters.push({ resolve, reject });
        return promise;
      }
      if (slot.status === "failed") return Promise.reject(slot.error ?? new Error("Draw save failed"));
      return Promise.resolve();
    },
    getState(documentId) {
      return stateOf(slotFor(documentId));
    },
    subscribe(documentId, listener) {
      const slot = slotFor(documentId);
      slot.listeners.add(listener);
      return () => { slot.listeners.delete(listener); };
    },
    bind(controller, documentId) {
      requireId(documentId);
      return controller.subscribeCommitted((snapshot) => {
        try {
          enqueue(slotFor(documentId), encodeDrawDocument(snapshot));
        } catch (error) {
          const slot = slotFor(documentId);
          slot.status = "failed";
          slot.error = error;
          settle(slot, false, error);
          notify(slot);
        }
      });
    },
  };
}
