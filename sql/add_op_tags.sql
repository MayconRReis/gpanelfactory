-- ==============================================================================
-- Etiquetas das OPs (estilo Trello): Datado, Ag. datação, Ag. insumos, Sem selo...
-- ==============================================================================
-- Rodar manualmente no Supabase SQL Editor (pode rodar mais de uma vez).
--   - op_tag_types: os tipos de etiqueta (a Coordenação cria/remove no Cronograma).
--   - op_tags: quais etiquetas cada OP tem (escolhidas no Editar OP).
--   Leitura: qualquer usuário logado. Alteração: só Coordenação (is_coordinator).

CREATE TABLE IF NOT EXISTS public.op_tag_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT 'slate',
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS op_tag_types_name_unique ON public.op_tag_types (upper(name));

CREATE TABLE IF NOT EXISTS public.op_tags (
  op_id text NOT NULL,
  tag_id uuid NOT NULL REFERENCES public.op_tag_types(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (op_id, tag_id)
);

ALTER TABLE public.op_tag_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.op_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read op_tag_types" ON public.op_tag_types;
CREATE POLICY "Authenticated can read op_tag_types" ON public.op_tag_types FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Coordinator manages op_tag_types" ON public.op_tag_types;
CREATE POLICY "Coordinator manages op_tag_types" ON public.op_tag_types FOR ALL TO authenticated
  USING (public.is_coordinator()) WITH CHECK (public.is_coordinator());

DROP POLICY IF EXISTS "Authenticated can read op_tags" ON public.op_tags;
CREATE POLICY "Authenticated can read op_tags" ON public.op_tags FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Coordinator manages op_tags" ON public.op_tags;
CREATE POLICY "Coordinator manages op_tags" ON public.op_tags FOR ALL TO authenticated
  USING (public.is_coordinator()) WITH CHECK (public.is_coordinator());

-- Etiquetas iniciais
INSERT INTO public.op_tag_types (name, color, sort) VALUES
  ('Datado', 'emerald', 1),
  ('Ag. datação', 'amber', 2),
  ('Ag. insumos', 'orange', 3),
  ('Sem selo', 'rose', 4)
ON CONFLICT ((upper(name))) DO NOTHING;
