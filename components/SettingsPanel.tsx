"use client";
import { useState } from "react";
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
              API 키가 있습니다
            </button>
            <button onClick={() => { props.setAiProvider("openai-oauth"); setStep("oauth"); }}>
              OpenAI 계정으로 로그인
            </button>
            <button onClick={() => { props.setAiProvider("ollama"); setStep("local"); }}>
              로컬 AI 사용 (Ollama / MLX)
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
              <button onClick={async () => {
                await props.onRefresh();
                if (props.codexStatus?.authenticated) {
                  completeSetup();
                } else {
                  alert("로그인이 확인되지 않았습니다. 로그인 창에서 코드를 입력한 뒤 다시 시도해 주세요.");
                }
              }}>로그인 완료 — 시작하기</button>
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
          <button className="iconButton" onClick={props.onClose}>x</button>
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
