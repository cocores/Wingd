export default function AuthHero() {
  return (
    <div className="auth-hero" aria-hidden="true">
      <svg viewBox="0 0 220 90">
        <path className="flight-path" d="M12,68 Q110,-6 208,18" />
        <circle className="flight-dot" cx="12" cy="68" r="4" />
        <circle className="flight-dot" cx="208" cy="18" r="4" />
      </svg>
      <span className="auth-plane">🛩️</span>
    </div>
  );
}
