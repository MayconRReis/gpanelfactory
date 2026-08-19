import { supabase } from '../lib/supabase';
import { UserProfile } from '../types';

export const signUp = async (email: string, password: string, name: string): Promise<UserProfile> => {
  try {
    // Sign up user with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('User creation failed');

    // Create profile in profiles table (auto-linked via trigger to auth.users)
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .insert([
        {
          id: authData.user.id,
          email,
          name,
          role: 'leader', // Default role
        },
      ])
      .select()
      .single();

    if (profileError) throw profileError;

    return profileData as UserProfile;
  } catch (error: any) {
    console.error('Error signing up:', error.message);
    throw new Error(error.message || 'Failed to sign up');
  }
};

export const signIn = async (email: string, password: string): Promise<UserProfile> => {
  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('Sign in failed');

    // Fetch user profile
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError) throw profileError;

    return profileData as UserProfile;
  } catch (error: any) {
    console.error('Error signing in:', error.message);
    throw new Error(error.message || 'Failed to sign in');
  }
};

export const signOut = async (): Promise<void> => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (error: any) {
    console.error('Error signing out:', error.message);
    throw new Error(error.message || 'Failed to sign out');
  }
};

export const getCurrentUser = async (): Promise<UserProfile | null> => {
  try {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return null;

    const { data: profileData, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (error) {
      console.error('Error fetching profile:', error.message);
      return null;
    }

    return profileData as UserProfile;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
};

export const onAuthStateChanged = (callback: (user: UserProfile | null) => void) => {
  const { data: subscription } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      callback(null);
    } else if (session?.user) {
      const profile = await getCurrentUser();
      callback(profile);
    }
  });

  return subscription?.unsubscribe || (() => {});
};

export const resetPassword = async (email: string): Promise<void> => {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${import.meta.env.VITE_APP_URL || window.location.origin}/reset-password`,
    });
    if (error) throw error;
  } catch (error: any) {
    console.error('Error resetting password:', error.message);
    throw new Error(error.message || 'Failed to reset password');
  }
};

export const updatePassword = async (newPassword: string): Promise<void> => {
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  } catch (error: any) {
    console.error('Error updating password:', error.message);
    throw new Error(error.message || 'Failed to update password');
  }
};
