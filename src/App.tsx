import * as React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './AuthProvider';
import { useAuthStore } from './store/authStore';
import { Login } from './pages/Login';
import { CoordinatorDashboard } from './pages/CoordinatorDashboard';
import { LeaderScreen } from './pages/LeaderScreen';
import { PesagemScreen } from './pages/PesagemScreen';
import { ManipulacaoScreen } from './pages/ManipulacaoScreen';
import { FirstAccessPasswordChange } from './pages/FirstAccessPasswordChange';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, profile, isLoading } = useAuthStore();
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] font-sans flex items-center justify-center text-[#f4f4f5] text-xs font-bold uppercase tracking-widest gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
        <span>Carregando Sistema...</span>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Se logado e sem profile, aguarde carregar profile
  if (!profile) {
    return (
      <div className="min-h-screen bg-[#09090b] font-sans flex items-center justify-center text-[#f4f4f5] text-xs font-bold uppercase tracking-widest gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        <span>Sincronizando perfil Supabase...</span>
      </div>
    );
  }

  return <>{children}</>;
}

function MainRoute() {
  const { profile } = useAuthStore();
  
  // Se for primeiro acesso ou troca obrigatória de senha, força a tela de definição de nova senha
  if (profile?.mustChangePassword || profile?.status === 'first_access') {
    return <FirstAccessPasswordChange />;
  }

  const role = String(profile?.role || '').toLowerCase().trim();
  const isCoordinator = role === 'coordinator' || role === 'coordenador';

  if (isCoordinator) {
    return <CoordinatorDashboard />;
  }

  const area = profile?.area;

  if (area === 'Pesagem') {
    return <PesagemScreen />;
  }

  if (area === 'Manipulação') {
    return <ManipulacaoScreen />;
  }

  // Se area === 'Envase' ou indefinida/outra, renderiza LeaderScreen por compatibilidade
  return <LeaderScreen />;
}

function PublicLoginRoute() {
  const { user, profile, isLoading } = useAuthStore();
  if (!isLoading && user && profile) {
    return <Navigate to="/" replace />;
  }
  return <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicLoginRoute />} />
          <Route path="/" element={
            <RequireAuth>
              <MainRoute />
            </RequireAuth>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
