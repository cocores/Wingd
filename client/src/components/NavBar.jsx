import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function NavBar() {
  const { user, logout } = useAuth();
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
        <NavLink to="/matches">Matches</NavLink>
        <NavLink to="/copilots">Co-pilots</NavLink>
        <NavLink to="/profile">Profile</NavLink>
      </div>
      <div className="navbar-user">
        <span>{user.name}</span>
        <button onClick={handleLogout}>Log out</button>
      </div>
    </nav>
  );
}
