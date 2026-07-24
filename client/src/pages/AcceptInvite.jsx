import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, getErrorMessage } from '../api';
import { useAuth } from '../context/AuthContext.jsx';

export default function AcceptInvite() {
  const { code } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    (async () => {
      try {
        const { data } = await api.get(`/copilots/invites/${code}`);
        setInvite(data.invite);
      } catch (err) {
        setError(getErrorMessage(err, 'Invite not found'));
      }
    })();
  }, [code, user, authLoading]);

  async function handleAccept() {
    setError('');
    try {
      await api.post(`/copilots/invites/${code}/accept`);
      setAccepted(true);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not accept invite'));
    }
  }

  if (authLoading) return <div className="page-loading">Loading…</div>;

  if (!user) {
    return (
      <div className="page">
        <div className="card">
          <h2>You've been invited to be a co-pilot!</h2>
          <p>Log in or sign up first, then come back to this link to accept.</p>
          <button onClick={() => navigate('/login')}>Log in</button>
          <button onClick={() => navigate('/signup')}>Sign up</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card">
        {error && <p className="error">{error}</p>}
        {!error && invite && !accepted && (
          <>
            <h2>{invite.pilotName} wants you as a co-pilot ✈️</h2>
            <p className="muted">
              As a co-pilot, you'll be able to vouch for {invite.pilotName} and chat with the co-pilots of anyone they match with.
            </p>
            <button onClick={handleAccept}>Accept & become co-pilot</button>
          </>
        )}
        {accepted && (
          <>
            <h2>You're in! 🎉</h2>
            <p>You're now a co-pilot for {invite.pilotName}.</p>
            <button onClick={() => navigate('/copilots')}>Go to Co-pilots</button>
          </>
        )}
      </div>
    </div>
  );
}
