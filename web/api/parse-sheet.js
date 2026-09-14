import { extractSheetIdAndGid, fetchSheetCsv, parseSheetCsv } from './_lib/parseSheet.js';

export default async function handler(req, res) {
  const sheetUrl = req.query.sheetUrl;
  if (!sheetUrl || typeof sheetUrl !== 'string') {
    res.status(400).json({ error: 'Missing sheetUrl.' });
    return;
  }

  try {
    const { sheetId, gid } = extractSheetIdAndGid(sheetUrl);
    const csvText = await fetchSheetCsv(sheetId, gid);
    const { items, siteName, policyName } = parseSheetCsv(csvText);
    res.status(200).json({ items, siteName, policyName });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Something went wrong reading that sheet.' });
  }
}
