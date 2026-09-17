import { downloadBuffer, resizeToTarget } from '../_lib/resize.js';

// Filename lives in the URL PATH (not a query param) so that right-click ->
// "Save Image As" on the <img> picks up the real name and .jpg extension
// from the URL itself, instead of guessing (which is where the random-looking
// saved filenames, and occasional .jfif extension, were coming from).
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
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(resized);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not fetch or resize that image.' });
  }
}
