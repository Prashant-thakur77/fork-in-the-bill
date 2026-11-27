import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "@fontsource-variable/overpass/wght.css";
import "@fontsource/overpass-mono/400.css";
import "@fontsource/overpass-mono/600.css";
import "./styles.css";
import "./site/site.css";
import "./site/pages.css";
import "./site/round2.css";
import "./site/play.css";
import "./site/live.css";
import "./site/results.css";
import { Site } from "./site/Shell";

const root = document.getElementById("root")!;
// The prerendered page is in #root already. The 404 page is served at any unknown path, so it
// names its own route.
const path = root.dataset.route ?? window.location.pathname;
const app = (
  <StrictMode>
    <Site path={path} />
  </StrictMode>
);
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
