import sharp from 'sharp';

// Fixed output specs for the site's image slots. Any input aspect ratio is
// accepted - the source is center-cropped to fill the exact target
// dimensions (sharp's "cover" fit), never letterboxed or distorted.
export const SPECS = {
  header: { width: 1920, height: 935, label: 'Header', suffix: 'FPHeader' },
  fundimpact: { width: 1000, height: 535, label: 'Fund / Impact', suffix: 'FPFundImpact' },
  quote: { width: 400, height: 400, label: 'Quote', suffix: 'FPQuote' },
};

const MAX_BYTES = 500 * 1024;

export async function cropToSpec(inputBuffer, variant) {
  const spec = SPECS[variant];
  if (!spec) throw new Error(`Unknown variant "${variant}".`);

  let quality = 85;
  let buffer = await render(inputBuffer, spec, quality);

  // Fixed-dimension crops are usually small already; only step quality down
  // if this particular source still comes out larger than expected.
  while (buffer.length > MAX_BYTES && quality > 40) {
    quality -= 10;
    buffer = await render(inputBuffer, spec, quality);
  }

  return buffer;
}

async function render(inputBuffer, spec, quality) {
  return sharp(inputBuffer, { failOn: 'none' })
    .rotate()
    .resize(spec.width, spec.height, { fit: 'cover', position: 'centre' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}
