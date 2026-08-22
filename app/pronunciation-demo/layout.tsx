import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "发音试听实验室 · 简辞",
  description: "比较 MiniMax 和 Xiaomi MiMo 语音模型的英语发音效果。",
};

export default function PronunciationDemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
