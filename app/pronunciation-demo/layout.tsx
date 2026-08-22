import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "发音试听实验室 · 简辞",
  description: "使用 MiniMax Speech-2.8 Turbo 与 HD 模型，按语言筛选官方系统音色并试听。",
};

export default function PronunciationDemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
