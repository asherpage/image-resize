import JSZip from 'jszip';

// Vercel serverless functions cap request bodies around 4.5MB.
export const UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

export function humanSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

// Strips the extension and any characters that aren't letters, numbers, or
// hyphens, guaranteeing a filename-safe slug with no spaces/special chars.
export function slugifyFilename(name) {
  const base = name.replace(/\.[^./]+$/, '');
  let slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'image';
}

export function uniqueFilename(candidateBase, ext, usedNames) {
  let candidate = `${candidateBase}.${ext}`;
  let n = 2;
  while (usedNames.has(candidate)) {
    candidate = `${candidateBase}-${n}.${ext}`;
    n++;
  }
  usedNames.add(candidate);
  return candidate;
}

// Large source photos can exceed the size a serverless function will accept
// as a request body, so shrink client-side first if needed - the server
// still does the real precise compression/crop pass afterward.
export async function preShrinkIfNeeded(blob) {
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

export async function extractImagesFromZip(file) {
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

// Expands any .zip files in a FileList into their image entries and passes
// through plain image files as-is, producing a flat { name, blob } list.
export async function stageFiles(fileList) {
  const files = Array.from(fileList);
  const staged = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
      const extracted = await extractImagesFromZip(file);
      staged.push(...extracted);
    } else if (file.type.startsWith('image/')) {
      staged.push({ name: file.name, blob: file });
    }
  }
  return staged;
}

export async function mapWithConcurrency(items, limit, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
