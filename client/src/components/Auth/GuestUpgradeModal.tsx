import { useRecoilState } from 'recoil';
import { useNavigate } from 'react-router-dom';
import { OGDialog, DialogTemplate } from '@librechat/client';
import { useLocalize } from '~/hooks';
import store from '~/store';

/**
 * Strong login prompt shown when an anonymous (GUEST) visitor exhausts their free-trial
 * messages. Opened via the `guestUpgradeModalOpen` atom, which the chat error handler sets
 * when a request fails with the `upgrade_required_quota` code.
 */
export default function GuestUpgradeModal() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [open, setOpen] = useRecoilState<boolean>(store.guestUpgradeModalOpen);

  const handleLogin = () => {
    setOpen(false);
    navigate('/login');
  };

  return (
    <OGDialog open={open} onOpenChange={setOpen}>
      <DialogTemplate
        title={localize('com_ui_guest_upgrade_title')}
        className="w-11/12 max-w-md"
        showCancelButton={false}
        main={
          <p className="px-1 py-2 text-sm text-text-primary">
            {localize('com_ui_guest_upgrade_desc')}
          </p>
        }
        buttons={
          <button
            onClick={handleLogin}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border-heavy bg-surface-secondary px-4 py-2 text-sm text-text-primary hover:bg-green-500 hover:text-white focus:bg-green-500 focus:text-white dark:hover:bg-green-600 dark:focus:bg-green-600"
          >
            {localize('com_auth_login')}
          </button>
        }
      />
    </OGDialog>
  );
}
