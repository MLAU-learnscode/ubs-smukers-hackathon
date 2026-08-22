// Client for the "working life" city service — venues, friends' schedules,
// and friends' locations, all scoped by day. Same host family as the other
// stages' tool-box services; confirmed live via curl against /venues/{day},
// /schedule/{person}/{day} and /location/{person}/{day}.
const BASE_URL = process.env.CITY_SERVICE_BASE_URL || "https://tool-box-2591eaa24fa3.herokuapp.com";

const FETCH_TIMEOUT_MS = 8800;
const CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new Map(); // url -> { data, expiresAt }

function pruneExpired() {
  const now = Date.now();
  for (const [key, val] of cache) {
    if (val.expiresAt < now) cache.delete(key);
  }
}

async function getJson(path) {
  pruneExpired();
  const url = `${BASE_URL}${path}`;
  const cached = cache.get(url);
  if (cached) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${path} fetch failed: ${res.status}`);
    const data = await res.json();
    cache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function getVenues(day) {
  return getJson(`/venues/${encodeURIComponent(day)}`);
}

function getSchedule(person, day) {
  return getJson(`/schedule/${encodeURIComponent(person)}/${encodeURIComponent(day)}`);
}

function getLocation(person, day) {
  return getJson(`/location/${encodeURIComponent(person)}/${encodeURIComponent(day)}`);
}

module.exports = { getVenues, getSchedule, getLocation };
