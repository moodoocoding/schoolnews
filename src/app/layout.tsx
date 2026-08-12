import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AI 교육, 오늘",
    template: "%s | AI 교육, 오늘",
  },
  description:
    "초등교육과 관련된 AI·디지털 교육의 변화를 하루 한 편씩 소개합니다.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <a className="skip-link" href="#main-content">
          본문 바로가기
        </a>
        {children}
      </body>
    </html>
  );
}
