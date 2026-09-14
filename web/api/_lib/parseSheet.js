import { parse } from 'csv-parse/sync';

export function extractSheetIdAndGid(sheetUrl) {
  const idMatch = /\/d\/([a-zA-Z0-9_-]+)/.exec(sheetUrl);
  if (!idMatch) {
    throw new Error("That doesn't look like a Google Sheets link. Copy the full URL from your browser's address bar.");
  }
  const gidMatch = /gid=(\d+)/.exec(sheetUrl);
  return { sheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : '0' };
}

export async function fetchSheetCsv(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' },
  });
  if (!res.ok) {
    throw new Error("Could not download that sheet. Make sure it's shared as 'Anyone with the link can view'.");
  }
  return res.text();
}

function pageSlug(item, rowNum) {
  const pages = item.pages && item.pages.length ? item.pages : [];
  const title = pages[0]?.title || 'unknown-page';
  let slug = title
    .toLowerCase()
    .replace(/\s*\|\s*[^|]*$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!slug) slug = 'unknown-page';
  return `${slug}-row${String(rowNum).padStart(3, '0')}`;
}

// Parses the Siteimprove "oversized images" export structure: a header row
// (URL, Size, Pages, Referring PDFs, Match detected, Details) followed by one
// data row per image, each optionally followed by a sub-header + N page rows
// (Title, URL, Page Report, Page level) when that image has referring pages.
export function parseSheetCsv(csvText) {
  const records = parse(csvText, { relax_column_count: true });

  let siteName = null;
  let policyName = null;
  for (const r of records) {
    if (typeof r[0] === 'string' && r[0].startsWith('Site:')) siteName = r[0].slice(5).trim();
    if (typeof r[0] === 'string' && r[0].startsWith('Policy:')) policyName = r[0].slice(7).trim();
  }

  const headerIdx = records.findIndex(r => r[0] === 'URL' && r[1] === 'Size');
  if (headerIdx === -1) {
    throw new Error("This doesn't look like a Siteimprove oversized-images export (no URL/Size header row found).");
  }

  const items = [];
  let i = headerIdx + 1;
  let rowNum = 0;
  while (i < records.length) {
    const row = records[i];
    const url = (row[0] || '').trim();
    if (url.startsWith('http')) {
      rowNum++;
      const originalSize = (row[1] || '').trim();
      const pageCount = parseInt((row[2] || '0').trim(), 10) || 0;
      i++;
      const pages = [];
      if (pageCount > 0 && i < records.length) {
        i++; // skip "Title / URL / Page Report / Page level" sub-header row
        for (let p = 0; p < pageCount && i < records.length; p++, i++) {
          const sub = records[i];
          const title = (sub[6] || '').trim();
          const pageUrl = (sub[7] || '').trim();
          if (title || pageUrl) pages.push({ title, url: pageUrl });
        }
      }
      const item = { rowNum, imageUrl: url, originalSize, pages };
      item.filename = pageSlug(item, rowNum) + '.jpg';
      items.push(item);
    } else {
      i++;
    }
  }

  if (items.length === 0) {
    throw new Error('No image rows found in that sheet tab.');
  }

  return { items, siteName, policyName };
}
