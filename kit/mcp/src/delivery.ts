/**
 * What Flagsmith's events API accepted.
 *
 * The SDK never fails a caller over an event: a batch that cannot be posted is logged, then kept
 * or dropped, and `flushEvents()` resolves either way. An experiment needs to know, so the
 * server gives the SDK a `fetch` that passes every request through untouched and writes down
 * which events got a 2xx answer and why the others did not.
 */

export type Fetch = typeof fetch;

export const EXPOSURE_EVENT = "$flag_exposure";

export interface SentEvent {
  event: string;
  identifier: string | null;
  value: string | null;
}

export interface Delivery {
  delivered: SentEvent[];
  /** Why the latest refused batch holding one of this identity's events was refused, if one was. */
  failure: string | null;
}

function urlOf(input: Parameters<Fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function isEventsRequest(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith("/v1/events");
  } catch {
    return false;
  }
}

function eventsIn(body: unknown): SentEvent[] {
  if (typeof body !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(body);
    const events = (parsed as { events?: unknown }).events;
    if (!Array.isArray(events)) return [];
    return events.map((e: Record<string, unknown>) => ({
      event: String(e["event"]),
      identifier: typeof e["identifier"] === "string" ? e["identifier"] : null,
      value: e["value"] == null ? null : String(e["value"]),
    }));
  } catch {
    return [];
  }
}

function reasonOf(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? `: ${err.cause.message}` : "";
  return `${err.message}${cause}`;
}

export class DeliveryLog {
  private delivered: SentEvent[] = [];
  private failures = new Map<string, string>();

  /** A `fetch` for the SDK that records the outcome of each post to the events endpoint. */
  wrap(base: Fetch): Fetch {
    return async (input, init) => {
      if (!isEventsRequest(urlOf(input))) return base(input, init);
      const events = eventsIn(init?.body);
      const fail = (reason: string): void => {
        for (const e of events) if (e.identifier !== null) this.failures.set(e.identifier, reason);
      };
      let response: Response;
      try {
        response = await base(input, init);
      } catch (err) {
        fail(`the events API could not be reached (${reasonOf(err)})`);
        throw err;
      }
      if (response.ok) {
        this.delivered.push(...events);
      } else {
        fail(`the events API answered HTTP ${response.status}`);
      }
      return response;
    };
  }

  /** Hand over, and forget, what is known about one identity's events. */
  take(identity: string): Delivery {
    const mine = this.delivered.filter((e) => e.identifier === identity);
    this.delivered = this.delivered.filter((e) => e.identifier !== identity);
    const failure = this.failures.get(identity) ?? null;
    this.failures.delete(identity);
    return { delivered: mine, failure };
  }
}
