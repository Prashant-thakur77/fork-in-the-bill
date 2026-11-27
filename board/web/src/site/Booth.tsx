import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { resolveApi } from "../data/useBoard";
import { Link } from "./router";

// The updates window: a short scripted exchange, one question at a time, in the voice of a toll
// booth. It is a form, not a chat: nobody and nothing replies beyond these fixed lines. Underneath
// it is one real <form> that posts to the board worker's /waitlist; without JavaScript every
// question shows at once and the form posts as it is.

export const WANTS: { key: "writeup" | "kit" | "both"; label: string; said: string }[] = [
  { key: "writeup", label: "The experiment 2 write-up", said: "The experiment 2 write-up." },
  { key: "kit", label: "A note when the kit is on npm", said: "A note when the kit is on npm." },
  { key: "both", label: "Both", said: "Both: the write-up and the kit note." },
];
export const STACKS = ["My own loop", "LangGraph or LangChain", "A vendor's agent SDK", "No agent yet"];
const STACK_MAX = 200;

type Step = "wants" | "stack" | "email" | "sending" | "done";
type Outcome = "joined" | "already";

interface Answers {
  wants: (typeof WANTS)[number]["key"] | "";
  stack: string;
  email: string;
}

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

function BoothLine({ children, fresh }: { children: ReactNode; fresh?: boolean }) {
  return (
    <li className={`booth-line is-booth${fresh ? " is-fresh" : ""}`}>
      <span className="booth-who">Booth</span>
      <p>{children}</p>
    </li>
  );
}

function YouLine({ children, onEdit, editLabel }: { children: ReactNode; onEdit?: () => void; editLabel: string }) {
  return (
    <li className="booth-line is-you">
      <span className="booth-who">You</span>
      <p>{children}</p>
      {onEdit && (
        <button type="button" className="booth-edit" onClick={onEdit} aria-label={editLabel}>
          Change
        </button>
      )}
    </li>
  );
}

/** The confirmation: a toll ticket that reads back what was asked for. */
function Ticket({ a, outcome }: { a: Answers; outcome: Outcome }) {
  const want = WANTS.find((w) => w.key === a.wants);
  return (
    <div className="ticket-printer" data-cursor="">
      <div className="ticket-slot" aria-hidden="true" />
      <div className="ticket" role="status">
        <div className="ticket-head">
          <span>Fork in the Bill</span>
          <span>Updates list · receipt</span>
        </div>
        <p className="ticket-title">{outcome === "joined" ? "You are on the list." : "You were already on the list."}</p>
        {outcome === "joined" ? (
          <>
            {want && (
              <div className="ticket-row">
                <span>Send me</span>
                <b>{want.label}</b>
              </div>
            )}
            {a.stack && (
              <div className="ticket-row">
                <span>I run my agent on</span>
                <b>{a.stack}</b>
              </div>
            )}
            <div className="ticket-row">
              <span>To</span>
              <b>{a.email.trim().toLowerCase()}</b>
            </div>
          </>
        ) : (
          <p className="ticket-note">That address is stored once, with the answers from the first time. Nothing was changed.</p>
        )}
        <div className="ticket-cut" aria-hidden="true" />
        <p className="ticket-foot">One email for each thing you asked for, when it is published. Nothing else.</p>
        <span className={`ticket-stamp ${outcome === "already" ? "is-already" : ""}`} aria-hidden="true">
          {outcome === "joined" ? "Paid: one address" : "Already held"}
        </span>
      </div>
    </div>
  );
}

export function Booth({ source, heading = "h2" }: { source: string; heading?: "h2" | "h3" }) {
  const uid = useId();
  // Until the script runs, every question shows at once as a plain form.
  const [enhanced, setEnhanced] = useState(false);
  const [api, setApi] = useState("");
  const [step, setStep] = useState<Step>("wants");
  const [a, setA] = useState<Answers>({ wants: "", stack: "", email: "" });
  const [stackText, setStackText] = useState("");
  const [problem, setProblem] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("joined");
  const [count, setCount] = useState<number | null>(null);
  const root = useRef<HTMLFormElement>(null);
  const moved = useRef(false);
  const furthest = useRef<Step>("wants");
  const H = heading;

  useEffect(() => {
    setEnhanced(true);
    void resolveApi().then((base) => {
      setApi(base);
      // The size of the list is shown only when the server gives one (it withholds small counts).
      fetch(`${base}/waitlist/count`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { count?: number | null } | null) => {
          if (b && typeof b.count === "number" && b.count >= 10) setCount(b.count);
        })
        .catch(() => {});
    });
  }, []);

  // After an answer, focus moves to the next question's first control.
  useEffect(() => {
    if (!moved.current) return;
    const el = root.current?.querySelector<HTMLElement>(step === "done" ? ".ticket" : ".booth-now input:not([type=hidden]):not(.booth-trap), .booth-now button");
    if (step === "done") el?.setAttribute("tabindex", "-1");
    el?.focus({ preventScroll: false });
  }, [step]);

  const ORDER: Step[] = ["wants", "stack", "email", "sending", "done"];
  const go = (s: Step) => {
    moved.current = true;
    setProblem("");
    if (s === "stack" || s === "email") {
      if (ORDER.indexOf(s) > ORDER.indexOf(furthest.current)) furthest.current = s;
    }
    setStep(s);
  };

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (step === "wants" || step === "stack") return; // Enter in a text field advances its own step
    if (!looksLikeEmail(a.email)) {
      setProblem("That does not look like an email address. Check it and try again.");
      return;
    }
    go("sending");
    const trap = root.current?.querySelector<HTMLInputElement>(".booth-trap")?.value ?? "";
    try {
      const res = await fetch(`${api}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: a.email, wants: a.wants, stack: a.stack, source, website: trap }),
      });
      const body = (await res.json().catch(() => null)) as { state?: string } | null;
      if (body?.state === "joined" || body?.state === "already") {
        setOutcome(body.state);
        go("done");
        return;
      }
      go("email");
      setProblem(
        body?.state === "invalid"
          ? "That does not look like an email address. Check it and try again."
          : body?.state === "slow"
            ? "Too many tries from this connection. Wait ten minutes and try again."
            : "The list could not be reached. Nothing was stored. Try again in a minute.",
      );
    } catch {
      go("email");
      setProblem("The list could not be reached. Nothing was stored. Try again in a minute.");
    }
  }

  const want = WANTS.find((w) => w.key === a.wants);
  const past = (s: Step) => ORDER.indexOf(step) > ORDER.indexOf(s);
  const editable = step !== "sending" && step !== "done";

  return (
    <form ref={root} className={`booth ${enhanced ? "is-stepped" : "is-plain"}`} action={`${api}/waitlist`} method="post" onSubmit={send} noValidate={enhanced} data-step={step}>
      <div className="booth-head">
        <span className="booth-lamp" aria-hidden="true" />
        <H className="booth-title">Updates window</H>
        <span className="booth-note">A short form in three questions. Nobody is typing back.</span>
      </div>
      <input type="hidden" name="source" value={source} />
      {/* A field people never see or reach. Anything in it marks the sender as a script. */}
      <div className="booth-trap-wrap" aria-hidden="true">
        <label htmlFor={`${uid}-w`}>Leave this empty</label>
        <input id={`${uid}-w`} className="booth-trap" type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      {enhanced && (
        <ol className="booth-log" role="log" aria-live="polite" aria-label="The exchange so far">
          <BoothLine>
            You can get one email when the experiment 2 write-up is published, and one when the kit is on npm. {count !== null ? `${count} people are on the list. ` : ""}What
            should we send you?
          </BoothLine>
          {past("wants") && want && (
            <YouLine onEdit={editable ? () => go("wants") : undefined} editLabel="Change what to send">
              {want.said}
            </YouLine>
          )}
          {past("wants") && <BoothLine fresh={step === "stack"}>Noted. What do you run your agent on? You can skip this one.</BoothLine>}
          {past("stack") && (
            <YouLine onEdit={editable ? () => go("stack") : undefined} editLabel="Change what you run your agent on">
              {a.stack || "Skipped."}
            </YouLine>
          )}
          {past("stack") && <BoothLine fresh={step === "email"}>Last one. Where should we send it?</BoothLine>}
          {past("email") && (
            <YouLine onEdit={editable ? () => go("email") : undefined} editLabel="Change the email address">
              {a.email.trim()}
            </YouLine>
          )}
          {step === "sending" && <BoothLine fresh>Printing your receipt…</BoothLine>}
          {step === "done" && <BoothLine fresh>{outcome === "joined" ? "Done. Here is your receipt." : "That address was already on the list. Here is the receipt."}</BoothLine>}
        </ol>
      )}

      <div className="booth-now">
        <fieldset className="booth-q" hidden={enhanced && step !== "wants"}>
          <legend className={enhanced ? "sr-only" : undefined}>What should we send you?</legend>
          <div className="booth-choices" role={enhanced ? "group" : undefined} aria-label={enhanced ? "What to send" : undefined}>
            {WANTS.map((w, i) =>
              enhanced ? (
                <button
                  key={w.key}
                  type="button"
                  className={`booth-choice ${a.wants === w.key ? "is-on" : ""}`}
                  aria-pressed={a.wants === w.key}
                  data-cursor="pick"
                  onClick={() => {
                    setA((x) => ({ ...x, wants: w.key }));
                    // After a change, go back to the furthest question already reached.
                    go(furthest.current === "email" ? "email" : "stack");
                  }}
                >
                  {w.label}
                </button>
              ) : (
                <label key={w.key} className="booth-radio">
                  <input type="radio" name="wants" value={w.key} defaultChecked={i === 2} /> {w.label}
                </label>
              ),
            )}
          </div>
          {enhanced && <input type="hidden" name="wants" value={a.wants} />}
        </fieldset>

        <fieldset className="booth-q" hidden={enhanced && step !== "stack"}>
          <legend className={enhanced ? "sr-only" : undefined}>What do you run your agent on? (optional)</legend>
          <div className="booth-choices" role={enhanced ? "group" : undefined} aria-label={enhanced ? "What you run your agent on" : undefined}>
            {STACKS.map((s) =>
              enhanced ? (
                <button
                  key={s}
                  type="button"
                  className={`booth-choice ${a.stack === s ? "is-on" : ""}`}
                  aria-pressed={a.stack === s}
                  data-cursor="pick"
                  onClick={() => {
                    setA((x) => ({ ...x, stack: s }));
                    setStackText("");
                    go("email");
                  }}
                >
                  {s}
                </button>
              ) : (
                <label key={s} className="booth-radio">
                  <input type="radio" name="stack_choice" value={s} /> {s}
                </label>
              ),
            )}
          </div>
          <div className="booth-field">
            <label htmlFor={`${uid}-s`}>Or say it in your own words</label>
            <div className="booth-row">
              <input
                id={`${uid}-s`}
                type="text"
                name="stack"
                maxLength={STACK_MAX}
                autoComplete="off"
                value={stackText}
                onChange={(e) => setStackText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setA((x) => ({ ...x, stack: stackText.trim().slice(0, STACK_MAX) }));
                    go("email");
                  }
                }}
              />
              {enhanced && (
                <>
                  <button
                    type="button"
                    className="booth-go"
                    onClick={() => {
                      setA((x) => ({ ...x, stack: stackText.trim().slice(0, STACK_MAX) }));
                      go("email");
                    }}
                  >
                    {stackText.trim() ? "Next" : "Skip"} <span aria-hidden="true">→</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </fieldset>

        <fieldset className="booth-q" hidden={enhanced && step !== "email"}>
          <legend className={enhanced ? "sr-only" : undefined}>Where should we send it?</legend>
          <div className="booth-field">
            <label htmlFor={`${uid}-e`}>Email address</label>
            <div className="booth-row">
              <input
                id={`${uid}-e`}
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                placeholder="you@example.org"
                value={a.email}
                onChange={(e) => setA((x) => ({ ...x, email: e.target.value }))}
                aria-invalid={problem ? true : undefined}
                aria-describedby={`${uid}-p ${uid}-h`}
              />
              <button type="submit" className="booth-go is-send" data-cursor="send">
                {enhanced ? "Print my receipt" : "Join the list"} <span aria-hidden="true">→</span>
              </button>
            </div>
            <p className="booth-problem" id={`${uid}-p`} role="alert">
              {problem}
            </p>
            <p className="booth-hint" id={`${uid}-h`}>
              Stored: this address, your two answers, the time and this page's path. <Link to="/updates#privacy">What happens to it</Link>.
            </p>
          </div>
        </fieldset>
      </div>

      {step === "done" && <Ticket a={a} outcome={outcome} />}
      {step === "done" && (
        <button
          type="button"
          className="booth-again"
          onClick={() => {
            setA({ wants: "", stack: "", email: "" });
            setStackText("");
            furthest.current = "wants";
            go("wants");
          }}
        >
          Start again with another address
        </button>
      )}
    </form>
  );
}

/** The footer's one-line version: an address and nothing else. The full exchange is on /updates. */
export function BoothLineForm({ source }: { source: string }) {
  const uid = useId();
  const [api, setApi] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"" | "sending" | "joined" | "already" | "invalid" | "slow" | "error">("");
  const trap = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void resolveApi().then(setApi);
  }, []);
  const text: Record<string, string> = {
    sending: "Printing…",
    joined: "You are on the list. One email when the experiment 2 write-up is published.",
    already: "That address was already on the list.",
    invalid: "That does not look like an email address.",
    slow: "Too many tries from this connection. Wait ten minutes.",
    error: "The list could not be reached. Nothing was stored.",
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!looksLikeEmail(email)) return setState("invalid");
    setState("sending");
    try {
      const res = await fetch(`${api}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, wants: "writeup", source, website: trap.current?.value ?? "" }),
      });
      const body = (await res.json().catch(() => null)) as { state?: string } | null;
      setState(body?.state === "joined" || body?.state === "already" || body?.state === "invalid" || body?.state === "slow" ? body.state : "error");
    } catch {
      setState("error");
    }
  }
  const ok = state === "joined" || state === "already";
  return (
    <form className="booth-mini" action={`${api}/waitlist`} method="post" onSubmit={submit} noValidate>
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="wants" value="writeup" />
      <div className="booth-trap-wrap" aria-hidden="true">
        <label htmlFor={`${uid}-w`}>Leave this empty</label>
        <input id={`${uid}-w`} ref={trap} className="booth-trap" type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <label htmlFor={`${uid}-e`} className="booth-mini-label">
        One email when the experiment 2 write-up is published
      </label>
      <div className="booth-row">
        <input id={`${uid}-e`} type="email" name="email" required maxLength={254} autoComplete="email" placeholder="you@example.org" value={email} onChange={(e) => setEmail(e.target.value)} disabled={ok} />
        <button type="submit" className="booth-go is-send" disabled={state === "sending" || ok}>
          Join <span aria-hidden="true">→</span>
        </button>
      </div>
      <p className={`booth-mini-state ${ok ? "is-ok" : state && state !== "sending" ? "is-bad" : ""}`} role="status">
        {text[state] ?? ""}
      </p>
      <p className="booth-hint">
        Want the kit note too? <Link to="/updates">Use the full window</Link>.
      </p>
    </form>
  );
}
