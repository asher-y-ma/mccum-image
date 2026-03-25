import { Part } from '../types';

/** 模型回复中的可展示图片（inline base64 或官方 fileUri） */
export function partHasRenderableImage(p: Part): boolean {
  return !!(p.inlineData || p.fileData) && !p.thought;
}
