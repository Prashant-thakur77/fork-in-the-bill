// A run ledger checked in the browser, the same way integrity/verify_ledger.py checks it:
//   hash = sha256(prev_hash_hex + canonical_json(payload))        (integrity/canonical.py)
//   canonical_json = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
//   Merkle root over the hash of every task_done record, in order  (integrity/merkle.py)
// The payload must be re-serialised byte for byte as Python would, so numbers are never turned
// into JavaScript numbers and back: the parser keeps each number's text, and floats are printed
// by Python's repr rule.

export const GENESIS = "0".repeat(64);

/** A JSON number kept as its source text. */
class Num {
  constructor(readonly text: string) {}
}

type Json = null | boolean | string | Num | Json[] | { [k: string]: Json };

/** JSON.parse, except numbers stay as text. Throws SyntaxError on bad input. */
export function parseKeepingNumbers(src: string): Json {
  let i = 0;
  const fail = (): never => {
    throw new SyntaxError(`bad JSON at ${i}`);
  };
  const ws = () => {
    while (i < src.length && (src[i] === " " || src[i] === "\n" || src[i] === "\t" || src[i] === "\r")) i++;
  };
  const str = (): string => {
    const start = i;
    i++;
    while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
    if (i >= src.length) fail();
    i++;
    return JSON.parse(src.slice(start, i)) as string;
  };
  const value = (): Json => {
    ws();
    const c = src[i];
    if (c === "{") {
      i++;
      const o: { [k: string]: Json } = {};
      ws();
      if (src[i] === "}") {
        i++;
        return o;
      }
      for (;;) {
        ws();
        if (src[i] !== '"') fail();
        const k = str();
        ws();
        if (src[i++] !== ":") fail();
        o[k] = value();
        ws();
        const d = src[i++];
        if (d === "}") return o;
        if (d !== ",") fail();
      }
    }
    if (c === "[") {
      i++;
      const a: Json[] = [];
      ws();
      if (src[i] === "]") {
        i++;
        return a;
      }
      for (;;) {
        a.push(value());
        ws();
        const d = src[i++];
        if (d === "]") return a;
        if (d !== ",") fail();
      }
    }
    if (c === '"') return str();
    if (src.startsWith("true", i)) return (i += 4), true;
    if (src.startsWith("false", i)) return (i += 5), false;
    if (src.startsWith("null", i)) return (i += 4), null;
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 400));
    if (!m) return fail();
    i += m[0].length;
    return new Num(m[0]);
  };
  const v = value();
  ws();
  if (i !== src.length) fail();
  return v;
}

/** A float as Python's repr prints it: shortest digits, fixed notation unless the exponent is far out. */
export function pyFloat(x: number): string {
  if (Object.is(x, -0)) return "-0.0";
  if (x === 0) return "0.0";
  const [mant, e] = x.toExponential().split("e") as [string, string];
  const neg = mant.startsWith("-");
  const digits = mant.replace("-", "").replace(".", "");
  const decpt = Number(e) + 1; // value = 0.DIGITS x 10^decpt
  let out: string;
  if (decpt <= -4 || decpt > 16) {
    const exp = decpt - 1;
    out = `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  } else if (decpt <= 0) {
    out = `0.${"0".repeat(-decpt)}${digits}`;
  } else if (digits.length <= decpt) {
    out = `${digits}${"0".repeat(decpt - digits.length)}.0`;
  } else {
    out = `${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
  }
  return neg ? `-${out}` : out;
}

function pyNumber(text: string): string {
  // Python's json reads a token without ".", "e" or "E" as an int and prints it back unchanged.
  if (!/[.eE]/.test(text)) return BigInt(text).toString();
  return pyFloat(Number(text));
}

/** Python sorts keys by code point; JavaScript's default sort compares UTF-16 units. */
function byCodePoint(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

/** Python's json string escaping with ensure_ascii=False: quote, backslash and control characters only. */
function pyString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

/** `json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)` for a parsed value. */
export function canonicalJson(v: Json): string {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "string") return pyString(v);
  if (v instanceof Num) return pyNumber(v.text);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(v)
    .sort(byCodePoint)
    .map((k) => `${pyString(k)}:${canonicalJson(v[k]!)}`)
    .join(",")}}`;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));

async function sha256(bytes: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", bytes as BufferSource);
}

/** `sha256(prev_hash_hex + canonical_json(payload))` as lowercase hex. */
export async function recordHash(prevHash: string, payload: Json): Promise<string> {
  return hex(await sha256(new TextEncoder().encode(prevHash + canonicalJson(payload))));
}

/** Leaves are raw 32-byte digests, a parent is sha256(left + right), an odd last node is paired with itself. */
export async function merkleRoot(hexLeaves: string[]): Promise<string> {
  if (!hexLeaves.length) return hex(await sha256(new Uint8Array()));
  let level: Uint8Array[] = hexLeaves.map(unhex);
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length - 1]!);
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const pair = new Uint8Array(64);
      pair.set(level[i]!, 0);
      pair.set(level[i + 1]!, 32);
      next.push(new Uint8Array(await sha256(pair)));
    }
    level = next;
  }
  return hex(level[0]!.buffer as ArrayBuffer);
}

export interface PathStep {
  /** The other child of this node's parent. */
  sibling: string;
  /** Which side the sibling sits on: the node is hashed as left + right. */
  side: "left" | "right";
  /** True when the node is the last of an odd-sized level and is paired with itself. */
  self: boolean;
}

/**
 * The audit path of one leaf: the sibling at every level from the leaf up to the root, in the
 * tree integrity/merkle.py builds (an odd last node is paired with itself).
 */
export async function inclusionPath(hexLeaves: string[], index: number): Promise<PathStep[]> {
  if (index < 0 || index >= hexLeaves.length) throw new RangeError("no such leaf");
  let level: Uint8Array[] = hexLeaves.map(unhex);
  let i = index;
  const path: PathStep[] = [];
  while (level.length > 1) {
    const last = level.length - 1;
    const sib = i % 2 === 0 ? Math.min(i + 1, last) : i - 1;
    path.push({ sibling: hex(level[sib]!.slice().buffer as ArrayBuffer), side: i % 2 === 0 ? "right" : "left", self: sib === i });
    if (level.length % 2 === 1) level = [...level, level[last]!];
    const next: Uint8Array[] = [];
    for (let k = 0; k < level.length; k += 2) {
      const pair = new Uint8Array(64);
      pair.set(level[k]!, 0);
      pair.set(level[k + 1]!, 32);
      next.push(new Uint8Array(await sha256(pair)));
    }
    level = next;
    i = Math.floor(i / 2);
  }
  return path;
}

/** A proof as integrity/merkle.py writes it: sibling hashes, leaf level first, with no entry where a node is paired with itself. */
export function proofOf(path: PathStep[]): string[] {
  return path.filter((s) => !s.self).map((s) => s.sibling);
}

const isDigest = (h: unknown): h is string => typeof h === "string" && /^[0-9a-f]{64}$/.test(h);

/**
 * Climbs from a leaf to the root with a proof, as `root_from_path` in integrity/merkle.py does:
 * at each level the node takes the next sibling, on the side its index says, unless it is the
 * last node of an odd level, where it is paired with itself. Returns the node at every level
 * (the last one is the root), or null when the proof is malformed, too short or too long.
 */
export async function climb(leafHex: string, index: number, size: number, proof: string[]): Promise<string[] | null> {
  if (!isDigest(leafHex) || !Number.isInteger(size) || size < 1 || !Number.isInteger(index) || index < 0 || index >= size) return null;
  let node = unhex(leafHex);
  let i = index;
  let n = size;
  let used = 0;
  const nodes = [leafHex];
  while (n > 1) {
    const pair = new Uint8Array(64);
    if (i % 2 === 1 || i + 1 < n) {
      const s = proof[used++];
      if (!isDigest(s)) return null;
      const sib = unhex(s);
      if (i % 2 === 1) {
        pair.set(sib, 0);
        pair.set(node, 32);
      } else {
        pair.set(node, 0);
        pair.set(sib, 32);
      }
    } else {
      pair.set(node, 0);
      pair.set(node, 32);
    }
    node = new Uint8Array(await sha256(pair));
    nodes.push(hex(node.buffer as ArrayBuffer));
    i = Math.floor(i / 2);
    n = Math.floor((n + 1) / 2);
  }
  return used === proof.length ? nodes : null;
}

/** The root a proof leads to, or null when the proof is malformed (`root_from_path`). */
export async function rootFromPath(leafHex: string, index: number, size: number, proof: string[]): Promise<string | null> {
  const nodes = await climb(leafHex, index, size, proof);
  return nodes ? nodes[nodes.length - 1]! : null;
}

/** True if `proof` shows `leafHex` as leaf `index` of a `size`-leaf tree with this root (`verify_inclusion`). */
export async function verifyInclusion(leafHex: string, index: number, size: number, proof: string[], rootHex: string): Promise<boolean> {
  if (!isDigest(rootHex)) return false;
  return (await rootFromPath(leafHex, index, size, proof)) === rootHex;
}

export interface RecordCheck {
  line: number;
  seq: number;
  kind: string;
  ts: string;
  /** The hash the ledger line carries. */
  stored: string;
  /** The hash recomputed here from the previous hash and the payload. */
  recomputed: string;
  bytes: number;
  /** A few words on what the record is, for the receipt. */
  note: string;
  ok: boolean;
  /** Why the record failed, when it did. */
  error?: string;
}

export interface LedgerReport {
  records: number;
  taskDone: number;
  merkleRoot: string;
  errors: string[];
  ok: boolean;
}

function noteOf(kind: string, payload: Json): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload instanceof Num) return "";
  const p = payload as { [k: string]: Json };
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  if (kind === "task_done") return `${s("instance_id")} · ${s("variant")} · ${p.solved === true ? "solved" : "not solved"}`;
  if (kind === "event_sent") return s("event") || s("identity");
  if (kind === "env_snapshot") return `flag config, ${s("label")}`;
  if (kind === "config") return s("event");
  return "";
}

/**
 * Walks a ledger line by line, as integrity/verify_ledger.py does, calling `onRecord` after each
 * one so a page can show the work. Returns the same report the Python command prints.
 */
export async function verifyLedger(text: string, onRecord?: (r: RecordCheck) => void | Promise<void>): Promise<LedgerReport> {
  const errors: string[] = [];
  let prev = GENESIS;
  let expectedSeq: number | null = null;
  let records = 0;
  const taskHashes: string[] = [];
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]!;
    if (!raw.trim()) continue;
    const lineno = n + 1;
    let rec: { [k: string]: Json };
    try {
      const v = parseKeepingNumbers(raw);
      if (!v || typeof v !== "object" || Array.isArray(v) || v instanceof Num) throw new SyntaxError("not an object");
      rec = v;
      if (!(rec.seq instanceof Num) || typeof rec.kind !== "string" || typeof rec.prev_hash !== "string" || typeof rec.hash !== "string" || rec.payload === undefined) {
        throw new SyntaxError("missing fields");
      }
    } catch {
      errors.push(`line ${lineno}: unreadable record`);
      continue;
    }
    records += 1;
    const seq = Number((rec.seq as Num).text);
    const kind = rec.kind as string;
    const stored = rec.hash as string;
    const prevHash = rec.prev_hash as string;
    const problems: string[] = [];
    if (expectedSeq !== null && seq !== expectedSeq) problems.push(`seq ${seq}, expected ${expectedSeq}`);
    expectedSeq = seq + 1;
    if (prevHash !== prev) problems.push("prev_hash does not match previous hash");
    const recomputed = await recordHash(prevHash, rec.payload!);
    if (recomputed !== stored) problems.push(`hash mismatch (seq ${seq})`);
    for (const p of problems) errors.push(`line ${lineno}: ${p}`);
    prev = stored;
    if (kind === "task_done") taskHashes.push(stored);
    if (onRecord) {
      await onRecord({
        line: lineno,
        seq,
        kind,
        ts: typeof rec.ts === "string" ? rec.ts : "",
        stored,
        recomputed,
        bytes: raw.length,
        note: noteOf(kind, rec.payload!),
        ok: problems.length === 0,
        error: problems[0],
      });
    }
  }
  return { records, taskDone: taskHashes.length, merkleRoot: await merkleRoot(taskHashes), errors, ok: errors.length === 0 };
}

/**
 * Changes one character inside one record's payload, the way an edit after the fact would.
 * Returns the tampered text and the sequence number that was touched.
 */
export function tamper(text: string, seq: number): { text: string; changed: string } | null {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith(`{"seq":${seq},`));
  if (at < 0) return null;
  const line = lines[at]!;
  // Flip the outcome of the task, or nudge the first digit found in the payload.
  const p = line.indexOf('"payload":');
  if (p < 0) return null;
  const solved = line.indexOf('"solved":false', p);
  if (solved > 0) {
    lines[at] = `${line.slice(0, solved)}"solved":true${line.slice(solved + '"solved":false'.length)}`;
    return { text: lines.join("\n"), changed: '"solved": false became true' };
  }
  const usd = /"usd":(\d)/.exec(line.slice(p));
  if (usd) {
    const i = p + usd.index + '"usd":'.length;
    const d = line[i] === "9" ? "8" : String(Number(line[i]) + 1);
    lines[at] = line.slice(0, i) + d + line.slice(i + 1);
    return { text: lines.join("\n"), changed: `"usd" went from ${line[i]}… to ${d}…` };
  }
  return null;
}
