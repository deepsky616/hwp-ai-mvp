import type { Metadata } from "next";
import "./style.css";

export const metadata: Metadata = {
  title: "HWP AI MVP",
  description: "HWP 문서를 열고 AI 수정, 마크다운, HTML 변환을 수행하는 MVP",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
