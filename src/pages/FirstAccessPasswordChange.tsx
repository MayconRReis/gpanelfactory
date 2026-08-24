import * as React from 'react';
import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { completeFirstAccessPasswordChange } from '../services/db';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  KeyRound,
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  LogOut,
  Sparkles,
  ArrowRight,
  Factory
} from 'lucide-react';

export function FirstAccessPasswordChange() {
  const { profile, setProfile, signOut } = useAuthStore();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const isMinLength = newPassword.length >= 6;
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmit = isMinLength && passwordsMatch && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isMinLength) {
      setError('A nova senha deve conter no mínimo 6 caracteres.');
      return;
    }

    if (!passwordsMatch) {
      setError('As senhas digitadas não coincidem.');
      return;
    }

    if (!profile?.uid) {
      setError('Sessão inválida. Por favor, saia e faça login novamente.');
      return;
    }

    setLoading(true);

    try {
      const res = await completeFirstAccessPasswordChange(profile.uid, newPassword);
      if (res.success) {
        setSuccess(true);
        // Atualiza o estado global do perfil para liberar o acesso ao sistema
        setTimeout(() => {
          setProfile({
            ...profile,
            mustChangePassword: false,
            status: 'active',
            defaultPassword: undefined,
          });
        }, 1200);
      } else {
        setError(res.message || 'Não foi possível atualizar a senha. Tente novamente.');
      }
    } catch (err: any) {
      setError(err?.message || 'Falha ao salvar nova senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070709] text-[#f4f4f5] flex flex-col items-center justify-center p-4 sm:p-6 font-sans relative overflow-hidden selection:bg-blue-600 selection:text-white">
      {/* Background ambient lighting */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(37,99,235,0.18),rgba(0,0,0,0))] pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-blue-900/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10 space-y-6">
        
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-xl shadow-blue-500/25 ring-1 ring-white/20 mb-1">
            <Factory className="w-7 h-7 text-white" />
          </div>
          <div className="flex items-center justify-center gap-2">
            <span className="text-[10px] uppercase font-bold tracking-widest px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
              <KeyRound className="w-3 h-3" />
              Primeiro Acesso Obrigatório
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Definir Nova Senha de Acesso
          </h1>
          <p className="text-xs text-[#a1a1aa] max-w-sm mx-auto leading-relaxed">
            Olá, <strong className="text-white">{profile?.name || 'Líder'}</strong>! Para sua segurança, cadastre sua senha pessoal definitiva para acessar o chão de fábrica.
          </p>
        </div>

        {/* Form Container */}
        <div className="bg-[#121217]/90 border border-[#26262e] rounded-3xl p-6 sm:p-7 shadow-2xl backdrop-blur-xl space-y-5">
          
          {/* User badge summary */}
          <div className="bg-[#181820] border border-[#2a2a34] rounded-2xl p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-sm">
                {profile?.name?.charAt(0)?.toUpperCase() || 'L'}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#f4f4f5] truncate">{profile?.name}</p>
                <p className="text-[11px] text-[#71717a] font-mono truncate">{profile?.email}</p>
              </div>
            </div>
            <span className="text-[10px] font-bold text-blue-400 bg-blue-950/60 border border-blue-800/40 px-2 py-0.5 rounded-md shrink-0">
              {profile?.cargo || 'Líder de Produção'}
            </span>
          </div>

          {/* Feedback messages */}
          {error && (
            <div className="p-3.5 bg-red-950/40 border border-red-800/50 rounded-xl text-xs text-red-300 flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{error}</p>
            </div>
          )}

          {success && (
            <div className="p-4 bg-emerald-950/50 border border-emerald-800/60 rounded-2xl text-xs text-emerald-200 flex items-center gap-3 animate-in fade-in zoom-in-95">
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="font-bold text-emerald-300">Senha Alterada com Sucesso!</p>
                <p className="text-[11px] text-emerald-400/90">Acessando a tela operacional do líder...</p>
              </div>
            </div>
          )}

          {!success && (
            <form onSubmit={handleSubmit} className="space-y-4">
              
              {/* Nova Senha */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-[#a1a1aa] flex items-center justify-between">
                  <span>Nova Senha</span>
                  <span className="text-[10px] text-[#71717a]">Mínimo de 6 caracteres</span>
                </Label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Digite sua nova senha"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="bg-[#181820] border-[#2c2c36] text-sm text-[#f4f4f5] pr-10 focus:border-blue-500 rounded-xl h-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717a] hover:text-[#f4f4f5] p-1"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirmar Nova Senha */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-[#a1a1aa]">
                  Confirmar Nova Senha
                </Label>
                <div className="relative">
                  <Input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    placeholder="Repita sua nova senha"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="bg-[#181820] border-[#2c2c36] text-sm text-[#f4f4f5] pr-10 focus:border-blue-500 rounded-xl h-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717a] hover:text-[#f4f4f5] p-1"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Requisitos Checklist */}
              <div className="bg-[#0e0e12] border border-[#202028] p-3 rounded-xl space-y-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                    isMinLength ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-[#22222a] text-[#71717a]'
                  }`}>
                    {isMinLength ? '✓' : '•'}
                  </div>
                  <span className={isMinLength ? 'text-emerald-300 font-medium' : 'text-[#71717a]'}>
                    No mínimo 6 caracteres
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                    passwordsMatch ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-[#22222a] text-[#71717a]'
                  }`}>
                    {passwordsMatch ? '✓' : '•'}
                  </div>
                  <span className={passwordsMatch ? 'text-emerald-300 font-medium' : 'text-[#71717a]'}>
                    As senhas coincidem
                  </span>
                </div>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={!canSubmit}
                className="w-full h-11 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Salvando Nova Senha...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Salvar Senha & Entrar no Sistema</span>
                  </>
                )}
              </Button>

            </form>
          )}

          {/* Sair / Trocar conta */}
          <div className="pt-2 border-t border-[#202028] text-center">
            <button
              onClick={() => signOut()}
              className="text-xs text-[#71717a] hover:text-[#f4f4f5] inline-flex items-center gap-1.5 transition-colors font-medium"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sair ou entrar com outra conta</span>
            </button>
          </div>

        </div>

      </div>
    </div>
  );
}
