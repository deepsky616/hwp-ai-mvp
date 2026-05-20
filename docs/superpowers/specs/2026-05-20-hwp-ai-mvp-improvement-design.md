# HWP AI MVP 효율화 개선 설계

**날짜:** 2026-05-20  
**목표:** 코드 품질 + 실행 성능 + UX(구독 흐름) 전면 개선  
**범위:** `app/ui.tsx`, `lib/ai-edit.ts`, `lib/document.ts`, 신규 컴포넌트·훅

---

## 1. 컴포넌트 구조 분리

### 현재 문제
`app/ui.tsx` 단일 파일 300줄 이상에 상태 관리·비동기 로직·UI가 혼재.

### 목표 구조

```
app/ui.tsx                    # 얇은 조립기 (~50줄)
components/SettingsPanel.tsx  # AI 제공자 설정 + 온보딩 마법사
components/ChatPanel.tsx      # 대화·패치 미리보기·퀵 프롬프트·입력창
components/Toolbar.tsx        # 추출·제안·반영·저장 버튼
lib/useHwpEditor.ts           # iframe 통신 + 문서 상태 hook
lib/useAiSettings.ts          # AI 설정 상태 + localStorage 동기화 hook
```

### 인터페이스 규칙
- 각 컴포넌트는 props로만 통신, 내부 상태 최소화
- `useHwpEditor` — `loadFile`, `extractBlocks`, `applyPatches`, `export*` 제공
- `useAiSettings` — `effectiveAiSettings`, `save`, `test`, `oauthLogin` 제공
- `ui.tsx`는 두 훅을 조합해 하위 컴포넌트에 전달만 함

---

## 2. 구독 설정 UX 재설계

### 현재 문제
- 설정 패널이 사이드바 안에 숨겨져 있음
- 어떤 제공자를 선택해야 하는지 안내 없음
- OAuth 코드 입력 과정이 불분명함

### 첫 방문 — 온보딩 모달 (3단계)

**Step 1: 제공자 선택**
```
"OpenAI를 어떻게 사용하시나요?"
  💳 API 키가 있습니다          → Step 2a
  👤 OpenAI 계정으로 로그인     → Step 2b
  💻 로컬 AI 사용 (Ollama/MLX) → Step 2c
```

**Step 2b: OAuth 안내**
```
1. [로그인 창 열기] → 팝업 자동 오픈
2. 코드 굵게 강조: 【 ABC-123 】
3. "팝업이 막혔다면 → 여기를 클릭" 링크
4. 완료 후 자동 폴링 (3초 간격, 최대 5분)
```

**Step 3: 연결 성공 → 자동 닫힘**

### 이후 방문 — 상태 뱃지
```
헤더: ● OpenAI 연결됨  [설정 변경]
      ○ AI 미연결     [지금 설정하기]
```

- 상태 뱃지 클릭 → 모달 재오픈 (인라인 패널 제거)
- 연결 상태는 앱 로드 시 자동 확인 (`/api/codex/status`)

---

## 3. 성능 개선

### 3-1. AI 스트리밍 응답

**현재:** 전체 응답 대기 후 일괄 표시  
**개선:** `ReadableStream`으로 패치 도착 즉시 카드 추가

```
/api/ai/edit 라우트:
  - Content-Type: text/event-stream
  - 패치 하나 완성될 때마다 flush

UI:
  - fetch + ReadableStream + TextDecoder
  - 카드 실시간 추가
  - 진행 메시지: "수정 제안 생성 중... (3/7개 완료)"
```

### 3-2. 대용량 문서 청크 처리

**현재:** 블록 전체를 한 번에 전송 → 토큰 초과 위험  
**개선:** 50개 단위로 청크 분할 후 순차 처리, 패치 합산

```typescript
// lib/useHwpEditor.ts 내부
async function createSuggestionChunked(blocks: DocumentBlock[], instruction: string) {
  const CHUNK_SIZE = 50;
  const chunks = chunkArray(blocks, CHUNK_SIZE);
  const allPatches: DocumentPatch[] = [];
  for (let i = 0; i < chunks.length; i++) {
    setStatus(`${i + 1}/${chunks.length} 구간 처리 중...`);
    const patches = await fetchPatches(chunks[i], instruction);
    allPatches.push(...patches);
  }
  return allPatches;
}
```

### 3-3. API 재시도 로직

네트워크 일시 오류 대응: 실패 시 1회 자동 재시도 (1초 지연).

---

## 4. 코드 품질

### 4-1. document.ts 중복 제거

`blocksToMarkdown`·`blocksToHtml` 양쪽에 동일한 테이블 매트릭스 빌드 로직 존재.

```typescript
// 공통 헬퍼 추출
function buildTableMatrix(cells: TableCellBlock[]): string[][] { ... }

// 두 함수 모두 공유
export function blocksToMarkdown(blocks) { ... buildTableMatrix(cells) ... }
export function blocksToHtml(blocks)     { ... buildTableMatrix(cells) ... }
```

### 4-2. 에러 경계

런타임 오류 시 화면 전체가 깨지는 문제 방지.

```tsx
<ErrorBoundary fallback="편집기 오류 — 새로고침해 주세요">
  <HwpEditor />
</ErrorBoundary>

<ErrorBoundary fallback="채팅 패널 오류">
  <ChatPanel />
</ErrorBoundary>
```

---

## 5. 전체 데이터 흐름

```
사용자 액션
    ↓
useHwpEditor (상태 + iframe 통신)
    ↓
/api/ai/edit  (ReadableStream, 청크 단위)
    ↓ 실시간
ChatPanel (패치 카드 추가)
    ↓
useHwpEditor.applyPatches()
    ↓
rhwp iframe (문서 반영)
```

---

## 구현 우선순위

| 순서 | 항목 | 담당 |
|------|------|------|
| 1 | 컴포넌트 분리 (ui.tsx → 4파일 + 2훅) | Codex |
| 2 | 구독 온보딩 마법사 + 상태 뱃지 | Codex |
| 3 | document.ts 중복 제거 | Codex |
| 4 | AI 스트리밍 응답 | Codex |
| 5 | 청크 처리 + 재시도 | Codex |
| 6 | 에러 경계 추가 | Codex |
| 검증 전체 | 각 단계별 동작 확인 | OpenCode |
