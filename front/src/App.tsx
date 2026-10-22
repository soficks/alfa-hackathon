import { Navigate, Route, Routes } from 'react-router-dom';
import { useStore } from './store/store';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import ProfilePage from './pages/ProfilePage';
import FinancingPage from './pages/FinancingPage';
import CalculatorPage from './pages/CalculatorPage';
import ApplicationsPage from './pages/ApplicationsPage';
import ApplicationDetailsPage from './pages/ApplicationDetailsPage';
import HelpPage from './pages/HelpPage';

export default function App() {
  const { state } = useStore();

  return (
    <Routes>
      <Route path="/login" element={state.authed ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={state.authed ? <Layout /> : <Navigate to="/login" replace />}>
        <Route index element={<HomePage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="financing" element={<FinancingPage />} />
        <Route path="financing/calculator" element={<CalculatorPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="applications/:id" element={<ApplicationDetailsPage />} />
        <Route path="help" element={<HelpPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
