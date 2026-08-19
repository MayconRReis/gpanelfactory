import * as React from 'react';
import { useEffect } from 'react';
import { supabase } from './lib/supabase';
import { useAuthStore } from './store/authStore';
import { UserProfile } from './types';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setProfile, setLoading } = useAuthStore();

  useEffect(() => {
    // Check current auth state
    const checkUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user) {
          // Fetch profile from profiles table
          const { data: profileData, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

          if (error) {
            console.error('Error fetching profile:', error.message);
            setProfile(null);
          } else if (profileData) {
            const profile: UserProfile = {
              uid: profileData.id,
              email: profileData.email,
              role: profileData.role,
              name: profileData.name,
              createdAt: profileData.created_at,
            };
            setProfile(profile);
          }
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error('Error checking user:', error);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    };

    checkUser();

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT') {
          setProfile(null);
        } else if (session?.user) {
          try {
            const { data: profileData, error } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single();

            if (error) {
              console.error('Error fetching profile:', error.message);
              setProfile(null);
            } else if (profileData) {
              const profile: UserProfile = {
                uid: profileData.id,
                email: profileData.email,
                role: profileData.role,
                name: profileData.name,
                createdAt: profileData.created_at,
              };
              setProfile(profile);
            }
          } catch (error) {
            console.error('Error fetching profile on auth change:', error);
            setProfile(null);
          }
        }
      }
    );

    return () => {
      subscription?.unsubscribe();
    };
  }, [setProfile, setLoading]);

  return <>{children}</>;
}
