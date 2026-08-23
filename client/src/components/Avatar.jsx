import { resolveAssetUrl } from '../config.js';

// Renders a photo when there is one, otherwise a colored initial so cards
// never show an empty gap where a photo would normally sit.
export default function Avatar({ name, photoUrl, className = '' }) {
  if (photoUrl) {
    return <img src={resolveAssetUrl(photoUrl)} alt={name} className={`avatar-photo ${className}`} />;
  }
  const initial = name ? name.trim()[0]?.toUpperCase() : '?';
  return (
    <div className={`avatar-placeholder ${className}`} aria-hidden="true">
      {initial}
    </div>
  );
}
