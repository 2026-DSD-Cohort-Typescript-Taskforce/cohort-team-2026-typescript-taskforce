"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { billUploadError, billUploadKind, formatFileSize, type BillUploadKind } from "@/lib/bill-upload";
import { ErrorAlert, colorTransition, focusRing } from "@/app/ui";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

type Chosen = {
  name: string;
  size: number;
  kind: BillUploadKind;
  file: File;
};

const actionClass = "text-body font-semibold";

/**
 * Left card on FigJam "Bill Intake \"Pay Bill\"" (node 143:2287): add, upload, and the
 * preview well. The bills list stays in the section beside this card.
 */
export function BillUploadCard() {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!chosen) return;
    const url = URL.createObjectURL(chosen.file);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setPreviewUrl(null);
    };
  }, [chosen]);

  function take(file: File | undefined) {
    if (!file) return;
    const message = billUploadError(file);
    if (message) {
      setError(message);
      return;
    }
    const kind = billUploadKind(file);
    if (!kind) return;
    setError("");
    setChosen({ name: file.name, size: file.size, kind, file });
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const { files } = event.dataTransfer;
    if (files.length > 1) {
      setError("Add one bill at a time.");
      return;
    }
    take(files[0]);
  }

  return (
        <section aria-label="Add or upload a bill" className="flex h-full min-h-0 flex-col rounded-card border border-subtle bg-surface">      
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-subtle px-6 py-4">
        <p className={`${actionClass} underline underline-offset-4`}>+ Add a Bill</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`${actionClass} underline underline-offset-4 ${focusRing}`}
        >
          + Upload a Bill
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <label
          htmlFor={inputId}
          data-dragging={dragging || undefined}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setDragging(false);
          }}
          onDrop={onDrop}
          className={`flex min-h-0 flex-1 cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-input border border-strong bg-background px-6 py-10 text-center hover:border-primary hover:bg-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary data-dragging:border-primary data-dragging:bg-raised ${colorTransition}`}
        >
          {previewUrl && chosen ? (
            <BillPreview url={previewUrl} chosen={chosen} />
          ) : (
            <span className="text-body-lg font-semibold tracking-wide text-secondary uppercase">
              + Bill upload preview
            </span>
          )}
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPT}
            aria-label="Upload a bill"
            aria-describedby={error ? errorId : undefined}
            className="sr-only"
            onChange={(event) => take(event.target.files?.[0])}
          />
        </label>
        <ErrorAlert id={errorId} message={error} />
      </div>
    </section>
  );
}

function BillPreview({ url, chosen }: { url: string; chosen: Chosen }) {
  return (
    <>
      {chosen.kind === "image" ? (
        // Blob previews are local and short-lived, so next/image cannot optimize them.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="max-h-full w-full object-contain" />
      ) : (
        <iframe title={chosen.name} src={url} className="h-full min-h-0 w-full bg-background" />
      )}
      <span className="text-body-sm text-secondary">
        {chosen.name} · {formatFileSize(chosen.size)}
      </span>
    </>
  );
}
