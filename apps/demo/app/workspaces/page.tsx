"use client";

import {
  createDrawController,
  createDrawPersistence,
  insertNodeTool,
  panTool,
  selectTool,
  type DrawController,
  type DrawDocument,
  type DrawNode,
  type DrawPersistence,
  type DrawPersistenceStatus,
  type Point,
} from "@skalahq/draw/core";
import { DrawCanvas } from "@skalahq/draw/react";
import { Button } from "@ui-sdk/react/button";
import { Field, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle";
import { useEffect, useMemo, useRef, useState } from "react";
import { openWorkspaceLibrary, workspaceDatabaseName, type CanvasRecord, type WorkspaceLibrary, type WorkspaceRecord } from "./library";
import "./workspaces.css";

const statusLabel: Record<DrawPersistenceStatus, string> = {
  saved: "Saved",
  saving: "Saving",
  failed: "Save failed",
};

type ToolId = "select" | "pan" | "insert-node";

function isToolId(value: string | undefined): value is ToolId {
  return value === "select" || value === "pan" || value === "insert-node";
}

function noteAt(at: Point, count: number): DrawNode {
  return {
    id: crypto.randomUUID(),
    type: "note",
    bounds: { x: at.x - 72, y: at.y - 40, width: 144, height: 80 },
    metadata: { label: `Note ${count}` },
  };
}

function nodeLabel(node: DrawNode): string {
  return typeof node.metadata?.label === "string" ? node.metadata.label : node.type;
}

function renderNode(node: DrawNode) {
  return <div className="editor-node">{nodeLabel(node)}</div>;
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function WorkspacesPage() {
  const [library, setLibrary] = useState<WorkspaceLibrary | null>(null);
  const [persistence, setPersistence] = useState<DrawPersistence | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [canvases, setCanvases] = useState<CanvasRecord[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [controller, setController] = useState(createDrawController);
  const [toolId, setToolId] = useState<ToolId>("select");
  const [storedTool, setStoredTool] = useState<ToolId>("select");
  const [status, setStatus] = useState<DrawPersistenceStatus>("saved");
  const [saveGeneration, setSaveGeneration] = useState(0);
  const [warning, setWarning] = useState("");
  const [loadError, setLoadError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftWorkspace, setDraftWorkspace] = useState("");
  const [draftCanvas, setDraftCanvas] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [canvasTitle, setCanvasTitle] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef(controller);
  const unbind = useRef<(() => void) | null>(null);
  const libraryRef = useRef<WorkspaceLibrary | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  controllerRef.current = controller;

  const insert = useMemo(() => insertNodeTool((at) => noteAt(at, controllerRef.current.getSnapshot().nodes.length + 1)), []);
  const tool = toolId === "pan" ? panTool : toolId === "insert-node" ? insert : selectTool;
  const currentWorkspace = workspaces.find((item) => item.id === workspaceId);
  const currentCanvas = canvases.find((item) => item.id === canvasId);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const opened = await openWorkspaceLibrary();
        if (cancelled) {
          opened.close();
          return;
        }
        libraryRef.current = opened;
        const stored = createDrawPersistence(opened.adapter);
        const preferences = await opened.readPreferences();
        const listedWorkspaces = await opened.listWorkspaces();
        const selectedWorkspace = listedWorkspaces.find((item) => item.id === preferences.workspaceId) ?? listedWorkspaces[0];
        const listedCanvases = selectedWorkspace ? await opened.listCanvases(selectedWorkspace.id) : [];
        const selectedCanvas = listedCanvases.find((item) => item.id === preferences.canvasId) ?? listedCanvases[0];
        let openedController = createDrawController();
        if (selectedCanvas) {
          openedController = createDrawController(await stored.load(selectedCanvas.id));
          unbind.current = stored.bind(openedController, selectedCanvas.id);
        }
        if (cancelled) {
          unbind.current?.();
          opened.close();
          return;
        }
        const preferenceTool = isToolId(preferences.tool) ? preferences.tool : "select";
        setLibrary(opened);
        setPersistence(stored);
        setWorkspaces(listedWorkspaces);
        setCanvases(listedCanvases);
        setWorkspaceId(selectedWorkspace?.id ?? null);
        setWorkspaceName(selectedWorkspace?.name ?? "");
        setCanvasId(selectedCanvas?.id ?? null);
        setCanvasTitle(selectedCanvas?.title ?? "");
        setController(openedController);
        setToolId(preferenceTool);
        setStoredTool(preferenceTool);
        setStatus(selectedCanvas ? stored.getState(selectedCanvas.id).status : "saved");
        setReady(true);
      } catch (error) {
        if (!cancelled) setLoadError(messageFrom(error, "Could not open local workspaces."));
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
      unbind.current?.();
      unbind.current = null;
      libraryRef.current?.close();
      libraryRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!persistence || !canvasId) return;
    setStatus(persistence.getState(canvasId).status);
    return persistence.subscribe(canvasId, (state) => {
      setStatus(state.status);
      if (state.status === "saved") {
        setWarning("");
        setSaveGeneration((count) => count + 1);
      }
    });
  }, [persistence, canvasId]);

  async function run(task: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await task();
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function flushOpen(): Promise<boolean> {
    if (!persistence || !canvasId) return true;
    try {
      await persistence.flush(canvasId);
      return true;
    } catch (error) {
      if (mounted.current) setWarning(`Unsaved edits. ${messageFrom(error, "Save failed.")} Retry the save before switching.`);
      return false;
    }
  }

  async function replaceCanvas(nextId: string, title: string, stored: DrawPersistence, opened: WorkspaceLibrary): Promise<boolean> {
    if (nextId === canvasId) return true;
    if (!(await flushOpen())) return false;
    let snapshot: DrawDocument | undefined;
    try {
      snapshot = await stored.load(nextId);
    } catch (error) {
      if (mounted.current) setLoadError(messageFrom(error, "Could not open that canvas."));
      return false;
    }
    if (!mounted.current) return false;
    const next = createDrawController(snapshot);
    unbind.current?.();
    unbind.current = stored.bind(next, nextId);
    setController(next);
    setCanvasId(nextId);
    setCanvasTitle(title);
    setStatus(stored.getState(nextId).status);
    setLoadError("");
    await opened.writePreference("canvasId", nextId);
    return true;
  }

  async function clearCanvas(opened: WorkspaceLibrary): Promise<boolean> {
    if (!(await flushOpen())) return false;
    unbind.current?.();
    unbind.current = null;
    if (!mounted.current) return false;
    setController(createDrawController());
    setCanvasId(null);
    setCanvasTitle("");
    await opened.writePreference("canvasId", "");
    return true;
  }

  function createWorkspace(name: string) {
    const title = name.trim();
    if (!title || !library || !persistence) return;
    return run(async () => {
      if (!(await flushOpen())) return;
      const record = await library.createWorkspace(title);
      if (!mounted.current || !(await clearCanvas(library))) return;
      setWorkspaces(await library.listWorkspaces());
      setWorkspaceId(record.id);
      setWorkspaceName(record.name);
      setCanvases([]);
      setDraftWorkspace("");
      await library.writePreference("workspaceId", record.id);
    });
  }

  function createCanvas(title: string) {
    const name = title.trim();
    if (!name || !library || !persistence || !workspaceId) return;
    return run(async () => {
      if (!(await flushOpen())) return;
      const record = await library.createCanvas(workspaceId, name);
      const next = createDrawController();
      persistence.save(record.id, next.getSnapshot());
      try {
        await persistence.flush(record.id);
      } catch (error) {
        if (mounted.current) {
          setCanvases(await library.listCanvases(workspaceId));
          setWarning(`Unsaved edits. ${messageFrom(error, "Save failed.")} Retry the save before switching.`);
        }
        return;
      }
      if (!mounted.current) return;
      unbind.current?.();
      unbind.current = persistence.bind(next, record.id);
      setCanvases(await library.listCanvases(workspaceId));
      setController(next);
      setCanvasId(record.id);
      setCanvasTitle(record.title);
      setDraftCanvas("");
      setStatus(persistence.getState(record.id).status);
      setLoadError("");
      await library.writePreference("canvasId", record.id);
    });
  }

  function renameWorkspace() {
    const name = workspaceName.trim();
    if (!library || !workspaceId || !name || name === currentWorkspace?.name) return;
    return run(async () => {
      await library.renameWorkspace(workspaceId, name);
      if (mounted.current) setWorkspaces(await library.listWorkspaces());
    });
  }

  function renameCanvas() {
    const title = canvasTitle.trim();
    if (!library || !canvasId || !workspaceId || !title || title === currentCanvas?.title) return;
    return run(async () => {
      await library.renameCanvas(canvasId, title);
      if (mounted.current) setCanvases(await library.listCanvases(workspaceId));
    });
  }

  function switchWorkspace(nextId: string) {
    if (!library || !persistence || nextId === workspaceId) return;
    return run(async () => {
      const nextCanvases = await library.listCanvases(nextId);
      const nextWorkspace = workspaces.find((item) => item.id === nextId);
      const nextCanvas = nextCanvases[0];
      const opened = nextCanvas
        ? await replaceCanvas(nextCanvas.id, nextCanvas.title, persistence, library)
        : await clearCanvas(library);
      if (!opened || !mounted.current) return;
      setWorkspaceId(nextId);
      setWorkspaceName(nextWorkspace?.name ?? "");
      setCanvases(nextCanvases);
      await library.writePreference("workspaceId", nextId);
    });
  }

  function switchCanvas(nextId: string) {
    if (!library || !persistence || nextId === canvasId) return;
    const title = canvases.find((item) => item.id === nextId)?.title ?? "";
    return run(() => replaceCanvas(nextId, title, persistence, library).then(() => undefined));
  }

  function chooseTool(next: string) {
    if (!isToolId(next) || !library) return;
    setToolId(next);
    canvasRef.current?.focus();
    return library.writePreference("tool", next).then(() => {
      if (mounted.current) setStoredTool(next);
    });
  }

  function addNote() {
    const count = controller.getSnapshot().nodes.length + 1;
    controller.commands.insertNode(noteAt({ x: 120 + (count % 5) * 18, y: 96 + (count % 5) * 16 }, count));
  }
  return (
    <main
      className="editor workspace-editor"
      data-storage={workspaceDatabaseName}
      data-workspace-id={workspaceId ?? ""}
      data-canvas-id={canvasId ?? ""}
      data-workspace-name={currentWorkspace?.name ?? ""}
      data-canvas-title={currentCanvas?.title ?? ""}
      data-tool-stored={storedTool}
    >
      <header className="editor-header">
        <h1>Workspaces</h1>
        <div className="editor-actions" aria-label="Document actions">
          <Button disabled={!ready || busy || !canvasId || status !== "failed"} onClick={() => { persistence?.retry(canvasId!); }}>Retry save</Button>
          <Button disabled={!ready || busy || !canvasId} onClick={addNote}>Add note</Button>
          <Button disabled={!ready || busy || !canvasId} onClick={() => { controller.commands.undo(); }}>Undo</Button>
          <Button disabled={!ready || busy || !canvasId} onClick={() => { controller.commands.redo(); }}>Redo</Button>
        </div>
        <output className="editor-status" aria-live="polite" aria-label="Save status" data-save-generation={saveGeneration}>{canvasId ? statusLabel[status] : "Saved"}</output>
      </header>
      <section className="workspace-library" aria-label="Workspace library">
        {!ready && !loadError ? <p role="status">Opening local workspaces…</p> : null}
        {loadError ? <p className="workspace-warning" role="alert">{loadError}</p> : null}
        {warning ? <p className="workspace-warning" role="alert">{warning}</p> : null}
        <form className="workspace-row" onSubmit={(event) => { event.preventDefault(); void createWorkspace(draftWorkspace); }}>
          <Field name="new-workspace">
            <FieldLabel>New workspace</FieldLabel>
            <Input value={draftWorkspace} onValueChange={setDraftWorkspace} required maxLength={80} disabled={!ready || busy} />
          </Field>
          <Button type="submit" disabled={!ready || busy || draftWorkspace.trim() === ""} onClick={() => createWorkspace(draftWorkspace)}>Create workspace</Button>
        </form>
        {workspaces.length > 0 ? (
          <ToggleGroup
            aria-label="Workspaces"
            value={workspaceId ? [workspaceId] : []}
            deselectable={false}
            disabled={!ready || busy}
            onValueChange={(value, details) => {
              details.cancel();
              const next = value[0];
              if (next) void switchWorkspace(next);
            }}
          >
            {workspaces.map((item) => <Toggle key={item.id} value={item.id}>{item.name}</Toggle>)}
          </ToggleGroup>
        ) : null}
        <form className="workspace-row" onSubmit={(event) => { event.preventDefault(); void renameWorkspace(); }}>
          <Field name="workspace-name">
            <FieldLabel>Workspace name</FieldLabel>
            <Input value={workspaceName} onValueChange={setWorkspaceName} maxLength={80} disabled={!ready || busy || !workspaceId} />
          </Field>
          <Button type="submit" disabled={!ready || busy || !workspaceId || workspaceName.trim() === "" || workspaceName.trim() === currentWorkspace?.name} onClick={renameWorkspace}>Rename workspace</Button>
        </form>
        <form className="workspace-row" onSubmit={(event) => { event.preventDefault(); void createCanvas(draftCanvas); }}>
          <Field name="new-canvas">
            <FieldLabel>New canvas</FieldLabel>
            <Input value={draftCanvas} onValueChange={setDraftCanvas} required maxLength={80} disabled={!ready || busy || !workspaceId} />
          </Field>
          <Button type="submit" disabled={!ready || busy || !workspaceId || draftCanvas.trim() === ""} onClick={() => createCanvas(draftCanvas)}>Create canvas</Button>
        </form>
        {canvases.length > 0 ? (
          <ToggleGroup
            aria-label="Canvases"
            value={canvasId ? [canvasId] : []}
            deselectable={false}
            disabled={!ready || busy}
            onValueChange={(value, details) => {
              details.cancel();
              const next = value[0];
              if (next) void switchCanvas(next);
            }}
          >
            {canvases.map((item) => <Toggle key={item.id} value={item.id}>{item.title}</Toggle>)}
          </ToggleGroup>
        ) : null}
        <form className="workspace-row" onSubmit={(event) => { event.preventDefault(); void renameCanvas(); }}>
          <Field name="canvas-title">
            <FieldLabel>Canvas title</FieldLabel>
            <Input value={canvasTitle} onValueChange={setCanvasTitle} maxLength={80} disabled={!ready || busy || !canvasId} />
          </Field>
          <Button type="submit" disabled={!ready || busy || !canvasId || canvasTitle.trim() === "" || canvasTitle.trim() === currentCanvas?.title} onClick={renameCanvas}>Rename canvas</Button>
        </form>
        <ToggleGroup
          className="editor-tools"
          aria-label="Canvas tools"
          value={[toolId]}
          deselectable={false}
          disabled={!ready || busy || !canvasId}
          onValueChange={(value) => { void chooseTool(value[0] ?? "select"); }}
        >
          <Toggle value="select">Select</Toggle>
          <Toggle value="pan">Pan</Toggle>
          <Toggle value="insert-node">Insert note</Toggle>
        </ToggleGroup>
      </section>
      {canvasId ? (
        <DrawCanvas
          key={canvasId}
          ref={canvasRef}
          className="editor-canvas"
          aria-describedby="workspace-canvas-keys"
          controller={controller}
          tool={tool}
          getNodeLabel={nodeLabel}
          renderNode={renderNode}
        />
      ) : (
        <p className="workspace-empty">Create a canvas to start drawing.</p>
      )}
      <footer className="editor-footer">
        <p id="workspace-canvas-keys">Use [ and ] to select a node, arrow keys to move it, and Delete to remove it. Undo applies only to the open canvas.</p>
      </footer>
    </main>
  );
}
