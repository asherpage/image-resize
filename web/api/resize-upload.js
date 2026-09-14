import { resizeToTarget } from './_lib/resize.js';

// Vercel's Node runtime auto-parses req.body for a few known content types
// and otherwise leaves it as a Buffer or unset - handle either case, falling
// back to reading the raw request stream directly so this works regardless
// of how the body ended up parsed.
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

  const filename = typeof req.query.filename === 'string' ? req.query.filename : 'image.jpg';

  try {
    const buf = await readRawBody(req);
    if (!buf || buf.length === 0) {
      throw new Error('No file data received.');
    }
    const resized = await resizeToTarget(buf);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    res.status(200).send(resized);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not resize that image.' });
  }
}
