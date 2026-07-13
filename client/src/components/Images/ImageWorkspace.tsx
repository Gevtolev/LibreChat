import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 } from 'uuid';
import { Image as ImageIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Select,
  Button,
  Spinner,
  SelectItem,
  SelectValue,
  SelectContent,
  SelectTrigger,
  TextareaAutosize,
} from '@librechat/client';
import { QueryKeys, dataService } from 'librechat-data-provider';
import {
  useImageModels,
  useGenerateImage,
  useImageResult,
  POLL_TIMEOUT_COUNT,
} from '~/data-provider';
import ReferenceImagePreview from '~/components/Chat/Input/Files/Image';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import { applyStyleToPrompt, DEFAULT_IMAGE_STYLE } from './styles';
import ImageControls from './ImageControls';
import ImageGallery from './ImageGallery';

const readImageDimensions = (file: File): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });

export default function ImageWorkspace() {
  const localize = useLocalize();
  const queryClient = useQueryClient();

  const { data: config } = useImageModels();

  const defaultModel = config?.default ?? '';
  const defaultAspectRatio = config?.aspectRatios?.[0] ?? '1:1';

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [style, setStyle] = useState(DEFAULT_IMAGE_STYLE);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [predictionId, setPredictionId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const pollCountRef = useRef(0);

  // Sync model/aspect-ratio defaults once config loads
  useEffect(() => {
    if (config && !model) {
      setModel(config.default);
    }
    if (
      config &&
      aspectRatio === '1:1' &&
      config.aspectRatios.length > 0 &&
      !config.aspectRatios.includes('1:1')
    ) {
      setAspectRatio(defaultAspectRatio);
    }
  }, [config, model, aspectRatio, defaultAspectRatio]);

  const handleModelChange = (value: string) => {
    setModel(value);
    setImageUrls([]);
  };

  const { mutate: generateImage } = useGenerateImage({
    onSuccess: (data) => {
      pollCountRef.current = 0;
      setPredictionId(data.predictionId);
    },
    onError: () => {
      setIsGenerating(false);
      setErrorMsg(localize('com_ui_image_failed'));
    },
  });

  const pollCount = pollCountRef.current;
  const result = useImageResult(predictionId, !!predictionId, pollCount);

  useEffect(() => {
    if (result.isError) {
      setPredictionId(null);
      setIsGenerating(false);
      setErrorMsg(localize('com_ui_image_failed'));
      return;
    }
    if (!result.data) {
      return;
    }
    if (result.data.status === 'completed') {
      queryClient.invalidateQueries([QueryKeys.imageGallery]);
      setPredictionId(null);
      setIsGenerating(false);
      setErrorMsg(null);
      return;
    }
    if (result.data.status === 'failed') {
      setPredictionId(null);
      setIsGenerating(false);
      setErrorMsg(localize('com_ui_image_failed'));
      return;
    }
    pollCountRef.current += 1;
    if (pollCountRef.current >= POLL_TIMEOUT_COUNT) {
      setPredictionId(null);
      setIsGenerating(false);
      setErrorMsg(localize('com_ui_image_timeout'));
    }
  }, [result.data, result.isError, queryClient, localize]);

  const handleGenerate = () => {
    if (!prompt.trim() || isGenerating) {
      return;
    }
    setErrorMsg(null);
    setIsGenerating(true);
    generateImage({
      prompt: applyStyleToPrompt(prompt.trim(), style),
      model,
      aspectRatio,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    });
  };

  const models = config?.models ?? [];
  const aspectRatios = config?.aspectRatios ?? ['1:1'];
  const selectedModel = models.find((m) => m.id === (model || defaultModel));

  const uploadReferenceImage = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const { width, height } = await readImageDimensions(file);
      const formData = new FormData();
      formData.append('endpoint', 'openAI');
      formData.append('file', file, encodeURIComponent(file.name));
      formData.append('file_id', v4());
      formData.append('width', String(width));
      formData.append('height', String(height));

      const uploaded = await dataService.uploadImage(formData);
      setImageUrls(uploaded.filepath ? [uploaded.filepath] : []);
    } catch {
      setImageUrls([]);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!selectedModel?.supportsEdit) {
        return;
      }
      const file = e.clipboardData?.files?.[0];
      if (!file) {
        return;
      }
      uploadReferenceImage(file);
    },
    [selectedModel, uploadReferenceImage],
  );

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-4 pb-12">
      {/* Model selector — centered at top */}
      {models.length > 0 && (
        <div className="flex w-full justify-center pt-3">
          <Select value={model || defaultModel} onValueChange={handleModelChange}>
            <SelectTrigger
              className="h-9 w-auto gap-1 border-0 bg-transparent text-base font-medium text-text-primary shadow-none hover:bg-surface-hover"
              aria-label={localize('com_ui_image_model')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-surface-secondary text-text-primary">
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Hero + composer */}
      <div className="flex w-full flex-col gap-8 pt-16 md:max-w-3xl md:pt-24 xl:max-w-4xl">
        <h1 className="sr-only">{localize('com_ui_images')}</h1>
        <p className="text-center text-2xl font-semibold text-text-primary">
          {localize('com_ui_image_workspace_subtitle')}
        </p>

        {/* Composer card */}
        <div
          className={cn(
            'rounded-3xl border border-border-light bg-surface-chat p-3 transition-all duration-200',
            isFocused ? 'shadow-lg' : 'shadow-md',
          )}
        >
          {imageUrls.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              <ReferenceImagePreview
                url={imageUrls[0]}
                progress={isUploading ? 0 : 1}
                onDelete={() => setImageUrls([])}
              />
            </div>
          )}

          <div className="flex items-start gap-2">
            <ImageIcon
              className="mt-2.5 h-5 w-5 flex-shrink-0 text-text-tertiary"
              aria-hidden="true"
            />
            <TextareaAutosize
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onPaste={handlePaste}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder={localize('com_ui_image_prompt_placeholder')}
              aria-label={localize('com_ui_image_prompt_placeholder')}
              className="min-h-[40px] w-full resize-none bg-transparent py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
              minRows={1}
              maxRows={8}
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            {models.length > 0 ? (
              <ImageControls
                style={style}
                aspectRatio={aspectRatio}
                aspectRatios={aspectRatios}
                onStyleChange={setStyle}
                onAspectRatioChange={setAspectRatio}
              />
            ) : (
              <span />
            )}

            <Button
              type="button"
              variant="submit"
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim() || isUploading}
              className="flex-shrink-0 rounded-full"
              aria-label={localize('com_ui_generate')}
            >
              {isGenerating ? (
                <span className="flex items-center gap-2">
                  <Spinner className="h-4 w-4" />
                  {localize('com_ui_image_generating')}
                </span>
              ) : (
                localize('com_ui_generate')
              )}
            </Button>
          </div>
        </div>

        {/* Error message */}
        {errorMsg && (
          <p role="alert" className="text-center text-sm text-red-500">
            {errorMsg}
          </p>
        )}
      </div>

      {/* Gallery */}
      <div className="mt-12 w-full md:max-w-3xl xl:max-w-4xl">
        <ImageGallery />
      </div>
    </div>
  );
}
