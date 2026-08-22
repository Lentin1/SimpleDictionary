import { NextResponse } from "next/server";

type RequestBody = {
  protocol?: "minimax-t2a" | "mimo-chat-audio" | "openai-audio";
  endpoint?: string;
  model?: string;
  apiKey?: string;
  text?: string;
  voiceId?: string;
  style?: string;
  speed?: number;
};

const MAX_TEXT_LENGTH = 800;

function resolveEndpoint(endpoint: string, protocol: NonNullable<RequestBody["protocol"]>) {
  const normalized = endpoint.trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(normalized)) throw new Error("第三方 API 地址必须使用 HTTPS。");
  if (protocol === "minimax-t2a" && normalized.includes("tokendance.space/gateway/v1")) {
    return normalized.replace("/gateway/v1", "/gateway/minimax/v1") + "/t2a_v2";
  }
  if (protocol === "minimax-t2a" && !normalized.endsWith("/t2a_v2")) return `${normalized}/t2a_v2`;
  if (protocol === "mimo-chat-audio" && !normalized.endsWith("/chat/completions")) return `${normalized}/chat/completions`;
  if (protocol === "openai-audio" && !normalized.endsWith("/audio/speech")) return `${normalized}/audio/speech`;
  return normalized;
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function readJsonResponse(response: Response, serviceName: string) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    throw new Error(`${serviceName} 返回了非 JSON 响应（HTTP ${response.status}）：${raw.slice(0, 160)}`);
  }
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return errorResponse("请求格式不正确。");
  }

  const protocol = body.protocol;
  const endpoint = body.endpoint?.trim();
  const apiKey = body.apiKey?.trim();
  const text = body.text?.trim();
  const model = body.model?.trim();

  if (!protocol || !["minimax-t2a", "mimo-chat-audio", "openai-audio"].includes(protocol)) return errorResponse("请选择第三方接口格式。");
  if (!endpoint) return errorResponse("请提供第三方 API 地址。");
  if (!apiKey) return errorResponse("请提供 API Key。");
  if (!text) return errorResponse("请提供要朗读的内容。");
  if (text.length > MAX_TEXT_LENGTH) return errorResponse(`试听文本请控制在 ${MAX_TEXT_LENGTH} 个字符以内。`);

  try {
    const targetEndpoint = resolveEndpoint(endpoint, protocol);
    if (protocol === "minimax-t2a") {
      const response = await fetch(targetEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || "speech-2.8-turbo",
          text,
          stream: false,
          language_boost: "English",
          output_format: "hex",
          voice_setting: {
            voice_id: body.voiceId || "English_expressive_narrator",
            speed: Math.max(0.5, Math.min(2, body.speed || 1)),
            vol: 1,
            pitch: 0,
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: "mp3",
            channel: 1,
          },
          pronunciation_dict: { tone: [] },
        }),
      });
      const payload = await readJsonResponse(response, "第三方 MiniMax 接口");
      if (!response.ok || payload?.base_resp?.status_code) {
        return errorResponse(payload?.base_resp?.status_msg || "MiniMax 请求失败，请检查 API Key、音色 ID 和账户权限。", response.status || 502);
      }
      const audioBase64 = payload?.data?.audio;
      if (!audioBase64) return errorResponse("MiniMax 没有返回音频数据。", 502);
      return NextResponse.json({
        audioBase64: Buffer.from(audioBase64, "hex").toString("base64"),
        mimeType: "audio/mpeg",
        audioLength: payload?.extra_info?.audio_length,
      });
    }

    if (protocol === "openai-audio") {
      const response = await fetch(targetEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || "tts-1",
          input: text,
          voice: body.voiceId || "alloy",
          response_format: "mp3",
          speed: body.speed || 1,
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        return errorResponse(message || "OpenAI Audio 兼容接口请求失败。", response.status || 502);
      }
      const audioBytes = Buffer.from(await response.arrayBuffer());
      return NextResponse.json({ audioBase64: audioBytes.toString("base64"), mimeType: "audio/mpeg" });
    }

    const mimoModel = model || "mimo-v2.5-tts";
    const response = await fetch(targetEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: mimoModel,
        messages: [
          {
            role: "user",
            content: body.style || "Clear, neutral English pronunciation. Speak the exact text without adding words.",
          },
          { role: "assistant", content: text },
        ],
        audio: {
          format: "wav",
          ...(mimoModel === "mimo-v2.5-tts" ? { voice: body.voiceId || "Mia" } : {}),
        },
      }),
    });
    const payload = await readJsonResponse(response, "第三方 MiMo 接口");
    if (!response.ok) {
      return errorResponse(payload?.error?.message || "MiMo 请求失败，请检查 API Key 和模型权限。", response.status || 502);
    }
    const audioBase64 = payload?.choices?.[0]?.message?.audio?.data;
    if (!audioBase64) return errorResponse("MiMo 没有返回音频数据。", 502);
    return NextResponse.json({ audioBase64, mimeType: "audio/wav" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "网络请求失败。";
    return errorResponse(`无法连接语音服务：${message}`, 502);
  }
}
