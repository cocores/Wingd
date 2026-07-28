import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Nominatim's usage policy requires a real User-Agent identifying the app, and
// discourages calling it directly from a browser — so we proxy it server-side.
const USER_AGENT = 'WingdApp/1.0 (dating app demo)';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 3) return res.json({ results: [] });

  try {
    const url = `${NOMINATIM_BASE}/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error('Geocoding service error');
    const data = await response.json();
    res.json({ results: data.map((r) => ({ label: r.display_name, lat: r.lat, lon: r.lon })) });
  } catch {
    res.status(502).json({ error: 'Could not search locations right now' });
  }
});

// zoom=10 caps results at city-level, deliberately excluding exact street addresses.
router.get('/reverse', requireAuth, async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon are required' });

  try {
    const url = `${NOMINATIM_BASE}/reverse?format=json&zoom=10&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error('Geocoding service error');
    const data = await response.json();
    res.json({ label: data.display_name || null });
  } catch {
    res.status(502).json({ error: 'Could not detect your location right now' });
  }
});

export default router;
