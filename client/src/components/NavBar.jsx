import { NavLink, useNavigate } from 'react-router-dom';
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

  if (!user) return null;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <nav className="navbar">
      <div className="navbar-brand">🛩️ Wingd</div>
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
        <NavLink to="/profile">Profile</NavLink>
      </div>
      <div className="navbar-user">
        <span>{user.name}</span>
        <button onClick={handleLogout}>Log out</button>
      </div>
    </nav>
  );
}
