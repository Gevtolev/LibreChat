import { useEffect } from 'react';
import { useRecoilState } from 'recoil';
import { SystemRoles } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import StartupLayout from './Startup';
import store from '~/store';

export default function LoginLayout() {
  const { user, isAuthenticated } = useAuthContext();
  /**
   * GUEST (anonymous) accounts are `isAuthenticated`, but must still be able to reach the login
   * form to log into an existing account (migrating their anonymous data) — only a real account
   * should be bounced back to the app.
   */
  const blocksLoginPage = isAuthenticated && user?.role !== SystemRoles.GUEST;
  const [queriesEnabled, setQueriesEnabled] = useRecoilState<boolean>(store.queriesEnabled);
  useEffect(() => {
    if (queriesEnabled) {
      return;
    }
    const timeout: NodeJS.Timeout = setTimeout(() => {
      setQueriesEnabled(true);
    }, 500);

    return () => {
      clearTimeout(timeout);
    };
  }, [queriesEnabled, setQueriesEnabled]);
  return <StartupLayout isAuthenticated={blocksLoginPage} />;
}
