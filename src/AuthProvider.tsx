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
        let dbMustChange = false;
        let dbDefaultPassword: string | undefined = undefined;
        let dbCreatedAt: string = new Date().toISOString();

        // 0. Verifica se existe cache local persistido
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            const rawStored = window.localStorage.getItem('SIG_PROD_PROFILES_STORAGE_V5');
            if (rawStored) {
              const parsed = JSON.parse(rawStored);
              const match = parsed.find((p: any) => p.uid === user.id || (user.email && p.email?.toLowerCase() === user.email.toLowerCase()));
              if (match) {
                if (match.mustChangePassword || match.status === 'first_access') {
                  dbMustChange = true;
                }
                if (match.defaultPassword) {
                  dbDefaultPassword = match.defaultPassword;
                }
              }
            }
          }
        } catch {
          // ignora
        }

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
            if (profileById.must_change_password === true || profileById.status === 'first_access') {
              dbMustChange = true;
            }
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
              if (profileByEmail.must_change_password === true || profileByEmail.status === 'first_access') {
                dbMustChange = true;
              }
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
        if (user.user_metadata?.must_change_password === true || user.app_metadata?.must_change_password === true) {
          dbMustChange = true;
        }

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
          status: dbMustChange ? 'first_access' : ((dbStatus as any) || 'active'),
          mustChangePassword: dbMustChange,
          defaultPassword: dbDefaultPassword,
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
              status: dbMustChange ? 'first_access' : 'active',
              must_change_password: dbMustChange,
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
          const metaMustChange = user.user_metadata?.must_change_password === true;
          setProfile({
            uid: user.id,
            email: user.email || '',
            role: isCoord ? 'coordinator' : 'leader',
            name: user.user_metadata?.name || user.email?.split('@')[0] || 'Usuário',
            cargo: isCoord ? 'Coordenador Geral' : 'Líder de Produção',
            status: metaMustChange ? 'first_access' : 'active',
            mustChangePassword: metaMustChange,
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
