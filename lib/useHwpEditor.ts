"use client";
import { useCallback, useRef, useState } from "react";
import { buildPatchPreviewCards, createChatMessage, replaceChatMessageText, summarizePatchResult, type ChatMessage, type PatchPreviewCard } from "./chat-panel";
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
  const res = await fetch(url, init);
  if (res.ok || res.status < 500) return res;
  await new Promise((r) => setTimeout(r, 1000));
  return fetch(url, init);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useHwpEditor() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const abortRef = useRef<AbortController | null>(null);
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
    const controller = new AbortController();
    abortRef.current = controller;
    setIsBusy(true);
    const progressId = `progress-${Date.now()}`;
    setChatMessages((m) => [
      ...m,
      createChatMessage("user", instruction),
      createChatMessage("assistant", "문서를 읽고 수정 제안을 만드는 중...", progressId),
    ]);
    const allPatches: DocumentPatch[] = [];
    let currentBlocks: DocumentBlock[] = blocks;
    let stoppedAtChunk = -1;
    let totalChunks = 0;
    try {
      currentBlocks = blocks.length ? blocks : await requestRhwp<DocumentBlock[]>("extractTextBlocks");
      setBlocks(currentBlocks);
      const chunks = chunkArray(currentBlocks, CHUNK_SIZE);
      totalChunks = chunks.length;
      for (let i = 0; i < chunks.length; i++) {
        if (controller.signal.aborted) { stoppedAtChunk = i; break; }
        const progressText =
          i === 0
            ? `1/${chunks.length} 구간 처리 중 · ${chunks[i].length}문단`
            : `${i + 1}/${chunks.length} 구간 처리 중 · 누적 ${allPatches.length}개 수정`;
        setStatus(progressText);
        setChatMessages((m) => replaceChatMessageText(m, progressId, progressText));
        const res = await fetchWithRetry("/api/ai/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction, blocks: chunks[i], model: aiSettings.model, aiSettings }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "AI 수정에 실패했습니다");
        allPatches.push(...(data.patches ?? []));
      }
      setPendingPatches(allPatches);
      setPreviewCards(buildPatchPreviewCards(currentBlocks, allPatches));
      if (stoppedAtChunk >= 0) {
        const stopMsg = `${stoppedAtChunk}/${totalChunks} 구간까지 처리 후 중단됨 · ${allPatches.length}개 수정 보관`;
        setStatus(stopMsg);
        setChatMessages((m) => replaceChatMessageText(m, progressId, stopMsg));
      } else {
        const summary = summarizePatchResult(allPatches);
        setStatus(summary);
        setChatMessages((m) => replaceChatMessageText(m, progressId, summary));
      }
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        setPendingPatches(allPatches);
        setPreviewCards(buildPatchPreviewCards(currentBlocks, allPatches));
        const stopMsg = `처리를 중단했습니다 · ${allPatches.length}개 수정 보관`;
        setStatus(stopMsg);
        setChatMessages((m) => replaceChatMessageText(m, progressId, stopMsg));
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        setStatus(msg);
        setChatMessages((m) => replaceChatMessageText(m, progressId, `수정 제안을 만들지 못했습니다. ${msg}`));
      }
    } finally {
      abortRef.current = null;
      setIsBusy(false);
    }
  }, [blocks, requestRhwp]);

  const stopProcessing = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
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
    loadFile, extractBlocks, createAiSuggestion, stopProcessing,
    applyPendingAiEdit, clearPatches,
    exportHwp, exportHwpx, exportMarkdown, exportHtml,
  };
}
