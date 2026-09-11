/**
 * Gentle read layer.
 *
 * Hard rule for this app: never spam a source. Every outbound read - HTTP, game
 * memory via GEP, or disk - goes through here, and the limiter is structural
 * rather than a convention callers are trusted to follow.
 *
 * Four independent guards, cheapest first:
 *   1. cache        - a fresh value is returned without touching the source at all
 *   2. singleflight - N concurrent callers for one key produce exactly 1 read
 *   3. floor        - a per-key minimum interval no caller can talk its way under
 *   4. bucket       - a global token bucket, so many distinct keys can't gang up
 *
 * Revalidation is conditional (ETag / Last-Modified), so an unchanged resource
 * costs a 304 and no body. Payloads are content-hashed: identical bytes resolve
 * to the *same object reference* as the previous read, which lets downstream
 * consumers skip work with a `prev === next` check.
 */

export type Origin = 'fresh' | 'cached' | 'unchanged';

export interface ReadResult<T> {
  value: T;
  /** Where the value came from. Surfaced in the debug HUD and asserted in tests. */
  origin: Origin;
  /** ms since epoch that the source was last actually contacted. */
  at: number;
}

interface Entry<T> {
  value: T;
  at: number;
  hash: string;
  etag?: string;
  lastModified?: string;
  /** In-flight read, shared by every concurrent caller of this key. */
  inflight?: Promise<ReadResult<T>>;
}

export interface Policy {
  /** How long a value is served straight from cache with zero source contact. */
  ttlMs: number;
  /** Absolute floor between two source reads. Not bypassable by any caller. */
  minIntervalMs: number;
  /** Survive an app restart. Off for volatile things like worldstate cycles. */
  persist?: boolean;
}

/** Policies per source class. Tuned to be a good citizen, not to be fast. */
export const POLICY = {
  /**
   * Worldstate. api.warframestat.us serves `Cache-Control: max-age=120` and a
   * weak ETag, so 120s is the server's own stated cadence - reading faster only
   * costs them and returns the same bytes.
   */
  worldstate: { ttlMs: 120_000, minIntervalMs: 120_000 },
  /** Item/drop datasets change on game patches, not on minutes. */
  staticData: { ttlMs: 24 * 3_600_000, minIntervalMs: 6 * 3_600_000, persist: true },
  /** Market prices: warframe.market publishes a 3/s ceiling; stay far under it. */
  market: { ttlMs: 300_000, minIntervalMs: 60_000 },
} as const satisfies Record<string, Policy>;

const STORE_PREFIX = 'codex.gentle.';
/** Separate from the value cache: this holds rate-limiter state, not payloads. */
const BUCKET_PREFIX = 'codex.bucket.';

/** FNV-1a. Not cryptographic - it only has to answer "did the bytes change". */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Global token bucket. Every key can sit inside its own floor and the app can
 * still burst at startup across many distinct keys - this caps the sum.
 */
/**
 * A token bucket, optionally SHARED ACROSS WINDOWS.
 *
 * The sharing is not a refinement - without it the rate limit is per JS
 * context, and this app has more than one. `ingame.html` and `desktop.html`
 * both mount the same panel registry, so both can open the Platinum panel, and
 * each would hold its own bucket: two windows reading at "one a second" put two
 * a second on the wire. The market reader's own note records what happens at
 * two a second - a run of 429s - so an unshared bucket does not merely drift
 * over the limit, it lands exactly on the rate that was measured to fail.
 *
 * `localStorage` is shared between windows of one origin, so the bucket's whole
 * state lives there when a share key is given. Two windows CAN still race
 * between the read and the write, because localStorage has no compare-and-swap;
 * the cost of a lost race is one extra request, not a doubled sustained rate,
 * because the timestamp they both write still moves the refill clock forward.
 *
 * Every storage access is guarded: a private window, a disabled store or a
 * corrupted value falls back to the in-memory fields, which is exactly the
 * unshared behaviour this class had before.
 */
class Bucket {
  private tokens: number;
  private last = Date.now();
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly shareKey: string | null;

  constructor(capacity: number, refillPerSec: number, shareKey: string | null = null) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.shareKey = shareKey === null ? null : BUCKET_PREFIX + shareKey;
  }

  /** The shared state if there is one and it is readable, else this instance's. */
  private load(): { tokens: number; last: number } {
    if (this.shareKey !== null) {
      try {
        const raw = localStorage.getItem(this.shareKey);
        if (raw !== null) {
          const v = JSON.parse(raw) as { tokens?: unknown; last?: unknown };
          if (typeof v.tokens === 'number' && typeof v.last === 'number' && Number.isFinite(v.tokens) && Number.isFinite(v.last)) {
            // A clock that jumped backwards would otherwise bank free tokens.
            return { tokens: Math.min(this.capacity, v.tokens), last: Math.min(v.last, Date.now()) };
          }
        }
      } catch {
        // Storage unavailable or corrupt: the in-memory fields still apply.
      }
    }
    return { tokens: this.tokens, last: this.last };
  }

  private save(state: { tokens: number; last: number }): void {
    this.tokens = state.tokens;
    this.last = state.last;
    if (this.shareKey === null) return;
    try {
      localStorage.setItem(this.shareKey, JSON.stringify(state));
    } catch {
      // Quota or disabled storage - this window still paces itself correctly.
    }
  }

  /** Resolves once a token frees up. Never rejects: back-pressure, not failure. */
  async take(): Promise<void> {
    for (;;) {
      const state = this.load();
      const now = Date.now();
      const gained = ((now - state.last) / 1000) * this.refillPerSec;
      const tokens = Math.min(this.capacity, state.tokens + gained);
      if (tokens >= 1) {
        this.save({ tokens: tokens - 1, last: now });
        return;
      }
      // Write the refill forward before sleeping, so a second window sees it.
      this.save({ tokens, last: now });
      const waitMs = ((1 - tokens) / this.refillPerSec) * 1000;
      await new Promise((r) => setTimeout(r, Math.ceil(waitMs)));
    }
  }
}

export interface LoadResponse {
  body: string;
  etag?: string;
  lastModified?: string;
  notModified?: boolean;
}

export class GentleReader {
  private entries = new Map<string, Entry<unknown>>();
  /*
   * WHEN THE SERVER SAID STOP AND THERE IS NOTHING TO SERVE INSTEAD.
   *
   * A 429 is held on the ENTRY by pushing `at` forward, which works only when
   * an entry exists - and on a cold cache there is none, so the refusal was
   * read, the wait was computed, and both were thrown away with the entry. The
   * next caller started over at guard 1 with nothing to stop it, which is a
   * retry storm aimed at the one server that has explicitly asked for the
   * opposite.
   *
   * It is a separate map rather than a value-less Entry on purpose: guards 1
   * and 3 both SERVE `prev.value`, so an entry parked to hold a deadline would
   * be handed back as a successful read of `undefined`.
   */
  private refused = new Map<string, number>();
  private readonly bucket: Bucket;

  /** Counters for the debug HUD, so "is it actually gentle" stays observable. */
  readonly stats = { reads: 0, served: 0, coalesced: 0, unchanged: 0, deferred: 0, unconditionalRetries: 0 };

  /**
   * `shareKey` makes the rate limit hold across WINDOWS rather than per window.
   * Give it to any reader whose ceiling belongs to a remote service; leave it
   * off for readers whose cost is local.
   */
  constructor(capacity = 5, refillPerSec = 0.5, shareKey: string | null = null) {
    this.bucket = new Bucket(capacity, refillPerSec, shareKey);
  }

  /**
   * Read `key`, contacting the source via `load` only when all four guards allow.
   * `load` is handed conditional-request headers and is expected to honour them.
   */
  async read<T>(
    key: string,
    policy: Policy,
    load: (headers: Record<string, string>) => Promise<LoadResponse>,
    parse: (body: string) => T,
  ): Promise<ReadResult<T>> {
    this.stats.served++;
    const now = Date.now();
    let prev = this.entries.get(key) as Entry<T> | undefined;
    if (!prev && policy.persist) prev = this.restore<T>(key);

    // 1. cache - fresh enough that the source is never contacted.
    if (prev && !prev.inflight && now - prev.at < policy.ttlMs) {
      return { value: prev.value, origin: 'cached', at: prev.at };
    }

    // 2. singleflight - everyone waiting on this key shares one read.
    if (prev?.inflight) {
      this.stats.coalesced++;
      return prev.inflight;
    }

    // 3. floor - stale, but read too recently. Serve stale rather than push.
    if (prev && now - prev.at < policy.minIntervalMs) {
      this.stats.deferred++;
      return { value: prev.value, origin: 'cached', at: prev.at };
    }

    /*
     * 3b. refusal - a 429 with nothing cached to serve in its place. The caller
     * gets the same failure it would have got from the network, and the server
     * gets the silence it asked for. There is no value to return here and
     * inventing one would be worse than the throw.
     */
    const until = this.refused.get(key);
    if (until !== undefined) {
      if (now < until) {
        this.stats.deferred++;
        throw new RateLimited(key, until - now);
      }
      this.refused.delete(key);
    }

    const before = prev;
    const run = (async (): Promise<ReadResult<T>> => {
      await this.bucket.take(); // 4. bucket

      const headers: Record<string, string> = {};
      if (before?.etag) headers['If-None-Match'] = before.etag;
      if (before?.lastModified) headers['If-Modified-Since'] = before.lastModified;

      this.stats.reads++;
      const at = Date.now();
      try {
        /*
         * A CONDITIONAL REQUEST MUST NEVER BE THE REASON DATA DOES NOT ARRIVE.
         *
         * `If-None-Match` makes the request non-simple, so the browser sends a
         * CORS preflight - and cdn.jsdelivr.net, which serves the entire item
         * catalog, does not list `if-none-match` in its
         * `Access-Control-Allow-Headers`. Every revalidation therefore failed
         * outright with "Request header field if-none-match is not allowed",
         * and the failure was invisible: the catch below keeps the stale value
         * and pushes `at` forward, so the catalog silently froze at whatever
         * version happened to load first and could never update again. On a
         * cold cache there is no stale value to keep and the read throws, which
         * is seven collection pursuits reporting "not measured" against a
         * healthy account.
         *
         * So the conditional headers are an OPTIMISATION with a fallback: if a
         * conditional read fails, the same read is made again unconditionally.
         * It costs one wasted request per host that rejects the header, once
         * per TTL, and it is the difference between fresh data and frozen data.
         */
        let res;
        try {
          res = await load(headers);
        } catch (conditional) {
          if (Object.keys(headers).length === 0) throw conditional;
          /*
           * A REFUSAL IS NOT A HEADER PROBLEM, AND RETRYING IT IS THE ONE THING
           * THE SERVER ASKED US NOT TO DO. The retry below exists for a host
           * that rejects `If-None-Match` at CORS; a 429 says the request itself
           * was too much, and sending it again a millisecond later - without
           * the header that would have let the server answer 304 - is strictly
           * worse than the request it just refused.
           */
          if (conditional instanceof RateLimited) throw conditional;
          this.stats.unconditionalRetries++;
          res = await load({});
        }

        // 304, or a body byte-identical to last time. Reuse the SAME reference so
        // consumers can skip work with a cheap identity check.
        if (before && (res.notModified || hash(res.body) === before.hash)) {
          this.stats.unchanged++;
          this.commit(
            key,
            {
              ...before,
              at,
              etag: res.etag ?? before.etag,
              lastModified: res.lastModified ?? before.lastModified,
            },
            policy,
          );
          return { value: before.value, origin: 'unchanged', at };
        }

        const value = parse(res.body);
        this.commit(key, { value, at, hash: hash(res.body), etag: res.etag, lastModified: res.lastModified }, policy);
        return { value, origin: 'fresh', at };
      } catch (err) {
        /*
         * A REFUSAL BUYS MORE SILENCE THAN A FAILURE DOES.
         *
         * `at` is pushed forward on any failure so the floor applies to it too.
         * For a 429 that is not enough: the floor is the cadence the server
         * just refused. The next attempt is pushed past whatever it asked for,
         * or a minute when it asked for nothing.
         */
        if (err instanceof RateLimited) {
          const wait = err.retryAfterMs ?? 60_000;
          if (before) {
            this.commit(key, { ...before, at: at + wait }, policy);
            return { value: before.value, origin: 'cached', at: before.at };
          }
          // Nothing cached, so the deadline has nowhere on the entry to live.
          this.refused.set(key, at + wait);
        }
        // A failed read must not become a retry storm. Keep the stale value and
        // push `at` forward so the floor applies to the failure too.
        if (before) {
          this.commit(key, { ...before, at }, policy);
          return { value: before.value, origin: 'cached', at: before.at };
        }
        this.entries.delete(key);
        throw err;
      }
    })();

    this.entries.set(key, { ...(before ?? ({} as Entry<T>)), inflight: run } as Entry<unknown>);
    return run;
  }

  /** Return a value only if already cached. Never contacts the source. */
  peek<T>(key: string): T | undefined {
    return (this.entries.get(key) as Entry<T> | undefined)?.value;
  }

  private commit<T>(key: string, e: Entry<T>, policy: Policy): void {
    // Anything that commits has a value, so a standing refusal is over.
    this.refused.delete(key);
    const clean: Entry<T> = { ...e, inflight: undefined };
    this.entries.set(key, clean as Entry<unknown>);
    if (!policy.persist) return;
    try {
      localStorage.setItem(STORE_PREFIX + key, JSON.stringify(clean));
    } catch {
      // Quota exceeded or storage disabled - in-memory caching still applies.
    }
  }

  private restore<T>(key: string): Entry<T> | undefined {
    try {
      const raw = localStorage.getItem(STORE_PREFIX + key);
      if (!raw) return undefined;
      const e = JSON.parse(raw) as Entry<T>;
      this.entries.set(key, e as Entry<unknown>);
      return e;
    } catch {
      return undefined;
    }
  }
}

/**
 * A refusal, told apart from a failure.
 *
 * A 429 is not an error in the sense a 500 is: the request was well formed and
 * the server is asking for less of them. Treated as a generic failure it gets
 * the same handling as a network drop - keep the stale value, try again on the
 * next tick - which is precisely the retry cadence the server just objected to.
 */
export class RateLimited extends Error {
  /** Seconds the server asked us to wait, when it said. */
  readonly retryAfterMs: number | null;
  constructor(url: string, retryAfterMs: number | null) {
    super(`429 rate limited for ${url}`);
    this.name = 'RateLimited';
    this.retryAfterMs = retryAfterMs;
  }
}

export const gentle = new GentleReader();

/** HTTP loader wired for conditional requests. Overwolf's CEF supports fetch + ETag. */
export function httpLoader(url: string) {
  return async (headers: Record<string, string>): Promise<LoadResponse> => {
    const res = await fetch(url, { headers });
    if (res.status === 304) return { body: '', notModified: true };
    /*
     * RATE LIMITING WAS INDISTINGUISHABLE FROM A CRASH, AND IT HAPPENED.
     * ————————————————————————————————————————————
     * Observed live against api.warframe.market: a run of 429s, at a request
     * rate this file had been told was safe. Thrown as a bare Error it looked
     * like any other failure, so the reader kept its cadence and kept being
     * refused - the one response to a server asking for fewer requests that is
     * guaranteed not to help.
     *
     * `Retry-After` is honoured when sent, because the server knows how long it
     * wants better than any constant here would.
     */
    if (res.status === 429) {
      const header = res.headers.get('retry-after');
      const seconds = header === null ? NaN : Number(header);
      throw new RateLimited(url, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null);
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return {
      body: await res.text(),
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
    };
  };
}
