import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { IMAGE_STYLES } from './styles';

const PILL_TRIGGER_CLASS =
  'h-8 w-auto gap-1 rounded-lg border-border-light bg-transparent px-2.5 text-xs text-text-secondary hover:bg-surface-hover';

const DROPDOWN_CONTENT_CLASS = 'bg-surface-secondary text-text-primary';

interface ImageControlsProps {
  style: string;
  aspectRatio: string;
  aspectRatios: string[];
  onStyleChange: (value: string) => void;
  onAspectRatioChange: (value: string) => void;
}

export default function ImageControls({
  style,
  aspectRatio,
  aspectRatios,
  onStyleChange,
  onAspectRatioChange,
}: ImageControlsProps) {
  const localize = useLocalize();

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label={localize('com_ui_images')}
    >
      <Select value={style} onValueChange={onStyleChange}>
        <SelectTrigger className={PILL_TRIGGER_CLASS} aria-label={localize('com_ui_image_style')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={DROPDOWN_CONTENT_CLASS}>
          {IMAGE_STYLES.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {localize(s.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={aspectRatio} onValueChange={onAspectRatioChange}>
        <SelectTrigger className={PILL_TRIGGER_CLASS} aria-label={localize('com_ui_aspect_ratio')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={DROPDOWN_CONTENT_CLASS}>
          {aspectRatios.map((ratio) => (
            <SelectItem key={ratio} value={ratio}>
              {ratio}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
