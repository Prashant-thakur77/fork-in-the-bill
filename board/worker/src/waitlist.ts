// The updates list: one email address per person, the page they signed up on, and when.
// Nothing here ever returns a stored address. The only read is a count, and it is withheld
// until the list is large enough that the number says nothing about any one person.

export const WAITLIST_MAX_BODY_BYTES = 2 * 1024;
/** Attempts allowed per address in the window, successful or not. */
export const WAITLIST_MAX_ATTEMPTS = 5;
export const WAITLIST_WINDOW_SECONDS = 10 * 60;
/** Attempt records older than this are deleted on the next request. */
export const WAITLIST_ATTEMPT_TTL_SECONDS = 60 * 60;
/** The count is published only from this size up. */
export const WAITLIST_MIN_PUBLIC_COUNT = 10;

export type JoinState = "joined" | "already" | "invalid" | "slow" | "error";

const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** A normalised address, or null when it is not one we will store. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  const at = email.lastIndexOf("@");
  if (at < 1 || at > 64) return null;
  const local = email.slice(0, at);
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  if (!EMAIL.test(email)) return null;
  const tld = email.slice(email.lastIndexOf(".") + 1);
  if (tld.length < 2 || /^\d+$/.test(tld)) return null;
  return email;
}

/** The page a sign-up came from: a short site path, or empty. */
export function cleanSource(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return /^\/[a-z0-9/-]{0,40}$/.test(raw) ? raw : "";
}

/**
 * A key for rate limiting that cannot be turned back into an address: sha256 of a secret salt,
 * the UTC day and the address. The day in the hash means keys from different days do not match.
 */
export async function attemptKey(salt: string, ip: string, nowSeconds: number): Promise<string> {
  const day = Math.floor(nowSeconds / 86400);
  const bytes = new TextEncoder().encode(`${salt}|updates|${day}|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface JoinBody {
  email: unknown;
  source: unknown;
  /** Honeypot: a field people never see. Anything in it means a script filled the form. */
  trap: unknown;
}

/** Reads a JSON or form-encoded body. Returns null when it is neither. */
export function parseJoinBody(contentType: string, raw: string): JoinBody | null {
  if (contentType.includes("application/json")) {
    try {
      const v: unknown = JSON.parse(raw);
      if (!v || typeof v !== "object" || Array.isArray(v)) return null;
      const o = v as Record<string, unknown>;
      return { email: o.email, source: o.source, trap: o.website };
    } catch {
      return null;
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const p = new URLSearchParams(raw);
    return { email: p.get("email"), source: p.get("source"), trap: p.get("website") };
  }
  return null;
}

export const JOIN_COPY: Record<JoinState, { title: string; text: string; status: number }> = {
  joined: { title: "You are on the list.", text: "We will email you once, when the experiment 2 write-up is published. Nothing else.", status: 200 },
  already: { title: "You were already on the list.", text: "That address is stored once. You will get the one email when the write-up is published.", status: 200 },
  invalid: { title: "That does not look like an email address.", text: "Check it and try again.", status: 400 },
  slow: { title: "Too many tries from this connection.", text: "Wait ten minutes and try again.", status: 429 },
  error: { title: "The list could not be reached.", text: "Nothing was stored. Try again in a minute.", status: 503 },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * The answer to a plain form post (no JavaScript): a small page in the site's own colours, drawn
 * as a toll receipt, with a way back.
 */
export function joinPage(state: JoinState): string {
  const c = JOIN_COPY[state];
  const ok = state === "joined" || state === "already";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(c.title)} · Fork in the Bill</title>
<style>
body{margin:0;background:#eceae3;color:#1b211e;font:17px/1.55 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px;box-sizing:border-box}
main{width:min(100%,460px)}
.slot{height:14px;border-radius:7px;background:#141716}
.ticket{margin:0 14px;padding:22px 22px 26px;background:#f6f5f0;font-family:ui-monospace,monospace;font-size:15px;box-shadow:0 10px 24px -14px rgba(0,0,0,.5);border-bottom:3px dashed #c9c6bb}
.k{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${ok ? "#0b6b45" : "#a91c15"};font-weight:700}
h1{font:800 26px/1.15 system-ui,sans-serif;margin:8px 0 10px}
p{margin:0 0 14px}
a{display:inline-block;padding:12px 18px;border-radius:6px;background:#1b211e;color:#eceae3;text-decoration:none;font:700 16px system-ui,sans-serif}
a:focus-visible{outline:3px solid #1b211e;outline-offset:3px}
</style>
</head>
<body>
<main>
<div class="slot" aria-hidden="true"></div>
<div class="ticket">
<div class="k">${ok ? "Updates list · receipt" : "Updates list · not stored"}</div>
<h1>${esc(c.title)}</h1>
<p>${esc(c.text)}</p>
<a href="/updates">${ok ? "Back to the site" : "Back to the form"}</a>
</div>
</main>
</body>
</html>`;
}
