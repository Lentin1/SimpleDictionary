"use client";

import { FormEvent, useMemo, useState } from "react";

type Provider = "minimax" | "mimo";
type Protocol = "minimax-t2a" | "mimo-chat-audio" | "openai-audio";

type ModelOption = {
  id: string;
  provider: Provider;
  name: string;
  shortName: string;
  description: string;
  badge?: string;
};

type AudioResult = {
  id: number;
  provider: Provider;
  model: string;
  text: string;
  audioBase64: string;
  mimeType: string;
  durationHint?: string;
};

const MODELS: ModelOption[] = [
  {
    id: "minimax-speech-2.8-turbo",
    provider: "minimax",
    name: "MiniMax Speech-2.8-Turbo",
    shortName: "MiniMax Turbo",
    description: "低延迟，适合快速比较单词发音",
    badge: "先试它",
  },
  {
    id: "minimax-speech-2.8-hd",
    provider: "minimax",
    name: "MiniMax Speech-2.8-HD",
    shortName: "MiniMax HD",
    description: "更注重音质、韵律和自然度",
  },
  {
    id: "mimo-v2.5-tts",
    provider: "mimo",
    name: "Xiaomi MiMo-V2.5-TTS",
    shortName: "MiMo TTS",
    description: "内置音色，支持英语朗读和风格控制",
    badge: "免费试用",
  },
  {
    id: "mimo-v2.5-tts-voicedesign",
    provider: "mimo",
    name: "MiMo VoiceDesign",
    shortName: "MiMo 音色设计",
    description: "用文字描述创造新的声音",
  },
  {
    id: "mimo-v2.5-tts-voiceclone",
    provider: "mimo",
    name: "Xiaomi MiMo-V2.5-TTS-VoiceClone",
    shortName: "MiMo 音色复刻",
    description: "复刻参考声音，需第三方接口支持",
  },
];

const TEXT_PRESETS = [
  { label: "serendipity", value: "serendipity" },
  { label: "read / read", value: "I read the book yesterday, and I read every day." },
  { label: "单词 + 例句", value: "meticulous. She kept meticulous notes during every experiment." },
];

function getModel(modelId: string) {
  return MODELS.find((model) => model.id === modelId) ?? MODELS[0];
}

function getProtocol(provider: Provider): Protocol {
  return provider === "minimax" ? "minimax-t2a" : "mimo-chat-audio";
}

export default function PronunciationDemoPage() {
  const [modelId, setModelId] = useState(MODELS[0].id);
  const [endpoint, setEndpoint] = useState("");
  const [protocol, setProtocol] = useState<Protocol>("minimax-t2a");
  const [text, setText] = useState(TEXT_PRESETS[0].value);
  const [apiKey, setApiKey] = useState("");
  const [voiceId, setVoiceId] = useState("English_expressive_narrator");
  const [mimoVoice, setMimoVoice] = useState("Mia");
  const [style, setStyle] = useState("Clear, neutral English pronunciation. Speak the exact text without adding words.");
  const [speed, setSpeed] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<AudioResult[]>([]);

  const selectedModel = useMemo(() => getModel(modelId), [modelId]);
  const isMiMo = selectedModel.provider === "mimo";

  function selectModel(model: ModelOption) {
    setModelId(model.id);
    setProtocol(getProtocol(model.provider));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!endpoint.trim()) {
      setError("请先填入第三方平台的 API Base URL 或完整接口地址。");
      return;
    }
    if (!apiKey.trim()) {
      setError("请先填入对应平台的 API Key。它只保存在当前页面内，不会写入项目。");
      return;
    }
    if (!text.trim()) {
      setError("请输入要朗读的单词或句子。");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/pronunciation-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol,
          endpoint: endpoint.trim(),
          model: selectedModel.id,
          apiKey: apiKey.trim(),
          text: text.trim(),
          voiceId: isMiMo ? mimoVoice : voiceId.trim(),
          style: style.trim(),
          speed,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "语音生成失败，请检查 API Key 和模型权限。");

      setResults((current) => [
        {
          id: Date.now(),
          provider: selectedModel.provider,
          model: selectedModel.name,
          text: text.trim(),
          audioBase64: payload.audioBase64,
          mimeType: payload.mimeType,
          durationHint: payload.audioLength ? `${(payload.audioLength / 1000).toFixed(1)} 秒` : undefined,
        },
        ...current,
      ]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "语音生成失败，请稍后再试。");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="pronunciation-demo">
      <div className="demo-orb demo-orb-one" />
      <div className="demo-orb demo-orb-two" />
      <section className="demo-shell">
        <header className="demo-header">
          <div>
            <p className="demo-overline">JIANCI · VOICE LAB</p>
            <h1>发音试听实验室</h1>
            <p className="demo-lede">把同一个单词交给不同语音模型，听听它们的语气、清晰度和自然度。</p>
          </div>
          <div className="demo-header-note">
            <span className="live-dot" />
            在线试听
          </div>
        </header>

        <div className="demo-layout">
          <form className="demo-panel demo-controls" onSubmit={handleSubmit}>
            <div className="panel-heading-row">
              <div>
                <p className="demo-kicker">01 / 选择声音</p>
                <h2>先选一个模型</h2>
              </div>
              <span className="secure-pill">KEY 仅本次使用</span>
            </div>

            <div className="model-grid">
              {MODELS.map((model) => (
                <button
                  className={`model-card ${modelId === model.id ? "selected" : ""}`}
                  key={model.id}
                  onClick={() => selectModel(model)}
                  type="button"
                >
                  <span className={`model-mark ${model.provider}`}>{model.provider === "mimo" ? "米" : "M"}</span>
                  <span className="model-copy">
                    <strong>{model.shortName}</strong>
                    <small>{model.description}</small>
                  </span>
                  {model.badge && <em>{model.badge}</em>}
                </button>
              ))}
            </div>

            <div className="field-group endpoint-group">
              <label htmlFor="demo-endpoint">第三方 API 地址</label>
              <input
                id="demo-endpoint"
                type="url"
                placeholder="https://你的平台.example.com/v1"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                autoComplete="off"
              />
              <p className="field-help">可以填 Base URL 或完整地址，Demo 会按下面的接口格式自动补路径。</p>
            </div>

            <div className="field-group">
              <label htmlFor="demo-protocol">第三方接口格式</label>
              <select id="demo-protocol" value={protocol} onChange={(event) => setProtocol(event.target.value as Protocol)}>
                <option value="minimax-t2a">MiniMax T2A：/t2a_v2，返回 HEX 音频</option>
                <option value="mimo-chat-audio">MiMo Chat Audio：/chat/completions，返回 Base64 音频</option>
                <option value="openai-audio">OpenAI Audio：/audio/speech，返回音频文件</option>
              </select>
              <p className="field-help">如果你的第三方平台文档写“OpenAI 兼容”，通常选择最后一项；以平台文档为准。</p>
            </div>

            <div className="field-group">
              <label htmlFor="demo-text">试听内容</label>
              <textarea id="demo-text" value={text} onChange={(event) => setText(event.target.value)} rows={4} />
              <div className="preset-row">
                {TEXT_PRESETS.map((preset) => (
                  <button key={preset.label} onClick={() => setText(preset.value)} type="button">
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="demo-api-key">第三方 API Key</label>
              <input
                id="demo-api-key"
                type="password"
                placeholder="粘贴第三方平台的 API Key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
              />
              <p className="field-help">不会保存到浏览器，也不会提交到代码仓库。试听完成后可刷新页面清除。</p>
            </div>

            <div className="two-column-fields">
              {protocol === "mimo-chat-audio" ? (
                <div className="field-group">
                  <label htmlFor="mimo-voice">英语音色</label>
                  <select id="mimo-voice" value={mimoVoice} onChange={(event) => setMimoVoice(event.target.value)}>
                    <option value="Mia">Mia · 女声</option>
                    <option value="Chloe">Chloe · 女声</option>
                    <option value="Milo">Milo · 男声</option>
                    <option value="Dean">Dean · 男声</option>
                  </select>
                </div>
              ) : (
                <div className="field-group">
                  <label htmlFor="minimax-voice">音色 ID / voice</label>
                  <input id="minimax-voice" value={voiceId} onChange={(event) => setVoiceId(event.target.value)} />
                </div>
              )}
              <div className="field-group">
                <label htmlFor="demo-speed">语速 <span>{speed.toFixed(1)}×</span></label>
                <input id="demo-speed" type="range" min="0.6" max="1.4" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="demo-style">语气提示</label>
              <input id="demo-style" value={style} onChange={(event) => setStyle(event.target.value)} />
            </div>

            {error && <div className="demo-error" role="alert">{error}</div>}
            <button className="generate-button" type="submit" disabled={isLoading}>
              <span>{isLoading ? "正在生成试听…" : "生成并播放试听"}</span>
              <span aria-hidden="true">↗</span>
            </button>
          </form>

          <section className="demo-panel demo-results">
            <div className="panel-heading-row">
              <div>
                <p className="demo-kicker">02 / 听效果</p>
                <h2>试听结果</h2>
              </div>
              <span className="result-count">{results.length} 条</span>
            </div>

            {results.length === 0 ? (
              <div className="empty-results">
                <div className="empty-disc">♫</div>
                <strong>还没有试听结果</strong>
                <p>选一个模型，输入 API Key，点击生成。音频只在本次页面会话里保留。</p>
              </div>
            ) : (
              <div className="result-list">
                {results.map((result) => (
                  <article className="result-card" key={result.id}>
                    <div className="result-card-top">
                      <div>
                        <span className={`result-provider ${result.provider}`}>{result.provider === "mimo" ? "MiMo" : "MiniMax"}</span>
                        <h3>{result.model}</h3>
                      </div>
                      {result.durationHint && <span className="duration-label">{result.durationHint}</span>}
                    </div>
                    <p className="result-text">“{result.text}”</p>
                    <audio controls src={`data:${result.mimeType};base64,${result.audioBase64}`} />
                  </article>
                ))}
              </div>
            )}

            <div className="demo-footnote">
              <span>ⓘ</span>
              这是试听 Demo，不是发音评分。真正的单词学习功能仍建议保留离线系统语音作为兜底。
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
