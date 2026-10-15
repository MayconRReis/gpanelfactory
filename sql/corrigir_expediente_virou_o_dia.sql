-- ==============================================================================
-- CORREÇÃO NA RAIZ: EXPEDIENTE que só foi encerrado no dia seguinte
-- ==============================================================================
-- Quando a OP fica "em produção" de noite, o expediente da linha também não
-- fecha sozinho, e alguém o encerra na manhã seguinte (ex.: 13/10 → 14/10
-- 07:50). O painel contava a madrugada como linha PARADA no dia seguinte
-- ("Sem pausa registrada" de 00:00 até a hora do encerramento).
--
-- Este script corrige o fim (ended_at) desses expedientes para o FIM DA
-- JORNADA do dia em que começaram (seg–qui 17:00, sex 16:00, horário de
-- Brasília) — ou para o último registro da linha naquele dia, se a produção
-- passou do horário (hora extra). Só linhas de Envase/Sleev (reatores ficam
-- de fora) e só expedientes que começaram dentro da jornada, em dia útil.
--
-- Rodar no Supabase SQL Editor: primeiro o PASSO 1 (só mostra), depois o
-- PASSO 2. Pode rodar de novo: o que já foi corrigido não aparece mais.

-- ------------------------------------------------------------------------------
-- PASSO 1 — CONFERIR (não altera nada)
-- ------------------------------------------------------------------------------
WITH ws AS (
  SELECT w.*,
    (w.started_at AT TIME ZONE 'America/Sao_Paulo') AS ini_local,
    (w.ended_at   AT TIME ZONE 'America/Sao_Paulo') AS fim_local
  FROM public.work_sessions w
  WHERE w.ended_at IS NOT NULL
    AND COALESCE(w.line_id, '') !~* 'reator|pesagem|manipula'
),
alvo AS (
  SELECT ws.*,
    ws.ini_local::date AS dia,
    CASE WHEN EXTRACT(ISODOW FROM ws.ini_local) = 5 THEN time '16:00' ELSE time '17:00' END AS fim_jornada
  FROM ws
  WHERE ws.fim_local::date > ws.ini_local::date
    AND EXTRACT(ISODOW FROM ws.ini_local) BETWEEN 1 AND 5
),
calc AS (
  SELECT a.*,
    GREATEST(
      (a.dia + a.fim_jornada) AT TIME ZONE 'America/Sao_Paulo',
      COALESCE((
        SELECT MAX(e.created_at) FROM public.events e
        WHERE e.line_id = a.line_id
          AND e.created_at > a.started_at
          AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date = a.dia
      ), a.started_at)
    ) AS novo_fim
  FROM alvo a
  WHERE a.ini_local::time < a.fim_jornada
)
SELECT
  c.id,
  c.line_id AS linha,
  to_char(c.ini_local, 'DD/MM HH24:MI') AS inicio,
  to_char(c.fim_local, 'DD/MM HH24:MI') AS encerrado_em,
  to_char(c.novo_fim AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS passa_a_encerrar_em
FROM calc c
ORDER BY c.started_at;

-- ------------------------------------------------------------------------------
-- PASSO 2 — CORRIGIR
-- ------------------------------------------------------------------------------
WITH ws AS (
  SELECT w.*,
    (w.started_at AT TIME ZONE 'America/Sao_Paulo') AS ini_local,
    (w.ended_at   AT TIME ZONE 'America/Sao_Paulo') AS fim_local
  FROM public.work_sessions w
  WHERE w.ended_at IS NOT NULL
    AND COALESCE(w.line_id, '') !~* 'reator|pesagem|manipula'
),
alvo AS (
  SELECT ws.*,
    ws.ini_local::date AS dia,
    CASE WHEN EXTRACT(ISODOW FROM ws.ini_local) = 5 THEN time '16:00' ELSE time '17:00' END AS fim_jornada
  FROM ws
  WHERE ws.fim_local::date > ws.ini_local::date
    AND EXTRACT(ISODOW FROM ws.ini_local) BETWEEN 1 AND 5
),
calc AS (
  SELECT a.id,
    GREATEST(
      (a.dia + a.fim_jornada) AT TIME ZONE 'America/Sao_Paulo',
      COALESCE((
        SELECT MAX(e.created_at) FROM public.events e
        WHERE e.line_id = a.line_id
          AND e.created_at > a.started_at
          AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date = a.dia
      ), a.started_at)
    ) AS novo_fim
  FROM alvo a
  WHERE a.ini_local::time < a.fim_jornada
)
UPDATE public.work_sessions w
SET ended_at = c.novo_fim
FROM calc c
WHERE w.id = c.id
