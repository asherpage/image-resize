import sharp from 'sharp';

const TARGET_BYTES = 300 * 1024;
const MAX_BYTES = 340 * 1024;
const MIN_WIDTH = 500;

export async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' },
  });
  if (!res.ok) throw new Error(`Source image returned HTTP ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// Iteratively re-encodes as JPEG, stepping quality down and then dimensions
// down, until the buffer lands at or under MAX_BYTES (targeting TARGET_BYTES).
export async function resizeToTarget(inputBuffer) {
  const metadata = await sharp(inputBuffer, { failOn: 'none' }).rotate().metadata();
  let width = metadata.width || 1600;
  if (width > 2000) width = 2000;

  let quality = 85;
  let buffer;
  let lastGood = null;

  for (let i = 0; i < 40; i++) {
    buffer = await sharp(inputBuffer, { failOn: 'none' })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    if (buffer.length <= MAX_BYTES) {
      lastGood = buffer;
      if (buffer.length <= TARGET_BYTES || quality <= 40) break;
    }

    if (quality > 40) {
      quality -= 5;
    } else if (width > MIN_WIDTH) {
      width = Math.max(MIN_WIDTH, Math.round(width * 0.85));
      quality = 60;
    } else {
      break;
    }
  }

  return lastGood || buffer;
}
