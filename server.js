import "dotenv/config";
import express from "express";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { YoutubeTranscript } from "youtube-transcript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTES_DIR = path.join(__dirname, "notes");
fs.mkdir(NOTES_DIR, { recursive: true }).catch(() => {});

// Short-lived in-memory cache of fetched + extracted pages. Lets the
// "discover then pick" flow avoid re-fetching the same URLs when the user
// confirms their selection in the picker modal.
const PAGE_CACHE = new Map(); // url → { title, text, expiresAt }
const PAGE_CACHE_TTL_MS = 10 * 60 * 1000;
function cacheGet(url) {
  const e = PAGE_CACHE.get(url);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    PAGE_CACHE.delete(url);
    return null;
  }
  return { title: e.title, text: e.text };
}
function cacheSet(url, title, text) {
  PAGE_CACHE.set(url, {
    title,
    text,
    expiresAt: Date.now() + PAGE_CACHE_TTL_MS,
  });
  // bound size
  if (PAGE_CACHE.size > 200) {
    const oldest = PAGE_CACHE.keys().next().value;
    PAGE_CACHE.delete(oldest);
  }
}

const app = express();
// 16 MB JSON ceiling — fits a base64-encoded handwriting photo for the
// HandFonted image path. Per-request allocations stay request-scoped.
app.use(express.json({ limit: "16mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------- LLM provider switch ----------------
// Two providers can be configured independently in .env:
//   • "openai" — needs OPENAI_API_KEY (or one pasted in the form per-request)
//   • "local"  — needs LLM_BASE_URL pointing at an OpenAI-compatible
//                server like Ollama (http://localhost:11434/v1)
//
// Each request can override which one to use via `provider: "openai" | "local"`
// in the JSON body. If unspecified, we default to local when configured,
// otherwise OpenAI. /api/config reports availability so the frontend can
// render a runtime toggle.
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "").trim();
const LLM_MODEL = (process.env.LLM_MODEL || "").trim() || "qwen2.5:3b";
const LLM_API_KEY = (process.env.LLM_API_KEY || "").trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "").trim() || "gpt-4o-mini";
const HAS_LOCAL = !!LLM_BASE_URL;
// OpenAI is "available" if either the server has a key in .env or the user
// can paste one per-request. We treat it as always offerable since the
// pasted-key UX exists; the actual makeChatClient call validates.
const HAS_OPENAI = true;
const DEFAULT_PROVIDER = HAS_LOCAL ? "local" : "openai";

function makeChatClient(userKey, requestedProvider) {
  const provider =
    requestedProvider === "openai" || requestedProvider === "local"
      ? requestedProvider
      : DEFAULT_PROVIDER;

  if (provider === "local") {
    if (!HAS_LOCAL) {
      const err = new Error(
        "Local LLM not configured. Set LLM_BASE_URL in .env (e.g. " +
        "http://localhost:11434/v1) to use the local provider."
      );
      err.status = 400;
      throw err;
    }
    return {
      openai: new OpenAI({
        apiKey: LLM_API_KEY || "ollama",
        baseURL: LLM_BASE_URL,
      }),
      model: LLM_MODEL,
      provider: "local",
    };
  }

  // OpenAI
  const key =
    (typeof userKey === "string" && userKey.trim()) ||
    process.env.OPENAI_API_KEY ||
    "";
  if (!key) {
    const err = new Error(
      "OpenAI API key required. Paste one in the form, set OPENAI_API_KEY " +
      "in .env, or switch to the local provider."
    );
    err.status = 400;
    throw err;
  }
  return {
    openai: new OpenAI({ apiKey: key }),
    model: OPENAI_MODEL,
    provider: "openai",
  };
}

console.log(
  `🧠 LLM providers: ${HAS_LOCAL ? `local (${LLM_MODEL} via ${LLM_BASE_URL})` : "—"}` +
    ` · openai (${OPENAI_MODEL}) · default=${DEFAULT_PROVIDER}`
);

const NOTES_SCHEMA_INSTRUCTION = `
You are a teacher who explains technical documentation to a CURIOUS BEGINNER WITH ZERO PROGRAMMING BACKGROUND. Imagine you're explaining what the docs are about to a friend who has never seen code, never heard the jargon, but is smart and willing to learn.

Return STRICT JSON matching this shape:
{
  "title": string,                       // short, plain-English title (<= 8 words). No jargon.
  "subtitle": string,                    // one-line "what is this and why should you care?"
  "sections": [
    {
      "heading": string,                 // section heading in plain English
      "bullets": [string],               // 5-14 bullets, each <= 32 words. Plain language, EVERY tech term explained inline.
      "codeSnippets": [                  // optional — only when an example helps a beginner
        { "lang": string, "code": string, "caption": string }
      ],
      "callout": string | null,          // "Real-world analogy" or "What this means" — use freely
      "doodle": "lightbulb" | "star" | "warning" | "arrow" | "heart" | "checkmark" | "question" | null
    }
  ],
  "keyTerms": [ { "term": string, "meaning": string } ],   // 5-20 jargon words explained for a beginner
  "realExample": {                       // ONE real-world production usage — see RULES below
    "usedBy": string,                    // a real product/company/project that uses this in production (e.g. "WhatsApp Web", "Stripe Dashboard", "GitHub", "Discord")
    "scenario": string,                  // 1-2 sentences: what they actually use it for, in plain English
    "code": string | null,               // optional — a short, production-style snippet showing the pattern (NOT a toy "hello world")
    "lang": string | null,               // highlight.js language id matching the code field, or null if no code
    "caption": string | null             // one beginner-friendly line explaining what the snippet does, or null
  },
  "flow": {                              // hierarchy/flow diagram of the page — see FLOW RULES below
    "title": string | null,              // short header (e.g. "How it all fits together"), or null for a default
    "root": <Node>                       // tree of nodes
  },
  "summary": string                      // 2-3 sentences: "what you now understand" in everyday English
}

Where <Node> = {
  "label": string,                       // short — concept name OR exact API token (e.g. "Server", "socket.emit()", "connect_error", "transports")
  "kind": "concept" | "method" | "event" | "option" | "step",
  "note": string | null,                 // one short plain-English line (<= 10 words), or null when label alone is clear
  "children": [<Node>]                   // direct children (empty array for leaves)
}

THE BEGINNER RULES (most important):
- Start every section with a plain-English **analogy** to something the reader already knows from daily life — TVs, recipes, libraries, post offices, plumbing, restaurants.
- Whenever you use a technical word for the first time, explain it in parentheses immediately:
  example: "**state** (the data your app remembers, like a notes app remembering your last typed letter)"
- NO assumed knowledge. If you'd have to know X to follow Y, explain X first.
- Convert API names, flag names, and config keys into "what they actually do" — not just what they're called.
- Use everyday verbs: "remembers", "checks", "sends", "listens for", "kicks off".
- Avoid stacked jargon ("the middleware injects the dependency"). Rewrite in plain English ("a helper function adds extra steps before your main code runs").

COVERAGE RULES (read carefully — this is the most common failure mode):
- DO NOT SUMMARISE. Your job is to translate, not condense. The source is structured as markdown with \`#\`, \`##\`, \`###\` headings, fenced code blocks, and bulleted lists — preserve everything that's there.
- One section per H2/H3 in the source, IN THE SAME ORDER. If the source has 14 headings, the output has 14 sections. Never merge two headings into one section. Never silently drop a section because it "feels minor".
- For each section, cover every concrete fact in the source: every API name, function signature, parameter, option, default value, return value, error type, gotcha, deprecation note, version difference, and example. If the source mentions five options, your bullets must mention all five (each with its purpose, default, and accepted values).
- Prefer adding more bullets over dropping detail. 14 short bullets > 5 long ones that miss things.
- Every code example in the source MUST appear as a codeSnippet. Don't summarise code into prose. If the source shows the same idea in JS and Python, include both.
- It is far better to be exhaustive and a bit long than tidy and incomplete. There is no length limit on the output.

CODE RULES:
- Inline code (function names, flags, options) goes in single backticks, e.g. \`useState\`, \`--verbose\`.
- Multi-line examples go in "codeSnippets", NEVER inside a bullet's text.
- For each snippet: set "lang" to a highlight.js id ("javascript", "typescript", "python", "tsx", "jsx", "html", "css", "json", "bash", "sql", "go", "rust", etc.). Use "plaintext" only as a last resort.
- Aim for 3-15 lines per snippet, focused on ONE concept (longer is fine if the source example is longer — don't truncate working code).
- Every snippet MUST have a "caption" — a plain-English line explaining what the code is actually doing. This is the most important field for beginners. Example caption: "creates a memory slot for the counter, starting at zero".
- Only include codeSnippets when the source page actually shows code AND seeing it helps a beginner. Skip for purely conceptual sections.
- CRITICAL — preserve LINE BREAKS in "code". Each statement / closing brace / new logical line MUST be on its own line, encoded as a real \\n in the JSON string. NEVER collapse a multi-line snippet onto one line. NEVER replace newlines with semicolons or spaces. Indent with two spaces. If you would write the code as 8 lines in a file, the JSON value MUST contain 7 \\n characters. Example of a CORRECT JSON code value: "const x = 1\\nconst y = 2\\nconsole.log(x + y)" — note the \\n between every statement.

Style rules:
- Wrap **key tech terms** with double asterisks so they highlight (only the term itself, not the explanation).
- Friendly, conversational tone — "Think of it like…", "Basically…", "Here's the thing…".
- Output ONLY the JSON object. No markdown fences, no commentary.

REAL-WORLD EXAMPLE RULES (very important — beginners learn from "where is this actually used?"):
- ALWAYS fill in "realExample". This is the part that turns abstract concepts into "ohhhh, that's where it's used".
- "usedBy" must be a recognizable, real product, company, or open-source project that genuinely uses this technology in production. Prefer well-known names (WhatsApp, Slack, Discord, GitHub, Stripe, Uber, Netflix, Airbnb, Notion, Figma, Linear, Vercel, Shopify, Spotify, etc.) and only mention ones you are confident actually use the tech. Do NOT invent companies. If you genuinely cannot pin it to one company, name a category instead ("multiplayer browser games", "live sports score tickers", "collaborative whiteboard apps").
- "scenario" describes the SPECIFIC real use — not "for chat apps" but "to push new messages into your open tab the moment they're sent, so you don't have to refresh".
- "code" should look like a stripped-down piece of real production code: realistic variable names, the actual pattern engineers use (rooms, channels, auth checks, broadcasting to a user-id, etc.) — NOT a "hello world" demo. Keep it 4-12 lines. Include both sides (server + client) when that's what makes the example click. Skip "code" only if a code snippet wouldn't help (purely conceptual topic).
- "caption" explains in one beginner sentence what the production snippet does (e.g. "when a customer sends a chat message, the server pushes it to every browser tab joined to that conversation").
- This example must be DIFFERENT from the in-section codeSnippets — those teach the API, this one shows the API doing real work in a real app.

FLOW RULES (very important — beginners need to SEE how the parts connect):
- ALWAYS fill in "flow". This is the page's "skeleton at a glance" — a tree that shows hierarchy and relationships.
- Build it so a beginner can mentally place every notable method/event/option from the page in its slot. Top of tree = the main concept; branches = sub-areas (server / client / lifecycle / etc.); leaves = concrete API tokens.
- Aim for 8-18 nodes total. Be GENEROUS with leaves (methods, events, options) — include the page's actual API names, not just abstract concepts. Be SELECTIVE with concepts (only the major buckets).
- For "kind", pick the closest match:
  - "concept" → a topic/area ("Server setup", "Rooms", "Connection lifecycle")
  - "method"  → a function or API call ("socket.emit()", "io.to(room)", "useState")
  - "event"   → an event name the API fires ("connect", "disconnect", "connect_error")
  - "option"  → a config flag/option ("transports", "maxDisconnectionDuration")
  - "step"    → a sequential phase in a flow ("connect → upgrade → recover")
- Use the EXACT API token in "label" for method/event/option leaves (e.g. \`socket.emit\`, not "the emit method"). The renderer styles them as code pills.
- Keep "note" optional. Add it (max ~10 words) ONLY when the label alone wouldn't be clear (e.g. label "ack" → note "reply confirming receipt"). Skip it for self-explanatory tokens.
- Tree depth: 2-4 levels usually. Don't force depth where the page's structure is flat.
- The diagram and the prose summary complement each other: the flow shows STRUCTURE, the summary tells the STORY.

VISUAL VARIETY (also important — these drive the doodled-notes look):
- Almost every section should have a "doodle" picked from the allowed set. Match the doodle to the vibe (lightbulb for a key insight, warning for a gotcha, checkmark for a do-this, heart for a "favorite", arrow for a transition, star for important, question for a common confusion). Pick null only if truly nothing fits.
- Use "callout" liberally — it shows up as a colored sketchy box on the page. Use it for the section's main analogy, a real-world comparison, a pro tip, or a "watch out" warning. Aim to include a callout on at least half of the sections.
- "keyTerms" should always have at least 4-6 entries — these are the jargon glossary the reader will skim later.
- "summary" must be present (2-3 sentences in plain English).

THE GRANDMA TEST:
Before finalizing, mentally read it as someone who has never coded. If a sentence still sounds like a textbook, rewrite it.
`.trim();

const FETCH_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (compatible; BoringDocsToNotes/0.2; +https://example.local)",
  accept: "text/html,application/xhtml+xml",
};

async function fetchHtml(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok)
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    return await res.text();
  } catch (err) {
    if (err?.name === "AbortError")
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Tags whose content we never want to send to the model.
const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  "iframe",
  "svg",
  "canvas",
  "button",
  "template",
]);

// Walk the DOM and produce a markdown-ish string that PRESERVES structure
// (headings, lists, code blocks, emphasis, tables). The original extractor
// called .text() which flattened everything into one big paragraph, so the
// model couldn't tell where a section started or ended and ended up
// summarising aggressively.
function htmlToMarkdown($, rootNode) {
  const out = [];

  function inlineText(node) {
    if (!node) return "";
    if (node.type === "text") return (node.data || "").replace(/\s+/g, " ");
    if (node.type !== "tag") return "";
    if (SKIP_TAGS.has((node.name || "").toLowerCase())) return "";
    const name = (node.name || "").toLowerCase();
    const inner = (node.children || []).map(inlineText).join("");
    if (name === "code") return "`" + inner.replace(/`/g, "\\`") + "`";
    if (name === "strong" || name === "b") return "**" + inner.trim() + "**";
    if (name === "em" || name === "i") return "*" + inner.trim() + "*";
    if (name === "br") return " ";
    return inner;
  }

  function block(node, listDepth) {
    if (!node) return;
    if (node.type === "text") {
      const s = (node.data || "").replace(/\s+/g, " ");
      if (s.trim()) out.push(s);
      return;
    }
    if (node.type !== "tag") return;
    const name = (node.name || "").toLowerCase();
    if (SKIP_TAGS.has(name)) return;
    const $el = $(node);

    switch (name) {
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
        const level = Number(name[1]);
        const txt = $el.text().replace(/\s+/g, " ").trim();
        if (txt) out.push("\n\n", "#".repeat(level), " ", txt, "\n\n");
        return;
      }
      case "p": {
        out.push("\n");
        for (const c of node.children || []) {
          if (c.type === "tag" && (c.name === "ul" || c.name === "ol" || c.name === "pre")) {
            block(c, listDepth);
          } else {
            out.push(inlineText(c));
          }
        }
        out.push("\n\n");
        return;
      }
      case "br": out.push("\n"); return;
      case "hr": out.push("\n---\n\n"); return;
      case "pre": {
        // Pull language from class on <pre> or its child <code>
        const codeChild = $el.find("code").first();
        const cls = (codeChild.attr("class") || $el.attr("class") || "").toLowerCase();
        let lang = "";
        const m =
          cls.match(/language-([a-z0-9+#.-]+)/) ||
          cls.match(/lang-([a-z0-9+#.-]+)/) ||
          cls.match(/(?:^|\s)([a-z0-9+#.-]+)(?:$|\s)/);
        if (m) lang = m[1];
        // some sites use 'highlight-source-X'
        if (!lang) {
          const m2 = cls.match(/highlight-source-([a-z0-9+#.-]+)/);
          if (m2) lang = m2[1];
        }
        const code = (codeChild.length ? codeChild.text() : $el.text()).replace(
          /^\s+|\s+$/g,
          ""
        );
        if (!code) return;
        out.push("\n\n```", lang || "", "\n", code, "\n```\n\n");
        return;
      }
      case "ul": case "ol": {
        out.push("\n");
        const ordered = name === "ol";
        let n = 1;
        for (const c of node.children || []) {
          if (c.type !== "tag" || c.name !== "li") continue;
          const indent = "  ".repeat(Math.max(0, listDepth));
          const bullet = ordered ? `${n++}. ` : "- ";
          out.push(indent, bullet);
          // Render li contents inline, but recurse for nested lists / code
          for (const cc of c.children || []) {
            if (cc.type === "tag" && (cc.name === "ul" || cc.name === "ol")) {
              out.push("\n");
              block(cc, listDepth + 1);
            } else if (cc.type === "tag" && cc.name === "pre") {
              out.push("\n");
              block(cc, listDepth + 1);
            } else if (cc.type === "tag" && /^h[1-6]$/.test(cc.name || "")) {
              block(cc, listDepth);
            } else {
              out.push(inlineText(cc));
            }
          }
          out.push("\n");
        }
        out.push("\n");
        return;
      }
      case "blockquote": {
        const inner = $el.text().replace(/\s+/g, " ").trim();
        if (inner) out.push("\n> ", inner, "\n\n");
        return;
      }
      case "table": {
        const rows = [];
        $el.find("tr").each((_, tr) => {
          const cells = $(tr)
            .find("th,td")
            .map((_, td) => $(td).text().replace(/\s+/g, " ").trim())
            .get();
          if (cells.length) rows.push("| " + cells.join(" | ") + " |");
        });
        if (rows.length) out.push("\n", rows.join("\n"), "\n\n");
        return;
      }
      case "dl": {
        out.push("\n");
        const kids = node.children || [];
        for (const c of kids) {
          if (c.type !== "tag") continue;
          if (c.name === "dt") out.push("\n**", $(c).text().trim(), "** — ");
          else if (c.name === "dd") out.push($(c).text().replace(/\s+/g, " ").trim(), "\n");
        }
        out.push("\n");
        return;
      }
      // Inline-ish elements that may appear at top level — emit inline text
      case "span": case "a": case "strong": case "em": case "b": case "i":
      case "code": case "small": case "kbd": case "abbr": case "mark":
      case "sup": case "sub": case "u": case "s": case "del": case "ins":
        out.push(inlineText(node));
        return;
      // Wrappers — recurse into children
      default: {
        for (const c of node.children || []) block(c, listDepth);
      }
    }
  }

  block(rootNode, 0);
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractMainText(html) {
  const $ = cheerio.load(html);

  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    "Untitled";

  $(
    "script, style, noscript, nav, footer, header, aside, form, iframe, svg, canvas, .toc, .table-of-contents, .sidebar, [role='navigation'], [role='banner'], [role='contentinfo']"
  ).remove();

  const candidates = [
    "main article",
    "main",
    "article",
    '[role="main"]',
    ".markdown",
    ".markdown-body",
    ".prose",
    ".content",
    "#content",
    ".docs-content",
    ".documentation",
    ".theme-doc-markdown",
    ".doc-content",
    "#main-content",
  ];
  let rootEl = null;
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 200) {
      rootEl = el;
      break;
    }
  }
  if (!rootEl) rootEl = $("body");

  const rootNode = rootEl.get(0);
  const md = htmlToMarkdown($, rootNode);

  // 90k chars ≈ ~22k tokens — plenty of room within gpt-4o-mini's 128k context
  const MAX = 90000;
  return {
    title,
    text: md.length > MAX ? md.slice(0, MAX) + "\n…[truncated]" : md,
  };
}

// extract internal links from a page that share the docs prefix
function discoverLinks(html, baseUrl, root) {
  return discoverLinkPairs(html, baseUrl, root).map((p) => p.url);
}

// extract {url, text} pairs for grounded topic resolution
function discoverLinkPairs(html, baseUrl, root) {
  const $ = cheerio.load(html);
  const map = new Map();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    let u;
    try {
      u = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (u.origin !== root.origin) return;
    if (!u.pathname.startsWith(root.pathname)) return;
    if (!/^https?:$/.test(u.protocol)) return;
    if (/\.(png|jpe?g|gif|svg|pdf|zip|gz|tar|mp4|webp|ico|css|js)$/i.test(u.pathname))
      return;
    u.hash = "";
    const key = u.toString();
    const text = $(a).text().trim().replace(/\s+/g, " ").slice(0, 100);
    if (!map.has(key)) map.set(key, new Set());
    if (text) map.get(key).add(text);
  });
  return [...map.entries()].map(([url, texts]) => ({
    url,
    text: [...texts].join(" / ").slice(0, 120),
  }));
}

const RESOLVE_ROOT_INSTRUCTION = `
You return ONLY a JSON object: {"rootUrl": string, "alternates": [string]}

Given a learning topic, output the URL of the official-docs page that LISTS / INDEXES the most relevant subpages for that topic. We will then fetch that page and pick subpages from its real link list — so this URL must:
- DEFINITELY exist on the official docs site
- Be a hub or index page that links to the relevant subpages (not a leaf article)
- Be server-rendered HTML

Examples (these URLs are known to exist):
- "React hooks" → {"rootUrl": "https://react.dev/reference/react", "alternates": ["https://react.dev/learn"]}
- "React" → {"rootUrl": "https://react.dev/learn", "alternates": ["https://react.dev/reference/react"]}
- "Express routing" → {"rootUrl": "https://expressjs.com/en/guide/routing.html", "alternates": ["https://expressjs.com/en/4x/api.html"]}
- "Express" → {"rootUrl": "https://expressjs.com/en/guide/routing.html", "alternates": ["https://expressjs.com/en/starter/installing.html"]}
- "Socket.IO" → {"rootUrl": "https://socket.io/docs/v4/", "alternates": []}
- "MongoDB aggregation" → {"rootUrl": "https://www.mongodb.com/docs/manual/aggregation/", "alternates": ["https://www.mongodb.com/docs/manual/"]}
- "Node.js" → {"rootUrl": "https://nodejs.org/api/", "alternates": ["https://nodejs.org/en/learn"]}
- "Vue composition API" → {"rootUrl": "https://vuejs.org/api/", "alternates": ["https://vuejs.org/guide/extras/composition-api-faq.html"]}

Use ONLY current canonical domains:
- React → react.dev (NOT reactjs.org)
- Vue → vuejs.org
- Node.js → nodejs.org
- Tailwind → tailwindcss.com
- Postgres → postgresql.org
- TypeScript → typescriptlang.org

Output ONLY the JSON object.
`.trim();

const PICK_PAGES_INSTRUCTION = `
You will be given a topic and a numbered list of REAL URLs that exist on the docs site (we fetched them). Pick the BEST pages to learn the topic.

CRITICAL: every URL you return MUST appear EXACTLY in the list provided — do not invent, modify, or shorten URLs. If a URL has a trailing slash, keep it. If it has the full path, keep it.

Return JSON:
{
  "pages": [
    { "url": string, "title": string, "why": string }
  ]
}

Rules:
- Order pedagogically (intro → core concepts → practical usage).
- Skip URLs that look like marketing pages, blog posts, or unrelated reference.
- Use the anchor text near each URL to judge relevance.
- Output ONLY JSON.
`.trim();

const TOPIC_RESOLVER_INSTRUCTION = `
You are a curator of authoritative software documentation. Given a learning topic, recommend specific pages from OFFICIAL documentation websites only — never blogs, tutorial sites, or YouTube.

Return STRICT JSON:
{
  "topic": string,
  "rootUrl": string,                     // canonical docs root for this topic
  "pages": [
    { "url": string, "title": string, "why": string }
  ]
}

CRITICAL — use CURRENT canonical domains (the legacy ones redirect or are deprecated):
- React → https://react.dev/learn or https://react.dev/reference  (NOT reactjs.org — that is legacy)
- Node.js → https://nodejs.org/api/ or https://nodejs.org/en/learn
- Express → https://expressjs.com/en/guide/
- Socket.IO → https://socket.io/docs/v4/
- MongoDB → https://www.mongodb.com/docs/manual/
- PostgreSQL → https://www.postgresql.org/docs/current/
- Python → https://docs.python.org/3/
- Vue → https://vuejs.org/guide/ or https://vuejs.org/api/
- Kubernetes → https://kubernetes.io/docs/
- Next.js → https://nextjs.org/docs
- TypeScript → https://www.typescriptlang.org/docs/handbook/
- Tailwind → https://tailwindcss.com/docs/
- For everything else, use the project's own docs subdomain (docs.X.com, X.dev, X.io/docs).

Rules:
- Pages must be in pedagogical order: intro → core concepts → practical usage.
- Use SERVER-RENDERED pages — avoid pages that need a search query / JS to load content.
- Use real, currently-live URLs. If unsure, prefer a page closer to the docs root.
- Output ONLY JSON.
`.trim();

async function resolveTopicToPages({ openai, model, topic, count, onPhase }) {
  // ----- Step 1: ask model for a hub URL it's confident exists -----
  onPhase?.("Asking model for the docs hub URL…");
  const rootCompletion = await openai.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      { role: "system", content: RESOLVE_ROOT_INSTRUCTION },
      { role: "user", content: `Topic: ${topic}` },
    ],
  });
  const rootRaw = rootCompletion.choices?.[0]?.message?.content?.trim();
  if (!rootRaw) throw new Error("Empty response from root resolver");
  let rootObj;
  try {
    rootObj = JSON.parse(rootRaw);
  } catch {
    throw new Error("Root resolver did not return JSON");
  }
  const tryUrls = [rootObj.rootUrl, ...(rootObj.alternates || [])].filter(
    (u) => typeof u === "string" && u.startsWith("http")
  );
  if (!tryUrls.length) throw new Error("No starter URL suggested");

  // ----- Step 2: fetch a real page; collect all real internal links -----
  let starterUrl = null;
  let starterHtml = null;
  let starterRoot = null;
  let lastErr = null;
  for (const candidate of tryUrls) {
    try {
      onPhase?.(`Fetching ${new URL(candidate).pathname}…`);
      starterHtml = await fetchHtml(candidate, { timeoutMs: 8000 });
      starterUrl = candidate;
      starterRoot = new URL(candidate);
      console.log(`[topic] starter ok: ${candidate} (${starterHtml.length}b)`);
      break;
    } catch (err) {
      console.warn(`[topic] starter ${candidate} failed: ${err.message}`);
      lastErr = err;
    }
  }
  if (!starterUrl) {
    throw new Error(
      `All suggested starter URLs failed (last: ${lastErr?.message || "unknown"})`
    );
  }

  let linkPairs = discoverLinkPairs(starterHtml, starterUrl, starterRoot);
  // Always include the starter URL itself
  if (!linkPairs.find((l) => l.url === starterUrl)) {
    const $ = cheerio.load(starterHtml);
    linkPairs.unshift({
      url: starterUrl,
      text: $("title").text().trim().slice(0, 100) || "Index",
    });
  }
  console.log(
    `[topic] discovered ${linkPairs.length} same-prefix links from ${starterUrl}`
  );

  // If too few links, fallback: just take the first `count` from what we have
  if (linkPairs.length === 0) {
    return {
      topic,
      rootUrl: starterUrl,
      pages: [{ url: starterUrl, title: topic, why: "starter page" }],
    };
  }
  if (linkPairs.length <= count + 1) {
    return {
      topic,
      rootUrl: starterUrl,
      pages: linkPairs.slice(0, count).map((l) => ({
        url: l.url,
        title: l.text || l.url,
        why: "auto-selected (small site)",
      })),
    };
  }

  // ----- Step 3: ask model to pick `count` URLs from this REAL list -----
  onPhase?.(`Picking the best ${count} pages from ${linkPairs.length} real links…`);
  const linkList = linkPairs
    .slice(0, 100)
    .map((l, i) => `${i + 1}. ${l.url} — ${l.text || "(no anchor text)"}`)
    .join("\n");

  const pickCompletion = await openai.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    temperature: 0.3,
    messages: [
      { role: "system", content: PICK_PAGES_INSTRUCTION },
      {
        role: "user",
        content: `Topic: ${topic}\nNumber to pick: ${count}\n\nReal URLs (pick from these EXACTLY):\n${linkList}`,
      },
    ],
  });
  const pickedRaw = pickCompletion.choices?.[0]?.message?.content?.trim();
  let picked = { pages: [] };
  try {
    picked = JSON.parse(pickedRaw);
  } catch {
    console.warn(`[topic] picker returned non-JSON, falling back`);
  }

  // ----- Validate: every returned URL must be in our discovered list -----
  const validUrls = new Set(linkPairs.map((l) => l.url));
  const validPages = (picked.pages || [])
    .filter((p) => p?.url && validUrls.has(p.url))
    .slice(0, count);

  if (validPages.length === 0) {
    console.warn(
      `[topic] picker returned no valid URLs, falling back to first ${count}`
    );
    return {
      topic,
      rootUrl: starterUrl,
      pages: linkPairs.slice(0, count).map((l) => ({
        url: l.url,
        title: l.text || l.url,
        why: "auto-fallback (picker invalid)",
      })),
    };
  }

  return {
    topic,
    rootUrl: starterUrl,
    pages: validPages,
  };
}

async function convertPageToNotes({ openai, model, title, text }) {
  const completion = await openai.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    temperature: 0.4,
    messages: [
      { role: "system", content: NOTES_SCHEMA_INSTRUCTION },
      {
        role: "user",
        content:
          `Source page title: ${title}\n\n` +
          `The text below is extracted from the page as markdown — \`#\`/\`##\`/\`###\` mark the original headings, \`\`\`code blocks\`\`\` preserve every code example, and \`-\` marks list items. Use this structure: produce ONE section per H2/H3, in source order, and include every detail under each heading. Do NOT skip, merge, or summarise topics.\n\n` +
          `Documentation (markdown):\n${text}`,
      },
    ],
  });
  const raw = completion.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("Empty response from model");
  return JSON.parse(raw);
}

async function convertVideoToNotes({ openai, model, title, channel, transcript }) {
  const header = [
    `Video title: ${title}`,
    channel ? `Channel: ${channel}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const completion = await openai.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    temperature: 0.5,
    messages: [
      { role: "system", content: NOTES_SCHEMA_INSTRUCTION },
      {
        role: "user",
        content:
          `${header}\n\n` +
          `The text below is the auto-generated TRANSCRIPT of a YouTube video — it has no headings, no code blocks, and may include filler words and false starts. Treat it as a spoken talk: discover the natural sections yourself (intro, each major topic the speaker covers, demos, closing thoughts) and produce ONE section per topic in spoken order. Cover every concept the speaker mentions, including any code/commands they describe out loud (reconstruct them as codeSnippets). Do NOT just summarise — translate the talk into structured notes.\n\n` +
          `Transcript:\n${transcript}`,
      },
    ],
  });
  const raw = completion.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("Empty response from model");
  return JSON.parse(raw);
}

// ---------------- YouTube transcript fetching ----------------
function parseYouTubeId(input) {
  if (!input) return null;
  const raw = String(input).trim();
  // Bare 11-char video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") {
      const id = u.searchParams.get("v");
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

function decodeXmlEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Best-effort scrape of title + channel from the watch page. Falls back to
// generic strings when YouTube's HTML shape changes — the transcript itself
// is far more important than the metadata.
async function fetchYouTubeMeta(videoId) {
  let title = "YouTube video";
  let channel = "";
  try {
    const html = await fetchHtml(
      `https://www.youtube.com/watch?v=${videoId}&hl=en`,
      { timeoutMs: 10000 }
    );
    const m =
      html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var|<\/script>)/s) ||
      html.match(/ytInitialPlayerResponse"\s*:\s*(\{.+?\})\s*,\s*"/s);
    if (m) {
      try {
        const player = JSON.parse(m[1]);
        const d = player.videoDetails || {};
        if (d.title) title = d.title;
        if (d.author) channel = d.author;
      } catch {}
    }
    if (title === "YouTube video") {
      const t = html.match(/<meta\s+name="title"\s+content="([^"]+)"/i);
      if (t) title = decodeXmlEntities(t[1]);
    }
  } catch {}
  return { title, channel };
}

async function fetchYouTubeTranscript(videoId) {
  // Pull the actual transcript via the youtube-transcript library — it tracks
  // YouTube's signed-URL quirks better than hand-rolled scraping.
  let entries;
  try {
    entries = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
  } catch (err) {
    // Fall back to the video's default caption language if English isn't there.
    try {
      entries = await YoutubeTranscript.fetchTranscript(videoId);
    } catch {
      const reason = err?.message || "unknown error";
      throw new Error(
        `Couldn't fetch transcript: ${reason}. The video may have captions disabled.`
      );
    }
  }
  if (!Array.isArray(entries) || !entries.length) {
    throw new Error(
      "This video has no captions / transcript available. Try one with subtitles enabled."
    );
  }

  const { title, channel } = await fetchYouTubeMeta(videoId);

  // The library returns each line HTML-encoded (e.g. "&amp;#39;" → apostrophe).
  let transcript = entries
    .map((e) => decodeXmlEntities(decodeXmlEntities(e.text || "")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!transcript) throw new Error("Transcript was empty after parsing");

  const MAX = 90000;
  if (transcript.length > MAX) {
    transcript = transcript.slice(0, MAX) + "\n…[truncated]";
  }
  return { videoId, title, channel, transcript };
}

// simple concurrency-limited map
async function pMap(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        try {
          results[i] = { ok: true, value: await worker(items[i], i) };
        } catch (err) {
          results[i] = { ok: false, error: err };
        }
      }
    });
  await Promise.all(runners);
  return results;
}

app.get("/api/config", (_req, res) => {
  res.json({
    hasServerKey: !!process.env.OPENAI_API_KEY,
    llm: {
      providers: {
        local: {
          available: HAS_LOCAL,
          model: HAS_LOCAL ? LLM_MODEL : null,
          baseUrl: HAS_LOCAL ? LLM_BASE_URL : null,
        },
        openai: {
          available: HAS_OPENAI,
          model: OPENAI_MODEL,
        },
      },
      default: DEFAULT_PROVIDER,
    },
  });
});

// ---------------- saved-notes library ----------------
function slugify(s) {
  return (
    String(s || "untitled")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

// _folders.json keeps the list of known folder names. Stored alongside
// notes (with a leading underscore so safeFilename rejects it from the
// normal /api/notes/:filename endpoints — no accidental read/delete of
// the folder list via path traversal).
const FOLDERS_FILE = path.join(NOTES_DIR, "_folders.json");

function safeFilename(name) {
  // user-saved notes never start with "_" — reserved for system files
  return (
    /^[\w.-]+\.json$/.test(name) &&
    !name.includes("..") &&
    !name.startsWith("_")
  );
}

function safeFolderName(name) {
  if (typeof name !== "string") return "";
  // Strip control chars, collapse whitespace, cap length, forbid edges with whitespace.
  const cleaned = name.replace(/[\x00-\x1f]+/g, "").trim().replace(/\s+/g, " ");
  return cleaned.slice(0, 80);
}

async function readFolderList() {
  try {
    const raw = await fs.readFile(FOLDERS_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.folders)) return [];
    return [
      ...new Set(
        data.folders
          .map(safeFolderName)
          .filter(Boolean)
      ),
    ];
  } catch {
    return [];
  }
}

async function writeFolderList(folders) {
  const unique = [
    ...new Set(folders.map(safeFolderName).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  await fs.writeFile(
    FOLDERS_FILE,
    JSON.stringify({ folders: unique }, null, 2),
    "utf-8"
  );
  return unique;
}

app.get("/api/folders", async (_req, res) => {
  try {
    res.json({ folders: await readFolderList() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/folders", async (req, res) => {
  try {
    const name = safeFolderName(req.body?.name);
    if (!name) return res.status(400).json({ error: "Bad folder name" });
    const folders = await readFolderList();
    if (!folders.includes(name)) folders.push(name);
    const updated = await writeFolderList(folders);
    res.json({ ok: true, name, folders: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/folders/:name", async (req, res) => {
  try {
    const name = safeFolderName(decodeURIComponent(req.params.name || ""));
    if (!name) return res.status(400).json({ error: "Bad folder name" });
    const folders = await readFolderList();
    const updated = await writeFolderList(folders.filter((f) => f !== name));
    // Detach any notes assigned to this folder so they become uncategorized.
    const files = await fs.readdir(NOTES_DIR).catch(() => []);
    let touched = 0;
    for (const f of files) {
      if (!safeFilename(f)) continue;
      try {
        const p = path.join(NOTES_DIR, f);
        const json = JSON.parse(await fs.readFile(p, "utf-8"));
        if (json.folder === name) {
          json.folder = null;
          await fs.writeFile(p, JSON.stringify(json, null, 2), "utf-8");
          touched++;
        }
      } catch {}
    }
    res.json({ ok: true, folders: updated, notesUpdated: touched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/save-notes", async (req, res) => {
  try {
    const { name, papers, topic, sourceUrl, folder } = req.body || {};
    if (!Array.isArray(papers) || !papers.length) {
      return res.status(400).json({ error: "No papers to save" });
    }
    const folderName = safeFolderName(folder) || null;
    if (folderName) {
      const folders = await readFolderList();
      if (!folders.includes(folderName)) {
        await writeFolderList([...folders, folderName]);
      }
    }
    const data = {
      version: 1,
      savedAt: new Date().toISOString(),
      name: String(name || topic || sourceUrl || "Untitled").slice(0, 200),
      topic: topic || null,
      sourceUrl: sourceUrl || null,
      folder: folderName,
      papers,
    };
    const filename = `${slugify(data.name)}-${Date.now()}.json`;
    await fs.writeFile(
      path.join(NOTES_DIR, filename),
      JSON.stringify(data, null, 2),
      "utf-8"
    );
    res.json({
      ok: true,
      filename,
      name: data.name,
      savedAt: data.savedAt,
      folder: folderName,
      folderPath: NOTES_DIR,
    });
  } catch (err) {
    console.error("save-notes:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/list-notes", async (_req, res) => {
  try {
    const files = await fs.readdir(NOTES_DIR).catch(() => []);
    const items = [];
    for (const f of files) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      try {
        const content = await fs.readFile(path.join(NOTES_DIR, f), "utf-8");
        const json = JSON.parse(content);
        items.push({
          filename: f,
          name: json.name || f,
          topic: json.topic || null,
          sourceUrl: json.sourceUrl || null,
          folder: json.folder || null,
          savedAt: json.savedAt || null,
          paperCount: Array.isArray(json.papers) ? json.papers.length : 0,
        });
      } catch (e) {
        console.warn(`bad notes file ${f}: ${e.message}`);
      }
    }
    items.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
    // Also surface the folder list — UI seeds its tabs from this so empty
    // folders (no notes yet) still show up.
    const folders = await readFolderList();
    res.json({ items, folders, folderPath: NOTES_DIR });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Move a note between folders (or to "" / null = uncategorized).
app.patch("/api/notes/:filename/folder", async (req, res) => {
  try {
    const f = req.params.filename;
    if (!safeFilename(f)) return res.status(400).json({ error: "bad filename" });
    const target = safeFolderName(req.body?.folder) || null;
    const filePath = path.join(NOTES_DIR, f);
    const json = JSON.parse(await fs.readFile(filePath, "utf-8"));
    json.folder = target;
    await fs.writeFile(filePath, JSON.stringify(json, null, 2), "utf-8");
    if (target) {
      const folders = await readFolderList();
      if (!folders.includes(target)) await writeFolderList([...folders, target]);
    }
    res.json({ ok: true, filename: f, folder: target });
  } catch (err) {
    const msg = /ENOENT/.test(err?.message || "") ? "not found" : err.message;
    const code = msg === "not found" ? 404 : 500;
    res.status(code).json({ error: msg });
  }
});

app.get("/api/notes/:filename", async (req, res) => {
  try {
    const f = req.params.filename;
    if (!safeFilename(f)) return res.status(400).json({ error: "bad filename" });
    const content = await fs.readFile(path.join(NOTES_DIR, f), "utf-8");
    res.json(JSON.parse(content));
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.delete("/api/notes/:filename", async (req, res) => {
  try {
    const f = req.params.filename;
    if (!safeFilename(f)) return res.status(400).json({ error: "bad filename" });
    await fs.unlink(path.join(NOTES_DIR, f));
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.post("/api/convert", async (req, res) => {
  try {
    const { url, apiKey: bodyKey } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url" });

    let parsed;
    try {
      parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("bad protocol");
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    let openai, model;
    try { ({ openai, model } = makeChatClient(bodyKey, req.body?.provider)); }
    catch (e) { return res.status(e.status || 500).json({ error: e.message }); }

    const html = await fetchHtml(parsed.toString());
    const { title, text } = extractMainText(html);
    if (!text || text.length < 40) {
      return res.status(422).json({
        error:
          "Could not extract enough readable text from that page (it may require JavaScript to render).",
      });
    }

    const notes = await convertPageToNotes({ openai, model, title, text });

    res.json({ notes, sourceTitle: title, sourceUrl: parsed.toString() });
  } catch (err) {
    const msg = err?.message || String(err);
    const status = /api key|incorrect|401|unauthorized/i.test(msg) ? 401 : 500;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/convert-youtube", async (req, res) => {
  try {
    const { url, apiKey: bodyKey } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url" });

    const videoId = parseYouTubeId(url);
    if (!videoId) {
      return res.status(400).json({
        error:
          "That doesn't look like a YouTube URL. Use a youtube.com/watch?v=… or youtu.be/… link.",
      });
    }

    let openai, model;
    try { ({ openai, model } = makeChatClient(bodyKey, req.body?.provider)); }
    catch (e) { return res.status(e.status || 500).json({ error: e.message }); }

    const { title, channel, transcript } = await fetchYouTubeTranscript(videoId);
    if (!transcript || transcript.length < 40) {
      return res.status(422).json({
        error: "Transcript was too short to convert.",
      });
    }

    const notes = await convertVideoToNotes({
      openai,
      model,
      title,
      channel,
      transcript,
    });

    res.json({
      notes,
      sourceTitle: channel ? `${title} — ${channel}` : title,
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    const status = /api key|incorrect|401|unauthorized/i.test(msg) ? 401 : 500;
    res.status(status).json({ error: msg });
  }
});

// Used by the "PDF" tab — the browser extracts text via pdf.js client-side,
// then posts the plain text here for the LLM pass. Same for any future
// already-extracted-text source.
app.post("/api/convert-text", async (req, res) => {
  try {
    const {
      title: rawTitle,
      text,
      apiKey: bodyKey,
      sourceKind = "text",
    } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length < 40) {
      return res.status(400).json({
        error: "No text to convert (need at least 40 characters).",
      });
    }

    let openai, model;
    try { ({ openai, model } = makeChatClient(bodyKey, req.body?.provider)); }
    catch (e) { return res.status(e.status || 500).json({ error: e.message }); }

    const title = (rawTitle && String(rawTitle).slice(0, 200)) || "Document";
    const notes = await convertPageToNotes({ openai, model, title, text });
    res.json({
      notes,
      sourceTitle: title,
      sourceUrl: null,
      sourceKind,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    const status = /api key|incorrect|401|unauthorized/i.test(msg) ? 401 : 500;
    res.status(status).json({ error: msg });
  }
});

// ---------------- discover-only (NDJSON stream) ----------------
// Same shape as /api/convert-site but stops after the discovery phase so the
// client can show a picker. Cache hits are reused on the follow-up convert call.
app.post("/api/discover-pages", async (req, res) => {
  const {
    url,
    topic,
    apiKey: bodyKey,
    maxPages = 30,
  } = req.body || {};

  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders?.();

  const send = (obj) => res.write(JSON.stringify(obj) + "\n");
  const done = () => res.end();

  try {
    if (!url && !topic) {
      send({ type: "error", error: "Provide either url or topic" });
      return done();
    }

    const cap = Math.max(1, Math.min(60, Number(maxPages) || 30));
    const discovered = []; // [{ url, title }]
    let rootUrl = null;

    // ---------- topic mode ----------
    if (topic && !url) {
      let openai, model;
      try { ({ openai, model } = makeChatClient(bodyKey, req.body?.provider)); }
      catch (e) { send({ type: "error", error: e.message }); return done(); }
      send({ type: "phase", phase: "resolving-topic", topic, cap });
      let plan;
      try {
        plan = await resolveTopicToPages({
          openai,
          model,
          topic,
          count: cap,
          onPhase: (msg) => send({ type: "resolver-step", message: msg }),
        });
      } catch (err) {
        send({ type: "error", error: `Topic resolver failed: ${err.message}` });
        return done();
      }
      rootUrl = plan.rootUrl;
      for (const p of plan.pages || []) {
        discovered.push({ url: p.url, title: p.title || p.url });
      }
      send({
        type: "topic-resolved",
        topic: plan.topic || topic,
        rootUrl: plan.rootUrl,
        pages: plan.pages,
      });
      send({ type: "discovered", pages: discovered, rootUrl, topic });
      return done();
    }

    // ---------- URL crawl mode ----------
    let root;
    try {
      root = new URL(url);
      if (!/^https?:$/.test(root.protocol)) throw new Error();
    } catch {
      send({ type: "error", error: "Invalid URL" });
      return done();
    }
    rootUrl = root.toString();

    const visited = new Set();
    const queue = [root.toString()];
    const CRAWL_CONCURRENCY = 10;
    send({ type: "phase", phase: "crawling", cap });

    await new Promise((resolve) => {
      let inFlight = 0;
      let stopped = false;
      const tryStart = () => {
        if (stopped) return;
        if (discovered.length >= cap) {
          stopped = true;
          if (inFlight === 0) resolve();
          return;
        }
        while (
          queue.length &&
          inFlight < CRAWL_CONCURRENCY &&
          discovered.length + inFlight < cap
        ) {
          const u = queue.shift();
          if (!u || visited.has(u)) continue;
          visited.add(u);
          inFlight++;
          send({ type: "fetching", url: u });
          (async () => {
            try {
              const html = await fetchHtml(u);
              const { title, text } = extractMainText(html);
              const links = discoverLinks(html, u, root);
              if (text && text.length >= 40 && discovered.length < cap) {
                cacheSet(u, title, text);
                discovered.push({ url: u, title });
                send({
                  type: "fetched",
                  url: u,
                  title,
                  n: discovered.length,
                  queued: queue.length,
                });
              } else if (text && text.length < 40) {
                send({ type: "skipped", url: u, reason: "thin content" });
              }
              for (const link of links) {
                if (!visited.has(link) && !queue.includes(link))
                  queue.push(link);
              }
            } catch (err) {
              send({
                type: "fetch-error",
                url: u,
                error: err?.message || "fetch failed",
              });
            } finally {
              inFlight--;
              if (
                (queue.length === 0 && inFlight === 0) ||
                discovered.length >= cap
              ) {
                if (!stopped || inFlight === 0) {
                  stopped = true;
                  resolve();
                }
              } else {
                tryStart();
              }
            }
          })();
        }
        if (queue.length === 0 && inFlight === 0) resolve();
      };
      tryStart();
    });

    send({ type: "discovered", pages: discovered, rootUrl, topic: null });
    done();
  } catch (err) {
    send({ type: "error", error: err?.message || String(err) });
    done();
  }
});

// ---------------- crawl + multi-page conversion (NDJSON stream) ----------------
app.post("/api/convert-site", async (req, res) => {
  const {
    url,
    topic,
    apiKey: bodyKey,
    maxPages = 30,
    pages: presetPages,
  } = req.body || {};

  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders?.();

  const send = (obj) => {
    res.write(JSON.stringify(obj) + "\n");
  };
  const done = () => res.end();

  try {
    const hasPreset = Array.isArray(presetPages) && presetPages.length > 0;
    if (!url && !topic && !hasPreset) {
      send({ type: "error", error: "Provide either url, topic, or pages" });
      return done();
    }

    let openai, model;
    try { ({ openai, model } = makeChatClient(bodyKey, req.body?.provider)); }
    catch (e) { send({ type: "error", error: e.message }); return done(); }

    const cap = Math.max(1, Math.min(60, Number(maxPages) || 30));
    const fetched = []; // { url, title, text }
    let root = null;

    // ---------- preset mode: client already picked which URLs to convert ----------
    if (hasPreset) {
      const pages = presetPages
        .filter((p) => p && typeof p.url === "string")
        .slice(0, cap);
      send({ type: "phase", phase: "fetching", total: pages.length });
      const fetchResults = await Promise.allSettled(
        pages.map(async (p) => {
          const cached = cacheGet(p.url);
          if (cached) {
            return {
              url: p.url,
              title: cached.title || p.title || p.url,
              text: cached.text,
              cached: true,
            };
          }
          send({ type: "fetching", url: p.url });
          const html = await fetchHtml(p.url);
          const { title, text } = extractMainText(html);
          if (text && text.length >= 40) cacheSet(p.url, title, text);
          return {
            url: p.url,
            title: title || p.title || p.url,
            text,
            cached: false,
          };
        })
      );
      for (let idx = 0; idx < fetchResults.length; idx++) {
        const r = fetchResults[idx];
        const planned = pages[idx];
        if (r.status !== "fulfilled") {
          send({
            type: "fetch-error",
            url: planned?.url,
            error: r.reason?.message || "fetch failed",
          });
          continue;
        }
        const { url: u, title, text } = r.value;
        if (text && text.length >= 40) {
          fetched.push({ url: u, title, text });
          send({
            type: "fetched",
            url: u,
            title,
            n: fetched.length,
            queued: 0,
          });
        } else {
          send({
            type: "skipped",
            url: u,
            reason: `thin content (${text?.length || 0} chars)`,
          });
        }
      }
    } else if (topic && !url) {
      send({ type: "phase", phase: "resolving-topic", topic, cap });

      let plan;
      try {
        plan = await resolveTopicToPages({
          openai,
          model,
          topic,
          count: cap,
          onPhase: (msg) => send({ type: "resolver-step", message: msg }),
        });
      } catch (err) {
        send({ type: "error", error: `Topic resolver failed: ${err.message}` });
        return done();
      }

      send({
        type: "topic-resolved",
        topic: plan.topic || topic,
        rootUrl: plan.rootUrl,
        pages: plan.pages,
      });

      try {
        root = new URL(plan.rootUrl || plan.pages[0]?.url);
      } catch {}

      send({ type: "phase", phase: "fetching", total: plan.pages.length });

      const fetchResults = await Promise.allSettled(
        plan.pages.map(async (p) => {
          send({ type: "fetching", url: p.url });
          const html = await fetchHtml(p.url);
          const { title, text } = extractMainText(html);
          return { url: p.url, title: title || p.title, text, htmlLen: html.length };
        })
      );

      for (let idx = 0; idx < fetchResults.length; idx++) {
        const r = fetchResults[idx];
        const planned = plan.pages[idx];
        if (r.status !== "fulfilled") {
          console.warn(`[topic] fetch failed: ${planned?.url} → ${r.reason?.message}`);
          send({
            type: "fetch-error",
            url: planned?.url,
            error: r.reason?.message || "fetch failed",
          });
          continue;
        }
        const { url: u, title, text, htmlLen } = r.value;
        console.log(`[topic] ${u} → html=${htmlLen}b text=${text.length}c`);
        if (text && text.length >= 40) {
          fetched.push({ url: u, title, text });
          send({
            type: "fetched",
            url: u,
            title,
            n: fetched.length,
            queued: 0,
          });
        } else {
          send({
            type: "skipped",
            url: u,
            reason: `thin content (${text.length} chars)`,
          });
        }
      }
    } else {
      // ---------- URL mode: BFS-crawl the docs site ----------
      try {
        root = new URL(url);
        if (!/^https?:$/.test(root.protocol)) throw new Error();
      } catch {
        send({ type: "error", error: "Invalid URL" });
        return done();
      }

      const visited = new Set();
      const queue = [root.toString()];
      const CRAWL_CONCURRENCY = 10;
      send({ type: "phase", phase: "crawling", cap });

      // worker-pool crawl: events stream as each page completes,
      // a single slow page never blocks the rest
      await new Promise((resolve) => {
        let inFlight = 0;
        let stopped = false;

        const tryStart = () => {
          if (stopped) return;
          if (fetched.length >= cap) {
            stopped = true;
            if (inFlight === 0) resolve();
            return;
          }
          while (
            queue.length &&
            inFlight < CRAWL_CONCURRENCY &&
            fetched.length + inFlight < cap
          ) {
            const u = queue.shift();
            if (!u || visited.has(u)) continue;
            visited.add(u);
            inFlight++;
            send({ type: "fetching", url: u });
            (async () => {
              try {
                const html = await fetchHtml(u);
                const { title, text } = extractMainText(html);
                const links = discoverLinks(html, u, root);
                if (text && text.length >= 40 && fetched.length < cap) {
                  fetched.push({ url: u, title, text });
                  send({
                    type: "fetched",
                    url: u,
                    title,
                    n: fetched.length,
                    queued: queue.length,
                  });
                } else if (text && text.length < 40) {
                  send({ type: "skipped", url: u, reason: "thin content" });
                }
                for (const link of links) {
                  if (!visited.has(link) && !queue.includes(link))
                    queue.push(link);
                }
              } catch (err) {
                send({
                  type: "fetch-error",
                  url: u,
                  error: err?.message || "fetch failed",
                });
              } finally {
                inFlight--;
                if (
                  (queue.length === 0 && inFlight === 0) ||
                  fetched.length >= cap
                ) {
                  if (!stopped || inFlight === 0) {
                    stopped = true;
                    resolve();
                  }
                } else {
                  tryStart();
                }
              }
            })();
          }
          if (queue.length === 0 && inFlight === 0) resolve();
        };
        tryStart();
      });
    } // end URL-mode else block

    if (fetched.length === 0) {
      send({
        type: "error",
        error: topic
          ? `Couldn't read any pages from the suggested URLs for "${topic}". The model may have suggested legacy/JS-rendered pages — try rephrasing or pasting a specific URL.`
          : "Couldn't extract readable content from any page. The site may require JavaScript to render.",
      });
      return done();
    }

    send({ type: "phase", phase: "converting", total: fetched.length });

    // convert each page concurrently (3 at a time)
    let completed = 0;
    await pMap(fetched, 3, async (p) => {
      try {
        const notes = await convertPageToNotes({
          openai,
          model,
          title: p.title,
          text: p.text,
        });
        completed++;
        send({
          type: "page",
          url: p.url,
          sourceTitle: p.title,
          notes,
          completed,
          total: fetched.length,
        });
      } catch (err) {
        send({
          type: "page-error",
          url: p.url,
          error: err?.message || "conversion failed",
        });
      }
    });

    send({ type: "done", total: fetched.length });
  } catch (err) {
    send({ type: "error", error: err?.message || String(err) });
  } finally {
    done();
  }
});

// ---------------- HandFonted: free-form sample → real TTF ----------------
// We launch the Python service (handfonted/server.py) as a child process at
// startup so models load ONCE — per-request latency drops from ~30s (cold
// CLI) to a few seconds (warm HTTP). Node proxies /api/build-handwriting-font
// to the local Python service. If the venv isn't built, we skip the spawn
// and the proxy endpoint returns a friendly setup hint.
const HANDFONTED_DIR = path.join(__dirname, "handfonted");
const HANDFONTED_PYTHON =
  process.env.HANDFONTED_PYTHON ||
  path.join(HANDFONTED_DIR, ".venv", "bin", "python3");
const HANDFONTED_PORT = Number(process.env.HANDFONTED_PORT || 5179);
const HANDFONTED_BASE = `http://127.0.0.1:${HANDFONTED_PORT}`;

const handfonted = {
  proc: null,
  status: "stopped", // "stopped" | "starting" | "ready" | "error" | "missing"
  message: "",
  startedAt: 0,
};

async function isHandfontedInstalled() {
  try {
    await fs.access(path.join(HANDFONTED_DIR, "server.py"));
    await fs.access(HANDFONTED_PYTHON);
    return true;
  } catch {
    return false;
  }
}

async function startHandfonted() {
  const installed = await isHandfontedInstalled();
  if (!installed) {
    handfonted.status = "missing";
    handfonted.message =
      "HandFonted isn't installed yet. Run `npm run setup-handfonted` (one-time, ~2 min) to enable the 'From a writing sample' tab.";
    console.log(`[handfonted] ${handfonted.message}`);
    return;
  }

  handfonted.status = "starting";
  handfonted.startedAt = Date.now();
  handfonted.message = "loading models…";
  console.log(`[handfonted] starting ${HANDFONTED_PYTHON} server.py on :${HANDFONTED_PORT}`);
  const child = spawn(HANDFONTED_PYTHON, ["server.py"], {
    cwd: HANDFONTED_DIR,
    env: {
      ...process.env,
      HANDFONTED_PORT: String(HANDFONTED_PORT),
      PYTHONUNBUFFERED: "1",
    },
  });
  handfonted.proc = child;

  child.stdout.on("data", (b) => {
    process.stdout.write(`[handfonted] ${b}`);
  });
  child.stderr.on("data", (b) => {
    process.stderr.write(`[handfonted] ${b}`);
  });
  child.on("exit", (code) => {
    if (handfonted.status !== "stopped") {
      handfonted.status = "error";
      handfonted.message = `Python service exited (code ${code}). Tab will fall back to a setup hint until the next restart.`;
      console.error(`[handfonted] ${handfonted.message}`);
    }
    handfonted.proc = null;
  });

  // Background poll for /health; flips status to "ready" when Python is up.
  // Worst case it stays in "starting" until first build attempt times out.
  pollHandfontedHealth();
}

async function pollHandfontedHealth() {
  const deadline = Date.now() + 90_000; // give it 90s to finish loading models
  while (Date.now() < deadline && handfonted.proc) {
    try {
      const r = await fetch(`${HANDFONTED_BASE}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (r.ok) {
        const elapsed = ((Date.now() - handfonted.startedAt) / 1000).toFixed(1);
        handfonted.status = "ready";
        handfonted.message = `ready in ${elapsed}s`;
        console.log(`[handfonted] ${handfonted.message}`);
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1_000));
  }
  if (handfonted.proc && handfonted.status === "starting") {
    handfonted.message =
      "still loading models (this can take 30-90s on first run); try again in a moment.";
  }
}

function stopHandfonted() {
  if (!handfonted.proc) return;
  handfonted.status = "stopped";
  try {
    handfonted.proc.kill("SIGTERM");
    setTimeout(() => {
      try {
        handfonted.proc?.kill("SIGKILL");
      } catch {}
    }, 3_000).unref();
  } catch {}
}
process.on("SIGINT", () => {
  stopHandfonted();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopHandfonted();
  process.exit(0);
});
process.on("exit", stopHandfonted);

// Lightweight link previews for the home dashboard. Pulls og:image,
// og:title and favicon for the URL and caches the result. The dashboard
// lazy-fetches one of these per visible card so saved notes can show a
// real thumbnail next to the source instead of a flat gradient.
const URL_PREVIEW_CACHE = new Map(); // canonical href → { data, expiresAt }
const URL_PREVIEW_TTL_MS = 60 * 60 * 1000;
const URL_PREVIEW_FAILURE_TTL_MS = 5 * 60 * 1000;

app.get("/api/url-preview", async (req, res) => {
  const targetUrl = String(req.query.url || "").trim();
  if (!targetUrl) return res.status(400).json({ error: "Missing url" });
  let parsed;
  try {
    parsed = new URL(targetUrl);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("bad protocol");
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }
  const key = parsed.href;
  const cached = URL_PREVIEW_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json(cached.data);
  }

  const resolve = (u) => {
    if (!u) return "";
    try { return new URL(u, parsed.href).href; } catch { return ""; }
  };

  const fallback = {
    hostname: parsed.hostname,
    title: "",
    description: "",
    image: "",
    favicon: `https://www.google.com/s2/favicons?sz=64&domain=${parsed.hostname}`,
  };

  try {
    const html = await fetchHtml(parsed.href, { timeoutMs: 7000 });
    const $ = cheerio.load(html);
    const meta = (k) =>
      $(`meta[property="${k}"]`).attr("content") ||
      $(`meta[name="${k}"]`).attr("content") ||
      "";
    const image = meta("og:image") || meta("twitter:image") || meta("image");
    const title = meta("og:title") || $("title").first().text().trim();
    const description = meta("og:description") || meta("description");
    const favicon =
      $('link[rel="icon"]').attr("href") ||
      $('link[rel="shortcut icon"]').attr("href") ||
      $('link[rel="apple-touch-icon"]').attr("href") ||
      "/favicon.ico";

    const data = {
      hostname: parsed.hostname,
      title: (title || "").slice(0, 200),
      description: (description || "").slice(0, 300),
      image: resolve(image),
      favicon: resolve(favicon) || fallback.favicon,
    };
    URL_PREVIEW_CACHE.set(key, {
      data,
      expiresAt: Date.now() + URL_PREVIEW_TTL_MS,
    });
    // Bound cache size — drop the oldest when we get too big.
    if (URL_PREVIEW_CACHE.size > 500) {
      const oldest = URL_PREVIEW_CACHE.keys().next().value;
      URL_PREVIEW_CACHE.delete(oldest);
    }
    res.json(data);
  } catch (err) {
    URL_PREVIEW_CACHE.set(key, {
      data: fallback,
      expiresAt: Date.now() + URL_PREVIEW_FAILURE_TTL_MS,
    });
    res.json(fallback);
  }
});

app.get("/api/handfonted-status", (_req, res) => {
  res.json({
    ok: handfonted.status === "ready",
    status: handfonted.status,
    message: handfonted.message,
  });
});

app.post("/api/build-handwriting-font", async (req, res) => {
  try {
    const { imageDataUrl, fontName = "My Handwriting", thickness = 100 } =
      req.body || {};
    if (!imageDataUrl || typeof imageDataUrl !== "string")
      return res.status(400).json({ error: "Missing imageDataUrl" });
    const m = imageDataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.*)$/);
    if (!m)
      return res.status(400).json({
        error: "imageDataUrl must be a base64 PNG/JPEG/WebP data URL",
      });

    if (handfonted.status === "missing") {
      return res.status(503).json({ error: handfonted.message });
    }
    if (handfonted.status === "error") {
      return res.status(503).json({
        error: `HandFonted service crashed: ${handfonted.message}. Restart the Node server (npm start) to try again.`,
      });
    }
    if (handfonted.status !== "ready") {
      return res.status(503).json({
        error: `HandFonted is still starting up — ${handfonted.message || "give it a few more seconds"}`,
      });
    }

    const imgBytes = Buffer.from(m[2], "base64");
    if (imgBytes.length > 12 * 1024 * 1024) {
      return res
        .status(413)
        .json({ error: "Image too large — keep it under 12 MB." });
    }

    const safeFontName = String(fontName).slice(0, 60).replace(/[^\w \-]/g, "");
    const startedAt = Date.now();

    // 5-minute hard ceiling — first call after model load can be slower.
    const ctrl = AbortController ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), 5 * 60 * 1000);
    let upstream;
    try {
      upstream = await fetch(`${HANDFONTED_BASE}/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image_base64: m[2],
          font_name: safeFontName || "My Handwriting",
          thickness: Math.max(40, Math.min(300, Number(thickness) || 100)),
        }),
        signal: ctrl?.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      return res.status(502).json({
        error: `Couldn't reach HandFonted service: ${err?.message || err}`,
      });
    }
    clearTimeout(timer);

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data.error || `HandFonted service returned HTTP ${upstream.status}`,
      });
    }

    const elapsed = Math.round((Date.now() - startedAt) / 100) / 10;
    console.log(
      `[handfonted] build done in ${elapsed}s, ${data.bytes} bytes (${data.characters} chars)`
    );
    res.json({
      ok: true,
      ttfBase64: data.ttf_base64,
      bytes: data.bytes,
      characters: data.characters,
      elapsedSeconds: elapsed,
    });
  } catch (err) {
    console.error("build-handwriting-font:", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 5173;
app.listen(PORT, () => {
  console.log(`✏️  boringDocs running → http://localhost:${PORT}`);
  // Spawn the HandFonted Python service after Node is listening so users
  // can already interact with the rest of the app while ML models load.
  startHandfonted();
});
