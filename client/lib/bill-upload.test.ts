import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BILL_UPLOAD_MAX_BYTES,
  billUploadError,
  billUploadKind,
  formatFileSize,
  isSha256Hex,
  sha256Hex,
  signedBillUploadUrl,
} from './bill-upload.ts';

test('builds the one-time Storage upload URL without adding credentials', () => {
  assert.equal(
    signedBillUploadUrl('http://127.0.0.1:54321', 'pending/13/hash.pdf', 'signed-token'),
    'http://127.0.0.1:54321/storage/v1/object/upload/sign/bill-documents/pending/13/hash.pdf?token=signed-token',
  );
  assert.equal(signedBillUploadUrl(undefined, 'pending/13/hash.pdf', 'token'), null);
  assert.equal(signedBillUploadUrl('not a url', 'pending/13/hash.pdf', 'token'), null);
});

test('accepts a PDF, including when the browser leaves the type blank', () => {
  assert.equal(billUploadKind({ type: 'application/pdf', name: 'bill.pdf' }), 'pdf');
  assert.equal(billUploadKind({ type: '', name: 'Bill.PDF' }), 'pdf');
  assert.equal(billUploadKind({ type: 'image/png', name: 'scan.png' }), null);
  assert.equal(billUploadError({ type: 'application/pdf', name: 'bill.pdf', size: 2048 }), null);
});

test('rejects other types, empty files, and files over 10 MB', () => {
  assert.equal(billUploadError({ type: 'image/jpeg', name: 'photo.jpg', size: 100 }), 'Use a PDF.');
  assert.equal(billUploadError({ type: '', name: 'notes.txt', size: 100 }), 'Use a PDF.');
  assert.equal(
    billUploadError({ type: 'application/pdf', name: 'bill.pdf', size: 0 }),
    'That file is empty.',
  );
  assert.equal(
    billUploadError({ type: 'application/pdf', name: 'bill.pdf', size: BILL_UPLOAD_MAX_BYTES + 1 }),
    'That file is over 10 MB.',
  );
  assert.equal(
    billUploadError({ type: 'application/pdf', name: 'bill.pdf', size: BILL_UPLOAD_MAX_BYTES }),
    null,
  );
});

test('formats a file size for the preview', () => {
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(2048), '2 KB');
  assert.equal(formatFileSize(1.5 * 1024 * 1024), '1.5 MB');
});

test('fingerprints a file with SHA-256', async () => {
  const hash = await sha256Hex(new Blob(['abc']));
  assert.equal(hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(isSha256Hex(hash), true);
  assert.equal(isSha256Hex('not-a-hash'), false);
});
