-- ==============================================================================
-- Ocorrências de pessoal: atestado de vários dias e férias
-- ==============================================================================
-- Rodar manualmente no Supabase SQL Editor (pode rodar mais de uma vez).
--
--   - end_date: último dia fora (atestado/férias de vários dias). Vazio =
--     ocorrência de um dia só, como sempre foi.
--   - novo tipo 'ferias'.

ALTER TABLE public.staff_occurrences ADD COLUMN IF NOT EXISTS end_date date;

ALTER TABLE public.staff_occurrences DROP CONSTRAINT IF EXISTS staff_occurrences_end_date_check;
ALTER TABLE public.staff_occurrences
  ADD CONSTRAINT staff_occurrences_end_date_check CHECK (end_date IS NULL OR end_date >= occurred_on);

ALTER TABLE public.staff_occurrences DROP CONSTRAINT IF EXISTS staff_occurrences_type_check;
ALTER TABLE public.staff_occurrences
  ADD CONSTRAINT staff_occurrences_type_check CHECK (type IN (
    'falta', 'atraso', 'atestado', 'saida_antecipada', 'acidente', 'incidente',
    'hora_extra', 'retorno', 'ferias', 'free_balde'
  ));

-- Busca por período (quem está fora num dia)
CREATE INDEX IF NOT EXISTS staff_occurrences_end_date_idx ON public.staff_occurrences (end_date);
