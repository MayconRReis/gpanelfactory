-- =====================================================================
-- excluir_apontamentos.sql
-- Permite que COORDENAÇÃO / ADM / DIRETOR apaguem um apontamento de
-- quantidade lançado errado (aba Apontamentos do Dashboard do Envase).
--   1) Tabela apontamentos_excluidos: cópia de cada apontamento apagado
--      (quem lançou, quem apagou, quando e o motivo). Só inclusão.
--   2) Permissão de APAGAR e AJUSTAR eventos (events / production_events)
--      só para coordenação/ADM — líder continua sem poder apagar.
-- Pode rodar mais de uma vez sem problema.
-- Rodar no Supabase: SQL Editor > colar tudo > Run.
-- =====================================================================

-- Coordenador, ADM ou Diretor (mesma função do Relatório/Ocorrências/Metas)
CREATE OR REPLACE FUNCTION is_coordinator_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id::text = auth.uid()::text
      AND (
        lower(coalesce(to_jsonb(p)->>'role', '')) IN ('coordinator', 'coordenador')
        OR lower(coalesce(to_jsonb(p)->>'rule', '')) IN ('admin', 'diretor')
      )
  );
$$;

-- 1) Registro das exclusões
CREATE TABLE IF NOT EXISTS apontamentos_excluidos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  excluido_em      timestamptz NOT NULL DEFAULT now(),
  event_id         text,
  op_id            text NOT NULL,
  op_number        text NOT NULL DEFAULT '',
  product          text NOT NULL DEFAULT '',
  line_id          text,
  quantity         numeric NOT NULL DEFAULT 0,
  reported_at      timestamptz,
  reported_by      text,
  reported_by_name text NOT NULL DEFAULT '',
  deleted_by       text,
  deleted_by_name  text NOT NULL DEFAULT '',
  motivo           text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS apontamentos_excluidos_em_idx ON apontamentos_excluidos (excluido_em DESC);

ALTER TABLE apontamentos_excluidos ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON apontamentos_excluidos TO authenticated;

DROP POLICY IF EXISTS gpanel_apont_excl_insert ON apontamentos_excluidos;
DROP POLICY IF EXISTS gpanel_apont_excl_select ON apontamentos_excluidos;
CREATE POLICY gpanel_apont_excl_insert ON apontamentos_excluidos
  FOR INSERT TO authenticated WITH CHECK (is_coordinator_user());
CREATE POLICY gpanel_apont_excl_select ON apontamentos_excluidos
  FOR SELECT TO authenticated USING (is_coordinator_user());

-- 2) Apagar / ajustar eventos: só coordenação e ADM
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['events', 'production_events'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind IN ('r', 'p')
    ) THEN
      EXECUTE format('GRANT DELETE, UPDATE ON public.%I TO authenticated', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'gpanel_coord_delete_events', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_coordinator_user())', 'gpanel_coord_delete_events', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'gpanel_coord_update_events', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_coordinator_user()) WITH CHECK (public.is_coordinator_user())', 'gpanel_coord_update_events', t);
      RAISE NOTICE 'Permissão de apagar/ajustar eventos aplicada em %', t;
    ELSE
      RAISE NOTICE '% não é tabela (view ou inexistente) — ignorada', t;
    END IF;
  END LOOP;
END $$;

-- Conferência
SELECT 'apontamentos_excluidos pronta' AS status, count(*) AS exclusoes FROM apontamentos_excluidos;
