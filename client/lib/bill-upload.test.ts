import assert from "node:assert/strict";
import { test } from "node:test";
import { BILL_UPLOAD_MAX_BYTES, billUploadError, billUploadKind, formatFileSize } from "./bill-upload.ts";

test("accepts a PDF, PNG, or JPEG, including when the browser leaves the type blank", () => {
  assert.equal(billUploadKind({ type: "application/pdf", name: "bill.pdf" }), "pdf");
  assert.equal(billUploadKind({ type: "image/png", name: "scan.png" }), "image");
  assert.equal(billUploadKind({ type: "image/jpeg", name: "photo.jpg" }), "image");
  assert.equal(billUploadKind({ type: "", name: "Bill.PDF" }), "pdf");
  assert.equal(billUploadError({ type: "image/jpeg", name: "photo.jpg", size: 2048 }), null);
});

test("rejects other types, empty files, and files over 10 MB", () => {
  assert.equal(billUploadError({ type: "image/gif", name: "bill.gif", size: 100 }), "Use a PDF, PNG, or JPEG.");
  assert.equal(billUploadError({ type: "", name: "notes.txt", size: 100 }), "Use a PDF, PNG, or JPEG.");
  assert.equal(billUploadError({ type: "application/pdf", name: "bill.pdf", size: 0 }), "That file is empty.");
  assert.equal(
    billUploadError({ type: "application/pdf", name: "bill.pdf", size: BILL_UPLOAD_MAX_BYTES + 1 }),
    "That file is over 10 MB.",
  );
  assert.equal(billUploadError({ type: "application/pdf", name: "bill.pdf", size: BILL_UPLOAD_MAX_BYTES }), null);
});

test("formats a file size for the preview", () => {
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(2048), "2 KB");
  assert.equal(formatFileSize(1.5 * 1024 * 1024), "1.5 MB");
});
