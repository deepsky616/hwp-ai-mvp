import { describe, expect, it } from "vitest";
import { isTrustedLocalRequest } from "./request-guard";

function headers(map: Record<string, string>): { get(name: string): string | null } {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

describe("로컬 요청 가드", () => {
  it("localhost Host의 Origin 없는 요청을 허용한다", () => {
    expect(isTrustedLocalRequest(headers({ host: "localhost:3000" }), {})).toBe(true);
    expect(isTrustedLocalRequest(headers({ host: "127.0.0.1:3123" }), {})).toBe(true);
  });

  it("동일 출처 localhost Origin을 허용한다", () => {
    expect(
      isTrustedLocalRequest(headers({ host: "localhost:3000", origin: "http://localhost:3000" }), {}),
    ).toBe(true);
  });

  it("외부 사이트 Origin의 교차 출처 요청(CSRF)을 차단한다", () => {
    expect(
      isTrustedLocalRequest(headers({ host: "localhost:3000", origin: "https://evil.example.com" }), {}),
    ).toBe(false);
  });

  it("null Origin을 차단한다", () => {
    expect(isTrustedLocalRequest(headers({ host: "localhost:3000", origin: "null" }), {})).toBe(false);
  });

  it("로컬이 아닌 Host(DNS 리바인딩)를 차단한다", () => {
    expect(isTrustedLocalRequest(headers({ host: "rebind.evil.example.com:3000" }), {})).toBe(false);
  });

  it("Host 헤더가 없으면 차단한다", () => {
    expect(isTrustedLocalRequest(headers({}), {})).toBe(false);
  });

  it("호스팅 환경(VERCEL)에서는 동일 출처만 요구한다", () => {
    const env = { VERCEL: "1" };
    expect(isTrustedLocalRequest(headers({ host: "myapp.vercel.app" }), env)).toBe(true);
    expect(
      isTrustedLocalRequest(
        headers({ host: "myapp.vercel.app", origin: "https://myapp.vercel.app" }),
        env,
      ),
    ).toBe(true);
    expect(
      isTrustedLocalRequest(
        headers({ host: "myapp.vercel.app", origin: "https://evil.example.com" }),
        env,
      ),
    ).toBe(false);
  });

  it("HWP_AI_ALLOWED_HOSTS 환경 변수로 지정한 호스트는 허용한다", () => {
    const env = { HWP_AI_ALLOWED_HOSTS: "my-nas.local" };
    expect(isTrustedLocalRequest(headers({ host: "my-nas.local:3000" }), env)).toBe(true);
    expect(
      isTrustedLocalRequest(
        headers({ host: "my-nas.local:3000", origin: "http://my-nas.local:3000" }),
        env,
      ),
    ).toBe(true);
    expect(isTrustedLocalRequest(headers({ host: "other.example.com" }), env)).toBe(false);
  });
});
