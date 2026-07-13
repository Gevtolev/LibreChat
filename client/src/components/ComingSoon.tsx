import { Construction } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';

export default function ComingSoon({ titleKey }: { titleKey: TranslationKeys }) {
  const localize = useLocalize();
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 bg-surface-primary px-4 text-center text-text-primary">
      <Construction className="h-10 w-10 text-text-secondary" aria-hidden="true" />
      <h1 className="text-2xl font-bold tracking-tight">{localize(titleKey)}</h1>
      <p className="text-text-secondary">{localize('com_ui_coming_soon')}</p>
    </main>
  );
}
