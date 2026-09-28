export default function VerifiedBadge({ verified }) {
  if (!verified) return null;
  return (
    <span className="verify-badge" title="Verified">
      ✓
    </span>
  );
}
