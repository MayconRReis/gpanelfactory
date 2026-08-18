import * as React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './AuthProvider';
import { useAuthStore } from './store/authStore';
import { Login } from './pages/Login';
import { CoordinatorDashboard } from './pages/CoordinatorDashboard';
import { LeaderScreen } from './pages/LeaderScreen';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, profile, isLoading } = useAuthStore();
  
  if (isLoading) {
    return <div className="min-h-screen bg-[#0a0a0c] font-sans flex items-center justify-center text-[#f4f4f5] text-xs font-bold uppercase tracking-widest">Carregando...</div>;
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Se logado e sem profile, aguarde carregar profile
  if (!profile) {
    return <div className="min-h-screen bg-[#0a0a0c] font-sans flex items-center justify-center text-[#f4f4f5] text-xs font-bold uppercase tracking-widest">Carregando perfil...</div>;
  }

  return <>{children}</>;
}

function MainRoute() {
  const { profile } = useAuthStore();
  
  if (profile?.role === 'coordinator') {
    return <CoordinatorDashboard />;
  } else if (profile?.role === 'leader') {
    return <LeaderScreen />;
  }
  
  return <div className="text-white p-4">Perfil inválido</div>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            <RequireAuth>
              <MainRoute />
            </RequireAuth>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

