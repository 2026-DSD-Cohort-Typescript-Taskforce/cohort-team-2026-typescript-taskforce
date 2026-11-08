"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { billUploadError, billUploadKind, formatFileSize, type BillUploadKind } from "@/lib/bill-upload";
import { ErrorAlert, colorTransition, secondaryButton } from "../ui";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

type Chosen = {
  name: string;
  size: number;
  kind: BillUploadKind;
  file: File;
};

/**
 * Bill intake (FigJam "Add a Bill" / "Upload a Bill").
 * The chosen file is previewed in the browser. Sending it on for extraction is a later step.
 */
export function BillIntake() {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  // Created in an effect so a remount can make a fresh URL. Revoking the one held in
  // state leaves the preview blank.
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

  function clear() {
    setChosen(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  const describedBy = [hintId, error ? errorId : ""].filter(Boolean).join(" ");

  return (
    <section aria-label="Add a bill" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-subheading">{chosen ? "Upload a bill" : "Add a bill"}</h2>
        <p id={hintId} className="text-body-sm text-secondary">
          Drop a PDF, PNG, or JPEG here, up to 10 MB.
        </p>
      </div>

      {chosen ? (
        <div className="flex flex-col gap-4 rounded-card border border-subtle bg-surface p-4 sm:p-5">
          <div className="overflow-hidden rounded-input border border-subtle bg-background">
            {previewUrl && chosen.kind === "image" ? (
              // Blob previews are local and short-lived, so next/image cannot optimize them.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={`Preview of ${chosen.name}`} className="max-h-[32rem] w-full object-contain" />
            ) : previewUrl ? (
              <iframe title={`Preview of ${chosen.name}`} src={previewUrl} className="h-[32rem] w-full bg-background" />
            ) : (
              <p className="p-6 text-body-sm text-secondary">Opening the preview…</p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-body-sm break-words">
              <span className="font-semibold">{chosen.name}</span>
              <span className="text-secondary"> · {formatFileSize(chosen.size)}</span>
            </p>
            <div className="flex flex-wrap gap-3">
              <label className={`cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${secondaryButton}`}>
                Replace
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  onChange={(event) => take(event.target.files?.[0])}
                />
              </label>
              <button type="button" onClick={clear} className={secondaryButton}>
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
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
          className={`flex min-h-80 cursor-pointer flex-col items-center justify-center gap-3 rounded-card border border-dashed border-strong bg-background px-6 py-10 text-center hover:border-primary hover:bg-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary data-dragging:border-primary data-dragging:bg-raised ${colorTransition}`}
        >
          <UploadMark />
          <span className="text-body-lg font-semibold">Drop the bill here</span>
          <span className="text-body-sm text-secondary">or choose a file</span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPT}
            aria-describedby={describedBy}
            className="sr-only"
            onChange={(event) => take(event.target.files?.[0])}
          />
        </label>
      )}

      <ErrorAlert id={errorId} message={error} />
    </section>
  );
}

function UploadMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-10 text-primary"
    >
      <path d="M12 16V5" />
      <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
      <path d="M5 19h14" />
    </svg>
  );
}
