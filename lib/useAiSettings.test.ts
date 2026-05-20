// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
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
