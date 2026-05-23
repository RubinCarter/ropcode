export interface ReloadCircuitBreakerOptions {
  maxFailures: number;
  windowMs: number;
}

export interface ReloadCircuitBreaker {
  recordFailure(now?: number): boolean;
  recordSuccess(): void;
  isOpen(now?: number): boolean;
}

export function createReloadCircuitBreaker(options: ReloadCircuitBreakerOptions): ReloadCircuitBreaker {
  let failureTimes: number[] = [];
  let open = false;

  const prune = (now: number) => {
    failureTimes = failureTimes.filter((time) => now - time <= options.windowMs);
  };

  return {
    recordFailure(now = Date.now()) {
      prune(now);
      failureTimes.push(now);
      open = failureTimes.length >= options.maxFailures;
      return open;
    },
    recordSuccess() {
      failureTimes = [];
      open = false;
    },
    isOpen(now = Date.now()) {
      prune(now);
      if (failureTimes.length < options.maxFailures) {
        open = false;
      }
      return open;
    },
  };
}

export const streamReloadCircuitBreaker = createReloadCircuitBreaker({
  maxFailures: 3,
  windowMs: 30_000,
});
