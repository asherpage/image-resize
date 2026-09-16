import React, { useState } from 'react';
import UploadPanel from './UploadPanel.jsx';
import CropToSpecPanel from './CropToSpecPanel.jsx';

function ImageCard({ item }) {
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const src = `/api/resize-image?url=${encodeURIComponent(item.imageUrl)}&filename=${encodeURIComponent(item.filename)}`;
  const sourceLabel = (() => {
    try {
      return decodeURIComponent(new URL(item.imageUrl).pathname.split('/').pop());
    } catch {
      return item.imageUrl;
    }
  })();

  return (
    <article className="card">
      <div className="thumb">
        {status === 'error' && <div className="broken">image unavailable</div>}
        <img
          src={src}
          alt={`Resized image for row ${item.rowNum}`}
          loading="lazy"
          style={{ display: status === 'error' ? 'none' : 'block' }}
          onLoad={() => setStatus('ok')}
          onError={() => setStatus('error')}
        />
        {status === 'loading' && <div className="spinner" />}
      </div>
      <div className="meta">
        <div className="rownum">
          #{item.rowNum} <span className="filename">save as {item.filename}</span>
        </div>
        <div className="sizes">
          <span className="size-orig">{item.originalSize || '—'}</span>
          <span className="arrow">&rarr;</span>
          <span className="size-new">~300 KB</span>
        </div>
        <div className="field">
          <span className="label">Page</span>
          <div className="value">
            {item.pages.length ? (
              item.pages.map((p, idx) => (
                <React.Fragment key={idx}>
                  <a href={p.url} target="_blank" rel="noopener noreferrer">{p.title || p.url}</a>
                  {idx < item.pages.length - 1 && <br />}
                </React.Fragment>
              ))
            ) : (
              <span className="muted">No page match recorded</span>
            )}
          </div>
        </div>
        <div className="field">
          <span className="label">Source image</span>
          <div className="value">
            <a href={item.imageUrl} target="_blank" rel="noopener noreferrer" className="srclink">{sourceLabel}</a>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function App() {
  const [mode, setMode] = useState('sheet'); // sheet | upload | crop
  const [sheetUrl, setSheetUrl] = useState('');
  const [state, setState] = useState('idle'); // idle | loading | ready | error
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({});
  const [error, setError] = useState('');

  async function handleGenerate(e) {
    e.preventDefault();
    if (!sheetUrl.trim()) return;
    setState('loading');
    setError('');
    setItems([]);
    try {
      const res = await fetch(`/api/parse-sheet?sheetUrl=${encodeURIComponent(sheetUrl.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setItems(data.items);
      setMeta({ siteName: data.siteName, policyName: data.policyName });
      setState('ready');
    } catch (err) {
      setError(err.message);
      setState('error');
    }
  }

  return (
    <div className="page">
      <header>
        <p className="eyebrow">{mode === 'sheet' ? (meta.siteName || 'Image Resizer') : 'Image Resizer'}</p>
        <h1>Resize oversized images</h1>
        <p className="lede">
          {mode === 'sheet' && (
            <>
              Paste a Siteimprove "Images larger than 1&nbsp;MB" Google Sheet export link below.
              Every oversized image gets re-compressed to roughly <strong>300&nbsp;KB</strong> and
              shown below, each linked to the page it belongs to.
              {' '}Right-click any photo and choose <strong>Save Image As&hellip;</strong> to download it.
            </>
          )}
          {mode === 'upload' && (
            <>
              Pick individual image files or a .zip of images. Each one gets re-compressed to
              roughly <strong>300&nbsp;KB</strong> — there's no page/site info for these since
              they didn't come from a sheet.
              {' '}Right-click any photo and choose <strong>Save Image As&hellip;</strong> to download it.
            </>
          )}
          {mode === 'crop' && (
            <>
              Pick a target below, then choose images (or a .zip). Every image gets
              center-cropped to <strong>exactly</strong> that pixel size, whatever its original
              aspect ratio &mdash; a square photo picked for Header still comes out a proper
              1920&times;935 header. Filenames are cleaned up to letters, numbers, and
              hyphens only, with the target type appended.
              {' '}Right-click any photo and choose <strong>Save Image As&hellip;</strong> to download it.
            </>
          )}
        </p>

        <div className="mode-toggle">
          <button
            type="button"
            className={mode === 'sheet' ? 'active' : ''}
            onClick={() => setMode('sheet')}
          >
            From Google Sheet
          </button>
          <button
            type="button"
            className={mode === 'upload' ? 'active' : ''}
            onClick={() => setMode('upload')}
          >
            Upload Images
          </button>
          <button
            type="button"
            className={mode === 'crop' ? 'active' : ''}
            onClick={() => setMode('crop')}
          >
            Crop to Spec
          </button>
        </div>

        {mode === 'sheet' && (
          <>
            <form className="input-row" onSubmit={handleGenerate}>
              <input
                type="text"
                placeholder="Paste your Google Sheet link here"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
              />
              <button type="submit" disabled={state === 'loading'}>
                {state === 'loading' ? 'Loading…' : 'Generate'}
              </button>
            </form>
            {state === 'error' && <p className="error-box">{error}</p>}
            {state === 'ready' && (
              <div className="statbar">
                <span className="stat">Images <b>{items.length}</b></span>
              </div>
            )}
          </>
        )}
      </header>

      {mode === 'sheet' && state === 'ready' && (
        <main>
          <div className="grid">
            {items.map((item) => (
              <ImageCard key={item.rowNum} item={item} />
            ))}
          </div>
        </main>
      )}

      {mode === 'upload' && (
        <main>
          <UploadPanel />
        </main>
      )}

      {mode === 'crop' && (
        <main>
          <CropToSpecPanel />
        </main>
      )}

      <footer>
        {mode === 'sheet' &&
          'Works with any Siteimprove "Images larger than 1 MB" export. The sheet must be shared as "Anyone with the link can view".'}
        {mode !== 'sheet' && 'Uploaded images are processed and discarded — nothing is stored.'}
      </footer>
    </div>
  );
}
