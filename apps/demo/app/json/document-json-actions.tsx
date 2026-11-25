"use client";

import { decodeDrawDocument, encodeDrawDocument, type DrawDocument } from "@skalahq/draw/core";
import { Button } from "@ui-sdk/react/button";
import { FileInput, FileInputTrigger } from "@ui-sdk/react/file-input";
import { useId, useState } from "react";

const noFiles: File[] = [];
const jsonFileTypes = [".json", "application/json"];

type DocumentJsonActionsProps = {
  getSnapshot(): DrawDocument;
  onImport(snapshot: DrawDocument): void | Promise<void>;
  disabled?: boolean;
};

export function DocumentJsonActions({ getSnapshot, onImport, disabled }: DocumentJsonActionsProps) {
  const description = useId();
  const [status, setStatus] = useState<{ busy?: boolean; error?: string; message?: string }>({});

  async function importFile(file: File) {
    setStatus({ busy: true, message: "Opening drawing…" });
    try {
      const snapshot = decodeDrawDocument(await file.text());
      await onImport(snapshot);
      setStatus({ message: `Opened ${file.name}` });
    } catch (error) {
      setStatus({ error: `Could not import JSON. ${error instanceof Error ? error.message : "Try another file."}` });
    }
  }

  function exportFile() {
    try {
      const json = encodeDrawDocument(getSnapshot());
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "drawing.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus({ message: "Downloaded drawing.json" });
    } catch (error) {
      setStatus({ error: `Could not export JSON. ${error instanceof Error ? error.message : "Try again."}` });
    }
  }

  return (
    <section className="json-document-actions" aria-label="Editable document files">
      <div className="editor-actions">
        <Button disabled={disabled || status.busy} onClick={exportFile}>Export JSON</Button>
        <FileInput
          accept={jsonFileTypes}
          disabled={disabled || status.busy}
          value={noFiles}
          onValueChange={([file]) => { if (file) void importFile(file); }}
          onReject={() => setStatus({ error: "Choose a Draw JSON file." })}
        >
          <FileInputTrigger aria-describedby={description} data-agent-confirm="Replace the open drawing with the imported file">
            Import JSON
          </FileInputTrigger>
        </FileInput>
      </div>
      <p id={description}>Import replaces this drawing and starts a new undo history.</p>
      <p role="status">{status.message}</p>
      {status.error ? <p role="alert">{status.error}</p> : null}
    </section>
  );
}
