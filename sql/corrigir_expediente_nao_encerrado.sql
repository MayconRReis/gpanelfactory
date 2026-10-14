-- ==============================================================================
-- CORREÇÃO NA RAIZ: OP que ficou "em produção" de um dia para o outro
-- ==============================================================================
-- Quando o expediente não é encerrado, a OP fica "em produção" a noite inteira
-- (ex.: retomou 13/10 10:07 e só pausou 14/10 07:50). Este script registra a
-- pausa que faltou: "Fim de Expediente" no FIM DA JORNADA do dia em que a OP
-- ficou rodando (seg–qui 17:00, sex 16:00, horário de Brasília), marcada como
-- correção manual. Os eventos originais NÃO são alterados nem apagados.
--
-- Vale para as OPs lançadas pelo app nas linhas de Envase/Sleev (reatores têm
-- outra jornada e o histórico importado da planilha — imp-* — fica de fora). Casos que começaram depois do fim da jornada (hora extra) ou no fim de
-- semana não são corrigidos automaticamente — aparecem no PASSO 1 para análise.
--
-- Rodar no Supabase SQL Editor: primeiro o PASSO 1 (só mostra), depois o PASSO 2.
-- Pode rodar o PASSO 2 mais de uma vez: não duplica.

-- ------------------------------------------------------------------------------
-- PASSO 1 — CONFERIR (não altera nada)
-- ------------------------------------------------------------------------------
WITH ev AS (
  SELECT e.*, (e.created_at AT TIME ZONE 'America/Sao_Paulo') AS local_ts
  FROM public.events e
  WHERE e.op_id IS NOT NULL
    AND e.type IN ('STARTED', 'RESUMED', 'PAUSED', 'FINISHED', 'CANCELLED')
),
seq AS (
  SELECT ev.*,
    LEAD(created_at) OVER (PARTITION BY op_id ORDER BY created_at) AS next_at,
    LEAD(type)       OVER (PARTITION BY op_id ORDER BY created_at) AS next_type
  FROM ev
),
trechos AS (
  SELECT
    s.op_id, s.line_id, s.leader_id, s.type AS inicio_tipo, s.created_at AS inicio, s.next_at AS proximo, s.next_type,
    s.local_ts::date AS dia,
    EXTRACT(ISODOW FROM s.local_ts) AS dow,
    s.local_ts::time AS hora_inicio
  FROM seq s
  WHERE s.type IN ('STARTED', 'RESUMED')
    AND s.next_at IS NOT NULL
    AND (s.next_at AT TIME ZONE 'America/Sao_Paulo')::date > s.local_ts::date
    AND COALESCE(s.line_id, '') !~* 'reator|pesagem|manipula'
    -- Histórico importado da planilha (imp-*) fica de fora: só tem início/fim
    -- e a noite ali foi produção real (2º turno / hora extra), não esquecimento.
    AND s.op_id NOT LIKE 'imp-%'
)
SELECT
  t.op_id,
  o.number AS op,
  t.line_id AS linha,
  to_char(t.inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS em_producao_desde,
  to_char(t.proximo AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS proximo_registro,
  t.next_type AS proximo_tipo,
  CASE
    WHEN t.dow NOT BETWEEN 1 AND 5 THEN 'NÃO CORRIGE — fim de semana (analisar)'
    WHEN t.hora_inicio >= (CASE WHEN t.dow = 5 THEN time '16:00' ELSE time '17:00' END) THEN 'NÃO CORRIGE — começou depois da jornada (analisar)'
    ELSE 'Pausa "Fim de Expediente" às ' || to_char(CASE WHEN t.dow = 5 THEN time '16:00' ELSE time '17:00' END, 'HH24:MI') || ' de ' || to_char(t.dia, 'DD/MM')
  END AS correcao
FROM trechos t
LEFT JOIN public.ops o ON o.id = t.op_id
ORDER BY t.inicio;

-- ------------------------------------------------------------------------------
-- PASSO 2 — CORRIGIR (registra a pausa que faltou)
-- ------------------------------------------------------------------------------
WITH ev AS (
  SELECT e.*, (e.created_at AT TIME ZONE 'America/Sao_Paulo') AS local_ts
  FROM public.events e
  WHERE e.op_id IS NOT NULL
    AND e.type IN ('STARTED', 'RESUMED', 'PAUSED', 'FINISHED', 'CANCELLED')
),
seq AS (
  SELECT ev.*,
    LEAD(created_at) OVER (PARTITION BY op_id ORDER BY created_at) AS next_at
  FROM ev
),
trechos AS (
  SELECT
    s.op_id, s.line_id, s.leader_id, s.created_at AS inicio, s.next_at AS proximo,
    s.local_ts::date AS dia,
    EXTRACT(ISODOW FROM s.local_ts) AS dow,
    s.local_ts::time AS hora_inicio
  FROM seq s
  WHERE s.type IN ('STARTED', 'RESUMED')
    AND s.next_at IS NOT NULL
    AND (s.next_at AT TIME ZONE 'America/Sao_Paulo')::date > s.local_ts::date
    AND COALESCE(s.line_id, '') !~* 'reator|pesagem|manipula'
    -- Histórico importado da planilha (imp-*) fica de fora: só tem início/fim
    -- e a noite ali foi produção real (2º turno / hora extra), não esquecimento.
    AND s.op_id NOT LIKE 'imp-%'
),
correcoes AS (
  SELECT
    t.op_id, t.line_id, t.leader_id, t.dia,
    ((t.dia + CASE WHEN t.dow = 5 THEN time '16:00' ELSE time '17:00' END) AT TIME ZONE 'America/Sao_Paulo') AS pausa_em
  FROM trechos t
  WHERE t.dow BETWEEN 1 AND 5
    AND t.hora_inicio < (CASE WHEN t.dow = 5 THEN time '16:00' ELSE time '17:00' END)
)
INSERT INTO public.events (op_id, line_id, leader_id, type, pause_reason_name, comments, created_at)
SELECT
  c.op_id, c.line_id, c.leader_id, 'PAUSED', 'Fim de Expediente',
  'Correção manual: expediente não encerrado em ' || to_char(c.dia, 'DD/MM') || ' — pausa registrada no fim da jornada',
  c.pausa_em
FROM correcoes c
WHERE c.pausa_em < now()
  AND NOT EXISTS (
    SELECT 1 FROM public.events x
    WHERE x.op_id = c.op_id AND x.type = 'PAUSED' AND x.created_at = c.pausa_em
  );
