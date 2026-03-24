import type { AppSettings, AspectRatioSetting } from '../types';

/** 图像模型列表（设置与高级配置共用） */
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

/** 支持 1K / 2K / 4K */
const RESOLUTION_1K_2K_4K_MODEL_IDS = new Set<string>([
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview',
]);

/** 仅支持 1K / 2K（无 4K） */
const RESOLUTION_1K_2K_MODEL_IDS = new Set<string>([
  'gemini-3.0-pro-image',
  'gemini-3.1-flash-image',
]);

export function getSupportedImageResolutions(
  modelName: string | undefined
): readonly AppSettings['resolution'][] {
  const id = modelName || DEFAULT_IMAGE_MODEL;
  if (RESOLUTION_1K_2K_4K_MODEL_IDS.has(id)) return ['1K', '2K', '4K'];
  if (RESOLUTION_1K_2K_MODEL_IDS.has(id)) return ['1K', '2K'];
  // 自定义模型 id（如 URL 传入）：默认按全档位开放
  return ['1K', '2K', '4K'];
}

/** 是否展示分辨率档位（内置四模型均支持；自定义模型 id 亦展示，按全档位） */
export function supportsImageResolution(modelName: string | undefined): boolean {
  return getSupportedImageResolutions(modelName).length > 0;
}

export function supportsResolutionLevel(
  modelName: string | undefined,
  level: AppSettings['resolution']
): boolean {
  return getSupportedImageResolutions(modelName).includes(level);
}

export function clampResolutionForModel(
  modelName: string | undefined,
  resolution: AppSettings['resolution']
): AppSettings['resolution'] {
  const allowed = getSupportedImageResolutions(modelName);
  if (allowed.includes(resolution)) return resolution;
  if (resolution === '4K' && allowed.includes('2K')) return '2K';
  return allowed[0] ?? '1K';
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
  const res = clampResolutionForModel(model, settings.resolution);
  if (supportsImageResolution(model)) {
    cfg.imageSize = res;
  }
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}
