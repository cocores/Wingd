import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useNotifications } from '../context/NotificationsContext.jsx';
import { resolveAssetUrl } from '../config.js';

export default function Discover() {
  const { refresh: refreshNotifications } = useNotifications();
  const [profiles, setProfiles] = useState([]);
  const [index, setIndex] = useState(0);
  const [matchNotice, setMatchNotice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ minAge: '', maxAge: '', gender: '' });

  useEffect(() => {
    load();
  }, []);

  async function load(activeFilters = filters) {
    setLoading(true);
    const params = {};
    if (activeFilters.minAge) params.minAge = activeFilters.minAge;
    if (activeFilters.maxAge) params.maxAge = activeFilters.maxAge;
    if (activeFilters.gender) params.gender = activeFilters.gender;
    const { data } = await api.get('/profiles/discover', { params });
    setProfiles(data.profiles);
    setIndex(0);
    setLoading(false);
  }

  function updateFilter(field, value) {
    setFilters((f) => ({ ...f, [field]: value }));
  }

  function applyFilters(e) {
    e.preventDefault();
    load(filters);
  }

  function clearFilters() {
    const cleared = { minAge: '', maxAge: '', gender: '' };
    setFilters(cleared);
    load(cleared);
  }

  async function swipe(direction) {
    const target = profiles[index];
    if (!target) return;
    const { data } = await api.post('/swipes', { targetUserId: target.userId, direction });
    if (data.match) {
      setMatchNotice(data.match);
      refreshNotifications();
    }
    setIndex((i) => i + 1);
  }

  const current = profiles[index];
  const filtersActive = filters.minAge || filters.maxAge || filters.gender;

  return (
    <div className="page">
      <div className="discover-header">
        <h1>Discover</h1>
        <button className="link-btn" onClick={() => setShowFilters((s) => !s)}>
          {showFilters ? 'Hide filters' : 'Filters'}
          {filtersActive ? ' •' : ''}
        </button>
      </div>

      {showFilters && (
        <form className="card form form-inline filters-form" onSubmit={applyFilters}>
          <label>
            Min age
            <input type="number" min={18} value={filters.minAge} onChange={(e) => updateFilter('minAge', e.target.value)} />
          </label>
          <label>
            Max age
            <input type="number" min={18} value={filters.maxAge} onChange={(e) => updateFilter('maxAge', e.target.value)} />
          </label>
          <label>
            Gender
            <input value={filters.gender} onChange={(e) => updateFilter('gender', e.target.value)} placeholder="e.g. woman" />
          </label>
          <button type="submit">Apply</button>
          <button type="button" className="link-btn" onClick={clearFilters}>
            Clear
          </button>
        </form>
      )}

      {matchNotice && (
        <div className="match-banner">
          <p>
            🎉 It's a match! You liked each other. Your co-pilots can now vet it in{' '}
            <Link to="/matches">Matches</Link>.
          </p>
          <button onClick={() => setMatchNotice(null)}>Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="card">Loading pilots…</div>
      ) : !current ? (
        <div className="card">
          <p>No more pilots to discover right now{filtersActive ? ' with these filters' : ''}. Check back later!</p>
          <button onClick={() => load()}>Refresh</button>
        </div>
      ) : (
        <div className="swipe-card">
          {current.photoUrl && <img src={resolveAssetUrl(current.photoUrl)} alt={current.name} className="swipe-photo" />}
          <h2>
            {current.name}
            {current.age ? `, ${current.age}` : ''}
          </h2>
          <p className="muted">
            {[current.gender, current.location].filter(Boolean).join(' · ')}
          </p>
          {current.interestedIn && <p className="muted">Interested in: {current.interestedIn}</p>}
          {current.bio && <p className="bio">{current.bio}</p>}
          <div className="swipe-actions">
            <button className="pass" onClick={() => swipe('pass')}>
              ✕ Pass
            </button>
            <button className="like" onClick={() => swipe('like')}>
              ♥ Like
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
