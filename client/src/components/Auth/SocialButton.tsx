import React from 'react';
import { getLastLoginMethod, setLastLoginMethod } from '~/utils';
import { useLocalize } from '~/hooks';

const SocialButton = ({ id, enabled, serverDomain, oauthPath, Icon, label }) => {
  const localize = useLocalize();
  if (!enabled) {
    return null;
  }

  const isLastUsed = getLastLoginMethod() === id;

  return (
    <div className="relative mt-2 flex gap-x-2">
      <a
        aria-label={`${label}`}
        className="flex w-full items-center space-x-3 rounded-full border border-border-light bg-surface-primary px-5 py-3 text-text-primary transition-colors duration-200 hover:bg-surface-tertiary"
        href={`${serverDomain}/oauth/${oauthPath}`}
        onClick={() => setLastLoginMethod(id)}
        data-testid={id}
      >
        <Icon />
        <p>{label}</p>
      </a>
      {isLastUsed && (
        <span className="absolute -top-2 right-2 rounded-full border border-border-light bg-surface-secondary px-2 py-0.5 text-xs text-text-secondary">
          {localize('com_auth_last_used')}
        </span>
      )}
    </div>
  );
};

export default SocialButton;
