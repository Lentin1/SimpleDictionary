"use client";

import { FormEvent, useEffect, useState } from "react";

type TutorWord = {
  id: number;
  word: string;
  phonetic: string;
  senses: Array<{ part: string; meaning: string }>;
  example: string;
  translation: string;
};

type TutorMessage = {
  role: "user" | "assistant";
  content: string;
};

type LlmSettings = {
  endpoint: string;
  model: string;
  apiKey: string;
};

const SETTINGS_KEY = "simple-dictionary-llm-settings-v1";
const EMPTY_SETTINGS: LlmSettings = { endpoint: "", model: "", apiKey: "" };
const QUICK_QUESTIONS = ["怎么记住这个词？", "给我一个简单例句", "它和近义词有什么区别？"];

function renderInlineMarkdown(text: string) {
  return text
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g)
    .filter(Boolean)
    .map((token, index) => {
      if (token.startsWith("**") && token.endsWith("**")) {
        return <strong key={`${token}-${index}`}>{token.slice(2, -2)}</strong>;
      }
      if (token.startsWith("`") && token.endsWith("`")) {
        return <code key={`${token}-${index}`}>{token.slice(1, -1)}</code>;
      }
      if (token.startsWith("*") && token.endsWith("*")) {
        return <em key={`${token}-${index}`}>{token.slice(1, -1)}</em>;
      }
      return token;
    });
}

function MessageContent({ content }: { content: string }) {
  return <div className="ai-message-content">{content.split(/\r?\n/).map((line, index) => {
    const text = line.trim();
    if (!text) return <span className="ai-markdown-gap" key={`gap-${index}`} />;

    const heading = text.match(/^#{1,3}\s+(.+)$/);
    if (heading) return <p className="ai-markdown-heading" key={`heading-${index}`}>{renderInlineMarkdown(heading[1])}</p>;

    const bullet = text.match(/^[-*]\s+(.+)$/);
    if (bullet) return <p className="ai-markdown-list" key={`bullet-${index}`}><span>•</span><span>{renderInlineMarkdown(bullet[1])}</span></p>;

    const numbered = text.match(/^(\d+)\.\s+(.+)$/);
    if (numbered) return <p className="ai-markdown-list" key={`numbered-${index}`}><span>{numbered[1]}.</span><span>{renderInlineMarkdown(numbered[2])}</span></p>;

    return <p key={`paragraph-${index}`}>{renderInlineMarkdown(text)}</p>;
  })}</div>;
}

function loadSettings(): LlmSettings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<LlmSettings> | null;
    return {
      endpoint: typeof parsed?.endpoint === "string" ? parsed.endpoint : "",
      model: typeof parsed?.model === "string" ? parsed.model : "",
      apiKey: typeof parsed?.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return EMPTY_SETTINGS;
  }
}

export function WordAiTutor({ word, unlocked, answer }: {
  word: TutorWord;
  unlocked: boolean;
  answer: "known" | "unknown" | null;
}) {
  const [settings, setSettings] = useState<LlmSettings>(EMPTY_SETTINGS);
  const [draft, setDraft] = useState<LlmSettings>(EMPTY_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const configured = Boolean(settings.endpoint.trim() && settings.model.trim());

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = loadSettings();
      setSettings(saved);
      setDraft(saved);
      setShowSettings(!saved.endpoint.trim() || !saved.model.trim());
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function saveSettings() {
    const next = {
      endpoint: draft.endpoint.trim(),
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
    };
    if (!next.endpoint || !next.model) {
      setError("请填写接口地址和模型名称。");
      return;
    }
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    setSettings(next);
    setShowSettings(false);
    setError("");
  }

  async function ask(rawQuestion: string) {
    const content = rawQuestion.trim();
    if (!content || loading) return;
    if (!unlocked) {
      setError("请先选择认识或不认识，再向 AI 提问。");
      return;
    }
    if (!configured) {
      setShowSettings(true);
      setError("请先完成 LLM API 设置。");
      return;
    }

    const userMessage: TutorMessage = { role: "user", content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setQuestion("");
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: settings.endpoint,
          model: settings.model,
          apiKey: settings.apiKey,
          answer,
          word,
          messages: nextMessages,
        }),
      });
      const payload = await response.json() as { content?: string; error?: string };
      if (!response.ok || !payload.content) throw new Error(payload.error || "AI 暂时没有返回内容。");
      setMessages((current) => [...current, { role: "assistant", content: payload.content! }]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "连接 LLM API 失败，请检查设置。");
    } finally {
      setLoading(false);
    }
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <aside className={`ai-tutor-panel ${unlocked ? "unlocked" : "locked"}`} aria-label="AI 单词助教">
      <div className="ai-tutor-heading">
        <div><span>AI 助教</span><h3>问问这个词</h3></div>
        <button type="button" onClick={() => { setDraft(settings); setShowSettings((open) => !open); }}>{showSettings ? "收起" : "API 设置"}</button>
      </div>

      {showSettings && <div className="ai-settings">
        <label>接口地址<input type="url" value={draft.endpoint} onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))} placeholder="https://…/v1/chat/completions" /></label>
        <label>模型名称<input value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} placeholder="填写 API 支持的模型" /></label>
        <label>API Key（本机保存）<input type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))} placeholder="本机模型可留空" /></label>
        <button className="ai-settings-save" type="button" onClick={saveSettings}>保存 API 设置</button>
        <p>兼容 OpenAI Chat Completions。Key 只保存在当前设备，不会加入词书或备份。</p>
      </div>}

      {!showSettings && <>
        <div className="ai-word-context"><strong>{word.word}</strong><span>{word.phonetic}</span></div>
        {!unlocked ? <div className="ai-locked-state"><span>?</span><strong>答题后可以继续追问</strong><p>先选择认识或不认识，AI 会结合释义和你的答案进行讲解。</p></div> : <>
          <p className="ai-answer-context">你刚才选择了<strong>{answer === "known" ? "认识" : "不认识"}</strong>，可以从记忆、用法或辨析继续问。</p>
          <div className="ai-quick-questions">{QUICK_QUESTIONS.map((item) => <button type="button" disabled={loading} key={item} onClick={() => void ask(item)}>{item}</button>)}</div>
          <div className="ai-chat" aria-live="polite">
            {messages.length === 0 ? <p className="ai-chat-empty">关于这个词，想知道什么？</p> : messages.map((message, index) => <div className={`ai-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === "user" ? "你" : "AI"}</span><MessageContent content={message.content} /></div>)}
            {loading && <div className="ai-message assistant loading"><span>AI</span><MessageContent content="正在思考…" /></div>}
          </div>
          <form className="ai-question-form" onSubmit={submitQuestion}><textarea rows={3} maxLength={800} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：给我一个更容易记住的联想" /><button type="submit" disabled={loading || !question.trim()}>发送</button></form>
        </>}
      </>}
      {error && <p className="ai-error" role="alert">{error}</p>}
    </aside>
  );
}
