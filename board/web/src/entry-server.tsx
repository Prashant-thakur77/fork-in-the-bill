import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { Site } from "./site/Shell";
import { ROUTES, NOT_FOUND, docTitle, slugOf } from "./site/routes";
import { repo } from "./site/data";
import { markSvg } from "./site/Logo";
import { rasterize, GLYPH_ROWS } from "./led/font";

export { ROUTES, NOT_FOUND, docTitle, slugOf, repo, markSvg, rasterize, GLYPH_ROWS };

export function render(path: string): string {
  return renderToString(
    <StrictMode>
      <Site path={path} />
    </StrictMode>,
  );
}
