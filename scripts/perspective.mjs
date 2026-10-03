import sharp from 'sharp';

const distance = ([ax, ay], [bx, by]) => Math.hypot(bx - ax, by - ay);

/**
 * Builds the projective mapping from the unit square onto a quadrilateral (Heckbert's
 * square-to-quad form), so every output pixel can be traced back to its photographed position.
 * @param {number[][]} corners Top-left, top-right, bottom-right, bottom-left source points.
 * @returns {(s:number,t:number)=>number[]} Maps unit-square coordinates to source coordinates.
 */
function unitSquareToQuad([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) {
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (determinant === 0) throw Error('Artwork corners are collinear');
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  return (s, t) => {
    const w = g * s + h * t + 1;
    return [(a * s + b * t + x0) / w, (d * s + e * t + y0) / w];
  };
}

const cross = ([a1, a2, a3], [b1, b2, b3]) => [a2 * b3 - a3 * b2, a3 * b1 - a1 * b3, a1 * b2 - a2 * b1];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Recovers the artwork's true width/height ratio from its photographed corners
 * (Zhang & He, "Whiteboard scanning and image enhancement", 2007), assuming square pixels
 * and a principal point at the photograph's centre. Edge lengths alone under-report the
 * foreshortened dimension, which visibly squashes steeply angled photographs.
 * @returns {number} Width divided by height of the physical artwork.
 */
export function trueAspectRatio(corners, sourceWidth, sourceHeight) {
  const [m1, m2, m4, m3] = corners.map(([x, y]) => [x - sourceWidth / 2, y - sourceHeight / 2, 1]);
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]);
  const n3 = m3.map((v, i) => k3 * v - m1[i]);
  const diagonal = Math.hypot(sourceWidth, sourceHeight);
  // The focal length is only observable when both edge pairs converge. When one pair is
  // (nearly) parallel, use the lens these phone photographs were taken with: a 26 mm
  // full-frame-equivalent main camera, i.e. focal = diagonal × 26 / 43.27.
  const phoneFocalSquared = (diagonal * 26 / 43.27) ** 2;
  const measuredFocalSquared = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  // Each edge pair's convergence: the reciprocal of its vanishing point's distance in diagonals.
  const convergence = n => Math.abs(n[2]) * diagonal / Math.hypot(n[0], n[1]);
  const measurable = Math.min(convergence(n2), convergence(n3)) > 0.1 && measuredFocalSquared > (diagonal * 0.4) ** 2 && measuredFocalSquared < (diagonal * 3) ** 2;
  const focalSquared = measurable ? measuredFocalSquared : phoneFocalSquared;
  return Math.sqrt((n2[0] ** 2 + n2[1] ** 2 + focalSquared * n2[2] ** 2) / (n3[0] ** 2 + n3[1] ** 2 + focalSquared * n3[2] ** 2));
}

/**
 * Straightens the artwork photographed inside `corners` into an upright rectangle with the
 * artwork's true proportions, sized by the longer photographed horizontal edge.
 * @param {string} sourcePath Original photograph; never modified.
 * @param {number[][]} corners Top-left, top-right, bottom-right, bottom-left, in source pixels.
 * @returns {Promise<import('sharp').Sharp>} Pipeline holding the rectified artwork.
 */
export async function rectifyArtwork(sourcePath, corners) {
  // Raw pixels carry no colour profile, so convert to sRGB first; derivatives are tagged as sRGB.
  const {data, info} = await sharp(sourcePath).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject: true});
  const {width: sourceWidth, height: sourceHeight, channels} = info;
  for (const [x, y] of corners) {
    if (!(x >= 0 && y >= 0 && x <= sourceWidth - 1 && y <= sourceHeight - 1)) throw Error(`Artwork corner outside photograph: ${sourcePath}`);
  }
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const width = Math.round(Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight)));
  const height = Math.round(width / trueAspectRatio(corners, sourceWidth, sourceHeight));
  const project = unitSquareToQuad(corners);
  const output = Buffer.alloc(width * height * channels);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const [x, y] = project((column + 0.5) / width, (row + 0.5) / height);
      const left = Math.min(Math.max(Math.floor(x - 0.5), 0), sourceWidth - 2);
      const top = Math.min(Math.max(Math.floor(y - 0.5), 0), sourceHeight - 2);
      const fx = Math.min(Math.max(x - 0.5 - left, 0), 1), fy = Math.min(Math.max(y - 0.5 - top, 0), 1);
      const target = (row * width + column) * channels;
      for (let channel = 0; channel < channels; channel++) {
        const at = (px, py) => data[(py * sourceWidth + px) * channels + channel];
        const upper = at(left, top) * (1 - fx) + at(left + 1, top) * fx;
        const lower = at(left, top + 1) * (1 - fx) + at(left + 1, top + 1) * fx;
        output[target + channel] = Math.round(upper * (1 - fy) + lower * fy);
      }
    }
  }
  return sharp(output, {raw: {width, height, channels}});
}
