import { useEffect, useRef, type ComponentType } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { RouterProvider, useRouter } from "./router";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { routeFor } from "./routes";
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
import NotFound from "../pages/NotFound";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export const PAGES: Record<string, ComponentType> = {
  "/": Home,
  "/live": Live,
  "/how-it-works": HowItWorks,
  "/why-flagsmith": WhyFlagsmith,
  "/method": Method,
  "/results": Results,
  "/flagsmith": FlagsmithUses,
  "/proof": Proof,
  "/kit": Kit,
  "/timeline": Timeline,
  "/decisions": Decisions,
  "/glossary": Glossary,
  "/faq": Faq,
  "/experiment-2": Experiment2,
  "/rollout": Rollout,
  "/paper": Paper,
  "/verify": Verify,
  "/use-it": UseIt,
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
                  post.parentElement?.classList.toggle("is-off", self.progress > 0.985);
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
      <div className="km-rail" aria-hidden="true">
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
