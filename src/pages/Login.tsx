import * as React from 'react';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { doc, setDoc } from 'firebase/firestore'; 
import { db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      if (isResetting) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/`,
        });
        if (error) throw error;
        setMessage('Email de recuperação enviado. Verifique sua caixa de entrada.');
      } else if (isRegistering) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name }
          }
        });
        if (error) throw error;
        if (data.user) {
            await setDoc(doc(db, 'users', data.user.id), {
              uid: data.user.id,
              email,
              name,
              role: 'leader', // Force leader role
              createdAt: new Date().toISOString()
            });
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-[#f4f4f5] flex items-center justify-center p-4 font-sans">
      <Card className="w-full max-w-md bg-[#18181b] border-[#27272a] text-[#f4f4f5] shadow-2xl shadow-black/50">
        <CardHeader>
          <CardTitle className="text-2xl font-black tracking-tight text-center text-[#f4f4f5] flex items-center justify-center gap-2">
            <div className="bg-blue-600 text-white px-2 py-0.5 rounded text-sm tracking-tighter">GYP</div> 
            SISTEMA
          </CardTitle>
          <CardDescription className="text-center text-[#a1a1aa] text-xs uppercase tracking-widest mt-2">
            {isResetting ? 'Recuperar senha' : isRegistering ? 'Criar nova conta' : 'Faça login para continuar'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-[#a1a1aa] text-[10px] uppercase tracking-widest font-bold">Email</Label>
              <Input 
                id="email" 
                type="email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                className="bg-[#121214] border-[#27272a] text-[#f4f4f5] focus-visible:ring-blue-500"
                required
              />
            </div>
            {!isResetting && !isRegistering && (
              <div className="text-right">
                <button 
                  type="button" 
                  className="text-[#71717a] hover:text-[#a1a1aa] text-[10px] uppercase tracking-widest"
                  onClick={() => { setIsResetting(true); setIsRegistering(false); }}
                >
                  Esqueci minha senha
                </button>
              </div>
            )}
            {isRegistering && (
                <div className="space-y-2">
                    <Label htmlFor="name" className="text-[#a1a1aa] text-[10px] uppercase tracking-widest font-bold">Nome</Label>
                    <Input 
                        id="name" 
                        type="text" 
                        value={name} 
                        onChange={(e) => setName(e.target.value)} 
                        className="bg-[#121214] border-[#27272a] text-[#f4f4f5] focus-visible:ring-blue-500"
                        required
                    />
                </div>
            )}
            {!isResetting && (
                <div className="space-y-2">
                <Label htmlFor="password" className="text-[#a1a1aa] text-[10px] uppercase tracking-widest font-bold">Senha</Label>
                <Input 
                    id="password" 
                    type="password" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-[#121214] border-[#27272a] text-[#f4f4f5] focus-visible:ring-blue-500"
                    required={!isResetting}
                />
                </div>
            )}
            {error && <p className="text-red-500 text-sm">{error}</p>}
            {message && <p className="text-green-500 text-sm">{message}</p>}
            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-widest text-[11px] shadow-[0_0_10px_rgba(37,99,235,0.2)]">
              {isResetting ? 'Enviar link de recuperação' : isRegistering ? 'Registrar' : 'Entrar'}
            </Button>
            <Button 
              type="button" 
              variant="link" 
              className="w-full text-[#71717a] hover:text-[#a1a1aa] text-[10px] uppercase tracking-widest"
              onClick={() => { setIsRegistering(!isRegistering); setIsResetting(false); }}
            >
              {isRegistering ? 'Já tenho conta' : isResetting ? 'Voltar para login' : 'Criar conta (Demonstração)'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
