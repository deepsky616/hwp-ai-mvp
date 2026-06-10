// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("창 내에서 한도까지는 허용한다", () => {
    const limit = createRateLimiter({ windowMs: 1000, max: 3 });
    expect(limit("a", 0).allowed).toBe(true);
    expect(limit("a", 100).allowed).toBe(true);
    expect(limit("a", 200).allowed).toBe(true);
  });

  it("한도를 넘으면 거부하고 재시도까지 남은 시간을 알려준다", () => {
    const limit = createRateLimiter({ windowMs: 1000, max: 2 });
    limit("a", 0);
    limit("a", 100);
    const blocked = limit("a", 200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("창이 지나면 다시 허용한다", () => {
    const limit = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(limit("a", 0).allowed).toBe(true);
    expect(limit("a", 500).allowed).toBe(false);
    expect(limit("a", 1001).allowed).toBe(true);
  });

  it("키마다 독립적으로 집계한다", () => {
    const limit = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(limit("a", 0).allowed).toBe(true);
    expect(limit("b", 0).allowed).toBe(true);
  });
});
