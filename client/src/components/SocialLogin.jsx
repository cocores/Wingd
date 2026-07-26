import { useEffect, useRef } from 'react';
import { api, getErrorMessage } from '../api';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID;

// Renders "Continue with Google" / "Continue with Apple" using each
// provider's own script-rendered button (so branding stays compliant with
// their guidelines), and posts the resulting credential to our backend for
// verification. Silently renders nothing for a provider whose client ID
// isn't configured, so the demo works out of the box without either.
export default function SocialLogin({ onSuccess, onError }) {
  const googleButtonRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleButtonRef.current) return undefined;
    let cancelled = false;

    function setup() {
      if (cancelled || !window.google?.accounts?.id || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          try {
            const { data } = await api.post('/auth/google', { credential });
            onSuccess(data);
          } catch (err) {
            onError(getErrorMessage(err, 'Google sign-in failed'));
          }
        },
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        width: 300,
      });
    }

    if (window.google?.accounts?.id) {
      setup();
      return undefined;
    }
    const script = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    script?.addEventListener('load', setup);
    return () => {
      cancelled = true;
      script?.removeEventListener('load', setup);
    };
  }, [onSuccess, onError]);

  useEffect(() => {
    if (!APPLE_CLIENT_ID) return undefined;

    function setup() {
      window.AppleID?.auth.init({
        clientId: APPLE_CLIENT_ID,
        scope: 'name email',
        redirectURI: window.location.origin,
        usePopup: true,
      });
    }

    function handleSuccess(event) {
      const { authorization, user } = event.detail;
      const fullName = user?.name ? `${user.name.firstName || ''} ${user.name.lastName || ''}`.trim() : undefined;
      api
        .post('/auth/apple', { idToken: authorization.id_token, name: fullName || undefined })
        .then(({ data }) => onSuccess(data))
        .catch((err) => onError(getErrorMessage(err, 'Apple sign-in failed')));
    }

    function handleFailure(event) {
      if (event.detail?.error === 'popup_closed_by_user') return;
      onError('Apple sign-in failed');
    }

    if (window.AppleID) setup();
    else {
      const script = document.querySelector('script[src*="appleid.cdn-apple.com"]');
      script?.addEventListener('load', setup);
    }
    document.addEventListener('AppleIDSignInOnSuccess', handleSuccess);
    document.addEventListener('AppleIDSignInOnFailure', handleFailure);
    return () => {
      document.removeEventListener('AppleIDSignInOnSuccess', handleSuccess);
      document.removeEventListener('AppleIDSignInOnFailure', handleFailure);
    };
  }, [onSuccess, onError]);

  if (!GOOGLE_CLIENT_ID && !APPLE_CLIENT_ID) return null;

  return (
    <div className="social-login">
      {GOOGLE_CLIENT_ID && <div ref={googleButtonRef} className="google-btn-slot" />}
      {APPLE_CLIENT_ID && (
        <div
          id="appleid-signin"
          className="apple-btn-slot"
          data-color="black"
          data-border="true"
          data-type="sign in"
          data-width="300"
          data-height="40"
        />
      )}
      <div className="social-divider">
        <span>or</span>
      </div>
    </div>
  );
}
