"use client";
import { useCallback, useEffect, useState } from "react";
import type { AiProvider, CodexStatus } from "../lib/useAiSettings";

type CliInstallName = "codex" | "gemini";

function CliInstallBox({ cliName, onInstalled, onDetected }: { cliName: CliInstallName; onInstalled?: () => void; onDetected?: (path: string) => void }) {
  const [phase, setPhase] = useState<"idle" | "installing" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [isWindows, setIsWindows] = useState(false);

  useEffect(() => {
    setIsWindows(/Win/i.test(navigator.userAgent));
  }, []);

  const pkg = cliName === "codex" ? "@openai/codex" : "@google/gemini-cli";
  const label = cliName === "codex" ? "Codex CLI" : "Gemini CLI";

  const install = useCallback(async () => {
    setPhase("installing");
    setMsg("");
    try {
      const res = await fetch("/api/cli/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliName }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; detectedPath?: string | null };
      if (data.ok) {
        setPhase("done");
        if (data.detectedPath) {
          setMsg(`설치 완료 — 경로: ${data.detectedPath}`);
          onDetected?.(data.detectedPath);
        } else {
          setMsg("설치가 완료되었습니다. 경로 자동 감지를 눌러 주세요.");
        }
        onInstalled?.();
      } else {
        setPhase("error");
        setMsg(data.error ?? "설치에 실패했습니다.");
      }
    } catch {
      setPhase("error");
      setMsg("설치 요청 중 오류가 발생했습니다.");
    }
  }, [cliName, onInstalled, onDetected]);

  return (
    <div className="cliInstallBox">
      <p className="settingsHint">
        {label}가 설치되어 있지 않으면 원클릭 설치하거나, 터미널에서 직접 설치할 수 있습니다.
      </p>
      <p className="settingsHint">
        {isWindows ? "Windows — PowerShell 또는 명령 프롬프트:" : "macOS / Linux — 터미널:"}
        {" "}<code className="cliCode">{`npm install -g ${pkg}`}</code>
      </p>
      {isWindows && (
        <p className="settingsHint">
          PowerShell 실행 정책 오류 시:{" "}
          <code className="cliCode">Set-ExecutionPolicy RemoteSigned -Scope CurrentUser</code>
        </p>
      )}
      <button
        type="button"
        className="secondaryButton"
        onClick={install}
        disabled={phase === "installing" || phase === "done"}
      >
        {phase === "installing" ? `${label} 설치 중...` : phase === "done" ? `${label} 설치 완료` : `${label} 원클릭 설치`}
      </button>
      {msg && <p className={phase === "error" ? "settingsHint errorHint" : "settingsHint"}>{msg}</p>}
    </div>
  );
}

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
  isPolling: boolean;
  codexCliPath: string;
  setCodexCliPath: (p: string) => void;
  geminiCliPath: string;
  setGeminiCliPath: (p: string) => void;
  onTest: () => void;
  onRefresh: () => void;
  onOauthLogin: () => void;
  onClose: () => void;
};

function CliPathBox({
  cliName,
  path,
  setPath,
  onDetected,
}: {
  cliName: CliInstallName;
  path: string;
  setPath: (p: string) => void;
  onDetected?: () => void;
}) {
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState("");

  const detect = useCallback(async () => {
    setDetecting(true);
    setDetectMsg("");
    try {
      const res = await fetch(`/api/cli/detect?name=${cliName}`);
      const data = (await res.json()) as { found: boolean; path: string | null };
      if (data.found && data.path) {
        setPath(data.path);
        setDetectMsg(`감지됨: ${data.path}`);
        onDetected?.();
      } else {
        setDetectMsg("자동 감지 실패 — 경로를 직접 입력해 주세요.");
      }
    } catch {
      setDetectMsg("감지 요청 중 오류가 발생했습니다.");
    } finally {
      setDetecting(false);
    }
  }, [cliName, setPath, onDetected]);

  const label = cliName === "codex" ? "Codex CLI" : "Gemini CLI";
  const placeholder = cliName === "codex" ? "/usr/local/bin/codex" : "/usr/local/bin/gemini";

  return (
    <div className="cliPathBox">
      <label>
        {label} 실행 파일 경로
        <div className="cliPathRow">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder={placeholder}
          />
          <button type="button" className="secondaryButton" onClick={detect} disabled={detecting}>
            {detecting ? "탐색 중..." : "자동 감지"}
          </button>
        </div>
      </label>
      {detectMsg && (
        <p className={detectMsg.startsWith("감지됨") ? "settingsHint" : "settingsHint errorHint"}>
          {detectMsg}
        </p>
      )}
    </div>
  );
}

type WizardStep = "pick" | "apikey" | "oauth" | "local" | "done";

const SETUP_KEY = "hwp-ai-setup-complete";

export function SettingsPanel(props: SettingsPanelProps) {
  const [step, setStep] = useState<WizardStep>(() =>
    typeof window !== "undefined" && window.localStorage.getItem(SETUP_KEY) ? "done" : "pick"
  );

  const completeSetup = useCallback(() => {
    window.localStorage.setItem(SETUP_KEY, "1");
    setStep("done");
  }, []);

  if (step !== "done") {
    return <WizardModal step={step} setStep={setStep} completeSetup={completeSetup} {...props} />;
  }

  return <SettingsModal {...props} />;
}

function OAuthCodeField({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copyCode = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const input = document.createElement("input");
        input.value = code;
        input.setAttribute("readonly", "true");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [code]);

  return (
    <div className="oauthCodeBox">
      <label htmlFor="oauth-code-input">코드</label>
      <div className="oauthCodeRow">
        <input
          id="oauth-code-input"
          readOnly
          value={code}
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => event.currentTarget.select()}
          aria-label="OpenAI 로그인 코드"
        />
        <button type="button" className="secondaryButton" onClick={copyCode}>
          {copied ? "복사됨" : "코드 복사"}
        </button>
      </div>
    </div>
  );
}

function WizardModal({ step, setStep, completeSetup, ...props }: { step: WizardStep; setStep: (s: WizardStep) => void; completeSetup: () => void } & SettingsPanelProps) {
  useEffect(() => {
    if (step === "oauth" && props.codexStatus?.authenticated) {
      completeSetup();
    }
  }, [props.codexStatus?.authenticated, step, completeSetup]);

  return (
    <div className="modalOverlay" onClick={props.onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <span />
          <button className="iconButton" onClick={props.onClose}>x</button>
        </div>
        {step === "pick" && (
          <>
            <h2>OpenAI를 어떻게 사용하시나요?</h2>
            <button onClick={() => { props.setAiProvider("openai"); setStep("apikey"); }}>
              API 키가 있습니다
            </button>
            <button onClick={() => { props.setAiProvider("codex-cli"); setStep("oauth"); }}>
              Codex CLI 로그인 사용
            </button>
            <button onClick={() => { props.setAiProvider("gemini"); setStep("apikey"); }}>
              Gemini API 키가 있습니다
            </button>
            <button onClick={() => { props.setAiProvider("gemini-cli"); setStep("oauth"); }}>
              Gemini CLI 로그인 사용
            </button>
            <button onClick={() => { props.setAiProvider("ollama"); setStep("local"); }}>
              로컬 AI 사용 (Ollama / MLX)
            </button>
          </>
        )}
        {step === "apikey" && (
          <>
            <h2>API 키를 입력해 주세요</h2>
            <input type="password" value={props.aiApiKey} onChange={(e) => props.setAiApiKey(e.target.value)} placeholder={props.aiProvider === "gemini" ? "Gemini API 키" : "sk-..."} autoFocus />
            <div className="wizardActions">
              <button className="secondaryButton" onClick={() => setStep("pick")}>뒤로</button>
              <button onClick={async () => { await props.onTest(); completeSetup(); }}>연결 확인 후 시작</button>
            </div>
            {props.aiTestMessage && <p className="settingsHint">{props.aiTestMessage}</p>}
          </>
        )}
        {step === "oauth" && (
          <>
            <h2>{props.aiProvider === "gemini-cli" ? "Gemini CLI 로그인" : "Codex CLI 로그인"}</h2>
            <p className="settingsHint">
              {props.aiProvider === "gemini-cli"
                ? "터미널에서 gemini 로그인을 마친 뒤 연결 확인을 눌러 주세요."
                : "터미널에서 codex login을 마친 뒤 연결 확인을 눌러 주세요."}
            </p>
            <CliInstallBox
              cliName={props.aiProvider === "gemini-cli" ? "gemini" : "codex"}
              onInstalled={props.onTest}
              onDetected={props.aiProvider === "gemini-cli" ? props.setGeminiCliPath : props.setCodexCliPath}
            />
            <button onClick={props.onTest} disabled={props.isPolling}>
              연결 확인
            </button>
            {props.aiTestMessage && <p className="settingsHint">{props.aiTestMessage}</p>}
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
  const isCli = props.aiProvider === "codex-cli" || props.aiProvider === "gemini-cli" || props.aiProvider === "openai-oauth";
  const usesFixedModelList = ["openai", "codex-cli", "gemini", "gemini-cli", "openai-oauth"].includes(props.aiProvider);
  const usesApiKey = props.aiProvider === "openai" || props.aiProvider === "gemini" || props.aiProvider === "custom";
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
            <option value="codex-cli">Codex CLI 로그인</option>
            <option value="gemini">Gemini API 키</option>
            <option value="gemini-cli">Gemini CLI 로그인</option>
            <option value="ollama">로컬 Ollama</option>
            <option value="mlx">로컬 MLX 서버</option>
            <option value="custom">직접 입력 서버</option>
          </select>
        </label>
        <label>모델
          {usesFixedModelList ? (
            <select value={props.selectedModel} onChange={(e) => props.setSelectedModel(e.target.value)}>
              {props.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input value={props.selectedModel} onChange={(e) => props.setSelectedModel(e.target.value)} placeholder="모델명" />
          )}
        </label>
        {!isCli && props.aiProvider !== "openai" && props.aiProvider !== "gemini" && (
          <label>서버 주소
            <input value={props.aiBaseUrl} onChange={(e) => props.setAiBaseUrl(e.target.value)} placeholder="http://localhost:11434" />
          </label>
        )}
        {isCli && (() => {
          const cliName: CliInstallName = props.aiProvider === "gemini-cli" ? "gemini" : "codex";
          const cliPath = cliName === "gemini" ? props.geminiCliPath : props.codexCliPath;
          const setCliPath = cliName === "gemini" ? props.setGeminiCliPath : props.setCodexCliPath;
          return (
            <>
              <div className="oauthLoginBox">
                <button className="secondaryButton" onClick={props.onTest}>CLI 연결 테스트</button>
                <p className="settingsHint">
                  {props.aiProvider === "gemini-cli"
                    ? "Gemini CLI 로그인을 사용합니다. 터미널에서 gemini 로그인이 먼저 완료되어야 합니다."
                    : "Codex CLI 로그인을 사용합니다. 터미널에서 codex login이 먼저 완료되어야 합니다."}
                </p>
              </div>
              <CliInstallBox
                cliName={cliName}
                onInstalled={props.onTest}
                onDetected={setCliPath}
              />
              <CliPathBox
                cliName={cliName}
                path={cliPath}
                setPath={setCliPath}
                onDetected={props.onTest}
              />
            </>
          );
        })()}
        {usesApiKey && (
          <label>API 키
            <input type="password" value={props.aiApiKey} onChange={(e) => props.setAiApiKey(e.target.value)} placeholder={props.aiProvider === "gemini" ? "Gemini API 키" : "브라우저에 저장됩니다"} />
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
