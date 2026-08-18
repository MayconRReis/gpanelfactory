import * as React from 'react';
import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { useAuthStore } from './store/authStore';
import { UserProfile } from './types';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setProfile, setLoading } = useAuthStore();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        // Fetch or create profile
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          setProfile(userSnap.data() as UserProfile);
        } else {
          // Defaults: In a real app, role would be assigned by an admin.
          // For demo, first user is coordinator, others are leaders.
          const profile: UserProfile = {
            uid: currentUser.uid,
            email: currentUser.email || '',
            role: 'leader',
            name: currentUser.displayName || currentUser.email?.split('@')[0] || 'User',
            createdAt: new Date().toISOString(),
          };
          await setDoc(userRef, profile);
          setProfile(profile);
        }
      } else {
        setProfile(null);
      }
      
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return <>{children}</>;
}
