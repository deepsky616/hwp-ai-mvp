// 로컬 앱의 API는 인증이 없어서, 악성 웹사이트가 방문자 브라우저를 통해
// http://localhost:3000/api/* 로 요청을 쏘는 CSRF/DNS 리바인딩 공격에 노출된다.
// Host와 Origin이 모두 로컬(또는 허용 목록)일 때만 상태 변경 API를 통과시킨다.

export type HeadersLike = { get(name: string): string | null };
type EnvLike = Record<string, string | undefined>;

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost")
  );
}

function allowedExtraHosts(env: EnvLike): Set<string> {
  return new Set(
    (env.HWP_AI_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function hostnameOf(hostHeader: string): string | null {
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

export function isTrustedLocalRequest(headers: HeadersLike, env: EnvLike = process.env): boolean {
  const extra = allowedExtraHosts(env);
  // Vercel 같은 호스팅 환경에서는 Host가 로컬일 수 없으므로 동일 출처만 요구한다.
  const hosted = env.VERCEL === "1";

  // Host 검증: DNS 리바인딩(evil.com이 127.0.0.1로 해석)을 막는다.
  const hostHeader = headers.get("host");
  if (!hostHeader) return false;
  const hostname = hostnameOf(hostHeader);
  if (!hostname) return false;
  if (!hosted && !isLocalHostname(hostname) && !extra.has(hostname.toLowerCase())) return false;

  // Origin 검증: 브라우저 교차 출처 요청(CSRF)을 막는다.
  // Origin이 없는 요청(curl, 서버 간 호출, 동일 출처 GET)은 허용한다.
  const origin = headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const originHost = new URL(origin).hostname;
    if (hosted) return originHost.toLowerCase() === hostname.toLowerCase();
    return isLocalHostname(originHost) || extra.has(originHost.toLowerCase());
  } catch {
    return false;
  }
}

export const UNTRUSTED_REQUEST_MESSAGE =
  "허용되지 않은 출처의 요청입니다. 로컬 주소(localhost)로 접속해 주세요.";
