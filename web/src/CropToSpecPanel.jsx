import React, { useState, useRef, useCallback } from 'react';
import {
  humanSize,
  slugifyFilename,
  uniqueFilename,
  preShrinkIfNeeded,
  stageFiles,
  mapWithConcurrency,
} from './lib/imageUtils.js';

const CONCURRENCY = 4;

// Keep in sync with api/_lib/cropToSpec.js's SPECS.
const VARIANTS = [
  { id: 'header', label: 'Header', width: 1920, height: 935, suffix: 'FPHeader' },
  { id: 'fundimpact', label: 'Fund / Impact', width: 1000, height: 535, suffix: 'FPFundImpact' },
  { id: 'quote', label: 'Quote', width: 400, height: 400, suffix: 'FPQuote' },
];

function CropCard({ item, variant }) {
  return (
    <article className="card">
      <div className="thumb">
        {item.status === 'error' && <div className="broken">{item.error || 'could not process'}</div>}
        {item.status === 'ok' && (
          <img src={item.resultUrl} alt={`${variant.label} crop of ${item.filename}`} style={{ display: 'block' }} />
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
          <span className="size-new">
            {item.status === 'ok' ? `${variant.width}×${variant.height}, ${humanSize(item.resizedBytes)}` : '—'}
          </span>
          {item.status === 'ok' && (
            <a className="download-btn" href={item.resultUrl} download={item.filename}>Download</a>
          )}
        </div>
      </div>
    </article>
  );
}

export default function CropToSpecPanel() {
  const [variantId, setVariantId] = useState('header');
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const variant = VARIANTS.find((v) => v.id === variantId);

  const handleFiles = useCallback(async (fileList, activeVariant) => {
    setError('');
    setBusy(true);
    try {
      const staged = await stageFiles(fileList);
      if (staged.length === 0) {
        setError('No images found in what you selected. Choose image files or a .zip containing images.');
        setBusy(false);
        return;
      }

      const usedNames = new Set();
      const initial = staged.map((s, idx) => ({
        id: idx,
        filename: uniqueFilename(`${slugifyFilename(s.name)}-${activeVariant.suffix}`, 'jpg', usedNames),
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
          const res = await fetch(
            `/api/crop-to-spec/${encodeURIComponent(item.filename)}?variant=${activeVariant.id}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: uploadBlob,
            }
          );
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
      <div className="variant-toggle">
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={v.id === variantId ? 'active' : ''}
            onClick={() => setVariantId(v.id)}
            disabled={busy}
          >
            {v.label}
            <span className="variant-dims">{v.width}&times;{v.height}</span>
          </button>
        ))}
      </div>

      <div className="input-row">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.zip"
          onChange={(e) => handleFiles(e.target.files, variant)}
          style={{ display: 'none' }}
        />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Working…' : `Choose images or a .zip for ${variant.label}`}
        </button>
      </div>
      {error && <p className="error-box">{error}</p>}
      {items.length > 0 && (
        <div className="statbar">
          <span className="stat">Images <b>{items.length}</b></span>
          <span className="stat">Target <b>{variant.width}&times;{variant.height}</b></span>
        </div>
      )}
      {items.length > 0 && (
        <main style={{ padding: '24px 0 0', maxWidth: 'none' }}>
          <div className="grid">
            {items.map((item) => (
              <CropCard key={item.id} item={item} variant={variant} />
            ))}
          </div>
        </main>
      )}
    </div>
  );
}
