import * as React from 'react';
import { useEffect } from 'react';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { useAuthStore } from './store/authStore';
import { UserProfile } from './types';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setProfile, setLoading } = useAuthStore();

  useEffect(() => {
    let mounted = true;

    if (!isSupabaseConfigured) {
      if (mounted) {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
      return;
    }

    async function loadUserProfile(user: any) {
      try {
        let dbRole: string | null = null;
        let dbName: string | null = null;
        let dbCargo: string | null = null;
        let dbStatus: string = 'active';
        let dbCreatedAt: string = new Date().toISOString();

        // 1. Tenta buscar pelo ID na tabela profiles
        try {
          const { data: profileById } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

          if (profileById) {
            dbRole = profileById.role;
            dbName = profileById.name;
            dbCargo = profileById.cargo;
            dbStatus = profileById.status || 'active';
            dbCreatedAt = profileById.created_at || dbCreatedAt;
          }
        } catch (e) {
          console.warn('Erro ao consultar profile por id:', e);
        }

        // 2. Se não encontrou por ID, tenta buscar pelo e-mail
        if (!dbRole && user.email) {
          try {
            const { data: profileByEmail } = await supabase
              .from('profiles')
              .select('*')
              .eq('email', user.email)
              .maybeSingle();

            if (profileByEmail) {
              dbRole = profileByEmail.role;
              dbName = dbName || profileByEmail.name;
              dbCargo = dbCargo || profileByEmail.cargo;
              dbStatus = profileByEmail.status || dbStatus;
              dbCreatedAt = profileByEmail.created_at || dbCreatedAt;
            }
          } catch (e) {
            console.warn('Erro ao consultar profile por email:', e);
          }
        }

        // 3. Verifica também nos metadados do auth (user_metadata / app_metadata)
        const metaRole = user.user_metadata?.role || user.app_metadata?.role;
        const metaCargo = user.user_metadata?.cargo;
        const metaName = user.user_metadata?.name;

        // Determina se é Coordenador
        const rawRole = String(dbRole || metaRole || '').toLowerCase().trim();
        const isCoordinator = rawRole === 'coordinator' || rawRole === 'coordenador' || (dbCargo && dbCargo.toLowerCase().includes('coordenador'));

        const finalRole = isCoordinator ? 'coordinator' : 'leader';
        const finalName = dbName || metaName || user.email?.split('@')[0] || 'Usuário';
        const finalCargo = dbCargo || metaCargo || (isCoordinator ? 'Coordenador Geral' : 'Líder de Produção');

        const resolvedProfile: UserProfile = {
          uid: user.id,
          email: user.email || '',
          role: finalRole,
          name: finalName,
          cargo: finalCargo,
          status: (dbStatus as any) || 'active',
          createdAt: dbCreatedAt,
        };

        if (mounted) {
          setProfile(resolvedProfile);
        }

        // Se o usuário ainda não existe na tabela profiles, insere preservando o papel correto
        if (!dbRole) {
          try {
            await supabase.from('profiles').upsert({
              id: user.id,
              email: user.email,
              name: finalName,
              role: finalRole,
              status: 'active',
              created_at: dbCreatedAt,
              updated_at: new Date().toISOString(),
            });
          } catch {
            // Ignora se não for permitido por RLS
          }
        }
      } catch (err) {
        console.warn('Sincronização de perfil Supabase:', err);
        if (mounted) {
          const isCoord = user.user_metadata?.role === 'coordinator';
          setProfile({
            uid: user.id,
            email: user.email || '',
            role: isCoord ? 'coordinator' : 'leader',
            name: user.user_metadata?.name || user.email?.split('@')[0] || 'Usuário',
            cargo: isCoord ? 'Coordenador Geral' : 'Líder de Produção',
            status: 'active',
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    // 1. Initial Session Check
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        loadUserProfile(session.user).finally(() => {
          if (mounted) setLoading(false);
        });
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    }).catch(() => {
      if (mounted) {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    // 2. Auth State Change Listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        await loadUserProfile(session.user);
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  return <>{children}</>;
}
