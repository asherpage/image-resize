// Parses the Siteimprove-exported CSV into a list of image entries with
// their associated page(s), preserving the original row order.
const fs = require('fs');
const { parse } = require('csv-parse/sync');

function parseSheet(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const records = parse(raw, { relax_column_count: true });

  // Find the header row ("URL,Size,Pages,Referring PDFs,Match detected,Details")
  let headerIdx = records.findIndex(r => r[0] === 'URL' && r[1] === 'Size');
  if (headerIdx === -1) throw new Error('Could not find header row in CSV');

  const items = [];
  let i = headerIdx + 1;
  while (i < records.length) {
    const row = records[i];
    const url = (row[0] || '').trim();
    if (url.startsWith('http')) {
      const size = (row[1] || '').trim();
      const pageCount = parseInt((row[2] || '0').trim(), 10) || 0;
      const details = (row[5] || '').trim();
      i++;
      const pages = [];
      if (pageCount > 0 && i < records.length) {
        // Next row is the sub-header (Title,URL,Page Report,Page level) in cols G-J
        i++; // skip sub-header row
        for (let p = 0; p < pageCount && i < records.length; p++, i++) {
          const sub = records[i];
          const title = (sub[6] || '').trim();
          const pageUrl = (sub[7] || '').trim();
          if (title || pageUrl) pages.push({ title, url: pageUrl });
        }
      }
      items.push({ imageUrl: url, originalSize: size, details, pages });
    } else {
      i++;
    }
  }
  return items;
}

module.exports = { parseSheet };

if (require.main === module) {
  const items = parseSheet(process.argv[2] || 'sheet.csv');
  console.log(`Parsed ${items.length} image entries`);
  console.log(JSON.stringify(items.slice(0, 3), null, 2));
  console.log('...');
  console.log(JSON.stringify(items[items.length - 1], null, 2));
}
