import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useNotifications } from '../context/NotificationsContext.jsx';

function Badge({ count }) {
  if (!count) return null;
  return <span className="nav-badge">{count > 9 ? '9+' : count}</span>;
}

export default function NavBar() {
  const { user, logout } = useAuth();
  const { summary } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  if (!user) return null;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <nav className="navbar">
      <div className="navbar-top">
        <div className="navbar-brand">🛩️ Wingd</div>
        <button
          className="navbar-toggle"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>
      <div className={`navbar-menu ${menuOpen ? 'open' : ''}`}>
        <div className="navbar-links">
          <NavLink to="/discover">Discover</NavLink>
          <NavLink to="/matches">
            Matches
            <Badge count={summary.newMatches + summary.unreadMessages} />
          </NavLink>
          <NavLink to="/wing-queue">
            Wing queue
            <Badge count={summary.pendingVotes} />
          </NavLink>
          <NavLink to="/copilots">
            Wing circle
            <Badge count={summary.newCopilotAcceptances} />
          </NavLink>
          <NavLink to="/admirers">Admirers</NavLink>
          <NavLink to="/premium">Premium ✨</NavLink>
          <NavLink to="/profile">Profile</NavLink>
        </div>
        <div className="navbar-user">
          <span>{user.name}</span>
          <button onClick={handleLogout}>Log out</button>
        </div>
      </div>
    </nav>
  );
}
