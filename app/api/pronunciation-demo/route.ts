import { NextResponse } from "next/server";

type RequestBody = {
  endpoint?: string;
  model?: string;
  apiKey?: string;
  text?: string;
  voiceId?: string;
  languageBoost?: string;
  speed?: number;
  pitch?: number;
  emotion?: string;
};

type MiniMaxPayload = {
  data?: { audio?: string };
  extra_info?: { audio_length?: number };
  base_resp?: { status_code?: number; status_msg?: string };
};

const MAX_TEXT_LENGTH = 800;
const ALLOWED_ENDPOINT_HOSTS = new Set([
  "tokendance.space",
  "api.minimax.io",
  "api.minimaxi.com",
  "api.minimax.chat",
]);

function resolveEndpoint(endpoint: string) {
  const normalized = endpoint.trim().replace(/\/$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("第三方 API 地址格式不正确。");
  }
  if (parsed.protocol !== "https:") throw new Error("第三方 API 地址必须使用 HTTPS。");
  if (parsed.username || parsed.password) throw new Error("第三方 API 地址不能包含账号或密码。");
  if (parsed.port && parsed.port !== "443") throw new Error("第三方 API 地址只能使用 HTTPS 默认端口。");
  if (!ALLOWED_ENDPOINT_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("当前只允许 TokenDance 或 MiniMax 官方语音接口。");
  }
  if (normalized.includes("tokendance.space/gateway/v1")) return normalized.replace("/gateway/v1", "/gateway/minimax/v1") + "/t2a_v2";
  if (!normalized.endsWith("/t2a_v2")) return `${normalized}/t2a_v2`;
  return normalized;
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function readJsonResponse(response: Response, serviceName: string) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as MiniMaxPayload;
  } catch {
    throw new Error(`${serviceName} 返回了非 JSON 响应（HTTP ${response.status}）`);
  }
}

export async function POST(request: Request) {
  let body: RequestBody;
  try { body = (await request.json()) as RequestBody; } catch { return errorResponse("请求格式不正确。"); }

  const endpoint = body.endpoint?.trim();
  const apiKey = body.apiKey?.trim();
  const text = body.text?.trim();
  if (!endpoint) return errorResponse("请提供第三方 MiniMax API 地址。");
  if (!apiKey) return errorResponse("请提供 API Key。");
  if (!text) return errorResponse("请提供要朗读的内容。");
  if (text.length > MAX_TEXT_LENGTH) return errorResponse(`试听文本请控制在 ${MAX_TEXT_LENGTH} 个字符以内。`);

  let resolvedEndpoint: string;
  try {
    resolvedEndpoint = resolveEndpoint(endpoint);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "第三方 API 地址不受支持。");
  }

  try {
    const response = await fetch(resolvedEndpoint, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: body.model || "minimax-speech-2.8-turbo",
        text,
        stream: false,
        language_boost: body.languageBoost || "English",
        output_format: "hex",
        voice_setting: {
          voice_id: body.voiceId || "female-yujie",
          speed: Math.max(0.5, Math.min(2, body.speed || 1)),
          vol: 1,
          pitch: Math.max(-12, Math.min(12, body.pitch || 0)),
          ...(body.emotion ? { emotion: body.emotion } : {}),
        },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
        pronunciation_dict: { tone: [] },
      }),
    });
    const payload = await readJsonResponse(response, "第三方 MiniMax 接口");
    if (!response.ok || payload?.base_resp?.status_code) return errorResponse(payload?.base_resp?.status_msg || "MiniMax 请求失败，请检查 API Key、音色 ID 和账户权限。", response.status || 502);
    const audioBase64 = payload?.data?.audio;
    if (!audioBase64) return errorResponse("MiniMax 没有返回音频数据。", 502);
    return NextResponse.json({ audioBase64: Buffer.from(audioBase64, "hex").toString("base64"), mimeType: "audio/mpeg", audioLength: payload?.extra_info?.audio_length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "网络请求失败。";
    return errorResponse(`无法连接语音服务：${message}`, 502);
  }
}
