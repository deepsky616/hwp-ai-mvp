import type { ChatMessage, PatchPreviewCard } from "../lib/chat-panel";
import type { DocumentPatch } from "../lib/document";

type ChatPanelProps = {
  isBusy: boolean;
  status: string;
  chatMessages: ChatMessage[];
  previewCards: PatchPreviewCard[];
  pendingPatches: DocumentPatch[];
  instruction: string;
  paragraphCount: number;
  tableCellCount: number;
  excludedPatchIds: string[];
  onTogglePatch: (cardId: string) => void;
  onInstructionChange: (value: string) => void;
  onSuggest: () => void;
  onStop: () => void;
  onApply: () => void;
  onClearPatches: () => void;
  onOpenSettings: () => void;
};

const QUICK_PROMPTS = [
  { label: "공문체", text: "공문 문체로 자연스럽게 다듬고 오탈자를 수정해 주세요." },
  { label: "맞춤법", text: "맞춤법과 띄어쓰기를 바로잡고 어색한 표현을 자연스럽게 고쳐 주세요." },
  { label: "간결화", text: "핵심은 유지하면서 문장을 더 간결하게 정리해 주세요." },
  { label: "표 정리", text: "표 안의 내용을 보기 좋게 정리하고 항목명을 명확하게 바꿔 주세요." },
];

export function ChatPanel({
  isBusy, status, chatMessages, previewCards, pendingPatches,
  instruction, paragraphCount, tableCellCount,
  excludedPatchIds, onTogglePatch,
  onInstructionChange, onSuggest, onStop, onApply, onClearPatches, onOpenSettings,
}: ChatPanelProps) {
  const selectedCount = previewCards.filter((card) => !excludedPatchIds.includes(card.id)).length;
  return (
    <aside className="card sideCard chatPanel">
      <div className="assistantHeader">
        <div>
          <span className="assistantKicker">문서 편집 대화</span>
          <strong>인공지능 문서 도우미</strong>
        </div>
        <button className="iconButton" type="button" onClick={onOpenSettings}>설정</button>
      </div>
      <div className="documentMiniStats">
        <div><span>본문</span><b>{paragraphCount}</b></div>
        <div><span>표 셀</span><b>{tableCellCount}</b></div>
        <div><span>제안</span><b>{pendingPatches.length}</b></div>
      </div>
      <div className="chatStream" aria-label="문서 편집 대화 내용">
        {chatMessages.map((msg) => (
          <div key={msg.id} className={`chatBubble ${msg.role}`}>
            <span className="chatAvatar">{msg.role === "user" ? "나" : msg.role === "assistant" ? "AI" : "상태"}</span>
            <div className="chatMessageBody">
              <span className="chatRoleLabel">{msg.role === "user" ? "사용자" : msg.role === "assistant" ? "문서 도우미" : "문서 상태"}</span>
              <p>{msg.text}</p>
            </div>
          </div>
        ))}
      </div>
      {previewCards.length > 0 && (
        <div className="proposalStack">
          <div className="proposalHeader">
            <strong>수정 전후 비교</strong>
            <button className="secondaryButton" disabled={isBusy} onClick={onClearPatches}>제안 비우기</button>
          </div>
          {previewCards.map((card) => {
            const checked = !excludedPatchIds.includes(card.id);
            return (
              <article className="proposalCard" key={card.id} style={checked ? undefined : { opacity: 0.55 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isBusy}
                    onChange={() => onTogglePatch(card.id)}
                  />
                  <span>{card.label}</span>
                </label>
                <div><b>기존</b><p>{card.before || "빈 내용"}</p></div>
                <div><b>수정</b><p>{card.after}</p></div>
              </article>
            );
          })}
        </div>
      )}
      <div className="quickPrompts">
        {QUICK_PROMPTS.map(({ label, text }) => (
          <button key={label} type="button" onClick={() => onInstructionChange(text)}>{label}</button>
        ))}
      </div>
      <div className="composer">
        <textarea
          value={instruction}
          onChange={(e) => onInstructionChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!isBusy && instruction.trim()) onSuggest();
            }
          }}
          placeholder="문서에 원하는 수정 지시를 입력하세요 (Enter로 보내기, Shift+Enter 줄바꿈)"
        />
        <div className="composerActions">
          {isBusy ? (
            <button className="stopButton" onClick={onStop}>처리 중단</button>
          ) : (
            <button onClick={onSuggest}>보내기</button>
          )}
          <button className="secondaryButton" disabled={isBusy || pendingPatches.length === 0 || selectedCount === 0} onClick={onApply}>
            {pendingPatches.length > 0 ? `문서에 반영 (${selectedCount}/${previewCards.length})` : "문서에 반영"}
          </button>
        </div>
      </div>
      <p className="status">{isBusy ? "처리 중입니다..." : status}</p>
    </aside>
  );
}
