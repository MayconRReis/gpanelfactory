-- ==============================================================================
-- Migração 011: Metas fixas de produção
--   - Meta MENSAL ÚNICA da fábrica (não por linha) — ex: 450.000 un no mês
--   - Meta DIÁRIA fixa por linha — ex: linha1 18.000, linha2 18.000, sleeve 10.000
-- ==============================================================================
--
-- Rodar manualmente no Supabase SQL Editor.
--
-- Ambas ficam "fixas" até serem atualizadas manualmente pelo Coordenador
-- Geral, pelo Modal de Metas de Produção (botão na barra lateral).

-- ------------------------------------------------------------------------------
-- 1. Meta diária fixa por linha
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.line_daily_goals (
  line_id text PRIMARY KEY REFERENCES public.lines(id) ON DELETE CASCADE,
  goal_quantity integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.line_daily_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coordinator manages daily goals" ON public.line_daily_goals;
CREATE POLICY "Coordinator manages daily goals"
  ON public.line_daily_goals FOR ALL
  TO authenticated
  USING (public.is_coordinator())
  WITH CHECK (public.is_coordinator());

DROP POLICY IF EXISTS "Leaders can read daily goals" ON public.line_daily_goals;
CREATE POLICY "Leaders can read daily goals"
  ON public.line_daily_goals FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "line_daily_goals_public_readonly" ON public.line_daily_goals;
CREATE POLICY "line_daily_goals_public_readonly"
  ON public.line_daily_goals FOR SELECT
  TO anon
  USING (true);

DROP TRIGGER IF EXISTS tr_line_daily_goals_updated_at ON public.line_daily_goals;
CREATE TRIGGER tr_line_daily_goals_updated_at
  BEFORE UPDATE ON public.line_daily_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.line_daily_goals REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'line_daily_goals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.line_daily_goals;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. Meta mensal única da fábrica (não por linha)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.factory_monthly_goal (
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  goal_quantity integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year, month)
);

ALTER TABLE public.factory_monthly_goal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coordinator manages factory monthly goal" ON public.factory_monthly_goal;
CREATE POLICY "Coordinator manages factory monthly goal"
  ON public.factory_monthly_goal FOR ALL
  TO authenticated
  USING (public.is_coordinator())
  WITH CHECK (public.is_coordinator());

DROP POLICY IF EXISTS "Leaders can read factory monthly goal" ON public.factory_monthly_goal;
CREATE POLICY "Leaders can read factory monthly goal"
  ON public.factory_monthly_goal FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "factory_monthly_goal_public_readonly" ON public.factory_monthly_goal;
CREATE POLICY "factory_monthly_goal_public_readonly"
  ON public.factory_monthly_goal FOR SELECT
  TO anon
  USING (true);

DROP TRIGGER IF EXISTS tr_factory_monthly_goal_updated_at ON public.factory_monthly_goal;
CREATE TRIGGER tr_factory_monthly_goal_updated_at
  BEFORE UPDATE ON public.factory_monthly_goal
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.factory_monthly_goal REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'factory_monthly_goal'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.factory_monthly_goal;
  END IF;
END $$;
