import * as React from 'react';
import { useEffect } from 'react';
import { supabase } from './lib/supabase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './lib/firebase';
import { useAuthStore } from './store/authStore';
import { UserProfile } from './types';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setProfile, setLoading } = useAuthStore();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      if (session?.user) {
        // Fetch profile from Firestore
        fetchProfile(session.user);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user || null);
      if (session?.user) {
        await fetchProfile(session.user);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(user: any) {
    const userRef = doc(db, 'users', user.id);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      setProfile(userSnap.data() as UserProfile);
    } else {
      // Defaults
      const profile: UserProfile = {
        uid: user.id,
        email: user.email || '',
        role: 'leader',
        name: user.user_metadata.name || user.email?.split('@')[0] || 'User',
        createdAt: new Date().toISOString(),
      };
      await setDoc(userRef, profile);
      setProfile(profile);
    }
  }

  return <>{children}</>;
}
