import * as React from 'react';
import { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore'; // Need to import these
import { auth, db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, 'users', userCredential.user.uid), {
          uid: userCredential.user.uid,
          email,
          name,
          role: 'leader', // Force leader role
          createdAt: new Date().toISOString()
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
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
            {isRegistering ? 'Criar nova conta' : 'Faça login para continuar'}
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
            <div className="space-y-2">
              <Label htmlFor="password" className="text-[#a1a1aa] text-[10px] uppercase tracking-widest font-bold">Senha</Label>
              <Input 
                id="password" 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)}
                className="bg-[#121214] border-[#27272a] text-[#f4f4f5] focus-visible:ring-blue-500"
                required
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-widest text-[11px] shadow-[0_0_10px_rgba(37,99,235,0.2)]">
              {isRegistering ? 'Registrar' : 'Entrar'}
            </Button>
            <Button 
              type="button" 
              variant="link" 
              className="w-full text-[#71717a] hover:text-[#a1a1aa] text-[10px] uppercase tracking-widest"
              onClick={() => setIsRegistering(!isRegistering)}
            >
              {isRegistering ? 'Já tenho conta' : 'Criar conta (Demonstração)'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
