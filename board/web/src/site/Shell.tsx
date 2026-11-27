import { useEffect, useRef, type ComponentType } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { RouterProvider, useRouter } from "./router";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { routeFor } from "./routes";
import { PartContext } from "./ui";
import { chainage, initSmoothScroll } from "./scroll";
import { initPointerFx } from "./fx";
import Home from "../pages/Home";
import Live from "../pages/Live";
import HowItWorks from "../pages/HowItWorks";
import WhyFlagsmith from "../pages/WhyFlagsmith";
import Method from "../pages/Method";
import Results from "../pages/Results";
import FlagsmithUses from "../pages/FlagsmithUses";
import Proof from "../pages/Proof";
import Kit from "../pages/Kit";
import Timeline from "../pages/Timeline";
import Decisions from "../pages/Decisions";
import Glossary from "../pages/Glossary";
import Faq from "../pages/Faq";
import Experiment2 from "../pages/Experiment2";
import Rollout from "../pages/Rollout";
import Paper from "../pages/Paper";
import Verify from "../pages/Verify";
import UseIt from "../pages/UseIt";
import Updates from "../pages/Updates";
import Scale from "../pages/Scale";
import Different from "../pages/Different";
import Research from "../pages/Research";
import NotFound from "../pages/NotFound";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** One page made of a host page and the pages folded into it, with a short contents line on top. */
function merged(host: ComponentType, hostLabel: string, parts: { C: ComponentType; id: string; label: string }[]): ComponentType {
  const Host = host;
  return function Merged() {
    return (
      <>
        <nav className="parts-nav" aria-label="Parts of this page">
          <span>On this page</span>
          <a href="#main">{hostLabel}</a>
          {parts.map((p) => (
            <a key={p.id} href={`#${p.id}`}>
              {p.label}
            </a>
          ))}
        </nav>
        <Host />
        {parts.map(({ C, id }, i) => (
          <div className="part" key={id}>
            <PartContext.Provider value={{ id, n: i + 2 }}>
              <C />
            </PartContext.Provider>
          </div>
        ))}
      </>
    );
  };
}

export const PAGES: Record<string, ComponentType> = {
  "/": Home,
  "/live": Live,
  "/results": merged(Results, "The results", [{ C: Rollout, id: "end-experiment", label: "The rollout on the same flag" }]),
  "/experiment-2": Experiment2,
  "/method": merged(Method, "The method", [{ C: HowItWorks, id: "how-it-works", label: "How the agent works" }]),
  "/flagsmith": merged(WhyFlagsmith, "Why Flagsmith is the core", [{ C: FlagsmithUses, id: "features", label: "Every feature used" }]),
  "/different": Different,
  "/scale": Scale,
  "/verify": merged(Verify, "Check it in your browser", [{ C: Proof, id: "run-receipt", label: "The receipt and the commands" }]),
  "/research": merged(Research, "The research", [{ C: Paper, id: "paper", label: "The paper and the deck" }]),
  "/timeline": merged(Timeline, "The timeline", [{ C: Decisions, id: "decisions", label: "Every decision" }]),
  "/use-it": merged(UseIt, "Getting started", [{ C: Kit, id: "kit", label: "The kit in detail" }]),
  "/faq": merged(Faq, "Questions", [{ C: Glossary, id: "glossary", label: "Glossary" }]),
  "/updates": Updates,
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
        const main = document.getElementById("main");
        gsap.fromTo(".lane-rail-paint", { scaleY: 0 }, { scaleY: 1, ease: "none", scrollTrigger: { trigger: main, start: "top top", end: "bottom bottom", scrub: 0.6 } });
        // A kilometre post rides the painted line and reads how far down the page the reader is.
        const text = main?.querySelector<HTMLElement>(".km-text");
        const post = main?.querySelector<HTMLElement>(".km-post");
        if (post && main) {
          gsap.fromTo(
            post,
            { y: 0 },
            {
              y: () => Math.max(0, window.innerHeight - 220),
              ease: "none",
              scrollTrigger: {
                trigger: main,
                start: "top top",
                end: "bottom bottom",
                scrub: 0.6,
                invalidateOnRefresh: true,
                onUpdate: (self) => {
                  const next = chainage(window.scrollY);
                  if (text && text.textContent !== next) text.textContent = next;
                  // The post belongs to the page's road; it steps aside before the footer's own road.
                  post.parentElement?.classList.toggle("is-off", self.progress < 0.004 || self.progress > 0.985);
                },
              },
            },
          );
        }
      });
    },
    { scope: rail, dependencies: [route.path], revertOnUpdate: true },
  );

  return (
    <main id="main" tabIndex={-1} data-page={route.path === "/" ? "home" : route.path.slice(1)}>
      <div className="lane-rail" ref={rail} aria-hidden="true">
        <span className="lane-rail-paint" />
      </div>
      <div className="km-rail is-off" aria-hidden="true">
        <span className="km-post">
          <i />
          <b className="km-text">km 0+000</b>
        </span>
      </div>
      <P key={route.path} />
    </main>
  );
}

export function Site({ path }: { path: string }) {
  // One smooth-scroll loop and one set of pointer effects for the whole site, on capable devices only.
  useEffect(() => {
    const stopScroll = initSmoothScroll();
    const stopFx = initPointerFx();
    return () => {
      stopFx();
      stopScroll();
    };
  }, []);
  return (
    <RouterProvider initialPath={path}>
      <Header />
      <Page />
      <Footer />
    </RouterProvider>
  );
}
