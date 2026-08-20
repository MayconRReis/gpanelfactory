import { create } from 'zustand';
import { User } from '@supabase/supabase-js';
import { UserProfile } from '../types';
import { supabase } from '../lib/supabase';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setProfile: (profile: UserProfile | null) => void;
  setLoading: (isLoading: boolean) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setLoading: (isLoading) => set({ isLoading }),
  signOut: async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error('Erro ao sair do Supabase:', e);
    }
    set({ user: null, profile: null, isLoading: false });
  },
}));
