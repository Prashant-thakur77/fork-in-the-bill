import { useRef, type ComponentType } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { RouterProvider, useRouter } from "./router";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { routeFor } from "./routes";
import Live from "../pages/Live";
import NotFound from "../pages/NotFound";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export const PAGES: Record<string, ComponentType> = {
  "/live": Live,
  "/404": NotFound,
};

function Page() {
  const { path } = useRouter();
  const route = routeFor(path);
  const P = PAGES[route.path] ?? NotFound;
  const rail = useRef<HTMLDivElement>(null);

  // A painted lane line down the left edge that draws as the page is read.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference) and (min-width: 1100px)", () => {
        gsap.fromTo(
          ".lane-rail-paint",
          { scaleY: 0 },
          { scaleY: 1, ease: "none", scrollTrigger: { trigger: document.getElementById("main"), start: "top top", end: "bottom bottom", scrub: 0.6 } },
        );
      });
    },
    { scope: rail, dependencies: [route.path], revertOnUpdate: true },
  );

  return (
    <main id="main" tabIndex={-1} data-page={route.path === "/" ? "home" : route.path.slice(1)}>
      <div className="lane-rail" ref={rail} aria-hidden="true">
        <span className="lane-rail-paint" />
      </div>
      <P key={route.path} />
    </main>
  );
}

export function Site({ path }: { path: string }) {
  return (
    <RouterProvider initialPath={path}>
      <Header />
      <Page />
      <Footer />
    </RouterProvider>
  );
}
