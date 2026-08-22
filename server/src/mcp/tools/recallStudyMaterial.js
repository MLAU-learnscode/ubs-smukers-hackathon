const { z } = require("zod");
const { getEncoding } = require("js-tiktoken");

const TOKEN_BUDGET = 900;
const FETCH_TIMEOUT_MS = 6000; // leaves headroom under the 10s tool deadline
const MAX_MATERIALS = 12; // cap parallel fetches so we don't blow the deadline

const encoding = getEncoding("o200k_base");
const countTokens = (text) => encoding.encode(text).length;

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

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return "";
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await res.json();
      return typeof json === "string" ? json : JSON.stringify(json);
    }
    return await res.text();
  } catch {
    return "";
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

function scorePassage(passageWords, questionWordCounts) {
  let score = 0;
  for (const w of passageWords) {
    const qc = questionWordCounts.get(w);
    if (qc) score += qc;
  }
  // Numbers/dates are frequently the actual "fact" being tested, and rarely
  // appear in the question itself, so give passages containing them a boost.
  if (/\b\d/.test(passageWords.join(" "))) score += 0.5;
  return score;
}

function selectPassages(candidatePassages, question) {
  const qWords = tokenizeWords(question);
  const qCounts = new Map();
  for (const w of qWords) qCounts.set(w, (qCounts.get(w) || 0) + 1);

  const scored = candidatePassages
    .map((text) => {
      const words = tokenizeWords(text);
      return {
        text,
        tokens: countTokens(text),
        score: scorePassage(words, qCounts),
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

function register(server) {
  server.registerTool(
    "recall_study_material",
    {
      description:
        "Recalls passages from assigned study materials relevant to an exam question. " +
        "Pass the question and the list of study material documents you were given " +
        "(each with its title and fetch address). Returns up to ~900 tokens worth of " +
        "the most relevant excerpts as a list of strings — read them and answer the " +
        "question yourself; this tool does not answer for you.",
      inputSchema: {
        question: z.string().describe("The exam question to recall material for"),
        materials: z
          .array(
            z.object({
              title: z.string().optional(),
              url: z.string().describe("Address to fetch this document from"),
            })
          )
          .min(1)
          .describe("The list of study material documents assigned, with fetch addresses"),
      },
    },
    async ({ question, materials }) => {
      const toFetch = materials.slice(0, MAX_MATERIALS);
      const texts = await Promise.all(toFetch.map((m) => fetchText(m.url)));

      const candidatePassages = [];
      for (const text of texts) {
        if (!text) continue;
        candidatePassages.push(...splitIntoPassages(text));
      }

      if (candidatePassages.length === 0) {
        return {
          content: [{ type: "text", text: "No study material could be retrieved." }],
          isError: true,
        };
      }

      const selected = selectPassages(candidatePassages, question);

      return {
        content: selected.map((text) => ({ type: "text", text })),
      };
    }
  );
}

module.exports = { register, countTokens, selectPassages, splitIntoPassages };
