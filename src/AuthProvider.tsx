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
        let dbArea: string | null = null;
        let dbStatus: string = 'active';
        let dbMustChange = false;
        let dbDefaultPassword: string | undefined = undefined;
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
            dbArea = profileById.area || dbArea;
            dbStatus = profileById.status || 'active';
            if (profileById.must_change_password === true || profileById.status === 'first_access') {
              dbMustChange = true;
            } else if (profileById.must_change_password === false || profileById.status === 'active') {
              dbMustChange = false;
            }
            dbCreatedAt = profileById.created_at || dbCreatedAt;
          }
        } catch (e) {
          console.warn('Erro ao consultar profile por id:', e);
        }

        // 2. Se não encontrou por ID ou faltou área, tenta buscar pelo e-mail
        if ((!dbRole || !dbArea) && user.email) {
          try {
            const { data: profileByEmail } = await supabase
              .from('profiles')
              .select('*')
              .eq('email', user.email)
              .maybeSingle();

            if (profileByEmail) {
              dbRole = dbRole || profileByEmail.role;
              dbName = dbName || profileByEmail.name;
              dbCargo = dbCargo || profileByEmail.cargo;
              dbArea = dbArea || profileByEmail.area;
              dbStatus = profileByEmail.status || dbStatus;
              if (profileByEmail.must_change_password === true || profileByEmail.status === 'first_access') {
                dbMustChange = true;
              } else if (profileByEmail.must_change_password === false || profileByEmail.status === 'active') {
                dbMustChange = false;
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
        const metaArea = user.user_metadata?.area || user.app_metadata?.area;
        const metaName = user.user_metadata?.name;
        if (user.user_metadata?.must_change_password === true || user.app_metadata?.must_change_password === true) {
          dbMustChange = true;
        } else if (user.user_metadata?.must_change_password === false || user.app_metadata?.must_change_password === false) {
          dbMustChange = false;
        }

        // Determina se é Coordenador
        const rawRole = String(dbRole || metaRole || '').toLowerCase().trim();
        const rawCargo = String(dbCargo || metaCargo || '').toLowerCase().trim();
        const isCoordinator = rawRole === 'coordinator' || rawRole === 'coordenador' || rawCargo.includes('coordenador');

        // Determina área (Envase, Pesagem, Manipulação, Coordenação)
        const candidateArea = String(dbArea || metaArea || '').trim();
        let finalArea: 'Envase' | 'Pesagem' | 'Manipulação' | 'Coordenação' = 'Envase';

        if (candidateArea === 'Pesagem' || candidateArea.toLowerCase().includes('pesag') || rawCargo.includes('pesag')) {
          finalArea = 'Pesagem';
        } else if (candidateArea === 'Manipulação' || candidateArea.toLowerCase().includes('manipula') || rawCargo.includes('manipula')) {
          finalArea = 'Manipulação';
        } else if (candidateArea === 'Envase' || candidateArea.toLowerCase().includes('envas') || rawCargo.includes('envas')) {
          finalArea = 'Envase';
        } else if (isCoordinator || candidateArea.toLowerCase().includes('coordena') || rawCargo.includes('coordena')) {
          finalArea = 'Coordenação';
        } else {
          finalArea = 'Envase';
        }

        const finalRole = isCoordinator ? 'coordinator' : 'leader';
        const finalName = dbName || metaName || user.email?.split('@')[0] || 'Usuário';

        let defaultCargo = 'Líder de Produção';
        if (isCoordinator) {
          defaultCargo = 'Coordenador Geral';
        } else if (finalArea === 'Pesagem') {
          defaultCargo = 'Líder de Pesagem';
        } else if (finalArea === 'Manipulação') {
          defaultCargo = 'Líder de Manipulação';
        } else if (finalArea === 'Envase') {
          defaultCargo = 'Líder de Envase';
        }
        const finalCargo = dbCargo || metaCargo || defaultCargo;

        const resolvedProfile: UserProfile = {
          uid: user.id,
          email: user.email || '',
          role: finalRole,
          name: finalName,
          cargo: finalCargo,
          area: finalArea,
          status: dbMustChange ? 'first_access' : ((dbStatus as any) || 'active'),
          mustChangePassword: dbMustChange,
          defaultPassword: dbDefaultPassword,
          createdAt: dbCreatedAt,
        };

        if (mounted) {
          setProfile(resolvedProfile);
        }

        // Se o usuário ainda não existe na tabela profiles, insere preservando o papel e área corretos
        if (!dbRole) {
          try {
            await supabase.from('profiles').upsert({
              id: user.id,
              email: user.email,
              name: finalName,
              role: finalRole,
              cargo: finalCargo,
              area: finalArea,
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
          const rawRole = String(user.user_metadata?.role || '').toLowerCase();
          const rawCargo = String(user.user_metadata?.cargo || '').toLowerCase();
          const isCoord = rawRole === 'coordinator' || rawRole === 'coordenador' || rawCargo.includes('coordena');
          const metaMustChange = user.user_metadata?.must_change_password === true;

          let fallbackArea: 'Envase' | 'Pesagem' | 'Manipulação' | 'Coordenação' = 'Envase';
          const metaArea = String(user.user_metadata?.area || '').trim();
          if (metaArea === 'Pesagem' || rawCargo.includes('pesag')) {
            fallbackArea = 'Pesagem';
          } else if (metaArea === 'Manipulação' || rawCargo.includes('manipula')) {
            fallbackArea = 'Manipulação';
          } else if (isCoord) {
            fallbackArea = 'Coordenação';
          }

          let defaultCargo = isCoord ? 'Coordenador Geral' : 'Líder de Produção';
          if (fallbackArea === 'Pesagem') defaultCargo = 'Líder de Pesagem';
          else if (fallbackArea === 'Manipulação') defaultCargo = 'Líder de Manipulação';
          else if (fallbackArea === 'Envase') defaultCargo = 'Líder de Envase';

          setProfile({
            uid: user.id,
            email: user.email || '',
            role: isCoord ? 'coordinator' : 'leader',
            name: user.user_metadata?.name || user.email?.split('@')[0] || 'Usuário',
            cargo: user.user_metadata?.cargo || defaultCargo,
            area: fallbackArea,
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
