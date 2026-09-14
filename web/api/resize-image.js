import { downloadBuffer, resizeToTarget } from './_lib/resize.js';

export default async function handler(req, res) {
  const imageUrl = req.query.url;
  const filename = typeof req.query.filename === 'string' ? req.query.filename : 'image.jpg';

  if (!imageUrl || typeof imageUrl !== 'string' || !/^https?:\/\//i.test(imageUrl)) {
    res.status(400).json({ error: 'Missing or invalid image url.' });
    return;
  }

  try {
    const original = await downloadBuffer(imageUrl);
    const resized = await resizeToTarget(original);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    // The output is a pure function of the source URL, so cache it hard at the edge.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(resized);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not fetch or resize that image.' });
  }
}
