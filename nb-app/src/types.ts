/** 与 Gemini 图像生成 API（ImageConfig.aspectRatio）及 Vertex 文档对齐 */
export type AspectRatioSetting =
  | 'Auto'
  | '1:1'
  | '2:3'
  | '3:2'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '21:9';

export interface AppSettings {
  resolution: '1K' | '2K' | '4K';
  aspectRatio: AspectRatioSetting;
  useGrounding: boolean;
  enableThinking: boolean;
  streamResponse: boolean;
  customEndpoint?: string;
  modelName?: string;
  theme: 'light' | 'dark' | 'system';
}

export interface Part {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  /** 部分网关/模型返回 GCS 等可访问 URL，而非 inline base64 */
  fileData?: {
    mimeType: string;
    fileUri: string;
  };
  thought?: boolean;
  thoughtSignature?: string;
  prompt?: string; // 用于数据集下载时的图片标注
}

export interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  parts: Part[];
  timestamp: number;
  isError?: boolean;
  thinkingDuration?: number;
}

export interface Attachment {
  file: File;
  preview: string; // Base64 for UI preview
  base64Data: string; // Raw base64 for API
  mimeType: string;
}

export interface ImageHistoryItem {
  id: string;
  mimeType: string;
  base64Data?: string; // Raw base64 for API (Optional if stored separately)
  thumbnailData?: string; // Base64 thumbnail
  /** 若尚未拉取为 base64，可直接展示（如官方返回的临时链接） */
  imageUrl?: string;
  prompt: string; // 生成图片的提示词
  timestamp: number;
  modelName?: string;
}

export interface PromptItem {
  title: string;
  preview: string;
  prompt: string;
  author: string;
  link: string;
  mode: 'edit' | 'generate';
  category: string;
}

