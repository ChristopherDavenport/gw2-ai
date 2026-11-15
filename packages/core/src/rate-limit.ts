/**
 * Token bucket shared by all requests from one client. The API advertises
 * 600 requests/minute (x-rate-limit-limit); we refill at that rate and allow
 * a modest burst so batched lookups don't trip 429s.
 */
export class RateLimiter {
  #tokens: number;
  #last: number;
  readonly #capacity: number;
  readonly #perMs: number;

  constructor(capacity = 100, perMinute = 600) {
    this.#capacity = capacity;
    this.#tokens = capacity;
    this.#perMs = perMinute / 60_000;
    this.#last = Date.now();
  }

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.#tokens = Math.min(this.#capacity, this.#tokens + (now - this.#last) * this.#perMs);
      this.#last = now;
      if (this.#tokens >= 1) {
        this.#tokens -= 1;
        return;
      }
      await sleep(Math.ceil((1 - this.#tokens) / this.#perMs));
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
