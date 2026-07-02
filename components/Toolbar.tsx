// AI 수정 흐름(제안 만들기·중단·반영)은 채팅 패널이 담당한다.
// 툴바는 문서 단위 작업(다시 추출, 저장, 설정)만 맡아 중복 버튼을 없앤다.
type ToolbarProps = {
  isBusy: boolean;
  onExtract: () => void;
  onExportHwp: () => void;
  onExportHwpx: () => void;
  onExportMarkdown: () => void;
  onExportHtml: () => void;
  onOpenSettings: () => void;
};

export function Toolbar({
  isBusy,
  onExtract,
  onExportHwp, onExportHwpx, onExportMarkdown, onExportHtml,
  onOpenSettings,
}: ToolbarProps) {
  return (
    <section className="toolbar">
      <button className="secondaryButton" disabled={isBusy} onClick={onExtract}>본문 다시 추출</button>
      <span className="toolbarDivider" aria-hidden="true" />
      <button disabled={isBusy} onClick={onExportHwp}>HWP 저장</button>
      <button disabled={isBusy} onClick={onExportHwpx}>HWPX 저장</button>
      <button className="secondaryButton" disabled={isBusy} onClick={onExportMarkdown}>마크다운</button>
      <button className="secondaryButton" disabled={isBusy} onClick={onExportHtml}>HTML</button>
      <span className="toolbarSpacer" aria-hidden="true" />
      <button className="secondaryButton" disabled={isBusy} onClick={onOpenSettings}>인공지능 설정</button>
    </section>
  );
}
