type LlmMessage = {
  role: "user" | "assistant";
  content: string;
};

type WordContext = {
  word: string;
  phonetic?: string;
  senses?: Array<{ part?: string; meaning?: string }>;
  example?: string;
  translation?: string;
};

function json(payload: unknown, status = 200) {
  return Response.json(payload, { status });
}

function chatCompletionsUrl(rawEndpoint: string) {
  const endpoint = new URL(rawEndpoint);
  const isLocal = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" || endpoint.hostname === "::1";
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && isLocal)) {
    throw new Error("接口必须使用 HTTPS；本机 localhost 接口可以使用 HTTP。");
  }
  const path = endpoint.pathname.replace(/\/$/, "");
  if (!path) endpoint.pathname = "/v1/chat/completions";
  else if (path.endsWith("/v1")) endpoint.pathname = `${path}/chat/completions`;
  return endpoint;
}

function normalizedMessages(value: unknown): LlmMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return [];
    const trimmed = content.trim().slice(0, 2000);
    return trimmed ? [{ role, content: trimmed }] : [];
  });
}

function assistantContent(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.flatMap((item) => item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string" ? [(item as { text: string }).text] : []).join("\n").trim();
  return "";
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "请求格式无效。" }, 400);
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const answer = body.answer === "known" ? "认识" : body.answer === "unknown" ? "不认识" : "未选择";
  const word = body.word && typeof body.word === "object" ? body.word as WordContext : null;
  const messages = normalizedMessages(body.messages);
  if (!endpoint || !model || !word?.word || messages.length === 0) return json({ error: "缺少接口、模型、单词或问题。" }, 400);

  let url: URL;
  try {
    url = chatCompletionsUrl(endpoint);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "接口地址无效。" }, 400);
  }

  const senses = Array.isArray(word.senses)
    ? word.senses.map((sense) => `${String(sense.part ?? "").trim()} ${String(sense.meaning ?? "").trim()}`.trim()).filter(Boolean).join("；")
    : "";
  const systemPrompt = [
    "你是中文背单词应用“简辞”里的英语单词助教。",
    "只围绕当前单词回答，优先使用简洁自然的中文；必要时给英文例句并附中文解释。",
    "不要虚构词义。如果用户的问题超出当前词，请简短提醒并拉回当前词。",
    `当前词：${word.word}`,
    word.phonetic ? `音标：${word.phonetic}` : "",
    senses ? `词性与释义：${senses}` : "",
    word.example ? `词书例句：${word.example}` : "",
    word.translation ? `例句翻译：${word.translation}` : "",
    `用户刚才选择：${answer}`,
  ].filter(Boolean).join("\n");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages: [{ role: "system", content: systemPrompt }, ...messages], stream: false }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const providerMessage = payload && typeof payload === "object" && typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
        ? (payload as { error: { message: string } }).error.message
        : `LLM API 返回 ${response.status}`;
      return json({ error: providerMessage.slice(0, 300) }, 502);
    }
    const content = assistantContent(payload);
    return content ? json({ content }) : json({ error: "LLM API 没有返回可显示的文本。" }, 502);
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "LLM API 请求超时。" : "无法连接 LLM API，请检查地址和网络。";
    return json({ error: message }, 502);
  }
}
