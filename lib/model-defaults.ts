// 제공자별 기본 모델 목록의 단일 출처. UI 선택 목록과 서버 폴백이 모두
// 이 상수를 쓰므로, 모델 세대 교체 시 이 파일만 수정하면 된다.

export const DEFAULT_OPENAI_MODELS = ["gpt-5.4-mini", "gpt-5.3-instant", "gpt-5.4-thinking", "gpt-5.4-pro"];

export const DEFAULT_GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash", "gemini-3-pro"];

// Claude CLI의 별칭은 CLI 버전과 무관하게 항상 최신 모델로 연결된다.
export const DEFAULT_CLAUDE_MODELS = ["sonnet", "opus", "haiku"];

export const DEFAULT_OPENAI_MODEL = DEFAULT_OPENAI_MODELS[0];
