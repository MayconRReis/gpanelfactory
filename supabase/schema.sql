-- ==============================================================================
-- GPANEL FACTORY | YBERA PARIS - SUPABASE PRODUCTION SECURITY & RLS POLICIES
-- ==============================================================================

-- 1. EXTENSIONS & FUNCTIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Helper: Check if the calling user is a coordinator
CREATE OR REPLACE FUNCTION public.is_coordinator()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (role = 'coordinator' OR role = 'coordenador')
      AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
