const { z } = require("zod");
const { getEncoding } = require("js-tiktoken");

const TOKEN_BUDGET = 900;

// The study-materials host (confirmed live via the qna) can take 20s+ to
// answer on a cold start — far past the 10s tool deadline. Fetching on
// demand inside the tool call is a losing game no matter how the timeout is
// tuned, so instead we warm a full in-memory copy of the corpus in the
// background starting the moment this module loads (i.e. at server boot,
// well before any real call arrives), and the tool call itself only ever
// reads that cache. A call only touches the network if it lands before the
// very first warmup completes.
const WARM_FETCH_TIMEOUT_MS = 25000;
const WARM_MAX_ATTEMPTS = 5;
const WARM_RETRY_DELAY_MS = 3000;
const REWARM_INTERVAL_MS = 30 * 60 * 1000; // refresh periodically in case content rotates
const CALL_WAIT_BUDGET_MS = 8500; // headroom under the 10s tool deadline
const MAX_MATERIALS = 12;

const MATERIALS_INDEX_URL =
  process.env.STUDY_MATERIALS_INDEX_URL ||
  "https://tool-box-2591eaa24fa3.herokuapp.com/study-materials";

const encoding = getEncoding("o200k_base");
const countTokens = (text) => encoding.encode(text).length;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "and", "or", "in", "on", "is", "was", "were",
  "are", "be", "been", "for", "with", "that", "this", "it", "its", "as",
  "at", "by", "from", "do", "does", "did", "when", "where", "what", "who",
  "how", "why", "which", "into", "last", "was", "has", "have", "had",
]);

function tokenizeWords(text) {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []).filter(
    (w) => !STOPWORDS.has(w) && w.length > 1
  );
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return res.json();
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Splits on blank lines / headings first, falling back to sentence groups so
// no single passage is absurdly long (keeps token accounting granular).
function splitIntoPassages(text) {
  const blocks = text
    .split(/\r?\n\s*\r?\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const passages = [];
  for (const block of blocks) {
    if (countTokens(block) <= 220) {
      passages.push(block);
      continue;
    }
    const sentences = block.match(/[^.!?\n]+[.!?]?/g) || [block];
    let buf = "";
    for (const s of sentences) {
      const candidate = buf ? `${buf} ${s.trim()}` : s.trim();
      if (countTokens(candidate) > 220 && buf) {
        passages.push(buf);
        buf = s.trim();
      } else {
        buf = candidate;
      }
    }
    if (buf) passages.push(buf);
  }
  return passages;
}

function scorePassage(passageWords, questionWordCounts, rawText) {
  let score = 0;
  for (const w of passageWords) {
    const qc = questionWordCounts.get(w);
    if (qc) score += qc;
  }
  // Numbers/dates are frequently the actual "fact" being tested, and rarely
  // appear in the question itself, so give passages containing them a boost.
  // Checked against the raw text, not passageWords — tokenizeWords drops
  // single-character tokens, which would silently swallow single-digit dates
  // like the "8" in "8 September" and lose the boost for exactly the kind of
  // passage this is meant to catch.
  if (/\b\d/.test(rawText)) score += 0.5;
  return score;
}

function selectPassages(candidatePassages, question, excludeWords = new Set()) {
  // Words already spent routing to this document (e.g. "engine" matching a
  // document titled "... Engine ...") are worthless for ranking passages
  // *within* that document — they recur in nearly every paragraph there,
  // so they'd outrank the actual (differently-worded) answer passage.
  const qWords = tokenizeWords(question).filter((w) => !excludeWords.has(w));
  const qCounts = new Map();
  for (const w of qWords) qCounts.set(w, (qCounts.get(w) || 0) + 1);

  const scored = candidatePassages
    .map((text) => {
      const words = tokenizeWords(text);
      return {
        text,
        tokens: countTokens(text),
        score: scorePassage(words, qCounts, text),
      };
    })
    .filter((p) => p.tokens > 0 && p.tokens <= TOKEN_BUDGET)
    .sort((a, b) => b.score - a.score);

  const selected = [];
  let used = 0;
  for (const p of scored) {
    if (p.score <= 0 && selected.length > 0) break; // stop once relevance runs dry
    if (used + p.tokens > TOKEN_BUDGET) continue;
    selected.push(p.text);
    used += p.tokens;
    if (used >= TOKEN_BUDGET) break;
  }

  // Nothing scored above zero (keyword mismatch) — fall back to the single
  // highest-token-density passage so the android still gets *something*.
  if (selected.length === 0 && scored.length > 0) {
    selected.push(scored[0].text);
  }

  return selected;
}

// --- background warm cache -------------------------------------------------

let documents = null; // [{id, title, url}, ...]
const docText = new Map(); // url -> text

async function fetchIndexWithRetry() {
  for (let attempt = 1; attempt <= WARM_MAX_ATTEMPTS; attempt++) {
    try {
      const json = await fetchWithTimeout(MATERIALS_INDEX_URL, WARM_FETCH_TIMEOUT_MS);
      if (Array.isArray(json.documents) && json.documents.length > 0) return json.documents;
    } catch {
      // fall through to retry
    }
    if (attempt < WARM_MAX_ATTEMPTS) await sleep(WARM_RETRY_DELAY_MS);
  }
  return [];
}

async function fetchDocWithRetry(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const text = await fetchWithTimeout(url, WARM_FETCH_TIMEOUT_MS);
      if (typeof text === "string" && text.length > 0) return text;
    } catch {
      // fall through to retry
    }
    if (attempt < attempts) await sleep(WARM_RETRY_DELAY_MS);
  }
  return "";
}

async function warmOnce() {
  const docs = await fetchIndexWithRetry();
  if (docs.length === 0) return false;

  const toFetch = docs.slice(0, MAX_MATERIALS);
  const results = await Promise.allSettled(toFetch.map((d) => fetchDocWithRetry(d.url)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) docText.set(toFetch[i].url, r.value);
  });

  documents = toFetch;
  return docText.size > 0;
}

let warmPromise = null;

function startWarming() {
  if (warmPromise) return warmPromise;
  warmPromise = warmOnce().catch(() => false);
  return warmPromise;
}

function scheduleRewarm() {
  setTimeout(() => {
    warmPromise = null;
    startWarming().finally(scheduleRewarm);
  }, REWARM_INTERVAL_MS).unref?.();
}

startWarming();
scheduleRewarm();

function register(server) {
  server.registerTool(
    "search",
    {
      description:
        "Searches the assigned study materials for passages relevant to an exam question " +
        "and returns up to ~900 tokens worth of the most relevant excerpts as a list of " +
        "strings — read them and answer the question yourself; this tool does not answer " +
        "for you.",
      inputSchema: {
        query: z.string().describe("The exam question, or search query, to recall material for"),
      },
    },
    async ({ query }) => {
      await Promise.race([startWarming(), sleep(CALL_WAIT_BUDGET_MS)]);

      if (!documents || docText.size === 0) {
        return {
          content: [
            { type: "text", text: "error: study materials are still loading, try again shortly" },
          ],
          isError: true,
        };
      }

      // Route to the document(s) whose TITLE shares words with the question
      // first. Passage-level keyword overlap is unreliable here — the docs
      // are deliberately paraphrased away from how the questions are worded
      // (e.g. a question about "the engine" is answered by a sentence about
      // "animation blending", sharing zero words) — but a question about a
      // document's subject almost always names something in that document's
      // (short, topically pure) title, even when the specific fact doesn't
      // share vocabulary with the passage that states it. Falls back to the
      // full corpus when no title matches at all.
      const qWords = tokenizeWords(query);
      const titleScores = documents.map((doc) => {
        const titleWords = new Set(tokenizeWords(doc.title || ""));
        return { doc, score: qWords.filter((w) => titleWords.has(w)).length };
      });
      const maxTitleScore = Math.max(0, ...titleScores.map((t) => t.score));
      const routedTitleScores =
        maxTitleScore > 0 ? titleScores.filter((t) => t.score === maxTitleScore) : titleScores;
      const routedDocs = routedTitleScores.map((t) => t.doc);
      const routingWords =
        maxTitleScore > 0
          ? new Set(
              routedTitleScores.flatMap((t) =>
                qWords.filter((w) => new Set(tokenizeWords(t.doc.title || "")).has(w))
              )
            )
          : new Set();

      const candidatePassages = [];
      for (const doc of routedDocs) {
        const text = docText.get(doc.url);
        if (text) candidatePassages.push(...splitIntoPassages(text));
      }

      if (candidatePassages.length === 0) {
        return {
          content: [{ type: "text", text: "No study material could be retrieved." }],
          isError: true,
        };
      }

      const selected = selectPassages(candidatePassages, query, routingWords);

      // The grader needs the raw result to parse as a JSON array of strings.
      // Multiple `content` text blocks get joined into one plain string
      // somewhere upstream of the grader with no separators (confirmed
      // against a real run record — a hard "Retrieval must return a JSON
      // array of strings" fault), so the array must travel as JSON text in
      // a single block instead. `structuredContent` can't carry it either —
      // the MCP wire schema requires it to be a JSON object, not a bare
      // array, and rejects the whole call outright if it isn't (also
      // confirmed live).
      return {
        content: [{ type: "text", text: JSON.stringify(selected) }],
      };
    }
  );
}

module.exports = { register, countTokens, selectPassages, splitIntoPassages };
