export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

export type RateLimiterOptions = { windowMs: number; max: number };

// 로컬 단일 사용자 앱을 위한 가벼운 in-memory 슬라이딩 윈도우 제한기.
// 인증 없는 API가 폭주(비용/자원 남용)하는 것을 1차로 막는다.
export function createRateLimiter({ windowMs, max }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();

  return function check(key: string, now: number = Date.now()): RateLimitResult {
    const recent = (hits.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);

    if (recent.length >= max) {
      hits.set(key, recent);
      const retryAfterMs = windowMs - (now - recent[0]);
      return { allowed: false, retryAfterMs };
    }

    recent.push(now);
    hits.set(key, recent);
    return { allowed: true, retryAfterMs: 0 };
  };
}
