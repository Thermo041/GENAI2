import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { AppShell } from './components/layout/AppShell.jsx';
import { Spinner } from './components/ui/primitives.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';

const Repositories = lazy(() => import('./pages/Repositories.jsx'));
const RepositoryLayout = lazy(() => import('./pages/repository/RepositoryLayout.jsx'));
const OverviewTab = lazy(() => import('./pages/repository/OverviewTab.jsx'));
const FilesTab = lazy(() => import('./pages/repository/FilesTab.jsx'));
const AssistantTab = lazy(() => import('./pages/repository/AssistantTab.jsx'));
const ImpactTab = lazy(() => import('./pages/repository/ImpactTab.jsx'));
const ChangesTab = lazy(() => import('./pages/repository/ChangesTab.jsx'));
const PullsTab = lazy(() => import('./pages/repository/PullsTab.jsx'));
const PullDetail = lazy(() => import('./pages/repository/PullDetail.jsx'));
const ArchitectureTab = lazy(() => import('./pages/repository/ArchitectureTab.jsx'));
const Activity = lazy(() => import('./pages/Activity.jsx'));
const Changes = lazy(() => import('./pages/Changes.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

function FullPageLoader() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <Spinner className="size-5" label="Loading CodeWeave" />
    </div>
  );
}

function RequireAuth({ children }) {
  const { authenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (!authenticated) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  return children;
}

export default function App() {
  const { authenticated, loading } = useAuth();

  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        <Route path="/" element={authenticated && !loading ? <Navigate to="/dashboard" replace /> : <Landing />} />
        <Route path="/login" element={authenticated && !loading ? <Navigate to="/dashboard" replace /> : <Login />} />

        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/repositories" element={<Repositories />} />
          <Route path="/changes" element={<Changes />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/settings" element={<Settings />} />

          <Route path="/r/:owner/:repo" element={<RepositoryLayout />}>
            <Route index element={<OverviewTab />} />
            <Route path="files" element={<FilesTab />} />
            <Route path="assistant" element={<AssistantTab />} />
            <Route path="impact" element={<ImpactTab />} />
            <Route path="changes" element={<ChangesTab />} />
            <Route path="architecture" element={<ArchitectureTab />} />
            <Route path="pulls" element={<PullsTab />} />
            <Route path="pulls/:number" element={<PullDetail />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
