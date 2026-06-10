// 복구 변환은 업로드 파일 전체를 메모리 버퍼로 읽으므로, 상한을 두어
// 대용량 업로드로 인한 메모리 고갈(DoS)을 방지한다.
export const MAX_RECOVER_FILE_BYTES = 50 * 1024 * 1024; // 50MB

export function isRecoverFileSizeAllowed(size: number): boolean {
  return Number.isFinite(size) && size > 0 && size <= MAX_RECOVER_FILE_BYTES;
}

// 본문을 메모리에 올리기 전에 Content-Length 헤더로 과대 요청을 먼저 거른다.
// 헤더가 없거나 파싱 불가하면 false를 반환하고 이후 file.size 검사에 맡긴다.
export function exceedsRecoverContentLength(headerValue: string | null): boolean {
  if (!headerValue) return false;
  const len = Number(headerValue);
  return Number.isFinite(len) && len > MAX_RECOVER_FILE_BYTES;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

export function shouldUseTextImportFallback(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  return (
    normalized.includes("docinfo") &&
    (normalized.includes("utf-16") || normalized.includes("utf16") || normalized.includes("surrogate"))
  );
}

export function markdownToImportHtml(markdown: string): string {
  const lines = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${escapeHtml(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }

    if (trimmed.includes("|") && index + 1 < lines.length && isSeparatorRow(lines[index + 1])) {
      flushParagraph();
      const rows: string[][] = [splitTableRow(trimmed)];
      index += 2;
      while (index < lines.length && lines[index].trim().includes("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      html.push(`<table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</table>`);
      continue;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listItem) {
      flushParagraph();
      const items = [listItem[1]];
      while (index + 1 < lines.length) {
        const next = /^[-*]\s+(.+)$/.exec(lines[index + 1].trim());
        if (!next) break;
        items.push(next[1]);
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return html.join("\n");
}
