import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getErrorMessage } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import SocialLogin from '../components/SocialLogin.jsx';
import AuthHero from '../components/AuthHero.jsx';

export default function Signup() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/signup', { name, email, password });
      loginWithToken(data.token, data.user);
      navigate('/profile');
    } catch (err) {
      setError(getErrorMessage(err, 'Something went wrong'));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSocialSuccess(data) {
    setError('');
    loginWithToken(data.token, data.user);
    navigate('/profile');
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <AuthHero />
        <h1>Wingd</h1>
        <p className="subtitle">Every pilot needs a wing-team.</p>
        <SocialLogin onSuccess={handleSocialSuccess} onError={setError} />
        <form className="form" onSubmit={handleSubmit}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Sign up'}
          </button>
        </form>
        <p>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
