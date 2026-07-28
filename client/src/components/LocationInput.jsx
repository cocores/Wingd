import { useEffect, useRef, useState } from 'react';
import { api, getErrorMessage } from '../api';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 400;

export default function LocationInput({ value, onChange }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  function handleChange(e) {
    const next = e.target.value;
    onChange(next);
    setError('');
    clearTimeout(debounceRef.current);

    if (next.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/geo/search', { params: { q: next } });
        setSuggestions(data.results);
        setShowSuggestions(true);
      } catch {
        // Suggestions are a nice-to-have; leave the field editable either way.
      }
    }, DEBOUNCE_MS);
  }

  function selectSuggestion(label) {
    onChange(label);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  function detectLocation() {
    if (!navigator.geolocation) {
      setError('Location detection is not supported in this browser');
      return;
    }
    setError('');
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const { data } = await api.get('/geo/reverse', { params: { lat: coords.latitude, lon: coords.longitude } });
          if (data.label) {
            onChange(data.label);
          } else {
            setError('Could not determine your location');
          }
        } catch (err) {
          setError(getErrorMessage(err, 'Could not detect your location right now'));
        } finally {
          setDetecting(false);
        }
      },
      () => {
        setError('Location permission denied');
        setDetecting(false);
      }
    );
  }

  return (
    <div className="location-input" ref={containerRef}>
      <div className="location-input-row">
        <input
          value={value}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          placeholder="Start typing a city…"
          autoComplete="off"
        />
        <button type="button" className="link-btn" onClick={detectLocation} disabled={detecting}>
          {detecting ? 'Detecting…' : '📍 Use my location'}
        </button>
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <ul className="location-suggestions">
          {suggestions.map((s) => (
            <li key={`${s.lat},${s.lon}`} onClick={() => selectSuggestion(s.label)}>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
