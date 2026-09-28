import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import PushToast from './components/PushToast.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import ProfileSetup from './pages/ProfileSetup.jsx';
import Discover from './pages/Discover.jsx';
import Copilots from './pages/Copilots.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import Matches from './pages/Matches.jsx';
import WingQueue from './pages/WingQueue.jsx';
import WingChat from './pages/WingChat.jsx';
import PilotChat from './pages/PilotChat.jsx';
import Premium from './pages/Premium.jsx';
import Admirers from './pages/Admirers.jsx';
import { useAuth } from './context/AuthContext.jsx';

// face-api.js pulls in a multi-MB bundle (a bundled TensorFlow core) that
// only the verification flow needs — split it into its own chunk instead of
// shipping it on every page load.
const Verify = lazy(() => import('./pages/Verify.jsx'));

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="page-loading">Loading…</div>;

  return (
    <>
      <NavBar />
      <PushToast />
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
          path="/wing-queue"
          element={
            <ProtectedRoute>
              <WingQueue />
            </ProtectedRoute>
          }
        />
        <Route
          path="/interests/:id/chat"
          element={
            <ProtectedRoute>
              <WingChat />
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
        <Route
          path="/premium"
          element={
            <ProtectedRoute>
              <Premium />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admirers"
          element={
            <ProtectedRoute>
              <Admirers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/verify"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="page">Loading…</div>}>
                <Verify />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to={user ? '/discover' : '/login'} replace />} />
      </Routes>
    </>
  );
}
