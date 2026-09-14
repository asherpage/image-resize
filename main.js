// Image Resizer App
// ------------------
// 1. Downloads the Siteimprove "oversized images" report from a public Google Sheet.
// 2. Parses it into image entries, each with its source URL and the page(s) it appears on.
// 3. Downloads each source image and re-compresses it to land around a target file size.
// 4. Produces a new .xlsx workbook with the resized image embedded per row, the page
//    title/URL, and original vs new size — in the same order as the source sheet.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ExcelJS = require('exceljs');
const { parseSheet } = require('./parse-sheet');

const SHEET_ID = '18qq7Dnm4qkE9fr8YWZaMYFR8KpjYX2niIlJECoSJ_QY';
const GID = '638764626';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

const TARGET_BYTES = 300 * 1024; // ~300 KB goal
const MAX_BYTES = 340 * 1024; // stop once we're at or under this
const MIN_WIDTH = 500; // don't shrink below this width no matter what

const OUT_DIR = path.join(__dirname, 'out');
const IMG_DIR = path.join(OUT_DIR, 'images');
const CONCURRENCY = 5;

function fmtKB(bytes) {
  return `${Math.round(bytes / 1024)} KB`;
}

async function downloadBuffer(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// Iteratively re-encode as JPEG, stepping quality down and then dimensions down,
// until the buffer lands at or under MAX_BYTES (targeting ~TARGET_BYTES).
async function resizeToTarget(inputBuffer) {
  const base = sharp(inputBuffer, { failOn: 'none' }).rotate();
  const metadata = await base.metadata();
  let width = metadata.width || 1600;
  if (width > 2000) width = 2000; // most of these are web photos; cap huge originals

  let quality = 85;
  let buffer;
  let lastGood = null;

  for (let i = 0; i < 40; i++) {
    buffer = await sharp(inputBuffer, { failOn: 'none' })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .flatten({ background: '#ffffff' }) // drop alpha for max jpeg compression
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
      break; // hit the floor on both quality and width
    }
  }

  const finalBuffer = lastGood || buffer;
  const finalMeta = await sharp(finalBuffer).metadata();
  return { buffer: finalBuffer, width: finalMeta.width, height: finalMeta.height };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  fs.mkdirSync(IMG_DIR, { recursive: true });

  console.log('Downloading sheet CSV...');
  const csvRes = await fetch(CSV_URL);
  if (!csvRes.ok) throw new Error(`Failed to download sheet CSV: HTTP ${csvRes.status}`);
  const csvText = await csvRes.text();
  const csvPath = path.join(OUT_DIR, 'source-sheet.csv');
  fs.writeFileSync(csvPath, csvText);

  const items = parseSheet(csvPath);
  console.log(`Parsed ${items.length} image entries from the sheet.`);

  let done = 0;
  const results = await mapWithConcurrency(items, CONCURRENCY, async (item, idx) => {
    const rowNum = idx + 1;
    try {
      const original = await downloadBuffer(item.imageUrl);
      const resized = await resizeToTarget(original);
      const localName = `img-${String(rowNum).padStart(3, '0')}.jpg`;
      fs.writeFileSync(path.join(IMG_DIR, localName), resized.buffer);
      done++;
      console.log(
        `[${done}/${items.length}] OK  ${fmtKB(original.length)} -> ${fmtKB(resized.buffer.length)}  ${item.imageUrl.slice(0, 90)}`
      );
      return {
        ...item,
        status: 'ok',
        originalBytes: original.length,
        newBytes: resized.buffer.length,
        newWidth: resized.width,
        newHeight: resized.height,
        localImagePath: path.join(IMG_DIR, localName),
      };
    } catch (err) {
      done++;
      console.log(`[${done}/${items.length}] FAIL ${item.imageUrl.slice(0, 90)} -- ${err.message}`);
      return { ...item, status: 'error', error: err.message };
    }
  });

  console.log('Building output workbook...');
  await buildWorkbook(results, path.join(OUT_DIR, 'resized-images-report.xlsx'));

  const okCount = results.filter(r => r.status === 'ok').length;
  const failCount = results.length - okCount;
  console.log(`Done. ${okCount} resized, ${failCount} failed.`);
  console.log(`Output: ${path.join(OUT_DIR, 'resized-images-report.xlsx')}`);
}

async function buildWorkbook(results, outPath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Resized Images');

  ws.columns = [
    { header: 'Image', key: 'image', width: 30 },
    { header: 'Page Title', key: 'pageTitle', width: 35 },
    { header: 'Page URL', key: 'pageUrl', width: 45 },
    { header: 'Original Image URL', key: 'imageUrl', width: 55 },
    { header: 'Original Size', key: 'originalSize', width: 14 },
    { header: 'New Size', key: 'newSize', width: 14 },
    { header: 'New Dimensions', key: 'dims', width: 16 },
    { header: 'Status', key: 'status', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };

  const IMG_ROW_HEIGHT = 110; // points
  const IMG_DISPLAY_WIDTH = 160; // px in the sheet (file size is independent of this)
  const IMG_DISPLAY_HEIGHT = 110;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const excelRow = i + 2; // header is row 1

    const pages = r.pages && r.pages.length ? r.pages : [];
    const pageTitle = pages.map(p => p.title).filter(Boolean).join('; ');
    const pageUrl = pages.map(p => p.url).filter(Boolean).join('; ');

    ws.addRow({
      image: '',
      pageTitle,
      pageUrl,
      imageUrl: r.imageUrl,
      originalSize: r.originalSize || (r.originalBytes ? fmtKB(r.originalBytes) : ''),
      newSize: r.status === 'ok' ? fmtKB(r.newBytes) : '',
      dims: r.status === 'ok' ? `${r.newWidth}x${r.newHeight}` : '',
      status: r.status === 'ok' ? 'OK' : `FAILED: ${r.error || 'unknown'}`,
    });

    ws.getRow(excelRow).height = IMG_ROW_HEIGHT;

    if (r.status === 'ok') {
      const imgId = wb.addImage({
        filename: r.localImagePath,
        extension: 'jpeg',
      });
      ws.addImage(imgId, {
        tl: { col: 0.1, row: excelRow - 1 + 0.05 },
        ext: { width: IMG_DISPLAY_WIDTH, height: IMG_DISPLAY_HEIGHT },
        editAs: 'oneCell',
      });
    }
  }

  ws.getColumn('image').width = 24;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);
}

main().catch(err => {
  console.error('FATAL', err);
  process.exit(1);
});
