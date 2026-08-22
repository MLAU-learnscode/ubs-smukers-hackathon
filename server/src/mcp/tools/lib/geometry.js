function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

// Grid point minimising the sum of Manhattan distances to every point in
// `points`. Manhattan distance separates cleanly into x and y: the total is
// minimised independently on each axis by any median of that axis's values.
// With an even count there's a whole range of tied medians — the lower one
// (sorted array index floor((n-1)/2)) is picked, which is always an integer
// already present in the input and so always a valid grid cell.
function medianPoint(points) {
  const xs = points.map((p) => p[0]).sort((a, b) => a - b);
  const ys = points.map((p) => p[1]).sort((a, b) => a - b);
  const mid = Math.floor((points.length - 1) / 2);
  return [xs[mid], ys[mid]];
}

function totalTravel(points, target) {
  return points.reduce((sum, p) => sum + manhattan(p, target), 0);
}

module.exports = { manhattan, medianPoint, totalTravel };
