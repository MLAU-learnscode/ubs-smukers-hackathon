const { z } = require("zod");
const { PNG } = require("pngjs");

const COLOR_THRESHOLD = 40; // euclidean-ish distance to count as foreground
const MAX_SAMPLES_PER_AXIS = 200; // cap work on large images

function decodePng(base64) {
  const clean = base64.includes(",") ? base64.split(",").pop() : base64;
  const buf = Buffer.from(clean, "base64");
  return PNG.sync.read(buf);
}

function classify(png) {
  const { width, height, data } = png;
  const bg = { r: data[0], g: data[1], b: data[2] };

  const strideX = Math.max(1, Math.floor(width / MAX_SAMPLES_PER_AXIS));
  const strideY = Math.max(1, Math.floor(height / MAX_SAMPLES_PER_AXIS));

  let minX = width, maxX = -1, minY = height, maxY = -1;
  let fgCount = 0;
  let sampleCount = 0;

  for (let y = 0; y < height; y += strideY) {
    for (let x = 0; x < width; x += strideX) {
      const idx = (width * y + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
      sampleCount++;
      const isFg =
        a > 10 &&
        (Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b)) > COLOR_THRESHOLD;
      if (isFg) {
        fgCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (fgCount === 0) return "circle"; // fallback, shouldn't happen

  const bboxW = (maxX - minX) / strideX + 1;
  const bboxH = (maxY - minY) / strideY + 1;
  const bboxArea = bboxW * bboxH;
  const fillRatio = fgCount / bboxArea;

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
