import React, { useRef, useEffect, useState, Suspense } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useUiStore } from '../store/useUiStore';
import { InputArea } from './InputArea';
import { PipelineModal } from './PipelineModal';
import { ErrorBoundary } from './ErrorBoundary';
import { streamGeminiResponse, generateContent } from '../services/geminiService';
import { convertMessagesToHistory, partHasRenderableImage } from '../utils/messageUtils';
import { imageUrlToBase64 } from '../utils/imageUtils';
import { ChatMessage, Attachment, Part } from '../types';
import { Sparkles } from 'lucide-react';
import { lazyWithRetry } from '../utils/lazyLoadUtils';

// Lazy load components
const ThinkingIndicator = lazyWithRetry(() => import('./ThinkingIndicator').then(m => ({ default: m.ThinkingIndicator })));
const MessageBubble = lazyWithRetry(() => import('./MessageBubble').then(m => ({ default: m.MessageBubble })));

export const ChatInterface: React.FC = () => {
  const {
    apiKey,
    messages,
    settings,
    addMessage,
    updateLastMessage,
    addImageToHistory,
    isLoading,
    setLoading,
    deleteMessage,
    sliceMessages,
    fetchBalance
  } = useAppStore();

  const { batchMode, batchCount, setBatchMode, addToast, setShowApiKeyModal } = useUiStore();

  const [showArcade, setShowArcade] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [isPipelineModalOpen, setIsPipelineModalOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isLoading) {
        setShowArcade(true);
        setIsExiting(false);
    } else if (!isLoading && showArcade) {
        // 当生成完成时，延迟 2.5 秒自动关闭小游戏
        const timer = setTimeout(() => {
            handleCloseArcade();
        }, 2500);
        return () => clearTimeout(timer);
    }
  }, [isLoading, showArcade]);

  const handleCloseArcade = () => {
    setIsExiting(true);
    setTimeout(() => {
        setShowArcade(false);
        setIsExiting(false);
    }, 200); // Match animation duration
  };

  const handleToggleArcade = () => {
      if (showArcade && !isExiting) {
          handleCloseArcade();
      } else if (!showArcade) {
          setShowArcade(true);
      }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, showArcade]);

  const handleSend = async (text: string, attachments: Attachment[]) => {
    // 检查 API Key
    if (!apiKey) {
      setShowApiKeyModal(true);
      addToast('请先输入 API Key', 'error');
      return;
    }

    // 批量生成处理
    if (batchMode === 'normal') {
      const tasks: Array<{ text: string; attachments: Attachment[] }> = [];

      // 普通批量：重复 N 次
      for (let i = 0; i < batchCount; i++) {
        tasks.push({ text, attachments });
      }

      // 执行批量任务
      setBatchProgress({ current: 0, total: tasks.length });
      addToast(`开始批量生成 ${tasks.length} 张图片`, 'info');

      for (let i = 0; i < tasks.length; i++) {
        setBatchProgress({ current: i + 1, total: tasks.length });
        try {
          await executeSingleGeneration(tasks[i].text, tasks[i].attachments);
          // 每个任务之间稍作延迟，避免请求过快
          if (i < tasks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`批量任务 ${i + 1} 失败:`, error);
          // 继续执行下一个任务
        }
      }

      setBatchProgress({ current: 0, total: 0 });
      setBatchMode('off'); // 完成后自动关闭批量模式
      addToast(`批量生成完成！共生成 ${tasks.length} 张图片`, 'success');
      return;
    }

    // 单次生成
    await executeSingleGeneration(text, attachments);
  };

  const executeSingleGeneration = async (text: string, attachments: Attachment[]) => {
    // Capture the current messages state *before* adding the new user message.
    // This allows us to generate history up to this point.
    const currentMessages = useAppStore.getState().messages;
    const history = convertMessagesToHistory(currentMessages);

    setLoading(true);
    const msgId = Date.now().toString();

    // Construct User UI Message
    const userParts: Part[] = [];
    attachments.forEach(att => {
        userParts.push({
            inlineData: {
                mimeType: att.mimeType,
                data: att.base64Data
            }
        });
    });
    if (text) userParts.push({ text });

    const userMessage: ChatMessage = {
      id: msgId,
      role: 'user',
      parts: userParts,
      timestamp: Date.now()
    };
    
    // Add User Message
    addMessage(userMessage);

    // Prepare Model Placeholder
    const modelMessageId = (Date.now() + 1).toString();
    const modelMessage: ChatMessage = {
      id: modelMessageId,
      role: 'model',
      parts: [], // Start empty
      timestamp: Date.now()
    };
    
    // Add Placeholder Model Message to Store
    addMessage(modelMessage);

    try {
      // Prepare images for service
      const imagesPayload = attachments.map(a => ({
          base64Data: a.base64Data,
          mimeType: a.mimeType
      }));

      abortControllerRef.current = new AbortController();

      const startTime = Date.now();
      let thinkingDuration = 0;
      let isThinking = false;

      if (settings.streamResponse) {
          const stream = streamGeminiResponse(
            apiKey,
            history, 
            text,
            imagesPayload,
            settings,
            abortControllerRef.current.signal
          );

          for await (const chunk of stream) {
              // Check if currently generating thought
              const lastPart = chunk.modelParts[chunk.modelParts.length - 1];
              if (lastPart && lastPart.thought) {
                  isThinking = true;
                  thinkingDuration = (Date.now() - startTime) / 1000;
              } else if (isThinking && lastPart && !lastPart.thought) {
                // Just finished thinking
                isThinking = false;
              }

              updateLastMessage(chunk.modelParts, false, isThinking ? thinkingDuration : undefined);
          }
          
          // Final update to ensure duration is set if ended while thinking (unlikely but possible)
          // or to set the final duration if the whole response was a thought
          if (isThinking) {
              thinkingDuration = (Date.now() - startTime) / 1000;
              updateLastMessage(useAppStore.getState().messages.slice(-1)[0].parts, false, thinkingDuration);
          }
      } else {
          const result = await generateContent(
            apiKey,
            history, 
            text,
            imagesPayload,
            settings,
            abortControllerRef.current.signal
          );

          // Calculate thinking duration for non-streaming response
          let totalDuration = (Date.now() - startTime) / 1000;
          // In non-streaming, we can't easily separate thinking time from generation time precisely
          // unless the model metadata provides it (which it currently doesn't in a standardized way exposed here).
          // But we can check if there are thinking parts and attribute some time or just show total time?
          // The UI expects thinkingDuration to show beside the "Thinking Process" block.
          // If we have thought parts, we can pass the total duration as a fallback, or 0 if we don't want to guess.
          // However, existing UI logic in MessageBubble uses `thinkingDuration` prop on the message.
          
          const hasThought = result.modelParts.some(p => p.thought);
          updateLastMessage(result.modelParts, false, hasThought ? totalDuration : undefined);
      }

      // 收集生成的图片到历史记录
      const finalMessage = useAppStore.getState().messages.slice(-1)[0];
      if (finalMessage && finalMessage.role === 'model') {
        const imageParts = finalMessage.parts.filter(partHasRenderableImage);
        imageParts.forEach((part) => {
          if (part.inlineData) {
            addImageToHistory({
              id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              mimeType: part.inlineData.mimeType,
              base64Data: part.inlineData.data,
              prompt: text || '图片生成',
              timestamp: Date.now(),
              modelName: settings.modelName,
            });
          } else if (part.fileData) {
            addImageToHistory({
              id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              mimeType: part.fileData.mimeType,
              imageUrl: part.fileData.fileUri,
              prompt: text || '图片生成',
              timestamp: Date.now(),
              modelName: settings.modelName,
            });
          }
        });
      }

    } catch (error: any) {
      if (error.name === 'AbortError' || abortControllerRef.current?.signal.aborted) {
        console.log("用户已停止生成");
        return;
      }
      console.error("生成失败", error);
      
      let errorText = "生成失败。请检查您的网络和 API Key。";
      if (error.message) {
          errorText = `Error: ${error.message}`;
      }

      // Update the placeholder message with error text and flag
      updateLastMessage([{ text: errorText }], true);

    } finally {
      setLoading(false);
      abortControllerRef.current = null;
      // 每次生成结束后静默刷新余额
      fetchBalance();
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleDelete = (id: string) => {
    deleteMessage(id);
  };

  const handleRegenerate = async (id: string) => {
    if (isLoading) return;

    const index = messages.findIndex(m => m.id === id);
    if (index === -1) return;

    const message = messages[index];
    let targetUserMessage: ChatMessage | undefined;
    let sliceIndex = -1;

    if (message.role === 'user') {
        targetUserMessage = message;
        sliceIndex = index - 1;
    } else if (message.role === 'model') {
        // Find preceding user message
        if (index > 0 && messages[index-1].role === 'user') {
            targetUserMessage = messages[index-1];
            sliceIndex = index - 2;
        }
    }

    if (!targetUserMessage) return;

    // Extract content
    const textPart = targetUserMessage.parts.find(p => p.text);
    const text = textPart ? textPart.text : '';
    const imageParts = targetUserMessage.parts.filter(p => p.inlineData);

    const attachments: Attachment[] = imageParts.map(p => ({
        file: new File([], "placeholder"), // Dummy file object
        preview: `data:${p.inlineData!.mimeType};base64,${p.inlineData!.data}`,
        base64Data: p.inlineData!.data || '',
        mimeType: p.inlineData!.mimeType || ''
    }));

    // Slice history (delete target and future)
    sliceMessages(sliceIndex);

    // Resend
    handleSend(text || '', attachments);
  };

  // Pipeline 执行逻辑 (支持串行和并行)
  const handleExecutePipeline = async (
    mode: 'serial' | 'parallel' | 'combination',
    steps: Array<{ id: string; prompt: string; modelName?: string; status: string }>,
    initialAttachments: Attachment[]
  ) => {
    if (!apiKey) {
      setShowApiKeyModal(true);
      addToast('请先输入 API Key', 'error');
      return;
    }

    if (mode === 'serial') {
      // 串行模式: 依次执行
      await executeSerialPipeline(steps, initialAttachments);
    } else if (mode === 'parallel') {
      // 并行模式: 同时执行
      await executeParallelPipeline(steps, initialAttachments);
    } else if (mode === 'combination') {
      // 批量组合模式: n×m 生成
      await executeCombinationPipeline(steps, initialAttachments);
    }
  };

  // 串行执行
  const executeSerialPipeline = async (
    steps: Array<{ prompt: string; modelName?: string }>,
    initialAttachments: Attachment[]
  ) => {
    setBatchProgress({ current: 0, total: steps.length });
    addToast(`开始串行编排，共 ${steps.length} 步`, 'info');

    let currentAttachments = initialAttachments;
    const originalSettings = useAppStore.getState().settings;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      setBatchProgress({ current: i + 1, total: steps.length });

      try {
        // 如果步骤指定了模型，临时切换模型
        if (step.modelName) {
          useAppStore.getState().updateSettings({ modelName: step.modelName });
        }

        // 执行单次生成
        await executeSingleGeneration(step.prompt, currentAttachments);

        // 恢复原始模型设置
        if (step.modelName) {
          useAppStore.getState().updateSettings({ modelName: originalSettings.modelName });
        }

        // 等待一小段时间确保消息已添加到store
        await new Promise(resolve => setTimeout(resolve, 100));

        // 获取最新生成的模型消息
        const currentMessages = useAppStore.getState().messages;
        const lastModelMessage = currentMessages[currentMessages.length - 1];

        if (lastModelMessage && lastModelMessage.role === 'model') {
          // 提取生成的图片作为下一步的输入（URL 图需先拉成 base64）
          const imageParts = lastModelMessage.parts.filter(partHasRenderableImage);
          const generatedImages: Attachment[] = [];
          for (const p of imageParts) {
            if (p.inlineData) {
              generatedImages.push({
                file: new File([], "generated"),
                preview: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,
                base64Data: p.inlineData.data || '',
                mimeType: p.inlineData.mimeType || '',
              });
            } else if (p.fileData) {
              try {
                const { base64, mimeType } = await imageUrlToBase64(p.fileData.fileUri);
                generatedImages.push({
                  file: new File([], "generated"),
                  preview: `data:${mimeType};base64,${base64}`,
                  base64Data: base64,
                  mimeType,
                });
              } catch (e) {
                console.error('串行编排：无法拉取上一步图片 URL', e);
                addToast('上一步返回的是链接图，拉取失败，无法作为下一步参考图', 'error');
              }
            }
          }

          if (generatedImages.length > 0) {
            currentAttachments = generatedImages;
          } else {
            addToast(`步骤 ${i + 1} 未生成图片，使用原图继续`, 'info');
          }
        }

        // 每个步骤之间延迟，避免请求过快
        if (i < steps.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Pipeline 步骤 ${i + 1} 失败:`, error);
        addToast(`步骤 ${i + 1} 失败，终止编排`, 'error');
        // 恢复原始设置
        useAppStore.getState().updateSettings({ modelName: originalSettings.modelName });
        break;
      }
    }

    setBatchProgress({ current: 0, total: 0 });
    addToast(`串行编排完成！`, 'success');
  };

  // 并行执行 - 优化版：所有结果显示在一条消息中
  const executeParallelPipeline = async (
    steps: Array<{ prompt: string; modelName?: string }>,
    initialAttachments: Attachment[]
  ) => {
    setBatchProgress({ current: 0, total: steps.length });
    addToast(`开始并行编排，共 ${steps.length} 个任务`, 'info');

    const originalSettings = useAppStore.getState().settings;

    // 1. 创建用户消息（显示并行编排信息）
    const userMsgId = Date.now().toString();
    const userParts: Part[] = [];

    // 添加初始图片
    initialAttachments.forEach(att => {
      userParts.push({
        inlineData: {
          mimeType: att.mimeType,
          data: att.base64Data
        }
      });
    });

    // 添加文本说明
    const promptSummary = steps.map((s, i) => `${i + 1}. ${s.prompt}`).join('\n');
    userParts.push({
      text: `🌳 并行编排 (${steps.length}个任务):\n\n${promptSummary}`
    });

    const userMessage: ChatMessage = {
      id: userMsgId,
      role: 'user',
      parts: userParts,
      timestamp: Date.now()
    };
    addMessage(userMessage);

    // 2. 创建模型占位消息
    const modelMessageId = (Date.now() + 1).toString();
    const modelMessage: ChatMessage = {
      id: modelMessageId,
      role: 'model',
      parts: [],
      timestamp: Date.now()
    };
    addMessage(modelMessage);

    // 3. 收集所有生成的图片
    const allGeneratedParts: Part[] = [];
    let completed = 0;

    // 为每个步骤创建独立的执行任务
    const tasks = steps.map(async (step, index) => {
      try {
        // 临时切换模型
        if (step.modelName) {
          useAppStore.getState().updateSettings({ modelName: step.modelName });
        }

        // 准备临时历史记录
        const currentMessages = useAppStore.getState().messages;
        const history = convertMessagesToHistory(currentMessages.slice(0, -2)); // 排除刚添加的两条消息

        // 准备图片数据
        const imagesPayload = initialAttachments.map(a => ({
          base64Data: a.base64Data,
          mimeType: a.mimeType
        }));

        // 执行生成
        const result = await generateContent(
          apiKey,
          history,
          step.prompt,
          imagesPayload,
          step.modelName ? { ...settings, modelName: step.modelName } : settings,
          new AbortController().signal
        );

        // 恢复原始设置
        if (step.modelName) {
          useAppStore.getState().updateSettings({ modelName: originalSettings.modelName });
        }

        // 收集生成的部分，为图片附加 prompt 信息（用于数据集下载）
        const partsWithPrompt = result.modelParts.map(part => {
          if (partHasRenderableImage(part)) {
            return { ...part, prompt: step.prompt };
          }
          return part;
        });
        allGeneratedParts.push(...partsWithPrompt);

        // 更新进度
        completed++;
        setBatchProgress({ current: completed, total: steps.length });

        // 实时更新模型消息
        updateLastMessage(allGeneratedParts, false, undefined);

        // 将生成的图片添加到历史记录
        const imageParts = result.modelParts.filter(partHasRenderableImage);
        imageParts.forEach((part) => {
          if (part.inlineData) {
            addImageToHistory({
              id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              mimeType: part.inlineData.mimeType,
              base64Data: part.inlineData.data,
              prompt: step.prompt,
              timestamp: Date.now(),
              modelName: step.modelName || settings.modelName,
            });
          } else if (part.fileData) {
            addImageToHistory({
              id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              mimeType: part.fileData.mimeType,
              imageUrl: part.fileData.fileUri,
              prompt: step.prompt,
              timestamp: Date.now(),
              modelName: step.modelName || settings.modelName,
            });
          }
        });

        // 延迟避免过快请求
        await new Promise(resolve => setTimeout(resolve, 300));

      } catch (error) {
        console.error(`并行任务 ${index + 1} 失败:`, error);
        // 添加错误文本
        allGeneratedParts.push({
          text: `❌ 步骤 ${index + 1} 失败: ${error instanceof Error ? error.message : '未知错误'}`
        });
        updateLastMessage(allGeneratedParts, false, undefined);

        completed++;
        setBatchProgress({ current: completed, total: steps.length });
      }
    });

    // 等待所有任务完成
    await Promise.all(tasks);

    // 恢复原始设置
    useAppStore.getState().updateSettings({ modelName: originalSettings.modelName });

    setBatchProgress({ current: 0, total: 0 });
    addToast(`并行编排完成！共生成 ${allGeneratedParts.filter(partHasRenderableImage).length} 张图片`, 'success');
  };

  // 批量组合执行: n 图片 × m 提示词
  const executeCombinationPipeline = async (
    steps: Array<{ prompt: string; modelName?: string }>,
    initialAttachments: Attachment[]
  ) => {
    const totalTasks = initialAttachments.length * steps.length;
    setBatchProgress({ current: 0, total: totalTasks });
    addToast(`开始批量组合生成，共 ${initialAttachments.length} 图 × ${steps.length} 词 = ${totalTasks} 张`, 'info');

    const originalSettings = useAppStore.getState().settings;

    // 1. 创建用户消息
    const userMsgId = Date.now().toString();
    const userParts: Part[] = [];

    // 添加所有初始图片
    initialAttachments.forEach(att => {
      userParts.push({
        inlineData: {
          mimeType: att.mimeType,
          data: att.base64Data
        }
      });
    });

    // 添加文本说明
    const promptSummary = steps.map((s, i) => `${i + 1}. ${s.prompt}`).join('\n');
    userParts.push({
      text: `🎨 批量组合生成 (${initialAttachments.length}图 × ${steps.length}词 = ${totalTasks}张):\n\n${promptSummary}`
    });

    const userMessage: ChatMessage = {
      id: userMsgId,
      role: 'user',
      parts: userParts,
      timestamp: Date.now()
    };
    addMessage(userMessage);

    // 2. 创建模型占位消息
    const modelMessageId = (Date.now() + 1).toString();
    const modelMessage: ChatMessage = {
      id: modelMessageId,
      role: 'model',
      parts: [],
      timestamp: Date.now()
    };
    addMessage(modelMessage);

    // 3. 收集所有生成的图片
    const allGeneratedParts: Part[] = [];
    let completed = 0;

    // 为每个图片×提示词组合创建任务
    const tasks = [];
    for (let imgIndex = 0; imgIndex < initialAttachments.length; imgIndex++) {
      const attachment = initialAttachments[imgIndex];

      for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
        const step = steps[stepIndex];

        const task = (async () => {
          try {
            // 临时切换模型
            if (step.modelName) {
              useAppStore.getState().updateSettings({ modelName: step.modelName });
            }

            // 准备历史记录
            const currentMessages = useAppStore.getState().messages;
            const history = convertMessagesToHistory(currentMessages.slice(0, -2));

            // 准备单张图片数据
            const imagesPayload = [{
              base64Data: attachment.base64Data,
              mimeType: attachment.mimeType
            }];

            // 执行生成
            const result = await generateContent(
              apiKey,
              history,
              step.prompt,
              imagesPayload,
              step.modelName ? { ...settings, modelName: step.modelName } : settings,
              new AbortController().signal
            );

            // 恢复原始设置
            if (step.modelName) {
              useAppStore.getState().updateSettings({ modelName: originalSettings.modelName });
            }

            // 收集生成的部分，附加 prompt 信息
            const partsWithPrompt = result.modelParts.map(part => {
              if (partHasRenderableImage(part)) {
                return { ...part, prompt: step.prompt };
              }
              return part;
            });
            allGeneratedParts.push(...partsWithPrompt);

            // 更新进度
            completed++;
            setBatchProgress({ current: completed, total: totalTasks });

            // 实时更新模型消息
            updateLastMessage(allGeneratedParts, false, undefined);

            // 将生成的图片添加到历史记录
            const imageParts = result.modelParts.filter(partHasRenderableImage);
            imageParts.forEach((part) => {
              if (part.inlineData) {
                addImageToHistory({
                  id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  mimeType: part.inlineData.mimeType,
                  base64Data: part.inlineData.data,
                  prompt: step.prompt,
                  timestamp: Date.now(),
                  modelName: step.modelName || settings.modelName,
                });
              } else if (part.fileData) {
                addImageToHistory({
                  id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  mimeType: part.fileData.mimeType,
                  imageUrl: part.fileData.fileUri,
                  prompt: step.prompt,
                  timestamp: Date.now(),
                  modelName: step.modelName || settings.modelName,
                });
              }
            });

            // 延迟避免过快请求
            await new Promise(resolve => setTimeout(resolve, 500));

          } catch (error) {
            console.error(`组合任务失败 (图${imgIndex + 1} × 词${stepIndex + 1}):`, error);
            // 添加错误文本
            allGeneratedParts.push({
              text: `❌ 图片${imgIndex + 1} × 提示词${stepIndex + 1} 失败: ${error instanceof Error ? error.message : '未知错误'}`
            });
            updateLastMessage(allGeneratedParts, false, undefined);

            completed++;
            setBatchProgress({ current: completed, total: totalTasks });
          }
        })();

        tasks.push(task);
      }
    }

    // 等待所有任务完成
    await Promise.all(tasks);

    // 恢复原始设置
    useAppStore.getState().updateSettings({ modelName: originalSettings.modelName });

    setBatchProgress({ current: 0, total: 0 });
    addToast(`批量组合完成！共生成 ${allGeneratedParts.filter(partHasRenderableImage).length} 张图片`, 'success');
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950 transition-colors duration-200">
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 space-y-8 scroll-smooth overscroll-y-contain"
      >
        {/* Batch Progress Indicator */}
        {batchProgress.total > 0 && (
          <div className="sticky top-0 z-10 mb-4 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
                批量生成进度
              </span>
              <span className="text-sm text-amber-700 dark:text-amber-300">
                {batchProgress.current} / {batchProgress.total}
              </span>
            </div>
            <div className="w-full bg-amber-200 dark:bg-amber-800 rounded-full h-2">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center opacity-40 select-none">
            <div className="mb-6 rounded-3xl bg-gray-50 dark:bg-gray-900 p-8 shadow-2xl ring-1 ring-gray-200 dark:ring-gray-800 transition-colors duration-200">
               <Sparkles className="h-16 w-16 text-amber-500 mb-4 mx-auto animate-pulse-fast" />
               <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">NB Nano Banana</h3>
               <p className="max-w-xs text-sm text-gray-500 dark:text-gray-400">
                 开始输入以创建图像，通过对话编辑它们，或询问复杂的问题。
               </p>
            </div>
          </div>
        )}

        {messages.map((msg, index) => (
          <ErrorBoundary key={msg.id}>
            <Suspense fallback={<div className="h-12 w-full animate-pulse bg-gray-100 dark:bg-gray-800 rounded-lg mb-4"></div>}>
              <MessageBubble 
                message={msg} 
                isLast={index === messages.length - 1}
                isGenerating={isLoading}
                onDelete={handleDelete}
                onRegenerate={handleRegenerate}
              />
            </Suspense>
          </ErrorBoundary>
        ))}

        {showArcade && (
            <React.Suspense fallback={
                <div className="flex w-full justify-center py-6 fade-in-up">
                    <div className="w-full max-w-xl h-96 rounded-xl bg-gray-100 dark:bg-gray-900/50 animate-pulse border border-gray-200 dark:border-gray-800"></div>
                </div>
            }>
                <ThinkingIndicator 
                    isThinking={isLoading} 
                    onClose={handleCloseArcade}
                    isExiting={isExiting}
                />
            </React.Suspense>
        )}
      </div>

      <InputArea
        onSend={handleSend}
        onStop={handleStop}
        disabled={isLoading}
        onOpenArcade={handleToggleArcade}
        isArcadeOpen={showArcade}
        onOpenPipeline={() => setIsPipelineModalOpen(true)}
      />

      {/* Pipeline Modal */}
      <PipelineModal
        isOpen={isPipelineModalOpen}
        onClose={() => setIsPipelineModalOpen(false)}
        onExecute={handleExecutePipeline}
      />
    </div>
  );
};
