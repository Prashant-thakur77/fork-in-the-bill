#!/usr/bin/env node
// After `vite build` (client) and `vite build --ssr` (server entry): writes one static HTML file
// per route with its content, title, description and share tags, so every page reads without
// JavaScript and deep links work on reload. Also writes the share images, favicons, sitemap
// and robots file. The Worker's asset handler serves /x from x.html and unknown paths from 404.html.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../dist");
const ssrDir = resolve(here, "../dist-ssr");
const ssrEntry = readdirSync(ssrDir).find((f) => /^entry-server\.(m?js)$/.test(f));
const ssr = await import(pathToFileURL(join(ssrDir, ssrEntry)).href);
const { render, ROUTES, NOT_FOUND, docTitle, slugOf, repo, markSvg, rasterize, GLYPH_ROWS } = ssr;

const template = readFileSync(join(dist, "index.html"), "utf8");
const site = (repo.site.url || "").replace(/\/$/, "");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// The latin Overpass face is the one every page needs first.
const assets = readdirSync(join(dist, "assets"));
const fontFile = assets.find((f) => /^overpass-latin-wght-normal.*\.woff2$/.test(f));

/* ---------- share images: a guide sign with the page title on an LED panel ---------- */

function ledRows(text, maxCols) {
  const words = text.toUpperCase().split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (rasterize(next).length > maxCols && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function ledSvg(lines, x, y, w, color = "#FFB21A") {
  const maxCols = Math.max(...lines.map((l) => rasterize(l).length));
  const pitch = Math.min(14, w / (maxCols + 2));
  const r = pitch * 0.36;
  let dots = "";
  lines.forEach((line, li) => {
    const bmp = rasterize(line);
    const ox = x + (w - bmp.length * pitch) / 2;
    const oy = y + li * (GLYPH_ROWS + 3) * pitch;
    bmp.forEach((col, cx) =>
      col.forEach((on, cy) => {
        if (on) dots += `<circle cx="${(ox + (cx + 0.5) * pitch).toFixed(1)}" cy="${(oy + (cy + 0.5) * pitch).toFixed(1)}" r="${r.toFixed(2)}" fill="${color}"/>`;
      }),
    );
  });
  const h = (lines.length * (GLYPH_ROWS + 3) - 3) * pitch;
  return { dots, h, pitch };
}

function ogSvg(route) {
  const W = 1200;
  const H = 630;
  const title = route.path === "/" ? "Two lanes. One bill." : route.title;
  const lines = ledRows(title.replace(/[.]/g, "").replace(/:/g, ""), 86);
  const panelX = 140;
  const panelW = 920;
  const led = ledSvg(lines, panelX + 30, 0, panelW - 60);
  const panelH = led.h + 70;
  const panelY = 300 - panelH / 2 + 30;
  const placed = ledSvg(lines, panelX + 30, panelY + 35, panelW - 60);
  const mark = markSvg(96).replace("<svg ", `<svg x="110" y="${panelY - 150}" `);
  // pale unlit dots behind the lit ones, like a real panel
  const host = (site || "").replace(/^https?:\/\//, "").toUpperCase();
  const hostLed = host ? ledSvg([host], 140, 560, 920, "#C8C5BA") : { dots: "" };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ECEAE3"/>
  <rect x="0" y="40" width="${W}" height="10" fill="#9EA19B"/>
  <rect x="300" y="50" width="8" height="${panelY - 150 - 50 + 10}" fill="#9EA19B"/>
  <rect x="892" y="50" width="8" height="${panelY - 150 - 50 + 10}" fill="#9EA19B"/>
  <rect x="80" y="${panelY - 170}" width="1040" height="${panelH + 230}" rx="24" fill="#0B6B45"/>
  <rect x="92" y="${panelY - 158}" width="1016" height="${panelH + 206}" rx="16" fill="none" stroke="#F4F5EF" stroke-width="6"/>
  ${mark}
  <rect x="236" y="${panelY - 120}" width="${route.exit.length * 28 + 120}" height="56" rx="8" fill="#EDBB2C"/>
  ${ledSvg([`EXIT ${route.exit}`], 248, panelY - 108, route.exit.length * 28 + 96, "#1B211E").dots}
  <rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="10" fill="#141716"/>
  ${placed.dots}
  ${hostLed.dots}
</svg>`;
}

function png(svg, width) {
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } }).render().asPng();
}

mkdirSync(join(dist, "og"), { recursive: true });

/* ---------- pages ---------- */

const pages = [...ROUTES, NOT_FOUND];
for (const r of pages) {
  const slug = slugOf(r);
  const isMissing = r === NOT_FOUND;
  const url = isMissing ? site : `${site}${r.path === "/" ? "/" : r.path}`;
  const ogUrl = `${site}/og/${isMissing ? "home" : slug}.png`;
  if (!isMissing) writeFileSync(join(dist, "og", `${slug}.png`), png(ogSvg(r), 1200));
  const title = docTitle(r);
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(r.description)}" />`,
    isMissing ? `<meta name="robots" content="noindex" />` : `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Fork in the Bill" />`,
    `<meta property="og:title" content="${esc(r.path === "/" ? "Fork in the Bill" : r.title)}" />`,
    `<meta property="og:description" content="${esc(r.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${ogUrl}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(`${r.title}: a green motorway sign with the title on an amber LED panel`)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(r.title)}" />`,
    `<meta name="twitter:description" content="${esc(r.description)}" />`,
    `<meta name="twitter:image" content="${ogUrl}" />`,
    fontFile ? `<link rel="preload" href="/assets/${fontFile}" as="font" type="font/woff2" crossorigin />` : "",
  ]
    .filter(Boolean)
    .join("\n    ");
  const body = render(r.path);
  const html = template
    .replace(/<title>[\s\S]*?<\/title>\s*/, "")
    .replace(/<meta name="description"[^>]*>\s*/, "")
    .replace("<!--head-->", head)
    .replace('<div id="root"></div>', `<div id="root"${isMissing ? ' data-route="/404"' : ""}>${body}</div>`);
  const file = r.path === "/" ? "index.html" : isMissing ? "404.html" : `${r.path.slice(1)}.html`;
  writeFileSync(join(dist, file), html);
}

/* ---------- files the pages link to: the paper, the deck, the figures, the ledger to verify ---------- */

const { REPO_ROOT, ledgerGz } = await import("./repo-data.mjs");
const copy = (from, to) => {
  const src = join(REPO_ROOT, from);
  if (!existsSync(src)) return false;
  mkdirSync(dirname(join(dist, to)), { recursive: true });
  copyFileSync(src, join(dist, to));
  return true;
};
copy("docs/paper.pdf", "downloads/fork-in-the-bill-paper.pdf");
copy("docs/deck.pdf", "downloads/fork-in-the-bill-deck.pdf");
for (const f of repo.charts ?? []) copy(`analysis/charts/${f}`, `figures/${f}`);
for (const shot of Object.values(repo.shots ?? {})) copy(`docs/img/${shot.file}`, `img/${shot.file}`);
if (repo.verifyLedger) {
  mkdirSync(join(dist, "data"), { recursive: true });
  writeFileSync(join(dist, "data", `${repo.verifyLedger.run}-ledger.jsonl.gz`), ledgerGz(REPO_ROOT, repo.verifyLedger.run));
}

/* ---------- favicons, manifest, sitemap, robots ---------- */

writeFileSync(join(dist, "favicon.svg"), markSvg(64));
writeFileSync(join(dist, "favicon-32.png"), png(markSvg(64), 32));
writeFileSync(join(dist, "apple-touch-icon.png"), png(markSvg(64).replace(/rx="13"/, 'rx="0"'), 180));
writeFileSync(join(dist, "icon-192.png"), png(markSvg(64), 192));
writeFileSync(join(dist, "icon-512.png"), png(markSvg(64), 512));
writeFileSync(
  join(dist, "site.webmanifest"),
  JSON.stringify(
    {
      name: "Fork in the Bill",
      short_name: "Fork Bill",
      start_url: "/",
      display: "browser",
      background_color: "#ECEAE3",
      theme_color: "#0B6B45",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    null,
    2,
  ),
);
if (site) {
  const urls = ROUTES.map((r) => `  <url><loc>${site}${r.path === "/" ? "/" : r.path}</loc></url>`).join("\n");
  writeFileSync(join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
}
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n${site ? `Sitemap: ${site}/sitemap.xml\n` : ""}`);

rmSync(ssrDir, { recursive: true, force: true });
console.log(`prerendered ${pages.length} pages, ${ROUTES.length} share images`);
