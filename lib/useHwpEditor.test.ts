// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHwpEditor } from "./useHwpEditor";

describe("useHwpEditor", () => {
  it("초기 상태: 블록 빈 배열, isBusy false", () => {
    const { result } = renderHook(() => useHwpEditor());
    expect(result.current.blocks).toEqual([]);
    expect(result.current.isBusy).toBe(false);
  });

  it("clearPatches 호출 시 pendingPatches와 previewCards 초기화", () => {
    const { result } = renderHook(() => useHwpEditor());
    act(() => result.current.clearPatches());
    expect(result.current.pendingPatches).toEqual([]);
    expect(result.current.previewCards).toEqual([]);
  });
});
