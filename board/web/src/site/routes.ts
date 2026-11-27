// Every page of the site. The prerender step writes one HTML file per entry; the header, menu,
// footer, sitemap and share images all read this list.

export type MenuGroup = "experiment" | "flagsmith" | "evidence" | "use";

export interface Route {
  path: string;
  /** Short label for nav and breadcrumbs. */
  label: string;
  /** Document title (the site name is appended). */
  title: string;
  /** Meta description and share text: one plain sentence. */
  description: string;
  /** Where it sits in the header: "main" links show beside the logo on wide screens. */
  group: "home" | "main" | "more" | "none";
  /** Its group in the menu and the footer. */
  menu?: MenuGroup;
  /** One short line under the label in the menu. */
  blurb?: string;
  /** Exit number on the page sign, like a motorway junction. Filled in below, in order. */
  exit: string;
}

type Draft = Omit<Route, "exit">;

const DRAFTS: Draft[] = [
  {
    path: "/",
    label: "Home",
    title: "Fork in the Bill",
    description:
      "A pre-registered A/B test of a coding agent's model routing, run as a Flagsmith experiment on real bug fixes and measured in dollars per task.",
    group: "home",
  },
  /* ---- the experiment ---- */
  {
    path: "/live",
    label: "Live board",
    title: "Live board",
    description: "What each arm has spent and solved: experiment 2 as it runs, experiment 1 and the rollout batch as they finished.",
    group: "main",
    menu: "experiment",
    blurb: "Both lanes, as the run goes",
  },
  {
    path: "/results",
    label: "Results",
    title: "Results",
    description: "The verdict of experiment 1, what ending it did to the flag and the batch that ran after, and experiment 2 as it stands, each read from the analysis output.",
    group: "main",
    menu: "experiment",
    blurb: "Experiment 1, and the rollout",
  },
  {
    path: "/experiment-2",
    label: "Experiment 2",
    title: "Experiment 2: who writes the first draft",
    description: "The second experiment, running now: the rolled-out winner against a lane where the small model drafts the patch and the frontier model reviews it.",
    group: "more",
    menu: "experiment",
    blurb: "Running now, registered first",
  },
  {
    path: "/method",
    label: "Method",
    title: "Method",
    description: "The pre-registration, the decision rule, the margin, power and the task pools, and how the two-lane agent under test works.",
    group: "main",
    menu: "experiment",
    blurb: "The rule, and the agent",
  },
  /* ---- the case for it ---- */
  {
    path: "/flagsmith",
    label: "Flagsmith",
    title: "Flagsmith, the core",
    description: "Flagsmith picks every arm, records every exposure, measures the result and rolls out the winner. Why the experiment cannot run without it, and every feature used, with the code.",
    group: "main",
    menu: "flagsmith",
    blurb: "Why it is the core, feature by feature",
  },
  {
    path: "/different",
    label: "How this is different",
    title: "How this is different",
    description: "How claims about model routing are usually supported, beside what this project did, row by row, with the evidence for each.",
    group: "more",
    menu: "flagsmith",
    blurb: "The usual way, and this one",
  },
  {
    path: "/scale",
    label: "By the numbers",
    title: "By the numbers",
    description: "How big the study is: task attempts, test results, model calls, tokens, dollars, ledger records and lines of code, each counted from the repository.",
    group: "more",
    menu: "flagsmith",
    blurb: "Every count, from the repo",
  },
  /* ---- evidence ---- */
  {
    path: "/verify",
    label: "Verify",
    title: "Verify it yourself",
    description: "Check a real run ledger and one task's proof in your browser, then the run receipt and the exact commands for every other check.",
    group: "more",
    menu: "evidence",
    blurb: "In your browser, then the commands",
  },
  {
    path: "/research",
    label: "Research and paper",
    title: "From the research to the code",
    description: "One card per published source the project uses, with what it produces here, then the paper and the deck to read or download.",
    group: "more",
    menu: "evidence",
    blurb: "Each source, then the write-up",
  },
  {
    path: "/timeline",
    label: "Timeline and decisions",
    title: "Run timeline",
    description: "Every phase of the study with its evidence, then every design decision and why it was made.",
    group: "more",
    menu: "evidence",
    blurb: "What happened, and why",
  },
  /* ---- use it ---- */
  {
    path: "/use-it",
    label: "Use it",
    title: "Use it in your project",
    description: "Step by step: put your own agent on a Flagsmith experiment with the forkbill kit or the MCP server, then the kit in detail.",
    group: "more",
    menu: "use",
    blurb: "Step by step, then in detail",
  },
  {
    path: "/faq",
    label: "Questions",
    title: "Questions, answers and terms",
    description: "Power, the margin chosen after the pilot, tasks the models may have seen, why Flagsmith and what it cost, then plain definitions of every term.",
    group: "more",
    menu: "evidence",
    blurb: "Honest answers, plain terms",
  },
  {
    path: "/updates",
    label: "Updates",
    title: "Get the next write-up",
    description: "Leave an email address and get one message when the experiment 2 write-up is published, or when the kit is on npm.",
    group: "more",
    menu: "use",
    blurb: "One email, when it ships",
  },
];

// Pages that were folded into another page. Their titles and purpose lines head their part of
// that page; their old addresses redirect (public/_redirects).
const PART_DRAFTS: Draft[] = [
  {
    path: "/flagsmith-features",
    label: "Flagsmith features",
    title: "Every Flagsmith feature used",
    description: "Experiments, exposures, events, the kill switch, rollout, flag-engine checks, Terraform, webhooks, feature health, Edge Proxy, OpenFeature and self-hosting.",
    group: "none",
  },
  {
    path: "/rollout",
    label: "Rollout",
    title: "Rollout on the same flag",
    description: "What ending the experiment did to the flag, and the fresh batch that ran on it with no code change.",
    group: "none",
    menu: "experiment",
    blurb: "What End Experiment did",
  },
  {
    path: "/how-it-works",
    label: "How it works",
    title: "How the agent works",
    description: "The two-lane coding agent: a planner that writes the fix and a worker that does the grunt work, with caps and grading.",
    group: "none",
    menu: "experiment",
    blurb: "Planner lane, worker lane",
  },
  {
    path: "/why-flagsmith",
    label: "Why Flagsmith",
    title: "Why Flagsmith is the core",
    description: "Flagsmith picks every arm, records every exposure, measures the result and rolls out the winner. Without it the experiment cannot be checked.",
    group: "none",
    menu: "flagsmith",
    blurb: "It picks every arm",
  },
  {
    path: "/proof",
    label: "Proof",
    title: "Proof the run was not edited",
    description: "The run receipt and the exact commands to check the ledger, the Merkle root, the flag snapshots and every arm assignment yourself.",
    group: "none",
    menu: "evidence",
    blurb: "The receipt and the commands",
  },
  {
    path: "/paper",
    label: "Paper",
    title: "The paper and the deck",
    description: "The write-up of experiment 1 as a paper and a slide deck: read the summary and the figures here, or download the PDFs.",
    group: "none",
    menu: "evidence",
    blurb: "Read it or download it",
  },
  {
    path: "/decisions",
    label: "Decisions",
    title: "Design decisions",
    description: "Every design choice made while building and running the experiments, and why it was made.",
    group: "none",
    menu: "evidence",
    blurb: "Every choice, with the reason",
  },
  {
    path: "/glossary",
    label: "Glossary",
    title: "Glossary",
    description: "Plain definitions of the terms used on this site: arm, identity, exposure, guardrail, margin, SRM, Merkle root and more.",
    group: "none",
    menu: "use",
    blurb: "Plain definitions",
  },
  {
    path: "/kit",
    label: "Kit",
    title: "Run it on your own agent",
    description: "The forkbill kit for Python and TypeScript: a routed-lane agent loop driven by a Flagsmith experiment, on Cloud or self-hosted.",
    group: "none",
    menu: "use",
    blurb: "The kit, in detail",
  },
];

/** Where each folded page went: the page it is part of and the anchor of its part. */
export const MOVED: Record<string, { to: string; anchor: string }> = {
  "/rollout": { to: "/results", anchor: "end-experiment" },
  "/how-it-works": { to: "/method", anchor: "how-it-works" },
  "/why-flagsmith": { to: "/flagsmith", anchor: "" },
  "/proof": { to: "/verify", anchor: "run-receipt" },
  "/paper": { to: "/research", anchor: "paper" },
  "/decisions": { to: "/timeline", anchor: "decisions" },
  "/glossary": { to: "/faq", anchor: "glossary" },
  "/kit": { to: "/use-it", anchor: "kit" },
};

export const ROUTES: Route[] = DRAFTS.map((r, i) => ({ ...r, exit: String(i) }));

export const PARTS: Route[] = PART_DRAFTS.map((r) => ({ ...r, exit: "" }));

export const MENU_GROUPS: { key: MenuGroup; title: string; line: string }[] = [
  { key: "experiment", title: "The experiment", line: "What was tested and what came out" },
  { key: "flagsmith", title: "The case", line: "Why it holds, and how big it is" },
  { key: "evidence", title: "Evidence", line: "Check it, do not trust it" },
  { key: "use", title: "Use it", line: "Run it on your own agent" },
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

/** Title and purpose of a page or of a part that was folded into one. Not for routing. */
export function pageMeta(path: string): Route {
  const p = normalize(path);
  return ROUTES.find((r) => r.path === p) ?? PARTS.find((r) => r.path === p) ?? NOT_FOUND;
}

export const SITE_NAME = "Fork in the Bill";

export function docTitle(r: Route): string {
  return r.path === "/" ? `${SITE_NAME}: an A/B test on a coding agent's bill` : `${r.title} · ${SITE_NAME}`;
}

export function slugOf(r: Route): string {
  return r.path === "/" ? "home" : r.path.slice(1);
}
