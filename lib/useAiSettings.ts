"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type AiProvider = "openai" | "codex-cli" | "gemini" | "gemini-cli" | "openai-oauth" | "ollama" | "mlx" | "custom";

const OPENAI_MODELS = ["gpt-5.4-mini", "gpt-5.3-instant", "gpt-5.4-thinking", "gpt-5.4-pro"];
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash", "gemini-3-pro"];

function modelsForProvider(provider: AiProvider): string[] {
  if (provider === "gemini" || provider === "gemini-cli") return GEMINI_MODELS;
  if (provider === "openai" || provider === "codex-cli" || provider === "openai-oauth") return OPENAI_MODELS;
  return [];
}

export type AiSettings = {
  provider: AiProvider;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  codexCliPath?: string;
  geminiCliPath?: string;
};

export type CodexStatus = {
  authenticated: boolean;
  source: "codex-oauth" | "api-key" | "missing";
  authFile: string;
  accountId?: string;
  message: string;
};

export type GeminiLoginStatus = {
  authenticated: boolean;
  message: string;
};

export function useAiSettings() {
  const [aiProvider, setAiProvider] = useState<AiProvider>("openai");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [selectedModel, setSelectedModel] = useState(OPENAI_MODELS[0]);
  const [codexCliPath, setCodexCliPath] = useState("");
  const [geminiCliPath, setGeminiCliPath] = useState("");
  const [models, setModels] = useState<string[]>(OPENAI_MODELS);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [aiTestMessage, setAiTestMessage] = useState("");
  const [oauthLoginUrl, setOauthLoginUrl] = useState("");

  const codexSessionRef = useRef<{ sessionId: string } | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const [geminiLoginStatus, setGeminiLoginStatus] = useState<GeminiLoginStatus | null>(null);
  const geminiSessionRef = useRef<{ sessionId: string } | null>(null);
  const [isGeminiPolling, setIsGeminiPolling] = useState(false);

  const effectiveAiSettings = useMemo<AiSettings>(
    () => ({
      provider: aiProvider,
      apiKey: aiApiKey.trim() || undefined,
      baseUrl: aiBaseUrl.trim() || undefined,
      model: selectedModel,
      codexCliPath: codexCliPath.trim() || undefined,
      geminiCliPath: geminiCliPath.trim() || undefined,
    }),
    [aiProvider, aiApiKey, aiBaseUrl, selectedModel, codexCliPath, geminiCliPath],
  );

  const refreshCodexSettings = useCallback(async () => {
    try {
      const statusRes = await fetch("/api/codex/status");
      const statusData = (await statusRes.json()) as CodexStatus;
      setCodexStatus(statusData);
    } catch (error) {
      setCodexStatus({
        authenticated: false,
        source: "missing",
        authFile: "~/.codex/auth.json",
        message: error instanceof Error ? error.message : "설정을 불러오지 못했습니다.",
      });
    }
  }, []);

  const refreshGeminiStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/gemini/status");
      const data = (await res.json()) as GeminiLoginStatus;
      setGeminiLoginStatus(data);
    } catch {
      setGeminiLoginStatus({ authenticated: false, message: "Gemini 상태를 확인할 수 없습니다." });
    }
  }, []);

  useEffect(() => {
    refreshCodexSettings();
    refreshGeminiStatus();
    const savedProvider = window.localStorage.getItem("hwp-ai-provider") as AiProvider | null;
    const savedKey = window.localStorage.getItem("hwp-ai-api-key");
    const savedUrl = window.localStorage.getItem("hwp-ai-base-url");
    const savedCodexPath = window.localStorage.getItem("hwp-ai-codex-cli-path");
    const savedGeminiPath = window.localStorage.getItem("hwp-ai-gemini-cli-path");
    if (
      savedProvider &&
      ["openai", "codex-cli", "gemini", "gemini-cli", "openai-oauth", "ollama", "mlx", "custom"].includes(savedProvider)
    )
      setAiProvider(savedProvider === "openai-oauth" ? "codex-cli" : savedProvider);
    if (savedKey) setAiApiKey(savedKey);
    if (savedUrl) setAiBaseUrl(savedUrl);
    if (savedCodexPath) setCodexCliPath(savedCodexPath);
    if (savedGeminiPath) setGeminiCliPath(savedGeminiPath);
  }, [refreshCodexSettings, refreshGeminiStatus]);

  useEffect(() => {
    const next = modelsForProvider(aiProvider);
    if (!next.length) return;
    setModels(next);
    setSelectedModel((current) => (next.includes(current) ? current : next[0]));
  }, [aiProvider]);

  useEffect(() => {
    window.localStorage.setItem("hwp-ai-model", selectedModel);
    window.localStorage.setItem("hwp-ai-provider", aiProvider);
    if (aiApiKey.trim()) window.localStorage.setItem("hwp-ai-api-key", aiApiKey.trim());
    else window.localStorage.removeItem("hwp-ai-api-key");
    if (aiBaseUrl.trim()) window.localStorage.setItem("hwp-ai-base-url", aiBaseUrl.trim());
    else window.localStorage.removeItem("hwp-ai-base-url");
    if (codexCliPath.trim()) window.localStorage.setItem("hwp-ai-codex-cli-path", codexCliPath.trim());
    else window.localStorage.removeItem("hwp-ai-codex-cli-path");
    if (geminiCliPath.trim()) window.localStorage.setItem("hwp-ai-gemini-cli-path", geminiCliPath.trim());
    else window.localStorage.removeItem("hwp-ai-gemini-cli-path");
  }, [selectedModel, aiProvider, aiApiKey, aiBaseUrl, codexCliPath, geminiCliPath]);

  useEffect(() => {
    if (!isPolling) return;
    let isRunning = false;
    const id = setInterval(async () => {
      const p = codexSessionRef.current;
      if (!p || isRunning) return;
      isRunning = true;
      try {
        const res = await fetch(`/api/codex/login/poll?session_id=${encodeURIComponent(p.sessionId)}`);
        const data = (await res.json()) as { status: string; error?: string };
        if (data.status === "complete") {
          codexSessionRef.current = null;
          setIsPolling(false);
          setAiTestMessage("로그인이 완료되었습니다. 설정을 불러오는 중...");
          await refreshCodexSettings();
          setAiTestMessage("로그인이 완료되었습니다.");
        } else if (data.status === "error") {
          codexSessionRef.current = null;
          setIsPolling(false);
          setAiTestMessage(`로그인 확인 중 오류가 발생했습니다: ${data.error ?? "다시 시도해 주세요."}`);
        }
      } catch {
        // 일시적 네트워크 오류는 무시하고 계속 폴링
      } finally {
        isRunning = false;
      }
    }, 2000);
    return () => clearInterval(id);
  }, [isPolling, refreshCodexSettings]);

  useEffect(() => {
    if (!isGeminiPolling) return;
    let isRunning = false;
    const id = setInterval(async () => {
      const p = geminiSessionRef.current;
      if (!p || isRunning) return;
      isRunning = true;
      try {
        const res = await fetch(`/api/gemini/login/poll?session_id=${encodeURIComponent(p.sessionId)}`);
        const data = (await res.json()) as { status: string; error?: string };
        if (data.status === "complete") {
          geminiSessionRef.current = null;
          setIsGeminiPolling(false);
          setAiTestMessage("Gemini 로그인이 완료되었습니다. 상태를 불러오는 중...");
          await refreshGeminiStatus();
          setAiTestMessage("Gemini 로그인이 완료되었습니다.");
        } else if (data.status === "error") {
          geminiSessionRef.current = null;
          setIsGeminiPolling(false);
          setAiTestMessage(`Gemini 로그인 오류: ${data.error ?? "다시 시도해 주세요."}`);
        }
      } catch {
        // 일시적 오류 무시
      } finally {
        isRunning = false;
      }
    }, 3000);
    return () => clearInterval(id);
  }, [isGeminiPolling, refreshGeminiStatus]);

  const startGeminiOauthLogin = useCallback(async () => {
    setAiTestMessage("Google 로그인 창을 여는 중입니다...");
    setIsGeminiPolling(false);
    geminiSessionRef.current = null;
    try {
      const res = await fetch("/api/gemini/login/start", { method: "POST" });
      const data = (await res.json()) as { authUrl?: string; sessionId?: string; error?: string };
      if (!res.ok || !data.authUrl || !data.sessionId) {
        throw new Error(data.error ?? "로그인 시작에 실패했습니다");
      }
      window.open(data.authUrl, "_blank", "width=600,height=700,popup=yes");
      geminiSessionRef.current = { sessionId: data.sessionId };
      setIsGeminiPolling(true);
      setAiTestMessage("브라우저에서 Google 계정으로 로그인해 주세요. 완료 후 자동으로 감지됩니다.");
    } catch (error) {
      setAiTestMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const testAiSettings = useCallback(async () => {
    setAiTestMessage("연결을 확인하는 중입니다...");
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiSettings: effectiveAiSettings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "연결 테스트에 실패했습니다");
      setAiTestMessage(data.message || "연결에 성공했습니다.");
    } catch (error) {
      setAiTestMessage(error instanceof Error ? error.message : String(error));
    }
  }, [effectiveAiSettings]);

  const startOpenAiOauthLogin = useCallback(async () => {
    setAiProvider("codex-cli");
    setAiTestMessage("Codex 로그인을 시작합니다...");
    setOauthLoginUrl("");
    setIsPolling(false);
    codexSessionRef.current = null;

    try {
      const res = await fetch("/api/codex/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codexCliPath: codexCliPath.trim() || undefined }),
      });
      const data = (await res.json()) as { ok?: boolean; authUrl?: string; sessionId?: string; error?: string };
      if (!res.ok || !data.authUrl || !data.sessionId) {
        throw new Error(data.error ?? "로그인을 시작하지 못했습니다");
      }
      window.open(data.authUrl, "_blank", "width=600,height=760,popup=yes");
      setOauthLoginUrl(data.authUrl);
      codexSessionRef.current = { sessionId: data.sessionId };
      setIsPolling(true);
      setAiTestMessage("브라우저에서 OpenAI 계정으로 로그인해 주세요. 완료되면 자동으로 감지됩니다.");
    } catch (error) {
      setAiTestMessage(error instanceof Error ? error.message : String(error));
    }
  }, [codexCliPath]);

  return {
    aiProvider,
    setAiProvider,
    aiApiKey,
    setAiApiKey,
    aiBaseUrl,
    setAiBaseUrl,
    selectedModel,
    setSelectedModel,
    models,
    codexStatus,
    effectiveAiSettings,
    aiTestMessage,
    oauthLoginUrl,
    isPolling,
    codexCliPath,
    setCodexCliPath,
    geminiCliPath,
    setGeminiCliPath,
    geminiLoginStatus,
    isGeminiPolling,
    refreshCodexSettings,
    refreshGeminiStatus,
    testAiSettings,
    startOpenAiOauthLogin,
    startGeminiOauthLogin,
  };
}
