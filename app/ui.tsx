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
          isPolling={settings.isPolling}
          codexCliPath={settings.codexCliPath}
          setCodexCliPath={settings.setCodexCliPath}
          geminiCliPath={settings.geminiCliPath}
          setGeminiCliPath={settings.setGeminiCliPath}
          geminiLoginStatus={settings.geminiLoginStatus}
          isGeminiPolling={settings.isGeminiPolling}
          onTest={settings.testAiSettings}
          onRefresh={settings.refreshCodexSettings}
          onOauthLogin={settings.startOpenAiOauthLogin}
          onGeminiLogin={settings.startGeminiOauthLogin}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
