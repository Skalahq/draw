import type { DrawPersistenceAdapter } from "@skalahq/draw/core";

export const workspaceDatabaseName = "draw-demo";
export const documentStoreName = "documents";
export const preferenceStoreName = "preferences";

const workspaceStoreName = "workspaces";
const canvasStoreName = "canvases";

export type WorkspaceRecord = { id: string; name: string; createdAt: number };
export type CanvasRecord = { id: string; workspaceId: string; title: string; createdAt: number };
export type EditorPreferences = { tool?: string; workspaceId?: string; canvasId?: string };

export type WorkspaceLibrary = {
  adapter: DrawPersistenceAdapter;
  listWorkspaces(): Promise<WorkspaceRecord[]>;
  createWorkspace(name: string): Promise<WorkspaceRecord>;
  renameWorkspace(id: string, name: string): Promise<void>;
  listCanvases(workspaceId: string): Promise<CanvasRecord[]>;
  createCanvas(workspaceId: string, title: string): Promise<CanvasRecord>;
  renameCanvas(id: string, title: string): Promise<void>;
  readPreferences(): Promise<EditorPreferences>;
  writePreference(key: keyof EditorPreferences, value: string): Promise<void>;
  close(): void;
};

function requestIn<T>(database: IDBDatabase, storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const transaction = database.transaction(storeName, mode);
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  let value: T;
  let settled = false;
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    reject(error ?? new Error("IndexedDB request failed"));
  };
  const request = run(transaction.objectStore(storeName));
  request.onsuccess = () => { value = request.result; };
  request.onerror = () => fail(request.error);
  transaction.oncomplete = () => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  transaction.onerror = () => fail(transaction.error);
  transaction.onabort = () => fail(transaction.error);
  return promise;
}

function byCreatedAt(left: { createdAt: number; id: string }, right: { createdAt: number; id: string }): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

export function openWorkspaceLibrary(): Promise<WorkspaceLibrary> {
  const { promise, resolve, reject } = Promise.withResolvers<WorkspaceLibrary>();
  const request = indexedDB.open(workspaceDatabaseName, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    database.createObjectStore(workspaceStoreName, { keyPath: "id" });
    const canvases = database.createObjectStore(canvasStoreName, { keyPath: "id" });
    canvases.createIndex("workspaceId", "workspaceId");
    database.createObjectStore(documentStoreName);
    database.createObjectStore(preferenceStoreName);
  };
  request.onerror = () => reject(request.error ?? new Error("Could not open workspace storage"));
  request.onsuccess = () => resolve(libraryFrom(request.result));
  return promise;
}

function libraryFrom(database: IDBDatabase): WorkspaceLibrary {
  return {
    adapter: {
      async load(documentId) {
        const value = await requestIn(database, documentStoreName, "readonly", (store) => store.get(documentId));
        return typeof value === "string" ? value : undefined;
      },
      save(documentId, snapshot) {
        return requestIn(database, documentStoreName, "readwrite", (store) => store.put(snapshot, documentId)).then(() => undefined);
      },
    },
    async listWorkspaces() {
      const records = await requestIn(database, workspaceStoreName, "readonly", (store) => store.getAll()) as WorkspaceRecord[];
      return records.sort(byCreatedAt);
    },
    createWorkspace(name) {
      const record = { id: crypto.randomUUID(), name, createdAt: Date.now() };
      return requestIn(database, workspaceStoreName, "readwrite", (store) => store.add(record)).then(() => record);
    },
    async renameWorkspace(id, name) {
      const current = await requestIn(database, workspaceStoreName, "readonly", (store) => store.get(id)) as WorkspaceRecord | undefined;
      if (!current) throw new Error("Missing workspace");
      await requestIn(database, workspaceStoreName, "readwrite", (store) => store.put({ ...current, name }));
    },
    async listCanvases(workspaceId) {
      const records = await requestIn(
        database,
        canvasStoreName,
        "readonly",
        (store) => store.index("workspaceId").getAll(workspaceId),
      ) as CanvasRecord[];
      return records.sort(byCreatedAt);
    },
    createCanvas(workspaceId, title) {
      const record = { id: crypto.randomUUID(), workspaceId, title, createdAt: Date.now() };
      return requestIn(database, canvasStoreName, "readwrite", (store) => store.add(record)).then(() => record);
    },
    async renameCanvas(id, title) {
      const current = await requestIn(database, canvasStoreName, "readonly", (store) => store.get(id)) as CanvasRecord | undefined;
      if (!current) throw new Error("Missing canvas");
      await requestIn(database, canvasStoreName, "readwrite", (store) => store.put({ ...current, title }));
    },
    async readPreferences() {
      const transaction = database.transaction(preferenceStoreName, "readonly");
      const { promise, resolve, reject } = Promise.withResolvers<EditorPreferences>();
      const store = transaction.objectStore(preferenceStoreName);
      const tool = store.get("tool");
      const workspaceId = store.get("workspaceId");
      const canvasId = store.get("canvasId");
      const values = { tool: undefined as unknown, workspaceId: undefined as unknown, canvasId: undefined as unknown };
      tool.onsuccess = () => { values.tool = tool.result; };
      workspaceId.onsuccess = () => { values.workspaceId = workspaceId.result; };
      canvasId.onsuccess = () => { values.canvasId = canvasId.result; };
      transaction.oncomplete = () => resolve({
        tool: typeof values.tool === "string" ? values.tool : undefined,
        workspaceId: typeof values.workspaceId === "string" ? values.workspaceId : undefined,
        canvasId: typeof values.canvasId === "string" ? values.canvasId : undefined,
      });
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB request failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
      return promise;
    },
    writePreference(key, value) {
      return requestIn(database, preferenceStoreName, "readwrite", (store) => store.put(value, key)).then(() => undefined);
    },
    close() {
      database.close();
    },
  };
}
