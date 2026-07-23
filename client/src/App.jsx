import { Navigate, Route, Routes } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import ProfileSetup from './pages/ProfileSetup.jsx';
import Discover from './pages/Discover.jsx';
import Copilots from './pages/Copilots.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import Matches from './pages/Matches.jsx';
import CopilotChat from './pages/CopilotChat.jsx';
import PilotChat from './pages/PilotChat.jsx';
import { useAuth } from './context/AuthContext.jsx';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="page-loading">Loading…</div>;

  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/discover" replace /> : <Login />} />
        <Route path="/signup" element={user ? <Navigate to="/discover" replace /> : <Signup />} />
        <Route path="/invite/:code" element={<AcceptInvite />} />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfileSetup />
            </ProtectedRoute>
          }
        />
        <Route
          path="/discover"
          element={
            <ProtectedRoute>
              <Discover />
            </ProtectedRoute>
          }
        />
        <Route
          path="/copilots"
          element={
            <ProtectedRoute>
              <Copilots />
            </ProtectedRoute>
          }
        />
        <Route
          path="/matches"
          element={
            <ProtectedRoute>
              <Matches />
            </ProtectedRoute>
          }
        />
        <Route
          path="/matches/:id/copilot-chat"
          element={
            <ProtectedRoute>
              <CopilotChat />
            </ProtectedRoute>
          }
        />
        <Route
          path="/matches/:id/pilot-chat"
          element={
            <ProtectedRoute>
              <PilotChat />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to={user ? '/discover' : '/login'} replace />} />
      </Routes>
    </>
  );
}
