# OpenAI Device Auth + 순수 HTTP 편집 설계

**날짜:** 2026-05-21
**목표:** codex CLI 바이너리 의존성을 완전히 제거하고 순수 HTTP로 OpenAI 계정 로그인 및 문서 편집 구현
**범위:** `lib/openai-device-auth.ts`, `lib/codex-auth.ts`, `lib/ai-edit.ts`, `app/api/codex/login/poll/route.ts`, `lib/useAiSettings.ts`, `components/SettingsPanel.tsx`

---

## 1. 문제 정의

### 현재 오류
`spawn codex ENOENT` — Electron 앱 환경에서 `codex` CLI 바이너리를 찾지 못해 두 기능이 모두 실패:

| 위치 | 용도 | 오류 |
|---|---|---|
| `lib/codex-auth.ts:136` | `codex login --device-auth` | ENOENT |
| `lib/ai-edit.ts:122` | `codex exec ...` | ENOENT |

---

## 2. 해결 방향

codex CLI를 완전히 제거하고 순수 HTTP로 대체:
- **OAuth 로그인**: OpenAI device auth API 직접 호출 (RFC 8628 변형)
- **문서 편집**: 저장된 access_token으로 `/v1/chat/completions` 직접 호출

---

## 3. OpenAI Device Auth 3단계 HTTP 흐름

### 3-1. 사용자 코드 발급

```
POST https://auth.openai.com/api/accounts/deviceauth/usercode
Content-Type: application/json

{ "client_id": "app_EMoamEEZ73f0CkXaXp7hrann" }

→ { device_auth_id: string, user_code: string, interval: string }
```

- `user_code` 형식: `XXXX-XXXXX` (대문자+숫자)
- `interval`: 폴링 간격(초), 문자열로 반환
- 사용자에게 `user_code` 표시 + `https://auth.openai.com/codex/device` 열기

### 3-2. 완료 폴링

```
POST https://auth.openai.com/api/accounts/deviceauth/token
Content-Type: application/json

{ "device_auth_id": string, "user_code": string }

403/404 → 대기 계속 (interval초 후 재시도)
200     → { authorization_code: string, code_verifier: string, code_challenge: string }
기타    → 오류 처리
```

- 최대 15분(900초) 폴링
- 프론트엔드는 `/api/codex/login/poll` 엔드포인트를 5초마다 호출

### 3-3. 토큰 교환

```
POST https://auth.openai.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={authorization_code}
&code_verifier={code_verifier}
&client_id=app_EMoamEEZ73f0CkXaXp7hrann
&redirect_uri=http://localhost:1455/auth/callback

→ { access_token, refresh_token, id_token }
```

- 결과를 `~/.codex/auth.json`에 저장

### auth.json 저장 형식

```json
{
  "auth_mode": "ChatGpt",
  "last_refresh": "ISO 8601",
  "tokens": {
    "access_token": "...",
    "refresh_token": "...",
    "id_token": "..."
  }
}
```

---

## 4. 파일별 변경 내용

### 4-1. `lib/openai-device-auth.ts` (신규)

순수 HTTP device auth 구현:

```typescript
export async function startDeviceAuth(): Promise<{
  device_auth_id: string;
  user_code: string;
  interval: number;
}>

export async function pollDeviceAuth(device_auth_id: string, user_code: string): Promise<{
  status: "pending" | "complete";
  authorization_code?: string;
  code_verifier?: string;
}>

export async function exchangeCodeForTokens(
  authorization_code: string,
  code_verifier: string,
): Promise<{ access_token: string; refresh_token: string; id_token: string }>

export function saveAuthTokens(tokens: {
  access_token: string;
  refresh_token: string;
  id_token: string;
}): void
```

### 4-2. `lib/codex-auth.ts` (수정)

- `startCodexDeviceLogin()`: `runCodexDeviceLoginCommand` → `startDeviceAuth()` + `exchangeCodeForTokens()` 파이프라인
- `spawn` import 제거
- device_auth_id를 메모리에 보관해 polling에 재사용

### 4-3. `app/api/codex/login/poll/route.ts` (신규)

```
GET /api/codex/login/poll?device_auth_id=...&user_code=...
→ { status: "pending" | "complete" | "error", message?: string }
```

- `pollDeviceAuth()` 1회 호출 후 즉시 반환 (프론트엔드가 5초마다 재호출)

### 4-4. `lib/ai-edit.ts` (수정)

`requestDocumentPatches()`에서 `openai-oauth` 처리:

```typescript
// 변경 전
if (provider === "openai-oauth") {
  return requestPatchesWithCodexCli(...); // spawn("codex")
}

// 변경 후
if (provider === "openai-oauth") {
  const auth = getOpenAiAuthorization();
  if (!auth) throw new Error("로그인이 필요합니다");
  return requestPatchesWithOpenAiCompatible(request, "https://api.openai.com", auth.header);
}
```

- `spawn` import 제거
- `requestPatchesWithCodexCli()` 함수 제거
- `runCodexCli()` 함수 제거

### 4-5. `lib/useAiSettings.ts` (수정)

`startOpenAiOauthLogin()` 이후 자동 폴링:
- `device_auth_id`, `user_code`를 state로 보관
- `useEffect`에서 5초 인터벌로 `/api/codex/login/poll` 호출
- 완료 시 `refreshCodexSettings()` 호출하고 폴링 중단

### 4-6. `components/SettingsPanel.tsx` (수정)

OAuth 단계 UI:
- 로그인 버튼 클릭 → "로그인 코드를 만드는 중..." 표시
- 코드 발급 후 → user_code 굵게 표시 + URL 표시
- 폴링 중 → "로그인 확인 중... (X초 경과)" 표시
- 완료 시 → 자동으로 설정 완료

---

## 5. TDD 테스트 계획

### `lib/openai-device-auth.test.ts`

```typescript
// startDeviceAuth: fetch mock으로 성공/실패 케이스
// pollDeviceAuth: 403 → pending, 200 → complete
// exchangeCodeForTokens: 성공적 토큰 교환
// saveAuthTokens: auth.json 파일 형식 검증
```

### `lib/ai-edit.test.ts` (추가)

```typescript
// openai-oauth 라우팅이 requestPatchesWithOpenAiCompatible을 호출하는지 확인
// codex CLI spawn이 더 이상 호출되지 않는지 확인
```

---

## 6. 구현 우선순위

| 순서 | 태스크 |
|---|---|
| 1 | `lib/openai-device-auth.ts` + 테스트 |
| 2 | `lib/codex-auth.ts` 수정 (spawn 제거) |
| 3 | `/api/codex/login/poll` 라우트 신규 |
| 4 | `lib/ai-edit.ts` 수정 (spawn 제거, Chat Completions 사용) |
| 5 | `lib/useAiSettings.ts` 자동 폴링 |
| 6 | `components/SettingsPanel.tsx` 폴링 UI |
