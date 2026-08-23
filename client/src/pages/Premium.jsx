import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, getErrorMessage } from '../api';

const STATUS_LABELS = {
  none: 'Free',
  active: 'Premium — active',
  past_due: 'Premium — payment past due',
  canceled: 'Premium — canceled',
  incomplete: 'Premium — payment incomplete',
  incomplete_expired: 'Free',
  unpaid: 'Premium — unpaid',
};

export default function Premium() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await api.get('/billing/status');
    setStatus(data);
  }

  async function subscribe() {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/billing/checkout');
      window.location.href = data.url;
    } catch (err) {
      setError(getErrorMessage(err, 'Could not start checkout'));
      setBusy(false);
    }
  }

  async function manage() {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/billing/portal');
      window.location.href = data.url;
    } catch (err) {
      setError(getErrorMessage(err, 'Could not open the billing portal'));
      setBusy(false);
    }
  }

  const checkoutResult = searchParams.get('checkout');
  const isPremium = status?.premiumStatus === 'active';

  return (
    <div className="page">
      <h1>Premium</h1>

      {checkoutResult === 'success' && <p className="success">You're all set — premium features are unlocked!</p>}
      {checkoutResult === 'cancelled' && <p className="muted">Checkout was cancelled — no charge was made.</p>}

      {!status ? (
        <div className="card">Loading…</div>
      ) : (
        <>
          <div className="card">
            <h3>Your plan</h3>
            <p>
              Status: <span className={`badge ${status.premiumStatus}`}>{STATUS_LABELS[status.premiumStatus] || status.premiumStatus}</span>
            </p>
            {status.premiumCurrentPeriodEnd && (
              <p className="muted">
                {isPremium ? 'Renews' : 'Access ends'} {new Date(status.premiumCurrentPeriodEnd).toLocaleDateString()}
              </p>
            )}
            {!status.configured && <p className="muted">Billing isn't configured on this server yet.</p>}
            {error && <p className="error">{error}</p>}
            {isPremium ? (
              <button onClick={manage} disabled={busy}>
                Manage subscription
              </button>
            ) : (
              <button className="primary" onClick={subscribe} disabled={busy || !status.configured}>
                {busy ? 'Redirecting…' : 'Upgrade to Premium'}
              </button>
            )}
          </div>

          <div className="card">
            <h3>What premium unlocks</h3>
            <ul className="list">
              <li>Bigger wing circle — up to 15 wingmen instead of 5</li>
              <li>Unlimited daily likes — no more waiting for tomorrow</li>
              <li>See who's interested in you before you browse back</li>
              <li>Undo your last swipe</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
