-- ==============================================================================
-- GPANEL FACTORY | YBERA PARIS - SUPABASE PRODUCTION SECURITY & RLS POLICIES
-- ==============================================================================

-- 1. EXTENSIONS & FUNCTIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Helper: Check if the calling user is a coordinator (imune a recursão RLS 42P17)
CREATE OR REPLACE FUNCTION public.is_coordinator()
RETURNS boolean AS $$
BEGIN
  -- 1. Verifica no metadata do auth.users (sem passar por RLS de profiles, imune a recursão 42P17)
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND (
        raw_user_meta_data->>'role' = 'coordinator'
        OR raw_user_meta_data->>'role' = 'coordenador'
      )
  ) THEN
    RETURN true;
  END IF;

  -- 2. Fallback via profiles
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (role = 'coordinator' OR role = 'coordenador')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- Helper: Get line assigned to a leader in active rotation
CREATE OR REPLACE FUNCTION public.get_leader_assigned_line(p_leader_id uuid)
RETURNS text AS $$
DECLARE
  v_line_id text;
BEGIN
  SELECT line_id INTO v_line_id
  FROM public.rotations
  WHERE leader_id = p_leader_id
  LIMIT 1;

  RETURN v_line_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 2. TABLE: PROFILES
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'leader' CHECK (role IN ('leader', 'coordinator', 'coordenador')),
  cargo text NOT NULL DEFAULT 'Líder de Produção',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles: SELECT (Authenticated users can read profiles)
CREATE POLICY "Profiles are viewable by authenticated users"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

-- Profiles: INSERT (Users can only create their own profile with role='leader' unless coordinator)
CREATE POLICY "Users can insert their own initial leader profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = id
  AND (
    (role = 'leader' AND cargo = 'Líder de Produção' AND status = 'active')
    OR public.is_coordinator()
  )
);

-- Profiles: UPDATE (Leader can only update own name; Only coordinator can update role, cargo, status)
CREATE POLICY "Users can update own basic info or coordinator can update all"
ON public.profiles FOR UPDATE
TO authenticated
USING (
  auth.uid() = id OR public.is_coordinator()
)
WITH CHECK (
  public.is_coordinator()
  OR (
    auth.uid() = id 
    AND role = 'leader'
  )
);

-- Trigger: Prevent self-elevation to coordinator
CREATE OR REPLACE FUNCTION public.check_profile_role_update()
RETURNS trigger AS $$
BEGIN
  IF (NEW.role != OLD.role OR NEW.cargo != OLD.cargo OR NEW.status != OLD.status) THEN
    IF NOT public.is_coordinator() THEN
      RAISE EXCEPTION 'Apenas coordenadores podem alterar cargos, permissões ou status de usuários.';
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_check_profile_role_update ON public.profiles;
CREATE TRIGGER tr_check_profile_role_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.check_profile_role_update();

-- ==============================================================================
-- 3. TABLE: LINES
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.lines (
  id text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'active', 'paused', 'maintenance')),
  current_op_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lines ENABLE ROW LEVEL SECURITY;

-- Lines: SELECT
CREATE POLICY "Lines viewable by authenticated users"
ON public.lines FOR SELECT
TO authenticated
USING (true);

-- Lines: INSERT / DELETE (Coordinators only)
CREATE POLICY "Only coordinators can create lines"
ON public.lines FOR INSERT
TO authenticated
WITH CHECK (public.is_coordinator());

CREATE POLICY "Only coordinators can delete lines"
ON public.lines FOR DELETE
TO authenticated
USING (public.is_coordinator());

-- Lines: UPDATE (Coordinators or Leader assigned to this line)
CREATE POLICY "Coordinators or assigned leaders can update line status"
ON public.lines FOR UPDATE
TO authenticated
USING (
  public.is_coordinator()
  OR id = public.get_leader_assigned_line(auth.uid())
)
WITH CHECK (
  public.is_coordinator()
  OR id = public.get_leader_assigned_line(auth.uid())
);

-- ==============================================================================
-- 4. TABLE: OPS (Production Orders)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.ops (
  id text PRIMARY KEY,
  number text NOT NULL,
  product text NOT NULL,
  planned_quantity integer NOT NULL CHECK (planned_quantity > 0),
  produced_quantity integer NOT NULL DEFAULT 0 CHECK (produced_quantity >= 0),
  priority text NOT NULL DEFAULT 'Normal',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'paused', 'completed', 'cancelled')),
  line_id text REFERENCES public.lines(id),
  leader_id uuid REFERENCES auth.users(id),
  package_availability integer NOT NULL DEFAULT 0,
  sequence integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ops ENABLE ROW LEVEL SECURITY;

-- OPs: SELECT
CREATE POLICY "OPs viewable by authenticated users"
ON public.ops FOR SELECT
TO authenticated
USING (true);

-- OPs: INSERT / DELETE (Coordinators only)
CREATE POLICY "Only coordinators can create OPs"
ON public.ops FOR INSERT
TO authenticated
WITH CHECK (public.is_coordinator());

CREATE POLICY "Only coordinators can delete OPs"
ON public.ops FOR DELETE
TO authenticated
USING (public.is_coordinator());

-- OPs: UPDATE (Coordinators or assigned leader on their own line)
CREATE POLICY "Coordinators or assigned leaders can update OPs"
ON public.ops FOR UPDATE
TO authenticated
USING (
  public.is_coordinator()
  OR (
    line_id = public.get_leader_assigned_line(auth.uid())
    AND (leader_id IS NULL OR leader_id = auth.uid())
  )
)
WITH CHECK (
  public.is_coordinator()
  OR (
    line_id = public.get_leader_assigned_line(auth.uid())
    AND produced_quantity >= 0
  )
);

-- ==============================================================================
-- 5. TABLE: EVENTS (Append-Only Audit Log)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  op_id text NOT NULL,
  line_id text NOT NULL,
  leader_id uuid NOT NULL REFERENCES auth.users(id),
  type text NOT NULL CHECK (type IN ('STARTED', 'PAUSED', 'RESUMED', 'FINISHED', 'QUANTITY_REPORTED')),
  quantity integer CHECK (quantity IS NULL OR quantity > 0),
  reason text,
  observation text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Events: SELECT
CREATE POLICY "Events viewable by authenticated users"
ON public.events FOR SELECT
TO authenticated
USING (true);

-- Events: INSERT (Leader can only log events for their own assigned line and identity)
CREATE POLICY "Leaders can only insert events for their assigned line"
ON public.events FOR INSERT
TO authenticated
WITH CHECK (
  leader_id = auth.uid()
  AND (
    public.is_coordinator()
    OR line_id = public.get_leader_assigned_line(auth.uid())
  )
);

-- Events: UPDATE & DELETE ARE FORBIDDEN FOR EVERYONE (Zero policies created = Deny all)
-- Append-only audit integrity guaranteed.

-- ==============================================================================
-- 6. TABLE: ROTATIONS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.rotations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  leader_id uuid NOT NULL REFERENCES auth.users(id),
  line_id text NOT NULL REFERENCES public.lines(id),
  week_number integer,
  year integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leader_id, line_id)
);

ALTER TABLE public.rotations ENABLE ROW LEVEL SECURITY;

-- Rotations: SELECT
CREATE POLICY "Rotations viewable by authenticated users"
ON public.rotations FOR SELECT
TO authenticated
USING (true);

-- Rotations: INSERT / UPDATE / DELETE (Coordinators only)
CREATE POLICY "Only coordinators can manage rotations"
ON public.rotations FOR ALL
TO authenticated
USING (public.is_coordinator())
WITH CHECK (public.is_coordinator());

-- ==============================================================================
-- Migração 001: profiles first_access
-- ==============================================================================

-- 1. Garante a existência de todas as colunas necessárias na tabela profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'leader',
  ADD COLUMN IF NOT EXISTS cargo text NOT NULL DEFAULT 'Líder de Produção',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- 2. Atualiza a constraint de verificação de status para permitir 'first_access'
DO $$
DECLARE
  v_con_name text;
BEGIN
  SELECT con.conname INTO v_con_name
  FROM pg_constraint con
  INNER JOIN pg_class rel ON rel.oid = con.conrelid
  INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'profiles'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%';

  IF v_con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', v_con_name);
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('active', 'inactive', 'suspended', 'first_access'));

-- 3. Atualiza policy de inserção e atualização para primeiro acesso
DROP POLICY IF EXISTS "Users can insert their own initial leader profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND (status IS NULL OR status IN ('active', 'first_access'))
  );

DROP POLICY IF EXISTS "Users can update own basic info or coordinator can update all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_update_policy" ON public.profiles;
CREATE POLICY "profiles_self_update_policy"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 4. Atualiza trigger check_profile_role_update para permitir que o usuário atualize seu próprio status no primeiro acesso
CREATE OR REPLACE FUNCTION public.check_profile_role_update()
RETURNS trigger AS $$
BEGIN
  IF (NEW.role != OLD.role OR NEW.cargo != OLD.cargo OR NEW.status != OLD.status) THEN
    -- Permite que o próprio usuário atualize status durante o primeiro acesso
    IF NOT (public.is_coordinator() OR (
      auth.uid() = NEW.id
      AND OLD.status = 'first_access'
      AND NEW.status = 'active'
      AND NEW.must_change_password = false
      AND OLD.role = NEW.role
      AND OLD.cargo = NEW.cargo
    )) THEN
      RAISE EXCEPTION 'Apenas coordenadores podem alterar cargos, permissões ou status de usuários.';
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- Migração 002: aliases de tabelas e colunas de ops
-- ==============================================================================

-- 1. Adiciona as colunas na tabela ops
ALTER TABLE public.ops
  ADD COLUMN IF NOT EXISTS op_number text GENERATED ALWAYS AS (number) STORED,
  ADD COLUMN IF NOT EXISTS lote text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS granel text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS scheduled_shift text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ops_scheduled_shift_check'
  ) THEN
    ALTER TABLE public.ops
      ADD CONSTRAINT ops_scheduled_shift_check
      CHECK (scheduled_shift IS NULL OR scheduled_shift IN ('Manhã', 'Tarde', 'Noite'));
  END IF;
END $$;

-- 2. Views com security_invoker = true
CREATE OR REPLACE VIEW public.production_orders AS
  SELECT * FROM public.ops
  WITH CHECK OPTION;
ALTER VIEW public.production_orders SET (security_invoker = true);

CREATE OR REPLACE VIEW public.production_lines AS
  SELECT * FROM public.lines
  WITH CHECK OPTION;
ALTER VIEW public.production_lines SET (security_invoker = true);

CREATE OR REPLACE VIEW public.production_events AS
  SELECT * FROM public.events
  WITH CHECK OPTION;
ALTER VIEW public.production_events SET (security_invoker = true);

CREATE OR REPLACE VIEW public.weekly_rotations AS
  SELECT * FROM public.rotations
  WITH CHECK OPTION;
ALTER VIEW public.weekly_rotations SET (security_invoker = true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_orders TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_lines TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_events TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_rotations TO authenticated, anon;

-- ==============================================================================
-- Migração 003: rotations constraint e RLS líderes
-- ==============================================================================

-- 1. Adiciona coluna updated_at e trigger de atualização automática
ALTER TABLE public.rotations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_rotations_updated_at ON public.rotations;
CREATE TRIGGER tr_rotations_updated_at
BEFORE UPDATE ON public.rotations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Limpeza de duplicados
DELETE FROM public.rotations a
USING public.rotations b
WHERE a.leader_id = b.leader_id
  AND a.ctid < b.ctid
  AND (
    COALESCE(a.created_at, NOW()) < COALESCE(b.created_at, NOW())
    OR (
      COALESCE(a.created_at, NOW()) = COALESCE(b.created_at, NOW())
      AND a.ctid < b.ctid
    )
  );

-- 3. Constraint UNIQUE (leader_id)
DO $$
DECLARE
  v_con_name text;
BEGIN
  FOR v_con_name IN (
    SELECT con.conname
    FROM pg_constraint con
    INNER JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'rotations'
      AND con.contype = 'u'
  ) LOOP
    EXECUTE format('ALTER TABLE public.rotations DROP CONSTRAINT IF EXISTS %I', v_con_name);
  END LOOP;
END $$;

ALTER TABLE public.rotations
  ADD CONSTRAINT rotations_leader_id_key UNIQUE (leader_id);

-- 4. Políticas de RLS para rotação individual de líderes
DROP POLICY IF EXISTS "Rotations viewable by authenticated users" ON public.rotations;
DROP POLICY IF EXISTS "Only coordinators can manage rotations" ON public.rotations;
DROP POLICY IF EXISTS "Leader can upsert own rotation" ON public.rotations;
DROP POLICY IF EXISTS "Leader can update own rotation" ON public.rotations;
DROP POLICY IF EXISTS "Leader can select own rotation" ON public.rotations;

CREATE POLICY "Leader can select own rotation"
  ON public.rotations FOR SELECT
  TO authenticated
  USING (leader_id = auth.uid() OR public.is_coordinator());

CREATE POLICY "Leader can upsert own rotation"
  ON public.rotations FOR INSERT
  TO authenticated
  WITH CHECK (leader_id = auth.uid() OR public.is_coordinator());

CREATE POLICY "Leader can update own rotation"
  ON public.rotations FOR UPDATE
  TO authenticated
  USING (leader_id = auth.uid() OR public.is_coordinator())
  WITH CHECK (leader_id = auth.uid() OR public.is_coordinator());

-- 5. Função determinística para rotação
CREATE OR REPLACE FUNCTION public.get_leader_assigned_line(p_leader_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_line_id text;
BEGIN
  SELECT line_id INTO v_line_id
  FROM public.rotations
  WHERE leader_id = p_leader_id
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1;

  RETURN v_line_id;
END;
$$;

-- ==============================================================================
-- Migração 004: Habilitação do Supabase Realtime nas tabelas do sistema
-- ==============================================================================

ALTER TABLE public.ops REPLICA IDENTITY FULL;
ALTER TABLE public.lines REPLICA IDENTITY FULL;
ALTER TABLE public.events REPLICA IDENTITY FULL;
ALTER TABLE public.rotations REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'ops'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ops;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'lines'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lines;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'rotations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rotations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END $$;

-- ==============================================================================
-- Migração 005: setor/OEE em ops e tabela monthly_goals
-- ==============================================================================

-- 1. Campos de setor, unidade, refugo e horas planejadas em ops
ALTER TABLE public.ops
  ADD COLUMN IF NOT EXISTS setor text
  CHECK (setor IS NULL OR setor IN ('Pesagem', 'Manipulação', 'Envase', 'Geral'));

ALTER TABLE public.ops
  ADD COLUMN IF NOT EXISTS unidade text
  CHECK (unidade IS NULL OR unidade IN ('Un', 'Kg', 'Qtd'));

ALTER TABLE public.ops
  ADD COLUMN IF NOT EXISTS rejected_quantity integer NOT NULL DEFAULT 0;

ALTER TABLE public.ops
  ADD COLUMN IF NOT EXISTS planned_hours numeric(5,2);

-- 2. Tabela de metas mensais por linha e setor
CREATE TABLE IF NOT EXISTS public.monthly_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id text NOT NULL REFERENCES public.lines(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  goal_quantity integer NOT NULL DEFAULT 0,
  setor text CHECK (setor IN ('Pesagem', 'Manipulação', 'Envase', 'Geral')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_id, year, month, setor)
);

-- RLS: apenas coordenador gerencia metas; líder só lê
ALTER TABLE public.monthly_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coordinator manages goals" ON public.monthly_goals;
CREATE POLICY "Coordinator manages goals"
  ON public.monthly_goals FOR ALL
  TO authenticated
  USING (public.is_coordinator())
  WITH CHECK (public.is_coordinator());

DROP POLICY IF EXISTS "Leaders can read goals" ON public.monthly_goals;
CREATE POLICY "Leaders can read goals"
  ON public.monthly_goals FOR SELECT
  TO authenticated
  USING (true);

-- Trigger updated_at
DROP TRIGGER IF EXISTS tr_monthly_goals_updated_at ON public.monthly_goals;
CREATE TRIGGER tr_monthly_goals_updated_at
  BEFORE UPDATE ON public.monthly_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Realtime
ALTER TABLE public.monthly_goals REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'monthly_goals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.monthly_goals;
  END IF;
END $$;

-- ==============================================================================
-- Migração 006: tipo_documento OSM, finished_shift e area do líder
-- ==============================================================================

-- 1. Tipo de documento e turno de finalização em ops
ALTER TABLE public.ops
  ADD COLUMN IF NOT EXISTS tipo_documento text NOT NULL DEFAULT 'OP'
  CHECK (tipo_documento IN ('OP', 'OSM'));

ALTER TABLE public.ops
  ADD COLUMN IF NOT EXISTS finished_shift text
  CHECK (finished_shift IS NULL OR finished_shift IN ('Manhã', 'Tarde'));

-- Índices para acelerar consultas por tipo de documento e setor
CREATE INDEX IF NOT EXISTS idx_ops_tipo_documento ON public.ops (tipo_documento);
CREATE INDEX IF NOT EXISTS idx_ops_setor ON public.ops (setor);

-- 2. Campo area na tabela profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS area text
  CHECK (area IS NULL OR area IN ('Envase', 'Pesagem', 'Manipulação', 'Coordenação'));

-- ==============================================================================
-- Migração 008: salvar senha temporária no banco para acesso multi-dispositivo
-- ==============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_password text;

-- ==============================================================================
-- Migração 009: Correção Definitiva de RLS, Recursão 42P17 e Cadastro de Líderes
-- (Garante que líderes de Pesagem, Manipulação e Envase sejam gravados no Supabase)
-- ==============================================================================

-- 1. Garante colunas necessárias em profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS area text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_password text;

-- Remove constraint restritiva se houver e reaplica segura
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_area_check;
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_area_check
    CHECK (area IS NULL OR area IN ('Envase', 'Pesagem', 'Manipulação', 'Coordenação'));
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 2. Função is_coordinator() imune a recursão (lê do auth.users.raw_user_meta_data)
CREATE OR REPLACE FUNCTION public.is_coordinator()
RETURNS boolean AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND (
        raw_user_meta_data->>'role' = 'coordinator'
        OR raw_user_meta_data->>'role' = 'coordenador'
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (role = 'coordinator' OR role = 'coordenador')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- 3. Recria policies de profiles sem recursão e permitindo que o coordenador insira líderes
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy"
  ON public.profiles
  FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Users can insert their own initial leader profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy"
  ON public.profiles
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    auth.uid() = id
    OR public.is_coordinator()
    OR auth.uid() IS NULL
  );

DROP POLICY IF EXISTS "Users can update own basic info or coordinator can update all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_update_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id OR public.is_coordinator())
  WITH CHECK (auth.uid() = id OR public.is_coordinator());

DROP POLICY IF EXISTS "profiles_delete_policy" ON public.profiles;
CREATE POLICY "profiles_delete_policy"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (public.is_coordinator());


