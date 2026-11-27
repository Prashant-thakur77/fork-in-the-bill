// Builds docs/paper.pdf from docs/paper.md and docs/deck.pdf from docs/build/deck.html.
//
// Both sources carry number markers (<!--n:key:fmt-->value<!--/n-->) that
// `python -m analysis.render_docs` fills from analysis/out/numbers.json, and that
// `python -m analysis.check_consistency` checks. Run render_docs first (`make docs` does).
//
//   node build.mjs                 paper and deck
//   node build.mjs paper           one of them
//   node build.mjs --png <dir>     also write a PNG of every slide

import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.resolve(here, "..");
const fontDir = (pkg) => pathToFileURL(path.join(here, "node_modules", pkg, "files")).href;

const args = process.argv.slice(2);
const pngIdx = args.indexOf("--png");
const pngDir = pngIdx >= 0 ? path.resolve(args[pngIdx + 1]) : null;
const targets = args.filter((a, i) => !a.startsWith("--") && (pngIdx < 0 || i !== pngIdx + 1));
const want = (name) => targets.length === 0 || targets.includes(name);

const MARKER = /<!--n:[^>]*-->(.*?)<!--\/n-->/g;
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function paperHtml(md) {
  // Markers become plain text; other HTML comments (results fences) are dropped.
  md = md.replace(MARKER, "$1").replace(/<!--[\s\S]*?-->/g, "");
  const lines = md.split("\n");
  const title = lines.shift().replace(/^#\s+/, "");
  const front = [];
  while (lines.length && !lines[0].startsWith("## ")) front.push(lines.shift());
  const [authors, ...meta] = front.map((l) => l.trim()).filter(Boolean);

  const renderer = new marked.Renderer();
  renderer.image = ({ href, text }) =>
    `<figure><img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"><figcaption>${escapeHtml(text)}</figcaption></figure>`;
  let body = marked.parse(lines.join("\n"), { renderer, gfm: true });

  body = body
    .replace(/<p>\s*(<figure>[\s\S]*?<\/figure>)\s*<\/p>/g, "$1")
    .replace(/<p>Table: ([\s\S]*?)<\/p>\s*<table>/g, "<table><caption>$1</caption>")
    .replace(/<h2>Abstract<\/h2>\s*<p>([\s\S]*?)<\/p>/, '<section class="abstract"><h2>Abstract</h2><p>$1</p></section>')
    .replace(/<h2>(Appendix[\s\S]*?)<\/h2>/, '<h2 class="appendix">$1</h2>');

  const linkify = (s) => escapeHtml(s).replace(/(https:\/\/\S+)/g, '<a href="$1">$1</a>');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<base href="${pathToFileURL(docs).href}/">
<title>${escapeHtml(title)}</title>
<style>${paperCss()}</style></head>
<body>
<header class="front">
  <h1>${escapeHtml(title)}</h1>
  <p class="authors">${escapeHtml(authors ?? "")}</p>
  ${meta.map((m) => `<p class="meta">${linkify(m)}</p>`).join("\n  ")}
</header>
${body}
</body></html>`;
}

function paperCss() {
  const serif = fontDir("@fontsource/source-serif-4");
  const mono = fontDir("@fontsource/overpass-mono");
  const face = (fam, url, weight, style = "normal") =>
    `@font-face{font-family:"${fam}";src:url("${url}") format("woff2");font-weight:${weight};font-style:${style};}`;
  return `
${face("Paper Serif", `${serif}/source-serif-4-latin-400-normal.woff2`, 400)}
${face("Paper Serif", `${serif}/source-serif-4-latin-400-italic.woff2`, 400, "italic")}
${face("Paper Serif", `${serif}/source-serif-4-latin-600-normal.woff2`, 600)}
${face("Paper Serif", `${serif}/source-serif-4-latin-700-normal.woff2`, 700)}
${face("Paper Mono", `${mono}/overpass-mono-latin-400-normal.woff2`, 400)}
${face("Paper Mono", `${mono}/overpass-mono-latin-600-normal.woff2`, 600)}
@page { size: A4; margin: 22mm 20mm 22mm 20mm; }
:root { --ink: #1b211e; --quiet: #4a514c; --rule: #1b211e; --hair: #c9c6bb; --accent: #0b6b45; }
html { background: #fff; }
body { font-family: "Paper Serif", Georgia, serif; font-size: 10.4pt; line-height: 1.45; color: var(--ink);
  font-variant-numeric: tabular-nums; counter-reset: fig tab; margin: 0; hyphens: auto; }
.front { text-align: center; margin: 4mm 0 7mm; }
.front h1 { font-size: 19pt; line-height: 1.2; font-weight: 700; margin: 0 8mm 4mm; }
.front .authors { font-size: 11.5pt; margin: 0 0 1.5mm; }
.front .meta { font-size: 9pt; color: var(--quiet); margin: 0; }
.front a { color: var(--quiet); text-decoration: none; }
.abstract { margin: 0 10mm 6mm; font-size: 9.6pt; }
.abstract h2 { text-align: center; font-size: 10pt; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 2mm; }
.abstract p { text-align: justify; margin: 0; }
h2 { font-size: 12.5pt; font-weight: 700; margin: 6mm 0 2mm; break-after: avoid; }
h2.appendix { break-before: page; }
h3 { font-size: 10.6pt; font-weight: 600; font-style: italic; margin: 4mm 0 1.5mm; break-after: avoid; }
p { margin: 0 0 2.4mm; text-align: justify; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 2.4mm; padding-left: 6mm; }
li { margin: 0 0 1mm; }
a { color: var(--accent); text-decoration: none; }
code { font-family: "Paper Mono", monospace; font-size: 0.86em; word-break: break-word; }
pre { font-family: "Paper Mono", monospace; font-size: 7.6pt; line-height: 1.4; background: #f4f3ee;
  border-top: 0.6pt solid var(--hair); border-bottom: 0.6pt solid var(--hair); padding: 2.5mm 3mm;
  white-space: pre-wrap; break-inside: avoid; margin: 0 0 3mm; }
pre code { font-size: inherit; }
table { border-collapse: collapse; margin: 3mm auto 4mm; font-size: 8.8pt; line-height: 1.3;
  border-top: 1.2pt solid var(--rule); border-bottom: 1.2pt solid var(--rule); break-inside: avoid; width: 100%; }
caption { counter-increment: tab; caption-side: top; text-align: left; font-size: 9pt; padding-bottom: 1.8mm; }
caption::before { content: "Table " counter(tab) ". "; font-weight: 700; }
thead th { border-bottom: 0.6pt solid var(--rule); font-weight: 600; text-align: left; }
th, td { padding: 1.1mm 2mm; vertical-align: top; text-align: left; }
td:not(:first-child), th:not(:first-child) { white-space: nowrap; }
td code { white-space: nowrap; }
figure { margin: 4mm auto 5mm; text-align: center; break-inside: avoid; }
figure img { max-width: 100%; max-height: 62mm; }
figcaption { counter-increment: fig; font-size: 9pt; text-align: left; margin: 1.5mm 6mm 0; }
figcaption::before { content: "Figure " counter(fig) ". "; font-weight: 700; }
`;
}

async function withPage(browser, opts, fn) {
  const page = await browser.newPage(opts);
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

async function buildPaper(browser) {
  const md = await readFile(path.join(docs, "paper.md"), "utf8");
  const tmp = await mkdtemp(path.join(tmpdir(), "forkbill-paper-"));
  const htmlPath = path.join(tmp, "paper.html");
  await writeFile(htmlPath, paperHtml(md));
  const out = path.join(docs, "paper.pdf");
  await withPage(browser, {}, async (page) => {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: out,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;text-align:center;font-family:Georgia,serif;font-size:8.5pt;color:#4a514c;"><span class="pageNumber"></span></div>',
      margin: { top: "22mm", bottom: "22mm", left: "20mm", right: "20mm" },
      tagged: true,
      outline: true,
    });
  });
  await rm(tmp, { recursive: true, force: true });
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}

async function buildDeck(browser) {
  const src = path.join(here, "deck.html");
  const out = path.join(docs, "deck.pdf");
  await withPage(browser, { viewport: { width: 1280, height: 720 } }, async (page) => {
    await page.goto(pathToFileURL(src).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll(".slide")].flatMap((s, i) => {
        const box = s.getBoundingClientRect();
        const bad = [...s.querySelectorAll("*")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > box.right + 0.5 || r.bottom > box.bottom + 0.5 || r.left < box.left - 0.5);
        });
        return s.scrollHeight > s.clientHeight + 1 || bad.length ? [`slide ${i + 1}`] : [];
      }),
    );
    if (overflow.length) throw new Error(`content overflows: ${overflow.join(", ")}`);
    await page.pdf({ path: out, printBackground: true, preferCSSPageSize: true, tagged: true });
    if (pngDir) {
      const slides = await page.$$(".slide");
      for (const [i, el] of slides.entries()) {
        await el.screenshot({ path: path.join(pngDir, `deck-${String(i + 1).padStart(2, "0")}.png`) });
      }
    }
  });
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}

const browser = await chromium.launch();
try {
  if (pngDir) await mkdir(pngDir, { recursive: true });
  if (want("paper")) await buildPaper(browser);
  if (want("deck")) await buildDeck(browser);
} finally {
  await browser.close();
}
