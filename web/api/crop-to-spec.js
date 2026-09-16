import { cropToSpec, SPECS } from './_lib/cropToSpec.js';

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body.length) return Buffer.from(req.body, 'binary');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST required.' });
    return;
  }

  const variant = req.query.variant;
  const filename = typeof req.query.filename === 'string' ? req.query.filename : 'image.jpg';

  if (!SPECS[variant]) {
    res.status(400).json({ error: `Unknown variant "${variant}". Expected one of: ${Object.keys(SPECS).join(', ')}.` });
    return;
  }

  try {
    const buf = await readRawBody(req);
    if (!buf || buf.length === 0) {
      throw new Error('No file data received.');
    }
    const cropped = await cropToSpec(buf, variant);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    res.status(200).send(cropped);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not process that image.' });
  }
}
