import * as React from 'react';
import { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { preAuthorizeUser } from '../services/db';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { 
  UserCheck, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowRight, 
  Mail, 
  Lock, 
  User, 
  Factory,
  KeyRound,
  Sparkles
} from 'lucide-react';

export function Login() {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  // Status feedback
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [isUnconfirmedEmail, setIsUnconfirmedEmail] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);

  const handleResendConfirmation = async () => {
    if (!email.trim()) {
      setError('Informe seu e-mail para reenviar o link de confirmação.');
      return;
    }
    setResendingEmail(true);
    try {
      const { error: resendErr } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/`,
        }
      });
      if (resendErr) throw resendErr;
      setMessage(`Link de confirmação reenviado para ${email.trim()}! Verifique sua caixa de entrada e pasta de spam.`);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Erro ao reenviar confirmação. Aguarde alguns instantes e tente novamente.');
    } finally {
      setResendingEmail(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setIsUnconfirmedEmail(false);

    if (!isSupabaseConfigured) {
      setError('Credenciais do Supabase não configuradas no ambiente. Verifique o arquivo .env.local.');
      return;
    }

    setLoading(true);

    try {
      if (activeTab === 'register') {
        if (!name.trim()) {
          setError('Por favor, informe seu nome.');
          setLoading(false);
          return;
        }

        const initialRole = 'leader';
        const initialCargo = 'Líder de Produção';

        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              name: name.trim(),
              role: initialRole,
              cargo: initialCargo,
            },
          },
        });

        if (signUpErr) throw signUpErr;

        if (data.user) {
          try {
            await preAuthorizeUser({
              email: email.trim(),
              name: name.trim(),
              role: initialRole,
              cargo: initialCargo,
            });
            await supabase.from('profiles').upsert({
              id: data.user.id,
              email: email.trim(),
              name: name.trim(),
              role: initialRole,
              cargo: initialCargo,
              status: 'active',
              created_at: new Date().toISOString(),
            });
          } catch (profileErr) {
            console.warn('Registro no banco profiles pós-signup:', profileErr);
          }
        }

        if (data.user && !data.session) {
          setMessage(`Conta criada! Um link de confirmação foi enviado para ${email.trim()}.`);
        } else {
          setMessage('Conta criada com sucesso! Redirecionando para o sistema...');
        }
      } else {
        // Login / Entrada
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (signInErr) throw signInErr;
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('Invalid API key') || msg.includes('apikey')) {
        setError('Chave de API do Supabase inválida ou ausente. Verifique suas credenciais.');
      } else if (msg.includes('Invalid login credentials') || msg.includes('invalid_grant')) {
        setError('E-mail ou senha incorretos.');
      } else if (msg.includes('User already registered') || msg.includes('user_already_exists')) {
        setError('Este e-mail já está cadastrado no sistema. Faça login para entrar.');
      } else if (msg.includes('Password should be at least')) {
        setError('A senha deve conter no mínimo 6 caracteres.');
      } else if (msg.includes('Email not confirmed') || msg.includes('email_not_confirmed')) {
        setIsUnconfirmedEmail(true);
        setError('E-mail não confirmado. O Supabase enviou um link de validação para a sua caixa de entrada.');
      } else if (msg.includes('Failed to fetch')) {
        setError('Não foi possível conectar ao servidor do Supabase. Verifique sua conexão.');
      } else {
        setError(msg || 'Falha ao autenticar no sistema. Verifique suas credenciais.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070709] text-[#f4f4f5] flex flex-col items-center justify-center p-4 sm:p-6 font-sans relative overflow-hidden selection:bg-blue-600 selection:text-white">
      {/* Background ambient lighting */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(37,99,235,0.18),rgba(0,0,0,0))] pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-blue-900/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute -top-24 -right-24 w-80 h-80 bg-blue-600/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Main Container Card */}
      <div className="w-full max-w-md bg-[#101014]/95 backdrop-blur-2xl border border-[#23232a] text-[#f4f4f5] shadow-[0_20px_50px_rgba(0,0,0,0.8)] rounded-3xl overflow-hidden z-10 flex flex-col">
        
        {/* Header da Marca */}
        <div className="p-7 pb-5 border-b border-[#1f1f26] bg-gradient-to-b from-[#16161d] to-[#101014]">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="inline-flex items-center gap-2 bg-blue-600/90 text-white font-black text-xs px-3 py-1.5 rounded-lg tracking-wider shadow-[0_0_15px_rgba(37,99,235,0.4)]">
              <Factory className="w-3.5 h-3.5" />
              <span>Gpanel Factory</span>
            </div>
            
            <span className="text-[11px] font-bold tracking-widest text-[#71717a] uppercase bg-[#181820] border border-[#282832] px-2.5 py-1 rounded-md">
              Fábrica Guarapari
            </span>
          </div>

          <div>
            <h1 className="text-xl font-black tracking-tight text-[#f4f4f5] leading-tight">
              {activeTab === 'login' ? 'Acesso ao Chão de Fábrica' : 'Cadastro de Colaborador'}
            </h1>
            <p className="text-[#a1a1aa] text-xs mt-1 leading-relaxed">
              {activeTab === 'login' 
                ? 'Insira suas credenciais para gerenciar e acompanhar ordens de produção.' 
                : 'Crie sua conta para acessar o painel de produção e apontamentos.'}
            </p>
          </div>

          {/* Seletor de Abas (Entrar / Cadastrar) */}
          <div className="grid grid-cols-2 gap-1.5 bg-[#09090c] p-1.5 rounded-xl border border-[#23232b] mt-5">
            <button
              type="button"
              onClick={() => { setActiveTab('login'); setError(''); setMessage(''); }}
              className={`py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'login'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40'
                  : 'text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#16161c]'
              }`}
            >
              <span>Entrar</span>
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('register'); setError(''); setMessage(''); }}
              className={`py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'register'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40'
                  : 'text-[#71717a] hover:text-[#f4f4f5] hover:bg-[#16161c]'
              }`}
            >
              <span>Cadastrar</span>
            </button>
          </div>
        </div>

        {/* Formulário e Conteúdo */}
        <div className="p-7 pt-6 flex-1 flex flex-col justify-between">
          <div>
            {/* Aviso de Configuração Supabase */}
            {!isSupabaseConfigured && (
              <div className="mb-5 bg-amber-950/40 border border-amber-800/50 rounded-2xl p-3.5 text-amber-200 text-xs flex items-start gap-3">
                <KeyRound className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 leading-relaxed">
                  <p className="font-bold text-amber-300">Supabase não configurado</p>
                  <p className="text-[11px] text-amber-200/80 mt-0.5">
                    Preencha as variáveis de ambiente para habilitar a autenticação.
                  </p>
                </div>
              </div>
            )}

            {/* Mensagem de Erro */}
            {error && (
              <div className="mb-5 bg-red-950/40 border border-red-800/50 rounded-2xl p-3.5 text-red-200 text-xs flex flex-col gap-2.5 animate-in fade-in duration-200">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1 leading-relaxed">{error}</div>
                </div>

                {isUnconfirmedEmail && (
                  <div className="pt-2 border-t border-red-900/50 flex flex-col gap-2">
                    <p className="text-[11px] text-red-300/90 leading-tight">
                      Não recebeu o link ou expirou? Clique abaixo para reenviar.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      disabled={resendingEmail}
                      onClick={handleResendConfirmation}
                      className="h-8 bg-red-900/80 hover:bg-red-800 text-white text-[11px] font-bold rounded-lg self-start flex items-center gap-1.5"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span>{resendingEmail ? 'Reenviando...' : 'Reenviar E-mail de Confirmação'}</span>
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Mensagem de Sucesso */}
            {message && (
              <div className="mb-5 bg-emerald-950/40 border border-emerald-800/50 rounded-2xl p-3.5 text-emerald-200 text-xs flex items-start gap-3 animate-in fade-in duration-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1 leading-relaxed">{message}</div>
              </div>
            )}

            {/* Campos do Formulário */}
            <form onSubmit={handleSubmit} className="space-y-4">
              
              {/* Campo Nome (Apenas no Cadastro) */}
              {activeTab === 'register' && (
                <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
                  <Label htmlFor="name" className="text-[11px] uppercase tracking-widest font-bold text-[#a1a1aa] block">
                    Seu nome
                  </Label>
                  <div className="relative flex items-center">
                    <User className="w-4 h-4 text-[#71717a] absolute left-3.5 pointer-events-none" />
                    <Input
                      id="name"
                      type="text"
                      placeholder="Ex: Maycon Reis"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-11 bg-[#09090d] border-[#26262e] pl-10 text-xs text-[#f4f4f5] rounded-xl focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:border-blue-500"
                      required
                    />
                  </div>
                </div>
              )}

              {/* Campo E-mail */}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[11px] uppercase tracking-widest font-bold text-[#a1a1aa] block">
                  E-mail Corporativo
                </Label>
                <div className="relative flex items-center">
                  <Mail className="w-4 h-4 text-[#71717a] absolute left-3.5 pointer-events-none" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu.email@yberaparis.com.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 bg-[#09090d] border-[#26262e] pl-10 text-xs text-[#f4f4f5] rounded-xl focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:border-blue-500 font-sans"
                    required
                  />
                </div>
              </div>

              {/* Campo Senha */}
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-[11px] uppercase tracking-widest font-bold text-[#a1a1aa] block">
                  Senha de Acesso
                </Label>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 text-[#71717a] absolute left-3.5 pointer-events-none" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 bg-[#09090d] border-[#26262e] pl-10 text-xs text-[#f4f4f5] rounded-xl focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:border-blue-500"
                    required
                  />
                </div>
              </div>

              {/* Botão de Ação Principal */}
              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-wider text-xs shadow-[0_0_20px_rgba(37,99,235,0.35)] transition-all rounded-xl flex items-center justify-center gap-2 active:scale-[0.99]"
                >
                  {loading ? (
                    <span className="animate-pulse flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 animate-spin" />
                      Processando...
                    </span>
                  ) : activeTab === 'login' ? (
                    <>
                      <span>Entrar no Sistema</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      <UserCheck className="w-4 h-4" />
                      <span>Cadastrar Conta</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>

        {/* Rodapé Corporativo com o Nome da Empresa */}
        <div className="bg-[#0b0b0e] py-3.5 px-6 border-t border-[#1d1d24] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500/80 animate-pulse" />
            <span className="font-extrabold tracking-wider text-[#d4d4d8] uppercase text-[11px]">
              Ybera Group
            </span>
          </div>
          <span className="text-[10px] text-[#71717a] font-medium tracking-tight">
            Gestão de Produção & Operação
          </span>
        </div>

      </div>

      {/* Assinatura Corporativa Inferior */}
      <div className="mt-5 text-center text-[11px] text-[#52525b] font-medium">
        <span>© {new Date().getFullYear()} Ybera Group • Todos os direitos reservados</span>
      </div>
    </div>
  );
}
