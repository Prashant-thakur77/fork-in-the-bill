// Every page of the site. The prerender step writes one HTML file per entry; the header, menu,
// footer, sitemap and share images all read this list.

export interface Route {
  path: string;
  /** Short label for nav and breadcrumbs. */
  label: string;
  /** Document title (the site name is appended). */
  title: string;
  /** Meta description and share text: one plain sentence. */
  description: string;
  /** Where it sits in navigation. */
  group: "home" | "main" | "more" | "none";
  /** Footer column. */
  column?: "experiment" | "evidence" | "build";
  /** Exit number on the page sign, like a motorway junction. */
  exit: string;
}

export const ROUTES: Route[] = [
  {
    path: "/",
    label: "Home",
    title: "Fork in the Bill",
    description:
      "A pre-registered A/B test of a coding agent's model routing, run as a Flagsmith experiment on real bug fixes and measured in dollars per task.",
    group: "home",
    exit: "0",
  },
  {
    path: "/live",
    label: "Live board",
    title: "Live board",
    description: "What each arm of the experiment has spent and solved so far, live from the run.",
    group: "main",
    column: "experiment",
    exit: "1",
  },
  {
    path: "/how-it-works",
    label: "How it works",
    title: "How the agent works",
    description: "The two-lane coding agent: a planner that writes the fix and a worker that does the grunt work, with caps and grading.",
    group: "main",
    column: "experiment",
    exit: "2",
  },
  {
    path: "/why-flagsmith",
    label: "Why Flagsmith",
    title: "Why Flagsmith is the core",
    description: "Flagsmith picks every arm, records every exposure, measures the result and rolls out the winner. Without it the experiment cannot be checked.",
    group: "main",
    column: "experiment",
    exit: "3",
  },
  {
    path: "/method",
    label: "Method",
    title: "Method",
    description: "The pre-registration, the decision rule, the margin, power, the task pools and what changed after the pilot.",
    group: "main",
    column: "experiment",
    exit: "4",
  },
  {
    path: "/results",
    label: "Results",
    title: "Results",
    description: "The verdict of experiment 1 and experiment 2, filled in by the analysis script when the run ends.",
    group: "main",
    column: "experiment",
    exit: "5",
  },
  {
    path: "/flagsmith",
    label: "Flagsmith features",
    title: "Every Flagsmith feature used",
    description: "Experiments, exposures, events, the kill switch, rollout, flag-engine checks, Terraform, webhooks, feature health, Edge Proxy, OpenFeature and self-hosting.",
    group: "more",
    column: "build",
    exit: "6",
  },
  {
    path: "/proof",
    label: "Proof",
    title: "Proof the run was not edited",
    description: "The run receipt and the exact commands to check the ledger, the Merkle root, the flag snapshots and every arm assignment yourself.",
    group: "more",
    column: "evidence",
    exit: "7",
  },
  {
    path: "/kit",
    label: "Kit",
    title: "Run it on your own agent",
    description: "The forkbill kit for Python and TypeScript: a routed-lane agent loop driven by a Flagsmith experiment, on Cloud or self-hosted.",
    group: "more",
    column: "build",
    exit: "8",
  },
  {
    path: "/timeline",
    label: "Timeline",
    title: "Run timeline",
    description: "Every phase of the study, from the Flagsmith smoke test to the second experiment, with the evidence for each.",
    group: "more",
    column: "evidence",
    exit: "9",
  },
  {
    path: "/decisions",
    label: "Decisions",
    title: "Design decisions",
    description: "Every design choice made while building and running the experiments, and why it was made.",
    group: "more",
    column: "evidence",
    exit: "10",
  },
  {
    path: "/glossary",
    label: "Glossary",
    title: "Glossary",
    description: "Plain definitions of the terms used on this site: arm, identity, exposure, guardrail, margin, SRM, Merkle root and more.",
    group: "more",
    column: "build",
    exit: "11",
  },
  {
    path: "/faq",
    label: "Questions",
    title: "Questions and honest answers",
    description: "Power, the margin chosen after the pilot, tasks the models may have seen, why Flagsmith, and what the study cost to run.",
    group: "more",
    column: "evidence",
    exit: "12",
  },
];

export const NOT_FOUND: Route = {
  path: "/404",
  label: "Wrong exit",
  title: "Wrong exit",
  description: "This page does not exist.",
  group: "none",
  exit: "?",
};

export function normalize(path: string): string {
  const p = path.split(/[?#]/)[0] || "/";
  return p.length > 1 ? p.replace(/\/+$/, "") : "/";
}

export function routeFor(path: string): Route {
  const p = normalize(path);
  return ROUTES.find((r) => r.path === p) ?? NOT_FOUND;
}

export const SITE_NAME = "Fork in the Bill";

export function docTitle(r: Route): string {
  return r.path === "/" ? `${SITE_NAME}: an A/B test on a coding agent's bill` : `${r.title} · ${SITE_NAME}`;
}

export function slugOf(r: Route): string {
  return r.path === "/" ? "home" : r.path.slice(1);
}
