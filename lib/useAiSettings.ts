"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  const pollingRef = useRef<{ device_auth_id: string; user_code: string } | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const effectiveAiSettings = useMemo<AiSettings>(
    () => ({
      provider: aiProvider,
      apiKey: aiApiKey.trim() || undefined,
      baseUrl: aiBaseUrl.trim() || undefined,
      model: selectedModel,
    }),
    [aiProvider, aiApiKey, aiBaseUrl, selectedModel],
  );

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
      setCodexStatus({
        authenticated: false,
        source: "missing",
        authFile: "~/.codex/auth.json",
        message: error instanceof Error ? error.message : "설정을 불러오지 못했습니다.",
      });
    }
  }, []);

  useEffect(() => {
    refreshCodexSettings();
    const savedProvider = window.localStorage.getItem("hwp-ai-provider") as AiProvider | null;
    const savedKey = window.localStorage.getItem("hwp-ai-api-key");
    const savedUrl = window.localStorage.getItem("hwp-ai-base-url");
    if (
      savedProvider &&
      ["openai", "openai-oauth", "ollama", "mlx", "custom"].includes(savedProvider)
    )
      setAiProvider(savedProvider);
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

  useEffect(() => {
    if (!isPolling) return;
    let isRunning = false;
    const id = setInterval(async () => {
      const p = pollingRef.current;
      if (!p || isRunning) return;
      isRunning = true;
      try {
        const res = await fetch(
          `/api/codex/login/poll?device_auth_id=${encodeURIComponent(p.device_auth_id)}&user_code=${encodeURIComponent(p.user_code)}`,
        );
        const data = (await res.json()) as { status: string; error?: string };
        if (data.status === "complete") {
          pollingRef.current = null;
          setIsPolling(false);
          setAiTestMessage("로그인이 완료되었습니다. 설정을 불러오는 중...");
          await refreshCodexSettings();
          setAiTestMessage("로그인이 완료되었습니다.");
        } else if (data.status === "error") {
          pollingRef.current = null;
          setIsPolling(false);
          setAiTestMessage(`로그인 확인 중 오류가 발생했습니다: ${data.error ?? "다시 시도해 주세요."}`);
        }
      } catch {
        // 일시적 네트워크 오류는 무시하고 계속 폴링
      } finally {
        isRunning = false;
      }
    }, 5000);
    return () => clearInterval(id);
  }, [isPolling, refreshCodexSettings]);

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
    setAiProvider("openai-oauth");
    setAiTestMessage("OpenAI 계정 로그인 코드를 만드는 중입니다...");
    setOauthLoginCode("");
    setOauthLoginUrl("");
    setIsPolling(false);
    pollingRef.current = null;

    const isElectron =
      typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");

    try {
      const result = await startBrowserOpenAiAccountLogin({
        openWindow: (url, target, features) => {
          if (isElectron && (!url || url === "about:blank")) return null;
          return window.open(url, target, features);
        },
        requestLoginStart: async (): Promise<OpenAiLoginStartResult> => {
          const res = await fetch("/api/codex/login/start", { method: "POST" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "로그인을 시작하지 못했습니다");
          return data as OpenAiLoginStartResult;
        },
      });

      const loginData = result.data;
      setOauthLoginCode(loginData.code || "");
      setOauthLoginUrl(loginData.loginUrl || "");

      if (loginData.device_auth_id && loginData.code) {
        pollingRef.current = { device_auth_id: loginData.device_auth_id, user_code: loginData.code };
        setIsPolling(true);
        setAiTestMessage("로그인 창에서 코드를 입력해 주세요. 완료되면 자동으로 감지합니다.");
      } else {
        const notice = result.popupBlocked ? " 팝업이 차단되면 아래 링크를 눌러 주세요." : "";
        setAiTestMessage(
          (loginData.message || "로그인 창에서 코드를 입력해 주세요.") + notice,
        );
      }
    } catch (error) {
      setAiTestMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

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
    oauthLoginCode,
    oauthLoginUrl,
    isPolling,
    refreshCodexSettings,
    testAiSettings,
    startOpenAiOauthLogin,
  };
}
