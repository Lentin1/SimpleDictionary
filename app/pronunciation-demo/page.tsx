"use client";

import { FormEvent, useMemo, useState } from "react";
import { MINIMAX_VOICES, VoiceLanguage, VOICE_LANGUAGES } from "./voices";

type ModelOption = { id: string; name: string; shortName: string; description: string; badge?: string };
type AudioResult = { id: number; model: string; text: string; audioBase64: string; mimeType: string; durationHint?: string };

const MODELS: ModelOption[] = [
  { id: "minimax-speech-2.8-turbo", name: "MiniMax Speech-2.8-Turbo", shortName: "MiniMax Turbo", description: "低延迟，适合快速比较发音", badge: "先试它" },
  { id: "minimax-speech-2.8-hd", name: "MiniMax Speech-2.8-HD", shortName: "MiniMax HD", description: "更注重音质、韵律和自然度" },
];

const TEXT_PRESETS = [
  { label: "serendipity", value: "serendipity" },
  { label: "read / read", value: "I read the book yesterday, and I read every day." },
  { label: "单词 + 例句", value: "meticulous. She kept meticulous notes during every experiment." },
];

const EMOTIONS = [["", "自动"], ["calm", "平静"], ["happy", "开心"], ["sad", "悲伤"], ["angry", "生气"], ["fearful", "害怕"], ["disgusted", "厌恶"], ["surprised", "惊讶"]];

function getLanguage(language: VoiceLanguage) { return VOICE_LANGUAGES.find((item) => item.id === language) ?? VOICE_LANGUAGES[0]; }

export default function PronunciationDemoPage() {
  const [modelId, setModelId] = useState(MODELS[0].id);
  const [endpoint, setEndpoint] = useState("");
  const [text, setText] = useState(TEXT_PRESETS[0].value);
  const [apiKey, setApiKey] = useState("");
  const [language, setLanguage] = useState<VoiceLanguage>("zh-CN");
  const [voiceId, setVoiceId] = useState("female-yujie");
  const [voiceSearch, setVoiceSearch] = useState("");
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [emotion, setEmotion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<AudioResult[]>([]);

  const selectedModel = MODELS.find((model) => model.id === modelId) ?? MODELS[0];
  const selectedLanguage = getLanguage(language);
  const filteredVoices = useMemo(() => {
    const keyword = voiceSearch.trim().toLowerCase();
    return MINIMAX_VOICES.filter((voice) => voice.language === language && (!keyword || `${voice.name} ${voice.id}`.toLowerCase().includes(keyword)));
  }, [language, voiceSearch]);
  const selectedVoice = MINIMAX_VOICES.find((voice) => voice.id === voiceId);

  function handleLanguageChange(nextLanguage: VoiceLanguage) {
    setLanguage(nextLanguage);
    const firstVoice = MINIMAX_VOICES.find((voice) => voice.language === nextLanguage);
    if (firstVoice) setVoiceId(firstVoice.id);
    setVoiceSearch("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!endpoint.trim()) return setError("请先填入第三方 MiniMax API Base URL 或完整接口地址。");
    if (!apiKey.trim()) return setError("请先填入第三方平台的 API Key。它只保存在当前页面内，不会写入项目。");
    if (!text.trim()) return setError("请输入要朗读的单词或句子。");
    if (!voiceId.trim()) return setError("请选择或填写 MiniMax voice_id。");
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/pronunciation-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: endpoint.trim(), model: selectedModel.id, apiKey: apiKey.trim(), text: text.trim(), voiceId: voiceId.trim(), languageBoost: selectedLanguage.boost, speed, pitch, emotion: emotion || undefined }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "语音生成失败，请检查 API Key 和模型权限。");
      setResults((current) => [{ id: Date.now(), model: selectedModel.name, text: text.trim(), audioBase64: payload.audioBase64, mimeType: payload.mimeType, durationHint: payload.audioLength ? `${(payload.audioLength / 1000).toFixed(1)} 秒` : undefined }, ...current]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "语音生成失败，请稍后再试。");
    } finally { setIsLoading(false); }
  }

  return (
    <main className="pronunciation-demo">
      <div className="demo-orb demo-orb-one" /><div className="demo-orb demo-orb-two" />
      <section className="demo-shell">
        <header className="demo-header">
          <div><p className="demo-overline">JIANCI · MINIMAX VOICE LAB</p><h1>MiniMax 发音试听实验室</h1><p className="demo-lede">只用 MiniMax，同一段文字切换不同语言和音色，直接听 Turbo 与 HD 的差别。</p></div>
          <div className="demo-header-note"><span className="live-dot" />在线试听</div>
        </header>

        <div className="demo-layout">
          <form className="demo-panel demo-controls" onSubmit={handleSubmit}>
            <div className="panel-heading-row"><div><p className="demo-kicker">01 / MiniMax 设置</p><h2>选择模型与音色</h2></div><span className="secure-pill">KEY 仅本次使用</span></div>
            <div className="model-grid">{MODELS.map((model) => <button className={`model-card ${modelId === model.id ? "selected" : ""}`} key={model.id} onClick={() => setModelId(model.id)} type="button"><span className="model-mark minimax">M</span><span className="model-copy"><strong>{model.shortName}</strong><small>{model.description}</small></span>{model.badge && <em>{model.badge}</em>}</button>)}</div>

            <div className="field-group endpoint-group"><label htmlFor="demo-endpoint">第三方 MiniMax API 地址</label><input id="demo-endpoint" type="url" placeholder="https://tokendance.space/gateway/v1" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} autoComplete="off" /><p className="field-help">支持 TokenDance 与 MiniMax 官方 HTTPS 地址；TokenDance Base URL 会自动转换为对应的 T2A 路径。</p></div>
            <div className="field-group"><label htmlFor="demo-api-key">第三方 API Key</label><input id="demo-api-key" type="password" placeholder="粘贴第三方平台的 API Key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" /><p className="field-help">不会保存到浏览器，也不会提交到代码仓库。试听完成后刷新页面即可清除。</p></div>
            <div className="field-group"><label htmlFor="demo-text">试听内容</label><textarea id="demo-text" value={text} onChange={(event) => setText(event.target.value)} rows={4} /><div className="preset-row">{TEXT_PRESETS.map((preset) => <button key={preset.label} onClick={() => setText(preset.value)} type="button">{preset.label}</button>)}</div></div>

            <div className="two-column-fields">
              <div className="field-group"><label htmlFor="demo-language">语言类型</label><select id="demo-language" value={language} onChange={(event) => handleLanguageChange(event.target.value as VoiceLanguage)}>{VOICE_LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
              <div className="field-group"><label htmlFor="demo-emotion">情绪（MiniMax）</label><select id="demo-emotion" value={emotion} onChange={(event) => setEmotion(event.target.value)}>{EMOTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            </div>

            <div className="field-group"><label htmlFor="demo-voice">MiniMax 音色 <span>{filteredVoices.length} 个</span></label><select id="demo-voice" value={selectedVoice?.language === language ? voiceId : ""} onChange={(event) => setVoiceId(event.target.value)}>{filteredVoices.length ? filteredVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.id}</option>) : <option value="">没有匹配音色</option>}</select><input className="voice-search-input" aria-label="搜索音色" placeholder="搜索音色名称或 voice_id" value={voiceSearch} onChange={(event) => setVoiceSearch(event.target.value)} /><p className="field-help">官方系统音色目录按语言筛选。御姐音：female-yujie / Chinese (Mandarin)_Mature_Woman；萝莉感可试：lovely_girl / female-shaonv。</p></div>
            <div className="field-group"><label htmlFor="demo-custom-voice">自定义 voice_id（可选）</label><input id="demo-custom-voice" value={voiceId} onChange={(event) => setVoiceId(event.target.value)} /><p className="field-help">这里也能直接填你账号里的克隆或生成音色 ID；第三方网关未必支持动态列出私有音色。</p></div>

            <div className="two-column-fields"><div className="field-group"><label htmlFor="demo-speed">语速 <span>{speed.toFixed(1)}×</span></label><input id="demo-speed" type="range" min="0.5" max="2" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></div><div className="field-group"><label htmlFor="demo-pitch">音调 <span>{pitch}</span></label><input id="demo-pitch" type="range" min="-12" max="12" step="1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /></div></div>
            {error && <div className="demo-error" role="alert">{error}</div>}
            <button className="generate-button" type="submit" disabled={isLoading}><span>{isLoading ? "正在生成试听…" : "生成并播放试听"}</span><span aria-hidden="true">↗</span></button>
          </form>

          <section className="demo-panel demo-results"><div className="panel-heading-row"><div><p className="demo-kicker">02 / 听效果</p><h2>试听结果</h2></div><span className="result-count">{results.length} 条</span></div>{results.length === 0 ? <div className="empty-results"><div className="empty-disc">♫</div><strong>还没有试听结果</strong><p>填入第三方地址和 API Key，选择音色后点击生成。音频只在本次页面会话里保留。</p></div> : <div className="result-list">{results.map((result) => <article className="result-card" key={result.id}><div className="result-card-top"><div><span className="result-provider minimax">MiniMax</span><h3>{result.model}</h3></div>{result.durationHint && <span className="duration-label">{result.durationHint}</span>}</div><p className="result-text">“{result.text}”</p><audio controls src={`data:${result.mimeType};base64,${result.audioBase64}`} /></article>)}</div>}<div className="demo-footnote"><span>ⓘ</span>这是试听 Demo，不是发音评分。MiniMax 音色和权限以你所使用的第三方平台为准。</div></section>
        </div>
      </section>
    </main>
  );
}
