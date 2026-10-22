import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from './domain/types';
import { useSession } from './store/data';
import { BankLayout, ClientLayout } from './components/Layout';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/client/HomePage';
import ProfilePage from './pages/client/ProfilePage';
import FinancingPage from './pages/client/FinancingPage';
import WizardPage from './pages/client/WizardPage';
import ApplicationsPage from './pages/client/ApplicationsPage';
import ApplicationPage from './pages/client/ApplicationPage';
import HelpPage from './pages/client/HelpPage';
import QueuePage from './pages/bank/QueuePage';
import MyChecksPage from './pages/bank/MyChecksPage';
import HistoryPage from './pages/bank/HistoryPage';
import BankApplicationPage from './pages/bank/BankApplicationPage';

const HOME: Record<Role, string> = { client: '/', employee: '/bank/queue' };

/** Неавторизованный — на вход, чужая роль — в свой кабинет. */
function RequireRole({ role }: { role: Role }) {
  const { user } = useSession();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={HOME[user.role]} replace />;
  return <Outlet />;
}

function LoginRoute() {
  const { user } = useSession();
  return user ? <Navigate to={HOME[user.role]} replace /> : <LoginPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />

      <Route element={<RequireRole role="client" />}>
        <Route element={<ClientLayout />}>
          <Route index element={<HomePage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="financing" element={<FinancingPage />} />
          <Route path="financing/calculator" element={<WizardPage />} />
          <Route path="applications" element={<ApplicationsPage />} />
          <Route path="applications/:id" element={<ApplicationPage />} />
          <Route path="help" element={<HelpPage />} />
        </Route>
      </Route>

      <Route path="bank" element={<RequireRole role="employee" />}>
        <Route element={<BankLayout />}>
          <Route index element={<Navigate to="queue" replace />} />
          <Route path="queue" element={<QueuePage />} />
          <Route path="my" element={<MyChecksPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="applications/:id" element={<BankApplicationPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
