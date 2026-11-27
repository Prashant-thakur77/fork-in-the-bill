import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error plain ESM build script without types
import { loadRepoData, REPO_ROOT } from "./scripts/repo-data.mjs";

const VIRTUAL = "virtual:repo-data";

/** Exposes the build-time read of the repository (scripts/repo-data.mjs) as a module. */
function repoData(): Plugin {
  return {
    name: "repo-data",
    resolveId(id) {
      return id === VIRTUAL ? `\0${VIRTUAL}` : null;
    },
    load(id) {
      if (id !== `\0${VIRTUAL}`) return null;
      return `export default ${JSON.stringify(loadRepoData(REPO_ROOT))};`;
    },
    configureServer(server) {
      // Rebuild the data when a source file the site quotes changes.
      server.watcher.add([resolve(REPO_ROOT, "analysis/out"), resolve(REPO_ROOT, "prereg"), resolve(REPO_ROOT, "DECISIONS.md"), resolve(REPO_ROOT, "PROGRESS.md")]);
      server.watcher.on("change", (f) => {
        if (!f.includes("/board/web/")) {
          const mod = server.moduleGraph.getModuleById(`\0${VIRTUAL}`);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
      });
    },
  };
}

/** `vite preview` serves the prerendered pages the way the Worker's asset handler does. */
function cleanUrls(): Plugin {
  return {
    name: "clean-urls",
    configurePreviewServer(server) {
      const dist = resolve(process.cwd(), "dist");
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "/").split("?")[0]!;
        if (url === "/" || /\.[a-z0-9]+$/i.test(url)) return next();
        const clean = url.replace(/\/$/, "");
        if (existsSync(resolve(dist, `.${clean}.html`))) {
          req.url = `${clean}.html${req.url!.slice(url.length)}`;
          return next();
        }
        res.statusCode = 404;
        req.url = "/404.html";
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), repoData(), cleanUrls()],
  build: { target: "es2022", sourcemap: false },
  server: { fs: { allow: [REPO_ROOT] } },
  preview: { headers: { "Cache-Control": "no-store" } },
});
