import { ChatMessage, Content, Part } from '../types';

/** 模型回复中的可展示图片（inline base64 或官方 fileUri） */
export function partHasRenderableImage(p: Part): boolean {
  return !!(p.inlineData || p.fileData) && !p.thought;
}

export const convertMessagesToHistory = (messages: ChatMessage[]): Content[] => {
  return messages
    .filter(msg => !msg.isError) // Filter out error messages
    .map(msg => ({
      role: msg.role,
      parts: msg.parts
        // 不把 fileUri 回合进请求体（易过期）；由服务端/模型自行理解上文
        .filter((p) => !(msg.role === 'model' && p.fileData))
        .map((p) => {
        // Create a clean part object compatible with the SDK
        const part: Part = {};
        if (p.text) part.text = p.text;
        if (p.inlineData) part.inlineData = p.inlineData;
        // We preserve 'thought' property here so the service can decide whether to filter it
        if (p.thought) part.thought = p.thought;
        if (p.thoughtSignature) part.thoughtSignature = p.thoughtSignature;
        return part;
      }),
    }))
    .filter((msg) => msg.parts.length > 0);
};
