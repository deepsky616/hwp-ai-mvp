# HWP AI MVP 효율화 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코드 품질(컴포넌트 분리)·구독 UX(온보딩 마법사)·성능(스트리밍·청크)을 함께 개선한다.

**Architecture:** `ui.tsx`를 얇은 조립기로 줄이고 로직은 `useHwpEditor`/`useAiSettings` 훅으로, UI는 `Toolbar`/`ChatPanel`/`SettingsPanel` 컴포넌트로 분리한다. AI 응답은 SSE 스트리밍으로 전환하고 블록이 50개를 초과하면 청크 단위로 처리한다.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest, OpenAI API

---

## 파일 맵

| 동작 | 경로 | 역할 |
|------|------|------|
| 수정 | `lib/document.ts` | buildTableMatrix 공통 함수 추출 |
| 수정 | `lib/document.test.ts` | buildTableMatrix 테스트 추가 |
| 생성 | `lib/useAiSettings.ts` | AI 설정 상태 + localStorage 훅 |
| 생성 | `lib/useAiSettings.test.ts` | 훅 단위 테스트 |
| 생성 | `lib/useHwpEditor.ts` | iframe 통신 + 문서 상태 훅 |
| 생성 | `lib/useHwpEditor.test.ts` | 훅 단위 테스트 |
| 생성 | `components/ErrorBoundary.tsx` | 에러 경계 클래스 컴포넌트 |
| 생성 | `components/Toolbar.tsx` | 버튼 모음 컴포넌트 |
| 생성 | `components/ChatPanel.tsx` | 대화·패치·입력창 컴포넌트 |
| 생성 | `components/SettingsPanel.tsx` | 온보딩 마법사 + 설정 모달 |
| 수정 | `app/ui.tsx` | 조립기로 축소 |
| 수정 | `app/api/ai/edit/route.ts` | SSE 스트리밍으로 전환 |

---

## Task 1: document.ts — buildTableMatrix 추출

**Files:**
- Modify: `lib/document.ts`
- Modify: `lib/document.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `lib/document.test.ts` 끝에 추가

```typescript
import { blocksToHtml, blocksToMarkdown, buildTableMatrix, type DocumentBlock, type TableCellBlock } from "./document";

describe("buildTableMatrix", () => {
  it("셀 목록으로 2×2 행렬을 만든다", () => {
    const cells: TableCellBlock[] = [
      { type: "tableCell", id: "a", sectionIndex: 0, parentParagraphIndex: 0, controlIndex: 0, cellIndex: 0, cellParagraphIndex: 0, length: 2, text: "A", rows: 2, cols: 2 },
      { type: "tableCell", id: "b", sectionIndex: 0, parentParagraphIndex: 0, controlIndex: 0, cellIndex: 1, cellParagraphIndex: 0, length: 2, text: "B", rows: 2, cols: 2 },
      { type: "tableCell", id: "c", sectionIndex: 0, parentParagraphIndex: 0, controlIndex: 0, cellIndex: 2, cellParagraphIndex: 0, length: 2, text: "C", rows: 2, cols: 2 },
      { type: "tableCell", id: "d", sectionIndex: 0, parentParagraphIndex: 0, controlIndex: 0, cellIndex: 3, cellParagraphIndex: 0, length: 2, text: "D", rows: 2, cols: 2 },
    ];
    expect(buildTableMatrix(cells)).toEqual([["A", "B"], ["C", "D"]]);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npm run test
```
Expected: `buildTableMatrix is not exported`

- [ ] **Step 3: buildTableMatrix 추출** — `lib/document.ts`의 `blocksToMarkdown` 안에 있는 매트릭스 빌드 로직을 상단 함수로 추출하고 export

```typescript
export function buildTableMatrix(cells: TableCellBlock[]): string[][] {
  const cols = Math.max(1, ...cells.map((c) => c.cols ?? 1));
  const rows = Math.max(1, ...cells.map((c) => c.rows ?? Math.ceil((c.cellIndex + 1) / cols)));
  const matrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
  for (const cell of cells) {
    const row = Math.floor(cell.cellIndex / cols);
    const col = cell.cellIndex % cols;
    if (row < rows && col < cols) {
      matrix[row][col] = [matrix[row][col], cell.text.trim()].filter(Boolean).join(" ");
    }
  }
  return matrix;
}
```

`blocksToMarkdown`과 `blocksToHtml` 내부의 동일 로직을 `buildTableMatrix(tableCells)` 호출로 교체한다.

- [ ] **Step 4: 통과 확인**

```bash
npm run test
```
Expected: 전체 PASS (기존 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
git add lib/document.ts lib/document.test.ts
git commit -m "refactor: buildTableMatrix 공통 함수 추출"
```

---

## Task 2: useAiSettings 훅

**Files:**
- Create: `lib/useAiSettings.ts`
- Create: `lib/useAiSettings.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `lib/useAiSettings.test.ts` 생성

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiSettings } from "./useAiSettings";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("useAiSettings", () => {
  beforeEach(() => localStorageMock.clear());

  it("기본 provider는 openai", () => {
    const { result } = renderHook(() => useAiSettings());
    expect(result.current.aiProvider).toBe("openai");
  });

  it("setAiApiKey 후 effectiveAiSettings.apiKey 반영", () => {
    const { result } = renderHook(() => useAiSettings());
    act(() => result.current.setAiApiKey("sk-test"));
    expect(result.current.effectiveAiSettings.apiKey).toBe("sk-test");
  });

  it("localStorage에서 저장된 provider 복원", () => {
    localStorageMock.setItem("hwp-ai-provider", "ollama");
    const { result } = renderHook(() => useAiSettings());
    expect(result.current.aiProvider).toBe("ollama");
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npm run test
```
Expected: `useAiSettings is not exported`

- [ ] **Step 3: 훅 구현** — `lib/useAiSettings.ts` 생성

```typescript
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { startBrowserOpenAiAccountLogin, type OpenAiLoginStartResult } from "./openai-login-popup";

export type AiProvider = "openai" | "openai-oauth" | "ollama" | "mlx" | "custom";

export type AiSettings = {
  provider: AiProvider;
  apiKey?: string;
  baseUrl?: string;
  model: string;
};

export type CodexStatus = {
  authenticated: boolean;
  source: "codex-oauth" | "api-key" | "missing";
  authFile: string;
  accountId?: string;
  message: string;
};

export function useAiSettings() {
  const [aiProvider, setAiProvider] = useState<AiProvider>("openai");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4.1-mini");
  const [models, setModels] = useState<string[]>(["gpt-4.1-mini"]);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [aiTestMessage, setAiTestMessage] = useState("");
  const [oauthLoginCode, setOauthLoginCode] = useState("");
  const [oauthLoginUrl, setOauthLoginUrl] = useState("");

  const effectiveAiSettings = useMemo<AiSettings>(() => ({
    provider: aiProvider,
    apiKey: aiApiKey.trim() || undefined,
    baseUrl: aiBaseUrl.trim() || undefined,
    model: selectedModel,
  }), [aiProvider, aiApiKey, aiBaseUrl, selectedModel]);

  const refreshCodexSettings = useCallback(async () => {
    try {
      const statusRes = await fetch("/api/codex/status");
      const statusData = (await statusRes.json()) as CodexStatus;
      setCodexStatus(statusData);
      const modelsRes = await fetch("/api/codex/models");
      const modelsData = (await modelsRes.json()) as { models?: string[] };
      const next = modelsData.models?.length ? modelsData.models : ["gpt-4.1-mini"];
      setModels(next);
      const saved = window.localStorage.getItem("hwp-ai-model");
      setSelectedModel(saved && next.includes(saved) ? saved : next[0]);
    } catch (error) {
      setCodexStatus({ authenticated: false, source: "missing", authFile: "~/.codex/auth.json", message: error instanceof Error ? error.message : "설정을 불러오지 못했습니다." });
    }
  }, []);

  useEffect(() => {
    refreshCodexSettings();
    const savedProvider = window.localStorage.getItem("hwp-ai-provider") as AiProvider | null;
    const savedKey = window.localStorage.getItem("hwp-ai-api-key");
    const savedUrl = window.localStorage.getItem("hwp-ai-base-url");
    if (savedProvider && ["openai","openai-oauth","ollama","mlx","custom"].includes(savedProvider)) setAiProvider(savedProvider);
    if (savedKey) setAiApiKey(savedKey);
    if (savedUrl) setAiBaseUrl(savedUrl);
  }, [refreshCodexSettings]);

  useEffect(() => {
    window.localStorage.setItem("hwp-ai-model", selectedModel);
    window.localStorage.setItem("hwp-ai-provider", aiProvider);
    if (aiApiKey.trim()) window.localStorage.setItem("hwp-ai-api-key", aiApiKey.trim());
    else window.localStorage.removeItem("hwp-ai-api-key");
    if (aiBaseUrl.trim()) window.localStorage.setItem("hwp-ai-base-url", aiBaseUrl.trim());
    else window.localStorage.removeItem("hwp-ai-base-url");
  }, [selectedModel, aiProvider, aiApiKey, aiBaseUrl]);

  const testAiSettings = useCallback(async () => {
    setAiTestMessage("연결을 확인하는 중입니다...");
    try {
      const res = await fetch("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aiSettings: effectiveAiSettings }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "연결 테스트에 실패했습니다");
      setAiTestMessage(data.message || "연결에 성공했습니다.");
    } catch (error) {
      setAiTestMessage(error instanceof Error ? error.message : String(error));
    }
  }, [effectiveAiSettings]);

  const startOpenAiOauthLogin = useCallback(async () => {
    setAiProvider("openai-oauth");
    setAiTestMessage("OpenAI 계정 로그인 코드를 만드는 중입니다...");
    setOauthLoginCode("");
    setOauthLoginUrl("");
    try {
      const result = await startBrowserOpenAiAccountLogin({
        openWindow: (url, target, features) => window.open(url, target, features),
        requestLoginStart: async (): Promise<OpenAiLoginStartResult> => {
          const res = await fetch("/api/codex/login/start", { method: "POST" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "로그인을 시작하지 못했습니다");
          return data as OpenAiLoginStartResult;
        },
      });
      setOauthLoginCode(result.data.code || "");
      setOauthLoginUrl(result.data.loginUrl || "");
      const notice = result.popupBlocked ? " 팝업이 차단되면 아래 링크를 눌러 주세요." : "";
      setAiTestMessage((result.data.message || "로그인 창에서 코드를 입력해 주세요.") + notice);
    } catch (error) {
      setAiTestMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  return {
    aiProvider, setAiProvider,
    aiApiKey, setAiApiKey,
    aiBaseUrl, setAiBaseUrl,
    selectedModel, setSelectedModel,
    models, codexStatus, effectiveAiSettings,
    aiTestMessage, oauthLoginCode, oauthLoginUrl,
    refreshCodexSettings, testAiSettings, startOpenAiOauthLogin,
  };
}
```

- [ ] **Step 4: @testing-library/react 설치 (없으면)**

```bash
npm install -D @testing-library/react @testing-library/jest-dom
```

vitest.config가 없으면 `package.json`의 vitest 설정에 환경 추가:

```json
"vitest": { "environment": "jsdom" }
```

- [ ] **Step 5: 통과 확인**

```bash
npm run test
```
Expected: 전체 PASS

- [ ] **Step 6: 커밋**

```bash
git add lib/useAiSettings.ts lib/useAiSettings.test.ts
git commit -m "feat: useAiSettings 훅 추출"
```

---

## Task 3: useHwpEditor 훅

**Files:**
- Create: `lib/useHwpEditor.ts`
- Create: `lib/useHwpEditor.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `lib/useHwpEditor.test.ts` 생성

```typescript
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHwpEditor } from "./useHwpEditor";

describe("useHwpEditor", () => {
  it("초기 상태: 블록 빈 배열, isBusy false", () => {
    const { result } = renderHook(() => useHwpEditor());
    expect(result.current.blocks).toEqual([]);
    expect(result.current.isBusy).toBe(false);
  });

  it("clearPatches 호출 시 pendingPatches와 previewCards 초기화", () => {
    const { result } = renderHook(() => useHwpEditor());
    act(() => result.current.clearPatches());
    expect(result.current.pendingPatches).toEqual([]);
    expect(result.current.previewCards).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npm run test
```
Expected: `useHwpEditor is not exported`

- [ ] **Step 3: 훅 구현** — `lib/useHwpEditor.ts` 생성

```typescript
"use client";
import { useCallback, useRef, useState } from "react";
import { buildPatchPreviewCards, createChatMessage, summarizePatchResult, type ChatMessage, type PatchPreviewCard } from "./chat-panel";
import { blocksToHtml, blocksToMarkdown, type DocumentBlock, type DocumentPatch } from "./document";
import { shouldUseTextImportFallback } from "./hwp-load";
import type { AiSettings } from "./useAiSettings";

type RhwpResponse<T> = { type?: string; id?: string; result?: T; error?: string };

const CHUNK_SIZE = 50;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
    return fetch(url, init);
  }
}

export function useHwpEditor() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [fileName, setFileName] = useState("document.hwp");
  const [status, setStatus] = useState("HWP 파일을 열어 주세요.");
  const [blocks, setBlocks] = useState<DocumentBlock[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [pendingPatches, setPendingPatches] = useState<DocumentPatch[]>([]);
  const [previewCards, setPreviewCards] = useState<PatchPreviewCard[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    createChatMessage("assistant", "HWP 문서를 열고 원하는 수정 방향을 입력해 주세요.", "chat-welcome"),
  ]);

  const requestRhwp = useCallback(<T,>(method: string, params: Record<string, unknown> = {}) => {
    return new Promise<T>((resolve, reject) => {
      const frame = frameRef.current;
      if (!frame?.contentWindow) { reject(new Error("편집기가 아직 준비되지 않았습니다")); return; }
      const id = `rhwp-${method}-${crypto.randomUUID()}`;
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", receive);
        reject(new Error("요청 시간이 초과되었습니다"));
      }, 30000);
      function receive(event: MessageEvent<RhwpResponse<T>>) {
        if (event.origin !== window.location.origin) return;
        const data = event.data;
        if (data?.type !== "rhwp-response" || data.id !== id) return;
        window.clearTimeout(timeout);
        window.removeEventListener("message", receive);
        if (data.error) reject(new Error(data.error)); else resolve(data.result as T);
      }
      window.addEventListener("message", receive);
      frame.contentWindow.postMessage({ type: "rhwp-request", id, method, params }, window.location.origin);
    });
  }, []);

  const loadFile = useCallback(async (file: File) => {
    setIsBusy(true);
    try {
      const data = await file.arrayBuffer();
      const result = await requestRhwp<{ pageCount: number }>("loadFile", { fileName: file.name, data });
      setFileName(file.name);
      setBlocks([]);
      setPendingPatches([]);
      setPreviewCards([]);
      setStatus(`문서를 열었습니다. 쪽 수: ${result.pageCount}`);
      setChatMessages((m) => [...m, createChatMessage("system", `${file.name} 문서를 열었습니다.`)]);
    } catch (error) {
      if (!shouldUseTextImportFallback(error)) {
        setStatus(error instanceof Error ? error.message : String(error));
        setIsBusy(false);
        return;
      }
      try {
        setStatus("텍스트 복구 열기를 시도합니다.");
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/hwp/recover", { method: "POST", body: form });
        const recovered = await res.json();
        if (!res.ok) throw new Error(recovered.error || "텍스트 복구에 실패했습니다");
        const created = await requestRhwp<{ pageCount: number }>("createNewDocument");
        await requestRhwp("pasteHtml", { sectionIndex: 0, paragraphIndex: 0, charOffset: 0, html: recovered.html });
        const refreshed = await requestRhwp<DocumentBlock[]>("extractTextBlocks");
        setFileName(file.name.replace(/\.[^.]+$/, "") + "-recovered.hwp");
        setBlocks(refreshed);
        setPendingPatches([]);
        setPreviewCards([]);
        setStatus(`텍스트 복구 방식으로 열었습니다. 쪽 수: ${created.pageCount}`);
        setChatMessages((m) => [...m, createChatMessage("system", "텍스트 복구 방식으로 열었습니다.")]);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsBusy(false);
    }
  }, [requestRhwp]);

  const extractBlocks = useCallback(async () => {
    setIsBusy(true);
    try {
      const result = await requestRhwp<DocumentBlock[]>("extractTextBlocks");
      setBlocks(result);
      const pCount = result.filter((b) => b.type === "paragraph").length;
      const cCount = result.filter((b) => b.type === "tableCell").length;
      setStatus(`본문 ${pCount}개, 표 셀 ${cCount}개를 추출했습니다.`);
      setChatMessages((m) => [...m, createChatMessage("system", `본문 ${pCount}개와 표 셀 ${cCount}개를 읽었습니다.`)]);
      return result;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      setIsBusy(false);
    }
  }, [requestRhwp]);

  const createAiSuggestion = useCallback(async (instruction: string, aiSettings: AiSettings) => {
    if (!instruction.trim()) { setStatus("수정 지시를 입력해 주세요."); return; }
    setIsBusy(true);
    setChatMessages((m) => [...m, createChatMessage("user", instruction), createChatMessage("assistant", "문서를 읽고 수정 제안을 만드는 중입니다.")]);
    try {
      const currentBlocks = blocks.length ? blocks : await requestRhwp<DocumentBlock[]>("extractTextBlocks");
      setBlocks(currentBlocks);
      const chunks = chunkArray(currentBlocks, CHUNK_SIZE);
      const allPatches: DocumentPatch[] = [];
      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) setStatus(`${i + 1}/${chunks.length} 구간 처리 중...`);
        const res = await fetchWithRetry("/api/ai/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction, blocks: chunks[i], model: aiSettings.model, aiSettings }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "AI 수정에 실패했습니다");
        allPatches.push(...(data.patches ?? []));
      }
      setPendingPatches(allPatches);
      setPreviewCards(buildPatchPreviewCards(currentBlocks, allPatches));
      const summary = summarizePatchResult(allPatches);
      setStatus(summary);
      setChatMessages((m) => [...m, createChatMessage("assistant", summary)]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(msg);
      setChatMessages((m) => [...m, createChatMessage("assistant", `수정 제안을 만들지 못했습니다. ${msg}`)]);
    } finally {
      setIsBusy(false);
    }
  }, [blocks, requestRhwp]);

  const applyPendingAiEdit = useCallback(async () => {
    if (pendingPatches.length === 0) { setStatus("반영할 수정 제안이 없습니다."); return; }
    setIsBusy(true);
    try {
      await requestRhwp("applyTextPatches", { patches: pendingPatches });
      const refreshed = await requestRhwp<DocumentBlock[]>("extractTextBlocks");
      setBlocks(refreshed);
      setStatus(`수정 제안 ${pendingPatches.length}개를 문서에 반영했습니다.`);
      setChatMessages((m) => [...m, createChatMessage("system", `수정 제안 ${pendingPatches.length}개를 반영했습니다.`)]);
      setPendingPatches([]);
      setPreviewCards([]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(msg);
      setChatMessages((m) => [...m, createChatMessage("assistant", `문서 반영에 실패했습니다. ${msg}`)]);
    } finally {
      setIsBusy(false);
    }
  }, [pendingPatches, requestRhwp]);

  const clearPatches = useCallback(() => { setPendingPatches([]); setPreviewCards([]); }, []);

  function downloadBytes(name: string, bytes: Uint8Array, mime: string) {
    const blob = new Blob([bytes.buffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  const exportHwp = useCallback(async () => {
    setIsBusy(true);
    try {
      const bytes = await requestRhwp<number[]>("exportHwp");
      downloadBytes(fileName.replace(/\.[^.]+$/, "") + "-edited.hwp", new Uint8Array(bytes), "application/x-hwp");
      setStatus("HWP 파일을 내려받았습니다.");
    } catch (e) { setStatus(e instanceof Error ? e.message : String(e)); }
    finally { setIsBusy(false); }
  }, [fileName, requestRhwp]);

  const exportHwpx = useCallback(async () => {
    setIsBusy(true);
    try {
      const bytes = await requestRhwp<number[]>("exportHwpx");
      downloadBytes(fileName.replace(/\.[^.]+$/, "") + ".hwpx", new Uint8Array(bytes), "application/octet-stream");
      setStatus("HWPX 파일을 내려받았습니다.");
    } catch (e) { setStatus(e instanceof Error ? e.message : String(e)); }
    finally { setIsBusy(false); }
  }, [fileName, requestRhwp]);

  const exportMarkdown = useCallback(async () => {
    const current = blocks.length ? blocks : await extractBlocks();
    if (!current.length) return;
    const text = blocksToMarkdown(current);
    const blob = new Blob([new TextEncoder().encode(text)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = fileName.replace(/\.[^.]+$/, "") + ".md"; a.click();
    URL.revokeObjectURL(url);
    setStatus("마크다운 파일을 내려받았습니다.");
  }, [blocks, extractBlocks, fileName]);

  const exportHtml = useCallback(async () => {
    const current = blocks.length ? blocks : await extractBlocks();
    if (!current.length) return;
    const text = blocksToHtml(current);
    const blob = new Blob([new TextEncoder().encode(text)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = fileName.replace(/\.[^.]+$/, "") + ".html"; a.click();
    URL.revokeObjectURL(url);
    setStatus("HTML 파일을 내려받았습니다.");
  }, [blocks, extractBlocks, fileName]);

  return {
    frameRef, fileName, status, blocks, isBusy,
    pendingPatches, previewCards, chatMessages,
    loadFile, extractBlocks, createAiSuggestion,
    applyPendingAiEdit, clearPatches,
    exportHwp, exportHwpx, exportMarkdown, exportHtml,
  };
}
```

- [ ] **Step 4: 통과 확인**

```bash
npm run test
```
Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/useHwpEditor.ts lib/useHwpEditor.test.ts
git commit -m "feat: useHwpEditor 훅 추출 (청크 처리·재시도 포함)"
```

---

## Task 4: ErrorBoundary 컴포넌트

**Files:**
- Create: `components/ErrorBoundary.tsx`

- [ ] **Step 1: 구현** — `components/ErrorBoundary.tsx` 생성

```tsx
"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; fallback: ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  override render() {
    if (this.state.hasError) {
      return <div className="errorFallback">{this.props.fallback}</div>;
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: 빌드 확인**

```bash
npx tsc --noEmit
```
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add components/ErrorBoundary.tsx
git commit -m "feat: ErrorBoundary 컴포넌트 추가"
```

---

## Task 5: Toolbar 컴포넌트

**Files:**
- Create: `components/Toolbar.tsx`

- [ ] **Step 1: 구현** — `components/Toolbar.tsx` 생성

```tsx
type ToolbarProps = {
  isBusy: boolean;
  hasPendingPatches: boolean;
  onExtract: () => void;
  onSuggest: () => void;
  onApply: () => void;
  onExportHwp: () => void;
  onExportHwpx: () => void;
  onExportMarkdown: () => void;
  onExportHtml: () => void;
  onOpenSettings: () => void;
};

export function Toolbar({
  isBusy, hasPendingPatches,
  onExtract, onSuggest, onApply,
  onExportHwp, onExportHwpx, onExportMarkdown, onExportHtml,
  onOpenSettings,
}: ToolbarProps) {
  return (
    <section className="toolbar">
      <button disabled={isBusy} onClick={onExtract}>본문과 표 추출</button>
      <button disabled={isBusy} onClick={onSuggest}>수정 제안 만들기</button>
      <button disabled={isBusy || !hasPendingPatches} onClick={onApply}>제안 문서에 반영</button>
      <button disabled={isBusy} onClick={onExportHwp}>HWP 저장</button>
      <button disabled={isBusy} onClick={onExportHwpx}>HWPX 저장</button>
      <button disabled={isBusy} onClick={onExportMarkdown}>마크다운 저장</button>
      <button disabled={isBusy} onClick={onExportHtml}>HTML 저장</button>
      <button className="secondaryButton" disabled={isBusy} onClick={onOpenSettings}>인공지능 설정</button>
    </section>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```bash
npx tsc --noEmit
```
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add components/Toolbar.tsx
git commit -m "feat: Toolbar 컴포넌트 추출"
```

---

## Task 6: ChatPanel 컴포넌트

**Files:**
- Create: `components/ChatPanel.tsx`

- [ ] **Step 1: 구현** — `components/ChatPanel.tsx` 생성

```tsx
import type { ChatMessage, PatchPreviewCard } from "../lib/chat-panel";
import type { DocumentPatch } from "../lib/document";

type ChatPanelProps = {
  isBusy: boolean;
  status: string;
  chatMessages: ChatMessage[];
  previewCards: PatchPreviewCard[];
  pendingPatches: DocumentPatch[];
  instruction: string;
  paragraphCount: number;
  tableCellCount: number;
  onInstructionChange: (value: string) => void;
  onSuggest: () => void;
  onApply: () => void;
  onClearPatches: () => void;
  onOpenSettings: () => void;
};

const QUICK_PROMPTS = [
  { label: "공문체", text: "공문 문체로 자연스럽게 다듬고 오탈자를 수정해 주세요." },
  { label: "맞춤법", text: "맞춤법과 띄어쓰기를 바로잡고 어색한 표현을 자연스럽게 고쳐 주세요." },
  { label: "간결화", text: "핵심은 유지하면서 문장을 더 간결하게 정리해 주세요." },
  { label: "표 정리", text: "표 안의 내용을 보기 좋게 정리하고 항목명을 명확하게 바꿔 주세요." },
];

export function ChatPanel({
  isBusy, status, chatMessages, previewCards, pendingPatches,
  instruction, paragraphCount, tableCellCount,
  onInstructionChange, onSuggest, onApply, onClearPatches, onOpenSettings,
}: ChatPanelProps) {
  return (
    <aside className="card sideCard chatPanel">
      <div className="assistantHeader">
        <div>
          <span className="assistantKicker">문서 편집 대화</span>
          <strong>인공지능 문서 도우미</strong>
        </div>
        <button className="iconButton" type="button" onClick={onOpenSettings}>설정</button>
      </div>
      <div className="documentMiniStats">
        <div><span>본문</span><b>{paragraphCount}</b></div>
        <div><span>표 셀</span><b>{tableCellCount}</b></div>
        <div><span>제안</span><b>{pendingPatches.length}</b></div>
      </div>
      <div className="chatStream" aria-label="문서 편집 대화 내용">
        {chatMessages.map((msg) => (
          <div key={msg.id} className={`chatBubble ${msg.role}`}>
            <span className="chatAvatar">{msg.role === "user" ? "나" : msg.role === "assistant" ? "AI" : "상태"}</span>
            <div className="chatMessageBody">
              <span className="chatRoleLabel">{msg.role === "user" ? "사용자" : msg.role === "assistant" ? "문서 도우미" : "문서 상태"}</span>
              <p>{msg.text}</p>
            </div>
          </div>
        ))}
      </div>
      {previewCards.length > 0 && (
        <div className="proposalStack">
          <div className="proposalHeader">
            <strong>수정 전후 비교</strong>
            <button className="secondaryButton" disabled={isBusy} onClick={onClearPatches}>제안 비우기</button>
          </div>
          {previewCards.slice(0, 5).map((card) => (
            <article className="proposalCard" key={card.id}>
              <span>{card.label}</span>
              <div><b>기존</b><p>{card.before || "빈 내용"}</p></div>
              <div><b>수정</b><p>{card.after}</p></div>
            </article>
          ))}
          {previewCards.length > 5 && <p className="moreNotice">나머지 {previewCards.length - 5}개 제안도 문서 반영에 포함됩니다.</p>}
        </div>
      )}
      <div className="quickPrompts">
        {QUICK_PROMPTS.map(({ label, text }) => (
          <button key={label} type="button" onClick={() => onInstructionChange(text)}>{label}</button>
        ))}
      </div>
      <div className="composer">
        <textarea value={instruction} onChange={(e) => onInstructionChange(e.target.value)} placeholder="문서에 원하는 수정 지시를 입력하세요" />
        <div className="composerActions">
          <button disabled={isBusy} onClick={onSuggest}>보내기</button>
          <button className="secondaryButton" disabled={isBusy || pendingPatches.length === 0} onClick={onApply}>문서에 반영</button>
        </div>
      </div>
      <p className="status">{isBusy ? "처리 중입니다..." : status}</p>
    </aside>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add components/ChatPanel.tsx
git commit -m "feat: ChatPanel 컴포넌트 추출"
```

---

## Task 7: SettingsPanel — 온보딩 마법사

**Files:**
- Create: `components/SettingsPanel.tsx`

- [ ] **Step 1: 구현** — `components/SettingsPanel.tsx` 생성

```tsx
"use client";
import { useEffect, useState } from "react";
import type { AiProvider, CodexStatus } from "../lib/useAiSettings";

type SettingsPanelProps = {
  aiProvider: AiProvider;
  setAiProvider: (p: AiProvider) => void;
  aiApiKey: string;
  setAiApiKey: (k: string) => void;
  aiBaseUrl: string;
  setAiBaseUrl: (u: string) => void;
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  models: string[];
  codexStatus: CodexStatus | null;
  aiTestMessage: string;
  oauthLoginCode: string;
  oauthLoginUrl: string;
  onTest: () => void;
  onRefresh: () => void;
  onOauthLogin: () => void;
  onClose: () => void;
};

type WizardStep = "pick" | "apikey" | "oauth" | "local" | "done";

const SETUP_KEY = "hwp-ai-setup-complete";

export function SettingsPanel(props: SettingsPanelProps) {
  const [step, setStep] = useState<WizardStep>(() =>
    typeof window !== "undefined" && window.localStorage.getItem(SETUP_KEY) ? "done" : "pick"
  );

  function completeSetup() {
    window.localStorage.setItem(SETUP_KEY, "1");
    setStep("done");
  }

  if (step !== "done") {
    return <WizardModal step={step} setStep={setStep} completeSetup={completeSetup} {...props} />;
  }

  return <SettingsModal {...props} />;
}

function WizardModal({ step, setStep, completeSetup, ...props }: { step: WizardStep; setStep: (s: WizardStep) => void; completeSetup: () => void } & SettingsPanelProps) {
  return (
    <div className="modalOverlay">
      <div className="modalCard">
        {step === "pick" && (
          <>
            <h2>OpenAI를 어떻게 사용하시나요?</h2>
            <button onClick={() => { props.setAiProvider("openai"); setStep("apikey"); }}>
              💳 API 키가 있습니다
            </button>
            <button onClick={() => { props.setAiProvider("openai-oauth"); setStep("oauth"); }}>
              👤 OpenAI 계정으로 로그인
            </button>
            <button onClick={() => { props.setAiProvider("ollama"); setStep("local"); }}>
              💻 로컬 AI 사용 (Ollama / MLX)
            </button>
          </>
        )}
        {step === "apikey" && (
          <>
            <h2>API 키를 입력해 주세요</h2>
            <input type="password" value={props.aiApiKey} onChange={(e) => props.setAiApiKey(e.target.value)} placeholder="sk-..." autoFocus />
            <div className="wizardActions">
              <button className="secondaryButton" onClick={() => setStep("pick")}>뒤로</button>
              <button onClick={async () => { await props.onTest(); completeSetup(); }}>연결 확인 후 시작</button>
            </div>
            {props.aiTestMessage && <p className="settingsHint">{props.aiTestMessage}</p>}
          </>
        )}
        {step === "oauth" && (
          <>
            <h2>OpenAI 계정 로그인</h2>
            <p className="settingsHint">아래 버튼을 누르면 로그인 창이 열립니다. 창에 표시된 코드를 입력해 주세요.</p>
            <button onClick={props.onOauthLogin}>로그인 창 열기</button>
            {props.oauthLoginCode && (
              <p className="oauthCode">코드: <strong>{props.oauthLoginCode}</strong></p>
            )}
            {props.oauthLoginUrl && (
              <a href={props.oauthLoginUrl} target="_blank" rel="noreferrer">팝업이 막혔다면 여기를 클릭</a>
            )}
            <div className="wizardActions">
              <button className="secondaryButton" onClick={() => setStep("pick")}>뒤로</button>
              <button onClick={async () => { await props.onRefresh(); completeSetup(); }}>로그인 완료 — 시작하기</button>
            </div>
          </>
        )}
        {step === "local" && (
          <>
            <h2>로컬 AI 서버 주소</h2>
            <select value={props.aiProvider} onChange={(e) => props.setAiProvider(e.target.value as AiProvider)}>
              <option value="ollama">Ollama</option>
              <option value="mlx">MLX</option>
              <option value="custom">직접 입력</option>
            </select>
            <input value={props.aiBaseUrl} onChange={(e) => props.setAiBaseUrl(e.target.value)} placeholder="http://localhost:11434" />
            <input value={props.selectedModel} onChange={(e) => props.setSelectedModel(e.target.value)} placeholder="모델명" />
            <div className="wizardActions">
              <button className="secondaryButton" onClick={() => setStep("pick")}>뒤로</button>
              <button onClick={async () => { await props.onTest(); completeSetup(); }}>연결 확인 후 시작</button>
            </div>
            {props.aiTestMessage && <p className="settingsHint">{props.aiTestMessage}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function SettingsModal(props: SettingsPanelProps) {
  const isOauth = props.aiProvider === "openai-oauth";
  const connected = props.codexStatus?.authenticated || props.codexStatus?.source === "api-key";

  return (
    <div className="modalOverlay" onClick={props.onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <strong>인공지능 설정</strong>
          <button className="iconButton" onClick={props.onClose}>✕</button>
        </div>
        <div>
          <span className={connected || props.aiApiKey ? "statusDot good" : "statusDot warn"} />
          {props.aiTestMessage || props.codexStatus?.message || "인공지능 설정을 확인하는 중입니다."}
        </div>
        <label>제공자
          <select value={props.aiProvider} onChange={(e) => props.setAiProvider(e.target.value as AiProvider)}>
            <option value="openai">OpenAI API 키</option>
            <option value="openai-oauth">OpenAI 계정 로그인</option>
            <option value="ollama">로컬 Ollama</option>
            <option value="mlx">로컬 MLX 서버</option>
            <option value="custom">직접 입력 서버</option>
          </select>
        </label>
        <label>모델
          {(props.aiProvider === "openai" || isOauth) ? (
            <select value={props.selectedModel} onChange={(e) => props.setSelectedModel(e.target.value)}>
              {props.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input value={props.selectedModel} onChange={(e) => props.setSelectedModel(e.target.value)} placeholder="모델명" />
          )}
        </label>
        {!isOauth && props.aiProvider !== "openai" && (
          <label>서버 주소
            <input value={props.aiBaseUrl} onChange={(e) => props.setAiBaseUrl(e.target.value)} placeholder="http://localhost:11434" />
          </label>
        )}
        {isOauth && (
          <div className="oauthLoginBox">
            <button className="secondaryButton" onClick={props.onOauthLogin}>OpenAI 계정 로그인하기</button>
            {props.oauthLoginCode && <p>코드: <strong>{props.oauthLoginCode}</strong></p>}
            {props.oauthLoginUrl && <a href={props.oauthLoginUrl} target="_blank" rel="noreferrer">로그인 창 다시 열기</a>}
          </div>
        )}
        {(props.aiProvider === "openai" || props.aiProvider === "custom") && (
          <label>API 키
            <input type="password" value={props.aiApiKey} onChange={(e) => props.setAiApiKey(e.target.value)} placeholder="브라우저에 저장됩니다" />
          </label>
        )}
        <div className="settingsActions">
          <button className="secondaryButton" onClick={props.onTest}>연결 테스트</button>
          <button className="secondaryButton" onClick={props.onRefresh}>상태 새로고침</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```bash
npx tsc --noEmit
```
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add components/SettingsPanel.tsx
git commit -m "feat: SettingsPanel 온보딩 마법사 구현"
```

---

## Task 8: ui.tsx 조립기로 축소

**Files:**
- Modify: `app/ui.tsx`

- [ ] **Step 1: ui.tsx 전체 교체**

```tsx
"use client";
import { useMemo, useState } from "react";
import { ChatPanel } from "../components/ChatPanel";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SettingsPanel } from "../components/SettingsPanel";
import { Toolbar } from "../components/Toolbar";
import { useAiSettings } from "../lib/useAiSettings";
import { useHwpEditor } from "../lib/useHwpEditor";

export default function HwpAiMvp() {
  const editor = useHwpEditor();
  const settings = useAiSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [instruction, setInstruction] = useState("공문 문체로 자연스럽게 다듬고 오탈자를 수정해 주세요.");

  const paragraphCount = useMemo(() => editor.blocks.filter((b) => b.type === "paragraph").length, [editor.blocks]);
  const tableCellCount = useMemo(() => editor.blocks.filter((b) => b.type === "tableCell").length, [editor.blocks]);

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">HWP AI MVP</p>
          <h1>HWP 열기, AI 수정, 마크다운과 HTML 변환</h1>
          <p className="summary">브라우저 안에서 HWP를 열고, 표 셀까지 구조화해 추출한 뒤 AI 패치로 반영합니다.</p>
        </div>
        <label className="fileButton">
          HWP 파일 열기
          <input type="file" accept=".hwp,.hwpx" onChange={(e) => e.target.files?.[0] && editor.loadFile(e.target.files[0])} />
        </label>
      </section>

      <ErrorBoundary fallback="툴바 오류 — 새로고침해 주세요">
        <Toolbar
          isBusy={editor.isBusy}
          hasPendingPatches={editor.pendingPatches.length > 0}
          onExtract={editor.extractBlocks}
          onSuggest={() => editor.createAiSuggestion(instruction, settings.effectiveAiSettings)}
          onApply={editor.applyPendingAiEdit}
          onExportHwp={editor.exportHwp}
          onExportHwpx={editor.exportHwpx}
          onExportMarkdown={editor.exportMarkdown}
          onExportHtml={editor.exportHtml}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </ErrorBoundary>

      <section className="panelGrid">
        <div className="card editorCard">
          <div className="cardHeader">
            <strong>문서 편집기</strong>
            <span>{editor.fileName}</span>
          </div>
          <iframe ref={editor.frameRef} title="HWP 편집기" src="/rhwp-studio/index.html" />
        </div>

        <ErrorBoundary fallback="채팅 패널 오류 — 새로고침해 주세요">
          <ChatPanel
            isBusy={editor.isBusy}
            status={editor.status}
            chatMessages={editor.chatMessages}
            previewCards={editor.previewCards}
            pendingPatches={editor.pendingPatches}
            instruction={instruction}
            paragraphCount={paragraphCount}
            tableCellCount={tableCellCount}
            onInstructionChange={setInstruction}
            onSuggest={() => editor.createAiSuggestion(instruction, settings.effectiveAiSettings)}
            onApply={editor.applyPendingAiEdit}
            onClearPatches={editor.clearPatches}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </ErrorBoundary>
      </section>

      {settingsOpen && (
        <SettingsPanel
          aiProvider={settings.aiProvider}
          setAiProvider={settings.setAiProvider}
          aiApiKey={settings.aiApiKey}
          setAiApiKey={settings.setAiApiKey}
          aiBaseUrl={settings.aiBaseUrl}
          setAiBaseUrl={settings.setAiBaseUrl}
          selectedModel={settings.selectedModel}
          setSelectedModel={settings.setSelectedModel}
          models={settings.models}
          codexStatus={settings.codexStatus}
          aiTestMessage={settings.aiTestMessage}
          oauthLoginCode={settings.oauthLoginCode}
          oauthLoginUrl={settings.oauthLoginUrl}
          onTest={settings.testAiSettings}
          onRefresh={settings.refreshCodexSettings}
          onOauthLogin={settings.startOpenAiOauthLogin}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 2: 타입 오류 확인**

```bash
npx tsc --noEmit
```
Expected: 오류 없음

- [ ] **Step 3: 전체 테스트**

```bash
npm run test
```
Expected: 전체 PASS

- [ ] **Step 4: 커밋**

```bash
git add app/ui.tsx
git commit -m "refactor: ui.tsx 조립기로 축소 — 컴포넌트·훅 분리 완료"
```

---

## Task 9: SettingsPanel 상태 뱃지 CSS + 모달 스타일

**Files:**
- Modify: `app/style.css`

- [ ] **Step 1: 모달·뱃지 스타일 추가** — `app/style.css` 끝에 추가

```css
/* 모달 */
.modalOverlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modalCard {
  background: var(--surface, #fff);
  border-radius: 12px;
  padding: 28px 24px;
  width: min(480px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
}

.modalHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 온보딩 마법사 */
.wizardActions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}

.oauthCode {
  font-size: 1.1rem;
  text-align: center;
  letter-spacing: 0.05em;
}

/* 에러 경계 폴백 */
.errorFallback {
  padding: 16px;
  color: #b91c1c;
  background: #fef2f2;
  border-radius: 8px;
  font-size: 0.9rem;
}
```

- [ ] **Step 2: 개발 서버에서 확인**

```bash
npm run dev
```
브라우저에서 `http://localhost:3000` 열고:
- 첫 방문 시 온보딩 마법사 모달이 뜨는지 확인
- 제공자 선택 → API 키 입력 → "연결 확인 후 시작" 클릭
- 모달 닫힘 및 툴바 정상 표시 확인

- [ ] **Step 3: 커밋**

```bash
git add app/style.css
git commit -m "style: 온보딩 마법사·모달·에러 경계 CSS 추가"
```

---

## 역할 분배 요약

| Task | Codex (구현) | OpenCode (검증) |
|------|-------------|----------------|
| 1 — buildTableMatrix | 코드 추출 및 테스트 | 기존 변환 테스트 회귀 확인 |
| 2 — useAiSettings | 훅 구현 | localStorage 동기화 엣지케이스 |
| 3 — useHwpEditor | 훅 구현 (청크·재시도) | 청크 경계·에러 경로 검증 |
| 4 — ErrorBoundary | 구현 | 렌더 오류 발생 시 폴백 표시 확인 |
| 5 — Toolbar | 구현 | disabled 상태 조건 검증 |
| 6 — ChatPanel | 구현 | 스크롤·접근성(aria) 확인 |
| 7 — SettingsPanel | 온보딩 마법사 구현 | 단계 전환·localStorage 저장 확인 |
| 8 — ui.tsx | 조립기로 교체 | 전체 기능 회귀 테스트 |
| 9 — CSS | 스타일 추가 | 모달·뱃지 반응형 확인 |
