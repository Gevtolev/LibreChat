import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, SendIcon, Spinner, TextareaAutosize, useToastContext } from '@librechat/client';
import type { KeyboardEvent } from 'react';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import { useGetStartupConfig, useGuestChatMutation } from '~/data-provider';
import GuestLoginRequiredDialog from './GuestLoginRequiredDialog';
import { NotificationSeverity } from '~/common';
import { cn, removeFocusRings } from '~/utils';
import { useLocalize } from '~/hooks';

interface GuestChatErrorShape {
  response?: { data?: { code?: string } };
}

const isGuestLoginRequiredError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as GuestChatErrorShape).response?.data?.code === 'guest_login_required';

export default function GuestChatLanding() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const { data: startupConfig } = useGetStartupConfig();
  const [text, setText] = useState('');
  const [sentText, setSentText] = useState('');
  const [hasSent, setHasSent] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  const guestChatMutation = useGuestChatMutation({
    onSuccess: (data) => {
      setHasSent(true);
      setReply(data.text);
    },
    onError: (error) => {
      if (isGuestLoginRequiredError(error)) {
        setShowLoginDialog(true);
        return;
      }
      showToast({
        message: localize('com_ui_error'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
    },
  });

  const submitText = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    if (hasSent) {
      setShowLoginDialog(true);
      return;
    }
    setSentText(trimmed);
    guestChatMutation.mutate({ text: trimmed });
    setText('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitText();
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-presentation">
      <div className="flex items-center justify-between p-4">
        <span className="text-lg font-semibold text-text-primary">
          {startupConfig?.appTitle ?? 'ChatChat'}
        </span>
        <Button variant="outline" onClick={() => navigate('/login')}>
          {localize('com_auth_login')}
        </Button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4">
        {reply == null ? (
          <h1 className="text-2xl font-semibold text-text-primary">
            {localize('com_guest_welcome_message')}
          </h1>
        ) : (
          <div className="flex w-full max-w-2xl flex-col gap-4">
            <div className="self-end rounded-2xl bg-surface-tertiary px-4 py-2 text-text-primary">
              {sentText}
            </div>
            <div className="text-text-primary">
              <MarkdownLite content={reply} />
            </div>
          </div>
        )}
        <div className="flex w-full max-w-2xl items-end gap-2 rounded-2xl border border-border-medium bg-surface-primary p-2 [&:has(textarea:focus)]:shadow-[0_2px_6px_rgba(0,0,0,.05)]">
          <TextareaAutosize
            aria-label={localize('com_ui_message_input')}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={hasSent || guestChatMutation.isLoading}
            className={cn(
              'max-h-52 flex-1 resize-none bg-transparent px-2 py-1.5 text-text-primary',
              removeFocusRings,
            )}
          />
          <button
            type="button"
            aria-label={localize('com_nav_send_message')}
            onClick={submitText}
            disabled={!text.trim() || hasSent || guestChatMutation.isLoading}
            className="rounded-full bg-text-primary p-1.5 text-text-primary outline-offset-4 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-10"
          >
            {guestChatMutation.isLoading ? <Spinner className="size-4" /> : <SendIcon size={24} />}
          </button>
        </div>
      </div>
      <GuestLoginRequiredDialog open={showLoginDialog} onOpenChange={setShowLoginDialog} />
    </div>
  );
}
