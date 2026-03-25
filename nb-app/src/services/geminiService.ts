import type { Content, Part as SDKPart } from "@google/genai";
import { AppSettings, Part } from '../types';
import { buildImageConfig, DEFAULT_IMAGE_MODEL } from '../constants/geminiModels';

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"']+/g;

function trimTrailingUrlPunctuation(url: string): string {
  return url.replace(/[)\].,;]+$/g, '');
}

/** 部分网关把 GCS 等签名链接写在 text 里而不给 fileData，需提升为 fileData 才能用图片组件展示 */
function isLikelyDirectImageUrl(url: string): boolean {
  const u = trimTrailingUrlPunctuation(url).toLowerCase();
  if (!u.startsWith('http')) return false;
  if (
    u.includes('storage.googleapis.com') ||
    u.includes('googleusercontent.com') ||
    u.includes('gstatic.com') ||
    u.includes('ai-sandbox') ||
    u.includes('/image/') ||
    /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(u)
  ) {
    return true;
  }
  return false;
}

/**
 * 将正文里单独出现的图片 URL 抽成 fileData，并从 text 中移除，避免整段签名链接当 Markdown 展示。
 */
function promoteImageUrlsFromText(parts: Part[]): Part[] {
  const urisAlreadyInParts = new Set(
    parts
      .filter((p) => p.fileData?.fileUri)
      .map((p) => trimTrailingUrlPunctuation(p.fileData!.fileUri.trim()))
  );
  const out: Part[] = [];
  for (const p of parts) {
    if (p.thought || !p.text) {
      out.push(p);
      continue;
    }
    const matches = [...p.text.matchAll(URL_IN_TEXT_RE)];
    const toStrip: string[] = [];
    const urls: string[] = [];
    const seenInText = new Set<string>();
    for (const m of matches) {
      const full = m[0];
      const normalized = trimTrailingUrlPunctuation(full);
      if (!isLikelyDirectImageUrl(normalized) || seenInText.has(normalized)) continue;
      seenInText.add(normalized);
      toStrip.push(full);
      urls.push(normalized);
    }
    if (urls.length === 0) {
      out.push(p);
      continue;
    }
    let cleaned = p.text;
    for (const fragment of toStrip) {
      cleaned = cleaned.split(fragment).join('');
    }
    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
    if (cleaned.length > 0) {
      out.push({ ...p, text: cleaned });
    }
    for (const uri of urls) {
      if (urisAlreadyInParts.has(uri)) continue;
      urisAlreadyInParts.add(uri);
      out.push({
        fileData: { mimeType: 'image/png', fileUri: uri },
      });
    }
  }
  return out;
}

/** 模型有时同时返回 fileData 与一段与 fileUri 相同的 text，去重避免重复展示 */
function dedupeFileUriTextParts(parts: Part[]): Part[] {
  const uris = new Set(
    parts.filter((p) => p.fileData?.fileUri).map((p) => p.fileData!.fileUri.trim())
  );
  return parts.filter((p) => {
    if (p.text && uris.has(p.text.trim())) return false;
    return true;
  });
}

/**
 * 同一次回复里若同时出现 inlineData（通常全尺寸 base64）与 fileData（外链），
 * 只保留 inline，避免同一张图展示两次；仅链接、无 base64 时仍保留 fileData。
 */
function preferInlineImageOverFileUri(parts: Part[]): Part[] {
  const hasNonThoughtInline = parts.some((p) => p.inlineData && !p.thought);
  if (!hasNonThoughtInline) return parts;
  return parts.filter((p) => !(p.fileData && !p.thought));
}

function normalizeModelImageParts(parts: Part[]): Part[] {
  return preferInlineImageOverFileUri(dedupeFileUriTextParts(promoteImageUrlsFromText(parts)));
}

// Helper to construct user content
const constructUserContent = (prompt: string, images: { base64Data: string; mimeType: string }[]): Content => {
  const userParts: SDKPart[] = [];
  
  images.forEach((img) => {
    userParts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64Data,
      },
    });
  });

  if (prompt.trim()) {
    userParts.push({ text: prompt });
  }

  return {
    role: "user",
    parts: userParts,
  };
};

// Helper to format Gemini API errors
const formatGeminiError = (error: any): Error => {
  let message = "发生了未知错误，请稍后重试。";
  const errorMsg = error?.message || error?.toString() || "";

  if (errorMsg.includes("401") || errorMsg.includes("API key not valid")) {
    message = "API Key 无效或过期，请检查您的设置。";
  } else if (errorMsg.includes("403")) {
    message = "访问被拒绝。请检查您的网络连接（可能需要切换节点）或 API Key 权限。";
  } else if (errorMsg.includes("Thinking_config.include_thoughts") || errorMsg.includes("thinking is enabled")) {
    message = "当前模型不支持思考过程。请在设置中关闭“显示思考过程”，或切换到支持思考的模型。";
  } else if (errorMsg.includes("400")) {
    message = "请求参数无效 (400 Bad Request)。请检查您的设置或提示词。";
  } else if (errorMsg.includes("429")) {
    message = "请求过于频繁，请稍后再试（429 Too Many Requests）。";
  } else if (errorMsg.includes("503")) {
    message = "Gemini 服务暂时不可用，请稍后重试（503 Service Unavailable）。";
  } else if (errorMsg.includes("TypeError") || errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError")) {
    message = "网络请求失败。可能是网络连接问题，或者请求内容过多（如图片太大、历史记录过长）。";
  } else if (errorMsg.includes("SAFETY")) {
    message = "生成的内容因安全策略被拦截。请尝试修改您的提示词。";
  } else if (errorMsg.includes("404")) {
    message = "请求的模型不存在或路径错误 (404 Not Found)。";
  } else if (errorMsg.includes("500")) {
    message = "Gemini 服务器内部错误，请稍后重试 (500 Internal Server Error)。";
  } else {
      // 保留原始错误信息以便调试，但在前面加上中文提示
      message = `请求出错: ${errorMsg}`;
  }

  const newError = new Error(message);
  (newError as any).originalError = error;
  return newError;
};

// Helper to process SDK parts into app Parts
const processSdkParts = (sdkParts: SDKPart[]): Part[] => {
  const appParts: Part[] = [];

  for (const part of sdkParts) {
    const signature = (part as any).thoughtSignature;
    const isThought = !!(part as any).thought;

    // Handle Text (Thought or Regular)
    if (part.text !== undefined) {
      const lastPart = appParts[appParts.length - 1];

      // Check if we should append to the last part or start a new one.
      // Append if: Last part exists AND is text AND matches thought type.
      if (
        lastPart && 
        lastPart.text !== undefined && 
        !!lastPart.thought === isThought
      ) {
        lastPart.text += part.text;
        if (signature) {
            lastPart.thoughtSignature = signature;
        }
      } else {
        // New text block
        const newPart: Part = { 
          text: part.text, 
          thought: isThought 
        };
        if (signature) {
            newPart.thoughtSignature = signature;
        }
        appParts.push(newPart);
      }
    } 
    // Handle Images
    else if (part.inlineData) {
      const newPart: Part = { 
        inlineData: {
            mimeType: part.inlineData.mimeType || 'image/png',
            data: part.inlineData.data || ''
        }, 
        thought: isThought 
      };
      if (signature) {
          newPart.thoughtSignature = signature;
      }
      appParts.push(newPart);
    }
    else if ((part as SDKPart & { fileData?: { mimeType?: string; fileUri?: string } }).fileData?.fileUri) {
      const fd = (part as { fileData: { mimeType?: string; fileUri: string } }).fileData;
      const newPart: Part = {
        fileData: {
          mimeType: fd.mimeType || 'image/png',
          fileUri: fd.fileUri,
        },
        thought: isThought,
      };
      if (signature) {
        newPart.thoughtSignature = signature;
      }
      appParts.push(newPart);
    }
  }
  return normalizeModelImageParts(appParts);
};

export const streamGeminiResponse = async function* (
  apiKey: string,
  prompt: string,
  images: { base64Data: string; mimeType: string }[],
  settings: AppSettings,
  signal?: AbortSignal
) {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI(
    { apiKey, httpOptions: { baseUrl: settings.customEndpoint || 'https://mccum.com' } }
  );

  /** 每次请求只发当前轮 user 内容，不带历史多轮（产品：非多轮对话） */
  const currentUserContent = constructUserContent(prompt, images);
  const contentsPayload = [currentUserContent];
  const imageConfig = buildImageConfig(settings);

  try {
    const responseStream = await ai.models.generateContentStream({
      model: settings.modelName || DEFAULT_IMAGE_MODEL,
      contents: contentsPayload,
      config: {
        ...(imageConfig ? { imageConfig } : {}),
        tools: settings.useGrounding ? [{ googleSearch: {} }] : [],
        responseModalities: ["TEXT", "IMAGE"],
        ...(settings.enableThinking ? {
            thinkingConfig: {
                includeThoughts: true,
            }
        } : {}),
      },
    });

    let currentParts: Part[] = [];

    for await (const chunk of responseStream) {
      if (signal?.aborted) {
        break;
      }
      const candidates = chunk.candidates;
      if (!candidates || candidates.length === 0) continue;
      
      const newParts = candidates[0].content?.parts || [];

      // Use the helper logic but incrementally
      // We can't reuse processSdkParts directly because we need to accumulate state (currentParts)
      // So we keep the loop logic here
      for (const part of newParts) {
        const signature = (part as any).thoughtSignature;
        const isThought = !!(part as any).thought;

        // Handle Text (Thought or Regular)
        if (part.text !== undefined) {
          const lastPart = currentParts[currentParts.length - 1];

          if (
            lastPart && 
            lastPart.text !== undefined && 
            !!lastPart.thought === isThought
          ) {
            lastPart.text += part.text;
            if (signature) {
                lastPart.thoughtSignature = signature;
            }
          } else {
            const newPart: Part = { 
              text: part.text, 
              thought: isThought 
            };
            if (signature) {
                newPart.thoughtSignature = signature;
            }
            currentParts.push(newPart);
          }
        } 
        else if (part.inlineData) {
          const newPart: Part = { 
            inlineData: {
                mimeType: part.inlineData.mimeType || 'image/png',
                data: part.inlineData.data || ''
            }, 
            thought: isThought 
          };
          if (signature) {
              newPart.thoughtSignature = signature;
          }
          currentParts.push(newPart);
        }
        else if ((part as SDKPart & { fileData?: { mimeType?: string; fileUri?: string } }).fileData?.fileUri) {
          const fd = (part as { fileData: { mimeType?: string; fileUri: string } }).fileData;
          const newPart: Part = {
            fileData: {
              mimeType: fd.mimeType || 'image/png',
              fileUri: fd.fileUri,
            },
            thought: isThought,
          };
          if (signature) {
            newPart.thoughtSignature = signature;
          }
          currentParts.push(newPart);
        }
      }

      currentParts = normalizeModelImageParts(currentParts);

      yield {
        userContent: currentUserContent,
        modelParts: currentParts // Yield the accumulated parts
      };
    }
  } catch (error) {
    console.error("Gemini API Stream Error:", error);
    throw formatGeminiError(error);
  }
};

export const generateContent = async (
  apiKey: string,
  prompt: string,
  images: { base64Data: string; mimeType: string }[],
  settings: AppSettings,
  signal?: AbortSignal
) => {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI(
    { apiKey, httpOptions: { baseUrl: settings.customEndpoint || 'https://mccum.com' } }
  );

  const currentUserContent = constructUserContent(prompt, images);
  const contentsPayload = [currentUserContent];
  const imageConfig = buildImageConfig(settings);

  try {
    // If signal is aborted before we start, throw immediately
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    const response = await ai.models.generateContent({
      model: settings.modelName || DEFAULT_IMAGE_MODEL,
      contents: contentsPayload,
      config: {
        ...(imageConfig ? { imageConfig } : {}),
        tools: settings.useGrounding ? [{ googleSearch: {} }] : [],
        responseModalities: ["TEXT", "IMAGE"],
        ...(settings.enableThinking ? {
            thinkingConfig: {
                includeThoughts: true,
            }
        } : {}),
      },
    });

    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    const candidate = response.candidates?.[0];
    if (!candidate || !candidate.content || !candidate.content.parts) {
      throw new Error("No content generated.");
    }

    const modelParts = processSdkParts(candidate.content.parts);

    return {
      userContent: currentUserContent,
      modelParts: modelParts
    };

  } catch (error) {
    console.error("Gemini API Error:", error);
    throw formatGeminiError(error);
  }
};
