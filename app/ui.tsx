"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPatchPreviewCards, createChatMessage, summarizePatchResult, type ChatMessage, type PatchPreviewCard } from "../lib/chat-panel";
import { blocksToHtml, blocksToMarkdown, type DocumentBlock, type DocumentPatch } from "../lib/document";
import { shouldUseTextImportFallback } from "../lib/hwp-load";

type RhwpResponse<T> = {
  type?: string;
  id?: string;
  result?: T;
  error?: string;
};

type CodexStatus = {
  authenticated: boolean;
  source: "codex-oauth" | "api-key" | "missing";
  authFile: string;
  accountId?: string;
  message: string;
};

type AiProvider = "openai" | "ollama" | "mlx" | "custom";

type AiSettings = {
  provider: AiProvider;
  apiKey?: string;
  baseUrl?: string;
  model: string;
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
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [models, setModels] = useState<string[]>(["gpt-4.1-mini"]);
  const [selectedModel, setSelectedModel] = useState("gpt-4.1-mini");
  const [aiProvider, setAiProvider] = useState<AiProvider>("openai");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiTestMessage, setAiTestMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    createChatMessage("assistant", "HWP 문서를 열고 원하는 수정 방향을 입력해 주세요. 수정 제안을 만든 뒤 비교 카드에서 확인하고 문서에 반영할 수 있습니다.", "chat-welcome"),
  ]);
  const [pendingPatches, setPendingPatches] = useState<DocumentPatch[]>([]);
  const [previewCards, setPreviewCards] = useState<PatchPreviewCard[]>([]);

  const tableCellCount = useMemo(() => blocks.filter((block) => block.type === "tableCell").length, [blocks]);
  const paragraphCount = useMemo(() => blocks.filter((block) => block.type === "paragraph").length, [blocks]);
  const codexConnected = codexStatus?.authenticated || codexStatus?.source === "api-key";
  const effectiveAiSettings = useMemo<AiSettings>(() => ({
    provider: aiProvider,
    apiKey: aiApiKey.trim() || undefined,
    baseUrl: aiBaseUrl.trim() || undefined,
    model: selectedModel,
  }), [aiProvider, aiApiKey, aiBaseUrl, selectedModel]);

  const refreshCodexSettings = useCallback(async () => {
    try {
      const statusResponse = await fetch("/api/codex/status");
      const statusData = (await statusResponse.json()) as CodexStatus;
      setCodexStatus(statusData);

      const modelsResponse = await fetch("/api/codex/models");
      const modelsData = (await modelsResponse.json()) as { models?: string[] };
      const nextModels = modelsData.models?.length ? modelsData.models : ["gpt-4.1-mini"];
      setModels(nextModels);
      const savedModel = window.localStorage.getItem("hwp-ai-model");
      setSelectedModel(savedModel && nextModels.includes(savedModel) ? savedModel : nextModels[0]);
    } catch (error) {
      setCodexStatus({
        authenticated: false,
        source: "missing",
        authFile: "~/.codex/auth.json",
        message: error instanceof Error ? error.message : "코덱스 설정을 불러오지 못했습니다.",
      });
    }
  }, []);

  useEffect(() => {
    refreshCodexSettings();
    const savedProvider = window.localStorage.getItem("hwp-ai-provider") as AiProvider | null;
    const savedApiKey = window.localStorage.getItem("hwp-ai-api-key");
    const savedBaseUrl = window.localStorage.getItem("hwp-ai-base-url");
    if (savedProvider && ["openai", "ollama", "mlx", "custom"].includes(savedProvider)) setAiProvider(savedProvider);
    if (savedApiKey) setAiApiKey(savedApiKey);
    if (savedBaseUrl) setAiBaseUrl(savedBaseUrl);
  }, [refreshCodexSettings]);

  useEffect(() => {
    window.localStorage.setItem("hwp-ai-model", selectedModel);
    window.localStorage.setItem("hwp-ai-provider", aiProvider);
    if (aiApiKey.trim()) window.localStorage.setItem("hwp-ai-api-key", aiApiKey.trim());
    else window.localStorage.removeItem("hwp-ai-api-key");
    if (aiBaseUrl.trim()) window.localStorage.setItem("hwp-ai-base-url", aiBaseUrl.trim());
    else window.localStorage.removeItem("hwp-ai-base-url");
  }, [selectedModel, aiProvider, aiApiKey, aiBaseUrl]);

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
      setPendingPatches([]);
      setPreviewCards([]);
      setStatus(`문서를 열었습니다. 쪽 수: ${result.pageCount}`);
      setChatMessages((messages) => [...messages, createChatMessage("system", `${file.name} 문서를 열었습니다. 이제 수정 지시를 입력할 수 있습니다.`)]);
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
        setPendingPatches([]);
        setPreviewCards([]);
        setStatus(`원본 HWP 메타데이터 오류 때문에 텍스트 복구 방식으로 열었습니다. 새 문서 쪽 수: ${created.pageCount}`);
        setChatMessages((messages) => [...messages, createChatMessage("system", "문서를 텍스트 복구 방식으로 열었습니다. 복구된 내용을 기준으로 수정할 수 있습니다.")]);
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
      setChatMessages((messages) => [...messages, createChatMessage("system", `본문 ${result.filter((block) => block.type === "paragraph").length}개와 표 셀 ${result.filter((block) => block.type === "tableCell").length}개를 읽었습니다.`)]);
      return result;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      setIsBusy(false);
    }
  }

  async function testAiSettings() {
    setAiTestMessage("연결을 확인하는 중입니다...");
    try {
      const response = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiSettings: effectiveAiSettings }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "연결 테스트에 실패했습니다");
      setAiTestMessage(data.message || "연결에 성공했습니다.");
      setStatus(data.message || "인공지능 연결에 성공했습니다.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAiTestMessage(message);
      setStatus(message);
    }
  }

  async function createAiSuggestion() {
    const prompt = instruction.trim();
    if (!prompt) {
      setStatus("수정 지시를 입력해 주세요.");
      return;
    }
    setIsBusy(true);
    setChatMessages((messages) => [...messages, createChatMessage("user", prompt), createChatMessage("assistant", "문서를 읽고 수정 제안을 만드는 중입니다.")]);
    try {
      const currentBlocks = blocks.length ? blocks : await requestRhwp<DocumentBlock[]>("extractTextBlocks");
      setBlocks(currentBlocks);
      const response = await fetch("/api/ai/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: prompt, blocks: currentBlocks, model: selectedModel, aiSettings: effectiveAiSettings }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI 수정에 실패했습니다");
      const patches = (data.patches ?? []) as DocumentPatch[];
      setPendingPatches(patches);
      setPreviewCards(buildPatchPreviewCards(currentBlocks, patches));
      const summary = summarizePatchResult(patches);
      setStatus(summary);
      setChatMessages((messages) => [...messages, createChatMessage("assistant", summary)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      setChatMessages((messages) => [...messages, createChatMessage("assistant", `수정 제안을 만들지 못했습니다. ${message}`)]);
    } finally {
      setIsBusy(false);
    }
  }

  async function applyPendingAiEdit() {
    if (pendingPatches.length === 0) {
      setStatus("반영할 수정 제안이 없습니다.");
      return;
    }
    setIsBusy(true);
    try {
      await requestRhwp("applyTextPatches", { patches: pendingPatches });
      const refreshed = await requestRhwp<DocumentBlock[]>("extractTextBlocks");
      setBlocks(refreshed);
      setStatus(`수정 제안 ${pendingPatches.length}개를 문서에 반영했습니다.`);
      setChatMessages((messages) => [...messages, createChatMessage("system", `수정 제안 ${pendingPatches.length}개를 문서에 반영했습니다.`)]);
      setPendingPatches([]);
      setPreviewCards([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      setChatMessages((messages) => [...messages, createChatMessage("assistant", `문서 반영에 실패했습니다. ${message}`)]);
    } finally {
      setIsBusy(false);
    }
  }

  function useQuickInstruction(nextInstruction: string) {
    setInstruction(nextInstruction);
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
        <button disabled={isBusy} onClick={createAiSuggestion}>수정 제안 만들기</button>
        <button disabled={isBusy || pendingPatches.length === 0} onClick={applyPendingAiEdit}>제안 문서에 반영</button>
        <button disabled={isBusy} onClick={exportHwp}>HWP 저장</button>
        <button disabled={isBusy} onClick={exportHwpx}>HWPX 저장</button>
        <button disabled={isBusy} onClick={exportMarkdown}>마크다운 저장</button>
        <button disabled={isBusy} onClick={exportHtml}>HTML 저장</button>
        <button className="secondaryButton" disabled={isBusy} onClick={() => setSettingsOpen((value) => !value)}>
          인공지능 설정
        </button>
      </section>

      <section className="panelGrid">
        <div className="card editorCard">
          <div className="cardHeader">
            <strong>문서 편집기</strong>
            <span>{fileName}</span>
          </div>
          <iframe ref={frameRef} title="HWP 편집기" src="/rhwp-studio/index.html" />
        </div>

        <aside className="card sideCard chatPanel">
          <div className="assistantHeader">
            <div>
              <span className="assistantKicker">문서 편집 대화</span>
              <strong>인공지능 문서 도우미</strong>
            </div>
            <button className="iconButton" type="button" onClick={() => setSettingsOpen((value) => !value)}>설정</button>
          </div>

          {settingsOpen && (
            <div className="inlineSettings">
              <div>
                <span className={codexConnected || aiApiKey || aiProvider !== "openai" ? "statusDot good" : "statusDot warn"} />
                {aiTestMessage || codexStatus?.message || "인공지능 설정을 확인하는 중입니다."}
              </div>
              <label>
                제공자
                <select value={aiProvider} onChange={(event) => setAiProvider(event.target.value as AiProvider)}>
                  <option value="openai">OpenAI API</option>
                  <option value="ollama">로컬 Ollama</option>
                  <option value="mlx">로컬 MLX 서버</option>
                  <option value="custom">직접 입력 서버</option>
                </select>
              </label>
              <label>
                모델
                {aiProvider === "openai" ? (
                  <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                    {models.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                ) : (
                  <input value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} placeholder="모델명을 입력하세요" />
                )}
              </label>
              {aiProvider !== "openai" && (
                <label>
                  서버 주소
                  <input value={aiBaseUrl} onChange={(event) => setAiBaseUrl(event.target.value)} placeholder={aiProvider === "ollama" ? "http://localhost:11434" : "http://localhost:8080"} />
                </label>
              )}
              {(aiProvider === "openai" || aiProvider === "custom") && (
                <label>
                  API 키
                  <input type="password" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder="브라우저에 저장됩니다" />
                </label>
              )}
              <div className="settingsActions">
                <button className="secondaryButton" type="button" onClick={testAiSettings}>연결 테스트</button>
                <button className="secondaryButton" type="button" onClick={refreshCodexSettings}>상태 새로고침</button>
              </div>
              <p className="settingsHint">입력한 값은 이 브라우저에만 저장되며, 문서 수정 요청과 연결 테스트 때만 서버로 전달됩니다.</p>
            </div>
          )}

          <div className="documentMiniStats">
            <div><span>본문</span><b>{paragraphCount}</b></div>
            <div><span>표 셀</span><b>{tableCellCount}</b></div>
            <div><span>제안</span><b>{pendingPatches.length}</b></div>
          </div>

          <div className="chatStream" aria-label="문서 편집 대화 내용">
            {chatMessages.map((message) => (
              <div key={message.id} className={`chatBubble ${message.role}`}>
                <span className="chatAvatar">{message.role === "user" ? "나" : message.role === "assistant" ? "AI" : "상태"}</span>
                <div className="chatMessageBody">
                  <span className="chatRoleLabel">{message.role === "user" ? "영석님" : message.role === "assistant" ? "문서 도우미" : "문서 상태"}</span>
                  <p>{message.text}</p>
                </div>
              </div>
            ))}
          </div>

          {previewCards.length > 0 && (
            <div className="proposalStack">
              <div className="proposalHeader">
                <strong>수정 전후 비교</strong>
                <button className="secondaryButton" disabled={isBusy} onClick={() => { setPendingPatches([]); setPreviewCards([]); }}>제안 비우기</button>
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
            <button type="button" onClick={() => useQuickInstruction("공문 문체로 자연스럽게 다듬고 오탈자를 수정해 주세요.")}>공문체</button>
            <button type="button" onClick={() => useQuickInstruction("맞춤법과 띄어쓰기를 바로잡고 어색한 표현을 자연스럽게 고쳐 주세요.")}>맞춤법</button>
            <button type="button" onClick={() => useQuickInstruction("핵심은 유지하면서 문장을 더 간결하게 정리해 주세요.")}>간결화</button>
            <button type="button" onClick={() => useQuickInstruction("표 안의 내용을 보기 좋게 정리하고 항목명을 명확하게 바꿔 주세요.")}>표 정리</button>
          </div>

          <div className="composer">
            <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="문서에 원하는 수정 지시를 입력하세요" />
            <div className="composerActions">
              <button disabled={isBusy} onClick={createAiSuggestion}>보내기</button>
              <button className="secondaryButton" disabled={isBusy || pendingPatches.length === 0} onClick={applyPendingAiEdit}>문서에 반영</button>
            </div>
          </div>

          <p className="status">{isBusy ? "처리 중입니다..." : status}</p>
        </aside>
      </section>
    </main>
  );
}
