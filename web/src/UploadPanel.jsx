import React, { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';

const UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024; // Vercel serverless functions cap request bodies around 4.5MB
const CONCURRENCY = 4;

function humanSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function slugifyFilename(name, usedNames) {
  const base = name.replace(/\.[^./]+$/, '');
  let slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (!slug) slug = 'image';
  let candidate = `${slug}.jpg`;
  let n = 2;
  while (usedNames.has(candidate)) {
    candidate = `${slug}-${n}.jpg`;
    n++;
  }
  usedNames.add(candidate);
  return candidate;
}

// Large source photos can exceed the size a serverless function will accept
// as a request body, so shrink client-side first if needed - the server
// still does the real precise compression pass afterward.
async function preShrinkIfNeeded(blob) {
  if (blob.size <= UPLOAD_LIMIT_BYTES) return blob;

  const bitmap = await createImageBitmap(blob);
  let scale = Math.sqrt(UPLOAD_LIMIT_BYTES / blob.size) * 0.85;
  let width = Math.max(600, Math.round(bitmap.width * scale));
  let quality = 0.85;
  let out = blob;

  for (let i = 0; i < 6; i++) {
    const height = Math.max(1, Math.round(bitmap.height * (width / bitmap.width)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!out || out.size <= UPLOAD_LIMIT_BYTES) break;
    width = Math.round(width * 0.8);
    quality = Math.max(0.5, quality - 0.1);
  }
  return out;
}

async function extractImagesFromZip(file) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter(
    (f) => !f.dir && /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(f.name)
  );
  const results = [];
  for (const entry of entries) {
    const blob = await entry.async('blob');
    const name = entry.name.split('/').pop();
    results.push({ name, blob });
  }
  return results;
}

async function mapWithConcurrency(items, limit, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function UploadCard({ item }) {
  return (
    <article className="card">
      <div className="thumb">
        {item.status === 'error' && <div className="broken">{item.error || 'could not resize'}</div>}
        {item.status === 'ok' && (
          <img src={item.resultUrl} alt={`Resized ${item.filename}`} style={{ display: 'block' }} />
        )}
        {(item.status === 'pending' || item.status === 'uploading') && <div className="spinner" />}
      </div>
      <div className="meta">
        <div className="rownum">
          <span className="filename">save as {item.filename}</span>
        </div>
        <div className="sizes">
          <span className="size-orig">{humanSize(item.originalBytes)}</span>
          <span className="arrow">&rarr;</span>
          <span className="size-new">{item.status === 'ok' ? humanSize(item.resizedBytes) : '—'}</span>
        </div>
      </div>
    </article>
  );
}

export default function UploadPanel() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const handleFiles = useCallback(async (fileList) => {
    setError('');
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setBusy(true);
    try {
      // Expand any .zip files into their image entries; pass through plain images as-is.
      const usedNames = new Set();
      const staged = [];
      for (const file of files) {
        if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
          const extracted = await extractImagesFromZip(file);
          for (const e of extracted) {
            staged.push({ name: slugifyFilename(e.name, usedNames), blob: e.blob });
          }
        } else if (file.type.startsWith('image/')) {
          staged.push({ name: slugifyFilename(file.name, usedNames), blob: file });
        }
      }

      if (staged.length === 0) {
        setError('No images found in what you selected. Choose image files or a .zip containing images.');
        setBusy(false);
        return;
      }

      const initial = staged.map((s, idx) => ({
        id: idx,
        filename: s.name,
        blob: s.blob,
        originalBytes: s.blob.size,
        status: 'pending',
        resultUrl: null,
        resizedBytes: 0,
        error: null,
      }));
      setItems(initial);

      await mapWithConcurrency(initial, CONCURRENCY, async (item) => {
        setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'uploading' } : p)));
        try {
          const uploadBlob = await preShrinkIfNeeded(item.blob);
          const res = await fetch(`/api/resize-upload?filename=${encodeURIComponent(item.filename)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: uploadBlob,
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${res.status}`);
          }
          const resultBlob = await res.blob();
          const resultUrl = URL.createObjectURL(resultBlob);
          setItems((prev) =>
            prev.map((p) =>
              p.id === item.id
                ? { ...p, status: 'ok', resultUrl, resizedBytes: resultBlob.size }
                : p
            )
          );
        } catch (err) {
          setItems((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, status: 'error', error: err.message } : p))
          );
        }
      });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div>
      <div className="input-row">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.zip"
          onChange={(e) => handleFiles(e.target.files)}
          style={{ display: 'none' }}
        />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Working…' : 'Choose images or a .zip'}
        </button>
      </div>
      {error && <p className="error-box">{error}</p>}
      {items.length > 0 && (
        <div className="statbar">
          <span className="stat">Images <b>{items.length}</b></span>
        </div>
      )}
      {items.length > 0 && (
        <main style={{ padding: '24px 0 0', maxWidth: 'none' }}>
          <div className="grid">
            {items.map((item) => (
              <UploadCard key={item.id} item={item} />
            ))}
          </div>
        </main>
      )}
    </div>
  );
}
