// Same-origin by default (matches the Vite dev proxy and a same-host
// production deploy). Set VITE_API_URL when the frontend and backend are
// deployed separately — e.g. the frontend on Vercel and the backend on a
// host that can run a persistent Node process.
export const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

// Uploaded photos come back from the API as a relative /uploads/... path,
// which only resolves correctly when the frontend and backend share an
// origin. Prefix it with the configured backend origin otherwise.
export function resolveAssetUrl(path) {
  if (!path || /^https?:\/\//.test(path)) return path;
  return `${API_BASE_URL}${path}`;
}
