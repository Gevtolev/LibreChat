import { useNavigate } from 'react-router-dom';
import { OGDialog, OGDialogTemplate } from '@librechat/client';
import { useLocalize } from '~/hooks';

export default function GuestLoginRequiredDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        showCloseButton={false}
        title={localize('com_guest_login_required_title')}
        className="w-11/12 max-w-md"
        main={
          <p className="text-left text-sm text-text-secondary">
            {localize('com_guest_login_required_description')}
          </p>
        }
        selection={{
          selectHandler: () => navigate('/login'),
          selectText: localize('com_auth_login'),
        }}
      />
    </OGDialog>
  );
}
