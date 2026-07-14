import { useMediaQuery } from '@librechat/client';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { MemoryPanel } from '~/components/SidePanel/Memories';
import { useLocalize } from '~/hooks';

export default function MemoriesView() {
  const localize = useLocalize();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  return (
    <main className="flex h-full min-h-0 flex-col overflow-auto bg-surface-primary text-text-primary">
      <div className="container mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 md:px-6 lg:pt-12">
        <div className="flex min-w-0 items-center gap-2.5">
          {isSmallScreen ? <OpenSidebar /> : null}
          <h1 className="text-2xl font-bold tracking-tight text-text-primary md:text-3xl">
            {localize('com_ui_memories')}
          </h1>
        </div>
        <MemoryPanel />
      </div>
    </main>
  );
}
