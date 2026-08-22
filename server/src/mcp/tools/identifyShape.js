const { z } = require("zod");
const { PNG } = require("pngjs");

const COLOR_THRESHOLD = 40; // euclidean-ish distance to count as foreground
const MAX_SAMPLES_PER_AXIS = 200; // cap work on large images

function decodePng(base64) {
  const clean = base64.includes(",") ? base64.split(",").pop() : base64;
  const buf = Buffer.from(clean, "base64");
  return PNG.sync.read(buf);
}

// Isolated foreground samples (anti-aliasing artifacts, stray noise pixels)
// have no foreground neighbor in the sample grid, unlike samples that are
// part of an actual filled shape. Dropping them keeps a single stray pixel
// from blowing up the bounding box and skewing fillRatio.
function denoise(points) {
  const grid = new Set(points.map(([ix, iy]) => `${ix},${iy}`));
  return points.filter(([ix, iy]) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && grid.has(`${ix + dx},${iy + dy}`)) return true;
      }
    }
    return false;
  });
}

function classify(png) {
  const { width, height, data } = png;
  const bg = { r: data[0], g: data[1], b: data[2] };

  const strideX = Math.max(1, Math.floor(width / MAX_SAMPLES_PER_AXIS));
  const strideY = Math.max(1, Math.floor(height / MAX_SAMPLES_PER_AXIS));

  const fgPoints = [];
  let sampleCount = 0;

  for (let y = 0; y < height; y += strideY) {
    for (let x = 0; x < width; x += strideX) {
      const idx = (width * y + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
      sampleCount++;
      const isFg =
        a > 10 &&
        (Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b)) > COLOR_THRESHOLD;
      if (isFg) fgPoints.push([x / strideX, y / strideY]);
    }
  }

  if (fgPoints.length === 0) return "circle"; // fallback, shouldn't happen

  const denoised = denoise(fgPoints);
  const points = denoised.length > 0 ? denoised : fgPoints;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [ix, iy] of points) {
    if (ix < minX) minX = ix;
    if (ix > maxX) maxX = ix;
    if (iy < minY) minY = iy;
    if (iy > maxY) maxY = iy;
  }

  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const bboxArea = bboxW * bboxH;
  const fillRatio = points.length / bboxArea;

  if (fillRatio >= 0.9) return "rectangle";
  if (fillRatio >= 0.65) return "circle";
  return "triangle";
}

function register(server) {
  server.registerTool(
    "identify_shape",
    {
      description: "Classifies a base64 PNG as rectangle, triangle, or circle",
      inputSchema: {
        image: z.string().describe("base64-encoded PNG"),
      },
    },
    async ({ image }) => {
      try {
        const png = decodePng(image);
        const shape = classify(png);
        return { content: [{ type: "text", text: shape }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: "error: invalid image" }],
          isError: true,
        };
      }
    }
  );
}

module.exports = { register, classify, decodePng };
