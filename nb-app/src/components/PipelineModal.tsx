import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Plus, Trash2, ImagePlus, ChevronUp, ChevronDown, Layers, GitBranch, Camera, Grid3x3 } from 'lucide-react';
import { Attachment, PipelineTemplate, PipelineStep } from '../types';
import { loadPipelineTemplates, filterTemplatesByMode } from '../services/pipelineTemplateService';
import { IMAGE_MODEL_OPTIONS } from '../constants/geminiModels';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (mode: 'serial' | 'parallel' | 'combination', steps: PipelineStep[], attachments: Attachment[]) => void;
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

export const PipelineModal: React.FC<Props> = ({ isOpen, onClose, onExecute }) => {
  const [mode, setMode] = useState<'serial' | 'parallel' | 'combination'>('serial');
  const [steps, setSteps] = useState<PipelineStep[]>([{
    id: Date.now().toString(),
    prompt: '',
    status: 'pending'
  }]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [templates, setTemplates] = useState<PipelineTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // 加载模板
  useEffect(() => {
    loadPipelineTemplates()
      .then(setTemplates)
      .catch(err => {
        console.error('Failed to load templates:', err);
        setTemplates([]);
      })
      .finally(() => setTemplatesLoading(false));
  }, []);

  const handleAddStep = () => {
    if (steps.length < 10) {
      setSteps([...steps, {
        id: Date.now().toString() + Math.random(),
        prompt: '',
        status: 'pending'
      }]);
    }
  };

  const handleRemoveStep = (index: number) => {
    if (steps.length > 1) {
      setSteps(steps.filter((_, i) => i !== index));
    }
  };

  const handleStepChange = (index: number, field: 'prompt' | 'modelName', value: string) => {
    const newSteps = [...steps];
    if (field === 'prompt') {
      newSteps[index].prompt = value;
    } else {
      newSteps[index].modelName = value || undefined;
    }
    setSteps(newSteps);
  };

  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    const newSteps = [...steps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
    setSteps(newSteps);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.currentTarget.files) {
      await processFiles(Array.from(e.currentTarget.files));
      // Reset inputs
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const processFiles = useCallback(async (files: File[]) => {
    const newAttachments: Attachment[] = [];

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const base64 = await fileToBase64(file);
          const base64Data = base64.split(',')[1];

          newAttachments.push({
            file,
            preview: base64,
            base64Data,
            mimeType: file.type
          });
        } catch (err) {
          console.error('Error reading file', err);
        }
      }
    }

    setAttachments(prev => [...prev, ...newAttachments].slice(0, 14));
  }, []);

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleApplyTemplate = (template: PipelineTemplate) => {
    setMode(template.mode);
    setSteps(template.steps.map((prompt, idx) => ({
      id: Date.now().toString() + idx,
      prompt,
      status: 'pending' as const
    })));
  };

  const handleExecute = () => {
    const validSteps = steps.filter(s => s.prompt.trim().length > 0);
    if (validSteps.length === 0) {
      alert('请至少添加一个步骤');
      return;
    }
    // 只有组合模式需要至少一张图片（n图×m词）
    if (mode === 'combination' && attachments.length === 0) {
      alert('批量组合模式需要至少上传一张初始图片');
      return;
    }
    onExecute(mode, validSteps, attachments);
    onClose();
  };

  const handleReset = () => {
    setMode('serial');
    setSteps([{
      id: Date.now().toString(),
      prompt: '',
      status: 'pending'
    }]);
    setAttachments([]);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-gray-200 dark:border-gray-800">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
              mode === 'combination' ? 'bg-amber-500/10' : 'bg-purple-500/10'
            }`}>
              {mode === 'serial' ? (
                <Layers className="h-5 w-5 text-purple-500" />
              ) : mode === 'parallel' ? (
                <GitBranch className="h-5 w-5 text-purple-500" />
              ) : (
                <Grid3x3 className="h-5 w-5 text-amber-500" />
              )}
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {mode === 'serial' ? '串行编排' : mode === 'parallel' ? '并行编排' : '批量组合生成'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
          >
            <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">

          {/* 模式选择 */}
          <section>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              执行模式
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setMode('serial')}
                className={`p-3 rounded-lg border transition ${
                  mode === 'serial'
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-500/10'
                    : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700'
                }`}
              >
                <Layers className={`h-5 w-5 mx-auto mb-1 ${mode === 'serial' ? 'text-purple-600 dark:text-purple-400' : 'text-gray-400'}`} />
                <p className={`text-xs font-medium ${mode === 'serial' ? 'text-purple-700 dark:text-purple-300' : 'text-gray-600 dark:text-gray-400'}`}>
                  串行模式
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
                  步骤依次执行
                </p>
              </button>
              <button
                onClick={() => setMode('parallel')}
                className={`p-3 rounded-lg border transition ${
                  mode === 'parallel'
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-500/10'
                    : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700'
                }`}
              >
                <GitBranch className={`h-5 w-5 mx-auto mb-1 ${mode === 'parallel' ? 'text-purple-600 dark:text-purple-400' : 'text-gray-400'}`} />
                <p className={`text-xs font-medium ${mode === 'parallel' ? 'text-purple-700 dark:text-purple-300' : 'text-gray-600 dark:text-gray-400'}`}>
                  并行模式
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
                  步骤同时执行
                </p>
              </button>
              <button
                onClick={() => setMode('combination')}
                className={`p-3 rounded-lg border transition ${
                  mode === 'combination'
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10'
                    : 'border-gray-200 dark:border-gray-700 hover:border-amber-300 dark:hover:border-amber-700'
                }`}
              >
                <Grid3x3 className={`h-5 w-5 mx-auto mb-1 ${mode === 'combination' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`} />
                <p className={`text-xs font-medium ${mode === 'combination' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-600 dark:text-gray-400'}`}>
                  批量组合
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
                  n图×m词
                </p>
              </button>
            </div>
          </section>

          {/* 模板选择 */}
          <section>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              快速模板
              {templatesLoading && (
                <span className="ml-2 text-xs text-gray-400">(加载中...)</span>
              )}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {/* 串行模板下拉 */}
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  串行模板
                </label>
                <select
                  onChange={(e) => {
                    const template = templates.find(t => t.name === e.target.value);
                    if (template) handleApplyTemplate(template);
                    e.target.value = '';
                  }}
                  disabled={templatesLoading}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-purple-500 dark:hover:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  defaultValue=""
                >
                  <option value="" disabled>选择串行模板...</option>
                  {filterTemplatesByMode(templates, 'serial').map((template) => (
                    <option key={template.name} value={template.name}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 并行模板下拉 */}
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  并行模板
                </label>
                <select
                  onChange={(e) => {
                    const template = templates.find(t => t.name === e.target.value);
                    if (template) handleApplyTemplate(template);
                    e.target.value = '';
                  }}
                  disabled={templatesLoading}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-purple-500 dark:hover:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  defaultValue=""
                >
                  <option value="" disabled>选择并行模板...</option>
                  {filterTemplatesByMode(templates, 'parallel').map((template) => (
                    <option key={template.name} value={template.name}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 批量组合模板下拉 */}
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  批量组合
                </label>
                <select
                  onChange={(e) => {
                    const template = templates.find(t => t.name === e.target.value);
                    if (template) handleApplyTemplate(template);
                    e.target.value = '';
                  }}
                  disabled={templatesLoading}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-amber-500 dark:hover:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  defaultValue=""
                >
                  <option value="" disabled>选择组合模板...</option>
                  {filterTemplatesByMode(templates, 'combination').map((template) => (
                    <option key={template.name} value={template.name}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* 初始图片 */}
          <section>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              初始参考图 {mode === 'combination' ? '(必需，最多14张)' : '(可选，最多14张)'}
              {mode === 'combination' && (
                <span className="block text-xs font-normal text-amber-600 dark:text-amber-400 mt-1">
                  💡 每张图片将与每条提示词组合生成，总共 {attachments.length} × {steps.length} = {attachments.length * steps.length} 张
                </span>
              )}
              {mode !== 'combination' && (
                <span className="block text-xs font-normal text-gray-500 dark:text-gray-400 mt-1">
                  💡 {mode === 'serial' ? '串行模式支持纯文本生成，也可上传图片作为初始参考' : '并行模式支持纯文本生成，也可上传图片作为初始参考'}
                </span>
              )}
            </label>

            {attachments.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
                {attachments.map((att, i) => (
                  <div key={i} className="relative h-16 w-16 shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 group">
                    <img
                      src={att.preview}
                      alt="preview"
                      className="h-full w-full object-cover rounded-lg opacity-80 group-hover:opacity-100 transition"
                    />
                    <button
                      onClick={() => removeAttachment(i)}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-sm hover:bg-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept="image/*"
              multiple
              className="hidden"
            />

            {/* 拍照输入（移动端） */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              ref={cameraInputRef}
              onChange={handleFileSelect}
            />

            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={attachments.length >= 14}
                className="flex-1 px-4 py-3 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-amber-500 dark:hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ImagePlus className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {attachments.length === 0 ? '点击上传' : `${attachments.length} 张`}
                </span>
              </button>

              {/* 拍照按钮（仅移动端显示） */}
              <button
                onClick={() => cameraInputRef.current?.click()}
                disabled={attachments.length >= 14}
                className="sm:hidden px-4 py-3 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-amber-500 dark:hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Camera className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                <span className="text-sm text-gray-600 dark:text-gray-400">拍照</span>
              </button>
            </div>
          </section>

          {/* 步骤列表 */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                编排步骤 ({steps.length}/10)
              </label>
              <button
                onClick={handleAddStep}
                disabled={steps.length >= 10}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <Plus className="h-3 w-3 inline mr-1" />
                添加步骤
              </button>
            </div>

            <div className="space-y-3">
              {steps.map((step, index) => (
                <div key={step.id} className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex-shrink-0 mt-2">
                    <div className={`h-6 w-6 rounded-full text-white text-xs font-bold flex items-center justify-center ${
                      mode === 'serial' ? 'bg-purple-500' : 'bg-blue-500'
                    }`}>
                      {index + 1}
                    </div>
                  </div>

                  <div className="flex-1 space-y-2">
                    <textarea
                      value={step.prompt}
                      onChange={(e) => handleStepChange(index, 'prompt', e.target.value)}
                      placeholder={`步骤 ${index + 1} 的提示词...`}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm resize-y focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[80px]"
                      rows={3}
                    />

                    {/* 模型选择器 */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        模型:
                      </label>
                      <select
                        value={step.modelName || ''}
                        onChange={(e) => handleStepChange(index, 'modelName', e.target.value)}
                        className="flex-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      >
                        <option value="">默认 (继承全局设置)</option>
                        {IMAGE_MODEL_OPTIONS.map((model) => (
                          <option key={model.value} value={model.value}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    {mode === 'serial' && (
                      <>
                        <button
                          onClick={() => handleMoveStep(index, 'up')}
                          disabled={index === 0}
                          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                          title="上移"
                        >
                          <ChevronUp className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                        </button>
                        <button
                          onClick={() => handleMoveStep(index, 'down')}
                          disabled={index === steps.length - 1}
                          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                          title="下移"
                        >
                          <ChevronDown className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleRemoveStep(index)}
                      disabled={steps.length === 1}
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-30 disabled:cursor-not-allowed transition"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
          <button
            onClick={handleReset}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 transition"
          >
            重置
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 transition"
            >
              取消
            </button>
            <button
              onClick={handleExecute}
              className="px-5 py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 transition"
            >
              开始执行
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
