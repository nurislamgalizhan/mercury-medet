import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';

import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import VerifyPage from './pages/VerifyPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import AdminMfaPage from './pages/AdminMfaPage.jsx';

import AdminLayout from './pages/admin/AdminLayout.jsx';
import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import UsersPage from './pages/admin/UsersPage.jsx';
import UserDetailPage from './pages/admin/UserDetailPage.jsx';
import VisitsAdminPage from './pages/admin/VisitsAdminPage.jsx';
import AccountingPage from './pages/admin/AccountingPage.jsx';
import TariffsAdminPage from './pages/admin/TariffsAdminPage.jsx';
import AdminHistoryPage from './pages/admin/AdminHistoryPage.jsx';

import VisitorLayout from './pages/visitor/VisitorLayout.jsx';
import VisitorHome from './pages/visitor/VisitorHome.jsx';
import VisitorTariffsPage from './pages/visitor/VisitorTariffsPage.jsx';
import VisitorHistoryPage from './pages/visitor/VisitorHistoryPage.jsx';

function RequireAuth({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'ADMIN') return <Navigate to="/admin" replace />;
  return <Navigate to="/visitor" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route path="/admin-mfa" element={<AdminMfaPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      <Route
        path="/admin"
        element={
          <RequireAuth role="ADMIN">
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:id" element={<UserDetailPage />} />
        <Route path="visits" element={<VisitsAdminPage />} />
        <Route path="accounting" element={<AccountingPage />} />
        <Route path="history" element={<AdminHistoryPage />} />
        <Route path="tariffs" element={<TariffsAdminPage />} />
      </Route>

      <Route
        path="/visitor"
        element={
          <RequireAuth role="VISITOR">
            <VisitorLayout />
          </RequireAuth>
        }
      >
        <Route index element={<VisitorHome />} />
        <Route path="history" element={<VisitorHistoryPage />} />
        <Route path="tariffs" element={<VisitorTariffsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
