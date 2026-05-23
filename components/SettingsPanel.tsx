"use client";
import { useCallback, useEffect, useState } from "react";
import type { AiProvider, CodexStatus, GeminiLoginStatus } from "../lib/useAiSettings";

type CliInstallName = "codex" | "gemini";

// ─── 공통 서브컴포넌트 ───────────────────────────────────────────────────────

function CliInstallBox({ cliName, onInstalled, onDetected }: {
  cliName: CliInstallName;
  onInstalled?: () => void;
  onDetected?: (path: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "installing" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [isWindows, setIsWindows] = useState(false);

  useEffect(() => { setIsWindows(/Win/i.test(navigator.userAgent)); }, []);

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
        {isWindows ? "PowerShell:" : "터미널:"}{" "}
        <code className="cliCode">{`npm install -g ${pkg}`}</code>
      </p>
      {isWindows && (
        <p className="settingsHint">
          실행 정책 오류 시: <code className="cliCode">Set-ExecutionPolicy RemoteSigned -Scope CurrentUser</code>
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

function CliPathBox({ cliName, path, setPath, onDetected }: {
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

  const placeholder = cliName === "codex" ? "/usr/local/bin/codex" : "/usr/local/bin/gemini";

  return (
    <div className="cliPathBox">
      <label>
        실행 파일 경로
        <div className="cliPathRow">
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={placeholder} />
          <button type="button" className="secondaryButton" onClick={detect} disabled={detecting}>
            {detecting ? "탐색 중..." : "자동 감지"}
          </button>
        </div>
      </label>
      {detectMsg && (
        <p className={detectMsg.startsWith("감지됨") ? "settingsHint" : "settingsHint errorHint"}>{detectMsg}</p>
      )}
    </div>
  );
}

function OAuthCodeField({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copyCode = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const el = document.createElement("input");
        el.value = code;
        el.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  }, [code]);

  return (
    <div className="oauthCodeBox">
      <label htmlFor="oauth-code-input">인증 코드</label>
      <div className="oauthCodeRow">
        <input
          id="oauth-code-input"
          readOnly
          value={code}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
        />
        <button type="button" className="secondaryButton" onClick={copyCode}>
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
    </div>
  );
}

// ─── 모델 선택기 ─────────────────────────────────────────────────────────────

function ModelPicker({ models, value, onChange }: {
  models: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const inList = models.includes(value);
  const [useCustom, setUseCustom] = useState(models.length > 0 && !inList);

  useEffect(() => {
    if (models.includes(value)) setUseCustom(false);
  }, [models, value]);

  if (models.length === 0) {
    return (
      <input
        className="settingInput"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="모델명 (예: llama3.2)"
      />
    );
  }

  return (
    <div className="modelPicker">
      <select
        value={useCustom ? "__custom__" : value}
        onChange={(e) => {
          if (e.target.value === "__custom__") {
            setUseCustom(true);
            onChange("");
          } else {
            setUseCustom(false);
            onChange(e.target.value);
          }
        }}
      >
        {models.map((m) => <option key={m} value={m}>{m}</option>)}
        <option value="__custom__">직접 입력...</option>
      </select>
      {useCustom && (
        <input
          className="settingInput"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="모델명"
          autoFocus
        />
      )}
    </div>
  );
}

// ─── Props 타입 ───────────────────────────────────────────────────────────────

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
  geminiLoginStatus: GeminiLoginStatus | null;
  isGeminiPolling: boolean;
  onTest: () => void;
  onRefresh: () => void;
  onOauthLogin: () => void;
  onGeminiLogin: () => void;
  onClose: () => void;
};

// ─── 제공자 메타데이터 ────────────────────────────────────────────────────────

const PROVIDERS: { id: AiProvider; label: string; badge: string }[] = [
  { id: "codex-cli",  label: "Codex CLI",  badge: "OpenAI 구독" },
  { id: "gemini-cli", label: "Gemini CLI", badge: "Google 구독" },
  { id: "openai",     label: "OpenAI",     badge: "API 키" },
  { id: "gemini",     label: "Gemini",     badge: "API 키" },
  { id: "ollama",     label: "Ollama",     badge: "로컬" },
  { id: "mlx",        label: "MLX",        badge: "로컬" },
  { id: "custom",     label: "커스텀",     badge: "직접 입력" },
];

// ─── 진입점 ───────────────────────────────────────────────────────────────────

const SETUP_KEY = "hwp-ai-setup-complete";

export function SettingsPanel(props: SettingsPanelProps) {
  const [step, setStep] = useState<"pick" | "detail" | "done">(() =>
    typeof window !== "undefined" && window.localStorage.getItem(SETUP_KEY) ? "done" : "pick"
  );

  const completeSetup = useCallback(() => {
    window.localStorage.setItem(SETUP_KEY, "1");
    setStep("done");
  }, []);

  if (step !== "done") {
    return <WizardModal step={step} setStep={setStep} completeSetup={completeSetup} {...props} />;
  }

  return <SettingsModal onResetSetup={() => setStep("pick")} {...props} />;
}

// ─── 마법사 모달 ─────────────────────────────────────────────────────────────

function WizardModal({
  step, setStep, completeSetup, ...props
}: { step: "pick" | "detail"; setStep: (s: "pick" | "detail") => void; completeSetup: () => void } & SettingsPanelProps) {
  const isCli = props.aiProvider === "codex-cli" || props.aiProvider === "gemini-cli";
  const isApi = props.aiProvider === "openai" || props.aiProvider === "gemini";
  const isLocal = props.aiProvider === "ollama" || props.aiProvider === "mlx" || props.aiProvider === "custom";

  useEffect(() => {
    if (step === "detail" && isCli) {
      const authed =
        props.aiProvider === "gemini-cli"
          ? props.geminiLoginStatus?.authenticated
          : props.codexStatus?.authenticated;
      if (authed) completeSetup();
    }
  }, [props.codexStatus?.authenticated, props.geminiLoginStatus?.authenticated, step, isCli, props.aiProvider, completeSetup]);

  const cliName: CliInstallName = props.aiProvider === "gemini-cli" ? "gemini" : "codex";

  return (
    <div className="modalOverlay" onClick={props.onClose}>
      <div className="modalCard settingsCard--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <strong>AI 연결 설정</strong>
          <button className="iconButton" onClick={props.onClose}>✕</button>
        </div>

        {step === "pick" && (
          <>
            <p className="settingsHint" style={{ margin: 0 }}>사용할 AI 제공자를 선택하세요.</p>
            <div className="providerGrid">
              {PROVIDERS.map(({ id, label, badge }) => (
                <button
                  key={id}
                  className={`providerCard${props.aiProvider === id ? " active" : ""}`}
                  onClick={() => { props.setAiProvider(id); setStep("detail"); }}
                >
                  <span className="providerCardLabel">{label}</span>
                  <span className="providerCardBadge">{badge}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "detail" && (
          <>
            <div className="settingSection">
              <button
                className="backLink"
                onClick={() => setStep("pick")}
              >
                ← {PROVIDERS.find((p) => p.id === props.aiProvider)?.label}
              </button>

              {/* CLI 제공자 */}
              {isCli && (
                <>
                  <CliInstallBox
                    cliName={cliName}
                    onInstalled={props.onTest}
                    onDetected={cliName === "gemini" ? props.setGeminiCliPath : props.setCodexCliPath}
                  />
                  {props.aiProvider === "gemini-cli" ? (
                    <button onClick={props.onGeminiLogin} disabled={props.isGeminiPolling}>
                      {props.isGeminiPolling ? "로그인 확인 중..." : "Google 계정으로 로그인"}
                    </button>
                  ) : (
                    <button onClick={props.onOauthLogin} disabled={props.isPolling}>
                      {props.isPolling ? "로그인 확인 중..." : "OpenAI 계정으로 로그인"}
                    </button>
                  )}
                  {props.oauthLoginCode && props.aiProvider !== "gemini-cli" && (
                    <OAuthCodeField code={props.oauthLoginCode} />
                  )}
                </>
              )}

              {/* API 키 제공자 */}
              {isApi && (
                <>
                  <label className="settingLabel">
                    API 키
                    <input
                      type="password"
                      className="settingInput"
                      value={props.aiApiKey}
                      onChange={(e) => props.setAiApiKey(e.target.value)}
                      placeholder={props.aiProvider === "gemini" ? "Gemini API 키" : "sk-..."}
                      autoFocus
                    />
                  </label>
                </>
              )}

              {/* 로컬 제공자 */}
              {isLocal && (
                <>
                  <label className="settingLabel">
                    서버 주소
                    <input
                      className="settingInput"
                      value={props.aiBaseUrl}
                      onChange={(e) => props.setAiBaseUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                    />
                  </label>
                  <label className="settingLabel">
                    모델명
                    <input
                      className="settingInput"
                      value={props.selectedModel}
                      onChange={(e) => props.setSelectedModel(e.target.value)}
                      placeholder="llama3.2"
                    />
                  </label>
                </>
              )}
            </div>

            {props.aiTestMessage && (
              <p className="settingsHint">{props.aiTestMessage}</p>
            )}

            <div className="wizardActions">
              <button className="secondaryButton" onClick={async () => { await props.onTest(); completeSetup(); }}>
                연결 확인 후 시작
              </button>
              <button className="secondaryButton" onClick={completeSetup}>건너뛰기</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── 설정 모달 ───────────────────────────────────────────────────────────────

function SettingsModal({ onResetSetup, ...props }: SettingsPanelProps & { onResetSetup: () => void }) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isCli = props.aiProvider === "codex-cli" || props.aiProvider === "gemini-cli" || props.aiProvider === "openai-oauth";
  const isLocal = props.aiProvider === "ollama" || props.aiProvider === "mlx" || props.aiProvider === "custom";
  const usesApiKey = props.aiProvider === "openai" || props.aiProvider === "gemini" || props.aiProvider === "custom";
  const cliName: CliInstallName = props.aiProvider === "gemini-cli" ? "gemini" : "codex";

  const isConnected =
    props.aiProvider === "gemini-cli"
      ? (props.geminiLoginStatus?.authenticated ?? false)
      : props.aiProvider === "openai" || props.aiProvider === "gemini" || props.aiProvider === "custom"
        ? !!props.aiApiKey
        : (props.codexStatus?.authenticated ?? false);

  const statusText =
    props.aiTestMessage ||
    (props.aiProvider === "gemini-cli"
      ? (props.geminiLoginStatus?.message ?? "상태 확인 중...")
      : (props.codexStatus?.message ?? "상태 확인 중..."));

  return (
    <div className="modalOverlay" onClick={props.onClose}>
      <div className="modalCard settingsCard--wide" onClick={(e) => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="modalHeader">
          <strong>AI 설정</strong>
          <button className="iconButton" onClick={props.onClose}>✕</button>
        </div>

        {/* 상태 바 */}
        <div className={`statusBar${isConnected ? " statusBar--ok" : " statusBar--warn"}`}>
          <span className={`statusDot ${isConnected ? "good" : "warn"}`} />
          <span className="statusBarText">{statusText}</span>
          <span className="statusBarMeta">
            {PROVIDERS.find((p) => p.id === props.aiProvider)?.label}
            {props.selectedModel ? ` · ${props.selectedModel}` : ""}
          </span>
        </div>

        {/* 제공자 선택 */}
        <div className="settingSection">
          <p className="settingSectionLabel">제공자</p>
          <div className="providerPills">
            {PROVIDERS.map(({ id, label, badge }) => (
              <button
                key={id}
                className={`providerPill${props.aiProvider === id ? " active" : ""}`}
                onClick={() => props.setAiProvider(id)}
              >
                {label}
                <span className="pillBadge">{badge}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 모델 선택 */}
        <div className="settingSection">
          <p className="settingSectionLabel">모델</p>
          <ModelPicker
            models={props.models}
            value={props.selectedModel}
            onChange={props.setSelectedModel}
          />
        </div>

        {/* 연결 설정 — CLI */}
        {isCli && (
          <div className="settingSection">
            <p className="settingSectionLabel">로그인</p>
            {props.aiProvider === "gemini-cli" ? (
              <>
                <div className="connectionRow">
                  <button onClick={props.onGeminiLogin} disabled={props.isGeminiPolling}>
                    {props.isGeminiPolling ? "확인 중..." : "Google 계정으로 로그인"}
                  </button>
                  <button className="secondaryButton" onClick={props.onTest}>연결 테스트</button>
                </div>
                {props.geminiLoginStatus && (
                  <p className="settingsHint">
                    <span className={`statusDot ${props.geminiLoginStatus.authenticated ? "good" : "warn"}`} />
                    {props.geminiLoginStatus.message}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="connectionRow">
                  <button onClick={props.onOauthLogin} disabled={props.isPolling}>
                    {props.isPolling ? "확인 중..." : "OpenAI 계정으로 로그인"}
                  </button>
                  <button className="secondaryButton" onClick={props.onTest}>연결 테스트</button>
                </div>
                {props.codexStatus && (
                  <p className="settingsHint">
                    <span className={`statusDot ${props.codexStatus.authenticated ? "good" : "warn"}`} />
                    {props.codexStatus.message}
                  </p>
                )}
                {props.oauthLoginCode && <OAuthCodeField code={props.oauthLoginCode} />}
              </>
            )}

            {/* 고급: CLI 경로 */}
            <button
              className="advancedToggle"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "▲ 고급 설정 숨기기" : "▼ 고급 설정 (CLI 경로)"}
            </button>
            {showAdvanced && (
              <div className="advancedBox">
                <CliInstallBox
                  cliName={cliName}
                  onInstalled={props.onTest}
                  onDetected={cliName === "gemini" ? props.setGeminiCliPath : props.setCodexCliPath}
                />
                <CliPathBox
                  cliName={cliName}
                  path={cliName === "gemini" ? props.geminiCliPath : props.codexCliPath}
                  setPath={cliName === "gemini" ? props.setGeminiCliPath : props.setCodexCliPath}
                  onDetected={props.onTest}
                />
              </div>
            )}
          </div>
        )}

        {/* 연결 설정 — API 키 */}
        {usesApiKey && (
          <div className="settingSection">
            <p className="settingSectionLabel">API 키</p>
            <div className="connectionRow">
              <input
                type="password"
                className="settingInput"
                style={{ flex: 1 }}
                value={props.aiApiKey}
                onChange={(e) => props.setAiApiKey(e.target.value)}
                placeholder={props.aiProvider === "gemini" ? "Gemini API 키" : "sk-..."}
              />
              <button className="secondaryButton" onClick={props.onTest}>테스트</button>
            </div>
          </div>
        )}

        {/* 연결 설정 — 로컬 서버 */}
        {isLocal && (
          <div className="settingSection">
            <p className="settingSectionLabel">서버 주소</p>
            <div className="connectionRow">
              <input
                className="settingInput"
                style={{ flex: 1 }}
                value={props.aiBaseUrl}
                onChange={(e) => props.setAiBaseUrl(e.target.value)}
                placeholder="http://localhost:11434"
              />
              <button className="secondaryButton" onClick={props.onTest}>테스트</button>
            </div>
          </div>
        )}

        {/* 하단 액션 */}
        <div className="settingsFooter">
          <button className="secondaryButton smallBtn" onClick={props.onRefresh}>상태 새로고침</button>
          <button className="secondaryButton smallBtn" onClick={onResetSetup}>초기 설정 다시하기</button>
        </div>
      </div>
    </div>
  );
}
