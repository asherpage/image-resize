import React, { useState } from 'react';

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
        <p className="eyebrow">{meta.siteName || 'Image Resizer'}</p>
        <h1>Resize oversized site images</h1>
        <p className="lede">
          Paste a Siteimprove "Images larger than 1&nbsp;MB" Google Sheet export link below.
          Every oversized image gets re-compressed to roughly <strong>300&nbsp;KB</strong> and
          shown below, each linked to the page it belongs to &mdash; right-click any photo and
          choose <strong>Save Image As&hellip;</strong> to download it.
        </p>
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
      </header>

      {state === 'ready' && (
        <main>
          <div className="grid">
            {items.map((item) => (
              <ImageCard key={item.rowNum} item={item} />
            ))}
          </div>
        </main>
      )}

      <footer>
        Works with any Siteimprove "Images larger than 1 MB" export. The sheet must be shared as "Anyone with the link can view".
      </footer>
    </div>
  );
}
