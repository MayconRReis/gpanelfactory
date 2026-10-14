// Tempo esperado da OP: digitado (Coordenação ou líder) no formato padrão de tempo
// (H:MM — "1:30" = 1h30, "0:35" = 35 min). No banco continua em horas
// decimais (1.5, 0.583…), que é o que o cálculo do OEE usa.
export function parseHoursHHMM(v: string): number | null {
  const t = String(v || '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (m) {
    const total = Number(m[1]) + Number(m[2]) / 60;
    return total > 0 ? Math.round(total * 10000) / 10000 : null;
  }
  // Só número inteiro = horas cheias ("2" = 2:00)
  if (/^\d{1,3}$/.test(t)) return Number(t) > 0 ? Number(t) : null;
  return null;
}
export function formatHoursHHMM(h?: number | null): string {
  if (h === undefined || h === null || !(Number(h) > 0)) return '';
  const totalMin = Math.round(Number(h) * 60);
  return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}`;
}
