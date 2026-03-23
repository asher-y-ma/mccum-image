import type { AppSettings, AspectRatioSetting } from '../types';

/** 与 Pipeline 批量编排共用的图像模型列表（单一数据源） */
export const IMAGE_MODEL_OPTIONS = [
  { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro (Preview)' },
  { value: 'gemini-3.0-pro-image', label: 'Gemini 3 Pro flow' },
  { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash (Preview)' },
  { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash flow' },
] as const;

export type ImageModelId = (typeof IMAGE_MODEL_OPTIONS)[number]['value'];

export const DEFAULT_IMAGE_MODEL: ImageModelId = 'gemini-3-pro-image-preview';

const IMAGE_MODEL_VALUES = new Set<string>(IMAGE_MODEL_OPTIONS.map((m) => m.value));

type AspectNonAuto = Exclude<AspectRatioSetting, 'Auto'>;

/** Gemini 图像模型常用完整比例（与 Vertex Gemini 3 Pro Image 文档对齐） */
const ASPECT_RATIOS_GEMINI_IMAGE_FULL: readonly AspectNonAuto[] = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
];

/**
 * gemini-3.0-pro-image、gemini-3.1-flash-image 不支持：2:3、3:2、4:5、5:4、21:9
 * （若接口后续放开，只需改此处与 ASPECT_RATIOS_BY_EXACT_MODEL_ID）
 */
const ASPECT_RATIOS_GEMINI_FLOW_RESTRICTED: readonly AspectNonAuto[] = [
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
];

const ASPECT_RATIOS_BY_EXACT_MODEL_ID: Record<string, readonly AspectNonAuto[]> = {
  'gemini-3.0-pro-image': ASPECT_RATIOS_GEMINI_FLOW_RESTRICTED,
  'gemini-3.1-flash-image': ASPECT_RATIOS_GEMINI_FLOW_RESTRICTED,
};

export function getSupportedAspectRatiosNonAuto(modelName: string | undefined): readonly AspectNonAuto[] {
  const id = modelName || DEFAULT_IMAGE_MODEL;
  const exact = ASPECT_RATIOS_BY_EXACT_MODEL_ID[id];
  if (exact) return exact;
  if (id.includes('gemini-3') && id.includes('image')) {
    return ASPECT_RATIOS_GEMINI_IMAGE_FULL;
  }
  if (id.includes('gemini-2.5') && id.includes('flash') && id.includes('image')) {
    return ASPECT_RATIOS_GEMINI_IMAGE_FULL;
  }
  return ASPECT_RATIOS_GEMINI_IMAGE_FULL;
}

/** 设置面板中展示的选项（Auto + 当前模型支持的比值） */
export function getAspectRatioOptionsForModel(modelName: string | undefined): AspectRatioSetting[] {
  const rest = [...getSupportedAspectRatiosNonAuto(modelName)];
  return ['Auto', ...rest];
}

export function isAspectRatioSupportedForModel(
  modelName: string | undefined,
  ratio: AspectRatioSetting
): boolean {
  if (ratio === 'Auto') return true;
  return getSupportedAspectRatiosNonAuto(modelName).includes(ratio as AspectNonAuto);
}

/** 切换模型时若当前长宽比不可用则回退到 Auto */
export function clampAspectRatioForModel(
  modelName: string | undefined,
  ratio: AspectRatioSetting
): AspectRatioSetting {
  if (isAspectRatioSupportedForModel(modelName, ratio)) return ratio;
  return 'Auto';
}

/**
 * 仅部分模型支持 imageConfig.imageSize（1K / 2K / 4K）。
 * Flash 系列通常固定输出或不暴露该档位，故仅对 Pro 图像模型开放 UI。
 */
const RESOLUTION_SUPPORTED_MODEL_IDS = new Set<string>(['gemini-3-pro-image-preview', 'gemini-3.0-pro-image']);

export function supportsImageResolution(modelName: string | undefined): boolean {
  const id = modelName || DEFAULT_IMAGE_MODEL;
  return RESOLUTION_SUPPORTED_MODEL_IDS.has(id);
}

export function clampResolutionForModel(
  modelName: string | undefined,
  resolution: AppSettings['resolution']
): AppSettings['resolution'] {
  if (supportsImageResolution(modelName)) return resolution;
  return '1K';
}

/** 请求体中使用的长宽比：不支持或 Auto 时不传 */
export function aspectRatioForApi(
  modelName: string | undefined,
  ratio: AspectRatioSetting
): string | undefined {
  if (ratio === 'Auto') return undefined;
  if (!isAspectRatioSupportedForModel(modelName, ratio)) return undefined;
  return ratio;
}

export function isKnownImageModelId(modelName: string | undefined): boolean {
  if (!modelName) return false;
  return IMAGE_MODEL_VALUES.has(modelName);
}

/** 组装 generateContent 的 imageConfig；不支持字段则省略，避免 400 */
export function buildImageConfig(settings: AppSettings): { imageSize?: string; aspectRatio?: string } | undefined {
  const model = settings.modelName;
  const cfg: { imageSize?: string; aspectRatio?: string } = {};
  const ar = aspectRatioForApi(model, settings.aspectRatio);
  if (ar) cfg.aspectRatio = ar;
  if (supportsImageResolution(model)) {
    cfg.imageSize = settings.resolution;
  }
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}
