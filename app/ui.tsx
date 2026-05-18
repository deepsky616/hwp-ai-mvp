"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { blocksToHtml, blocksToMarkdown, type DocumentBlock, type DocumentPatch } from "../lib/document";
import { shouldUseTextImportFallback } from "../lib/hwp-load";

type RhwpResponse<T> = {
  type?: string;
  id?: string;
  result?: T;
  error?: string;
};

function downloadBytes(fileName: string, bytes: Uint8Array, mime: string) {
  const safeBytes = bytes.slice();
  const blob = new Blob([safeBytes.buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadText(fileName: string, text: string, mime: string) {
  downloadBytes(fileName, new TextEncoder().encode(text), mime);
}

export default function HwpAiMvp() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [fileName, setFileName] = useState("document.hwp");
  const [status, setStatus] = useState("HWP 파일을 열어 주세요.");
  const [instruction, setInstruction] = useState("공문 문체로 자연스럽게 다듬고 오탈자를 수정해 주세요.");
  const [blocks, setBlocks] = useState<DocumentBlock[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const tableCellCount = useMemo(() => blocks.filter((block) => block.type === "tableCell").length, [blocks]);
  const paragraphCount = useMemo(() => blocks.filter((block) => block.type === "paragraph").length, [blocks]);

  const requestRhwp = useCallback(<T,>(method: string, params: Record<string, unknown> = {}) => {
    return new Promise<T>((resolve, reject) => {
      const frame = frameRef.current;
      if (!frame?.contentWindow) {
        reject(new Error("편집기가 아직 준비되지 않았습니다"));
        return;
      }

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
        if (data.error) reject(new Error(data.error));
        else resolve(data.result as T);
      }

      window.addEventListener("message", receive);
      frame.contentWindow.postMessage({ type: "rhwp-request", id, method, params }, window.location.origin);
    });
  }, []);

  async function loadFile(file: File) {
    setIsBusy(true);
    try {
      const data = await file.arrayBuffer();
      const result = await requestRhwp<{ pageCount: number }>("loadFile", { fileName: file.name, data });
      setFileName(file.name);
      setBlocks([]);
      setStatus(`문서를 열었습니다. 쪽 수: ${result.pageCount}`);
    } catch (error) {
      if (!shouldUseTextImportFallback(error)) {
        setStatus(error instanceof Error ? error.message : String(error));
        setIsBusy(false);
        return;
      }

      try {
        setStatus("문서 메타데이터 오류가 감지되어 텍스트 복구 열기를 시도합니다.");
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/hwp/recover", { method: "POST", body: form });
        const recovered = await response.json();
        if (!response.ok) throw new Error(recovered.error || "텍스트 복구 열기에 실패했습니다");
        const created = await requestRhwp<{ pageCount: number }>("createNewDocument");
        await requestRhwp("pasteHtml", { sectionIndex: 0, paragraphIndex: 0, charOffset: 0, html: recovered.html });
        const refreshed = await requestRhwp<DocumentBlock[]>("extractTextBlocks");
        setFileName(file.name.replace(/\.[^.]+$/, "") + "-recovered.hwp");
        setBlocks(refreshed);
        setStatus(`원본 HWP 메타데이터 오류 때문에 텍스트 복구 방식으로 열었습니다. 새 문서 쪽 수: ${created.pageCount}`);
      } catch (recoverError) {
        setStatus(recoverError instanceof Error ? recoverError.message : String(recoverError));
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function extractBlocks() {
    setIsBusy(true);
    try {
      const result = await requestRhwp<DocumentBlock[]>("extractTextBlocks");
      setBlocks(result);
      setStatus(`본문 ${result.filter((block) => block.type === "paragraph").length}개, 표 셀 ${result.filter((block) => block.type === "tableCell").length}개를 추출했습니다.`);
      return result;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      setIsBusy(false);
    }
  }

  async function applyAiEdit() {
    setIsBusy(true);
    try {
      const currentBlocks = blocks.length ? blocks : await requestRhwp<DocumentBlock[]>("extractTextBlocks");
      setBlocks(currentBlocks);
      const response = await fetch("/api/ai/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, blocks: currentBlocks }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI 수정에 실패했습니다");
      const patches = (data.patches ?? []) as DocumentPatch[];
      if (patches.length === 0) {
        setStatus("AI가 수정할 내용을 찾지 못했습니다.");
        return;
      }
      await requestRhwp("applyTextPatches", { patches });
      const refreshed = await requestRhwp<DocumentBlock[]>("extractTextBlocks");
      setBlocks(refreshed);
      setStatus(`AI 수정 패치 ${patches.length}개를 문서에 반영했습니다.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function exportHwp() {
    setIsBusy(true);
    try {
      const bytes = await requestRhwp<number[]>("exportHwp");
      downloadBytes(fileName.replace(/\.[^.]+$/, "") + "-edited.hwp", new Uint8Array(bytes), "application/x-hwp");
      setStatus("HWP 파일을 내려받았습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function exportHwpx() {
    setIsBusy(true);
    try {
      const bytes = await requestRhwp<number[]>("exportHwpx");
      downloadBytes(fileName.replace(/\.[^.]+$/, "") + ".hwpx", new Uint8Array(bytes), "application/octet-stream");
      setStatus("HWPX 파일을 내려받았습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function exportMarkdown() {
    const currentBlocks = blocks.length ? blocks : await extractBlocks();
    if (!currentBlocks.length) return;
    downloadText(fileName.replace(/\.[^.]+$/, "") + ".md", blocksToMarkdown(currentBlocks), "text/markdown;charset=utf-8");
    setStatus("마크다운 파일을 내려받았습니다.");
  }

  async function exportHtml() {
    const currentBlocks = blocks.length ? blocks : await extractBlocks();
    if (!currentBlocks.length) return;
    downloadText(fileName.replace(/\.[^.]+$/, "") + ".html", blocksToHtml(currentBlocks), "text/html;charset=utf-8");
    setStatus("HTML 파일을 내려받았습니다.");
  }

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
          <input type="file" accept=".hwp,.hwpx" onChange={(event) => event.target.files?.[0] && loadFile(event.target.files[0])} />
        </label>
      </section>

      <section className="toolbar">
        <button disabled={isBusy} onClick={extractBlocks}>본문과 표 추출</button>
        <button disabled={isBusy} onClick={applyAiEdit}>AI 수정 반영</button>
        <button disabled={isBusy} onClick={exportHwp}>HWP 저장</button>
        <button disabled={isBusy} onClick={exportHwpx}>HWPX 저장</button>
        <button disabled={isBusy} onClick={exportMarkdown}>마크다운 저장</button>
        <button disabled={isBusy} onClick={exportHtml}>HTML 저장</button>
      </section>

      <section className="panelGrid">
        <div className="card editorCard">
          <div className="cardHeader">
            <strong>문서 편집기</strong>
            <span>{fileName}</span>
          </div>
          <iframe ref={frameRef} title="HWP 편집기" src="/rhwp-studio/index.html" />
        </div>

        <aside className="card sideCard">
          <strong>AI 지시</strong>
          <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} />
          <div className="stats">
            <div><span>본문</span><b>{paragraphCount}</b></div>
            <div><span>표 셀</span><b>{tableCellCount}</b></div>
          </div>
          <p className="status">{isBusy ? "처리 중입니다..." : status}</p>
          <div className="preview">
            <strong>추출 미리보기</strong>
            <pre>{blocks.slice(0, 8).map((block) => `${block.type}: ${block.text}`).join("\n") || "아직 추출된 내용이 없습니다."}</pre>
          </div>
        </aside>
      </section>
    </main>
  );
}
