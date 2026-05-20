type ToolbarProps = {
  isBusy: boolean;
  hasPendingPatches: boolean;
  onExtract: () => void;
  onSuggest: () => void;
  onApply: () => void;
  onExportHwp: () => void;
  onExportHwpx: () => void;
  onExportMarkdown: () => void;
  onExportHtml: () => void;
  onOpenSettings: () => void;
};

export function Toolbar({
  isBusy, hasPendingPatches,
  onExtract, onSuggest, onApply,
  onExportHwp, onExportHwpx, onExportMarkdown, onExportHtml,
  onOpenSettings,
}: ToolbarProps) {
  return (
    <section className="toolbar">
      <button disabled={isBusy} onClick={onExtract}>본문과 표 추출</button>
      <button disabled={isBusy} onClick={onSuggest}>수정 제안 만들기</button>
      <button disabled={isBusy || !hasPendingPatches} onClick={onApply}>제안 문서에 반영</button>
      <button disabled={isBusy} onClick={onExportHwp}>HWP 저장</button>
      <button disabled={isBusy} onClick={onExportHwpx}>HWPX 저장</button>
      <button disabled={isBusy} onClick={onExportMarkdown}>마크다운 저장</button>
      <button disabled={isBusy} onClick={onExportHtml}>HTML 저장</button>
      <button className="secondaryButton" disabled={isBusy} onClick={onOpenSettings}>인공지능 설정</button>
    </section>
  );
}
