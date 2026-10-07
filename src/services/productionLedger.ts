import { ProductionEvent, ProductionOrder } from '../types';
import { toLocalDateStr, getOpReferenceDateStr, isReworkMarkerEvent, isSleeveLineId } from './db';

/**
 * LIVRO DE PRODUÇÃO — fonte ÚNICA dos números de produção do Dashboard e do
 * Dashboard Detalhado (antes cada tela somava de um jeito e os números não
 * batiam). Cada lançamento é "quanto foi produzido, de qual OP, em qual
 * linha e em qual dia":
 *
 * - ENVASE (Envase 1, Envase 2…): produção REAL pelos apontamentos. Cada
 *   apontamento/pausa/conclusão conta no dia em que aconteceu — uma OP que
 *   ainda está em produção já soma o que foi envasado hoje. OP sem nenhum
 *   apontamento (histórico importado) conta no dia em que foi fechada.
 * - SLEEV: mesma regra, nas linhas do Sleev — métrica separada do Envase.
 * - MANIPULAÇÃO: Kg da OSM, no dia em que foi concluída.
 * - PESAGEM: cada OSM pesada (contagem) + o Kg da OSM, no dia de referência.
 *
 * Unidades nunca se misturam: Envase/Sleev em Un, Manipulação/Pesagem em Kg.
 */

export type LedgerSector = 'Envase' | 'Sleev' | 'Manipulação' | 'Pesagem';

export interface LedgerEntry {
  key: string;
  day: string; // 'AAAA-MM-DD' (local)
  at: string; // ISO do último registro que compõe este lançamento
  sector: LedgerSector;
  lineId: string | null;
  opId: string;
  number: string;
  product: string;
  lote?: string;
  qty: number; // Un (Envase/Sleev) ou Kg (Manipulação/Pesagem)
  unit: 'Un' | 'Kg';
  opStatus: ProductionOrder['status'];
  leaderId?: string | null;
}

export function isEnvaseLineOp(op: ProductionOrder): boolean {
  if (op.setor === 'Pesagem' || op.setor === 'Manipulação') return false;
  if (op.tipoDocumento === 'OSM') return false;
  if (op.lineId && /reator|pesagem|manipula/i.test(op.lineId)) return false;
  return true;
}

const lineSector = (lineId?: string | null): LedgerSector | null => {
  if (!lineId) return 'Envase';
  if (/reator|pesagem|manipula/i.test(lineId)) return null;
  return isSleeveLineId(lineId) ? 'Sleev' : 'Envase';
};

export function buildProductionLedger(ops: ProductionOrder[], events: ProductionEvent[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const realOps = (ops || []).filter(o => o && !o.isPartialRecord);
  const opById = new Map(realOps.map(o => [String(o.id), o]));

  // ---------- Envase / Sleev: pelos apontamentos ----------
  const envOps = realOps.filter(isEnvaseLineOp);
  const envIds = new Set(envOps.map(o => String(o.id)));
  const byOp = new Map<string, ProductionEvent[]>();
  for (const ev of events || []) {
    if (!ev?.opId || !ev.createdAt || !envIds.has(String(ev.opId))) continue;
    if (ev.type !== 'QUANTITY_REPORTED' && ev.type !== 'PAUSED' && ev.type !== 'FINISHED') continue;
    const list = byOp.get(String(ev.opId)) || [];
    list.push(ev);
    byOp.set(String(ev.opId), list);
  }
  const withQty = new Set<string>();
  for (const [opId, list] of byOp.entries()) {
    if (list.some(e => e.type === 'QUANTITY_REPORTED' || ((e.type === 'PAUSED' || e.type === 'FINISHED') && e.quantity !== undefined && e.quantity !== null))) {
      withQty.add(opId);
    }
  }
  // Acumula por OP + linha + dia
  const acc = new Map<string, LedgerEntry>();
  const credit = (op: ProductionOrder, lineId: string | undefined | null, iso: string, qty: number, leaderId?: string | null) => {
    if (!qty) return;
    const sector = lineSector(lineId || op.lineId);
    if (!sector) return;
    const day = toLocalDateStr(iso);
    if (!day) return;
    const lid = lineId || op.lineId || null;
    const key = `${op.id}|${lid}|${day}`;
    const cur = acc.get(key);
    if (cur) {
      cur.qty += qty;
      if (iso > cur.at) cur.at = iso;
    } else {
      acc.set(key, {
        key, day, at: iso, sector, lineId: lid, opId: String(op.id), number: op.number, product: op.product,
        lote: op.lote, qty, unit: 'Un', opStatus: op.status, leaderId: leaderId || op.leaderId || null,
      });
    }
  };
  for (const [opId, list] of byOp.entries()) {
    const op = opById.get(opId);
    if (!op) continue;
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    let cumulative = 0;
    let reworkPhase = false;
    for (const ev of list) {
      if (reworkPhase) continue;
      const lineId = ev.lineId || op.lineId || undefined;
      const q = ev.quantity !== undefined && ev.quantity !== null && !isNaN(Number(ev.quantity)) ? Number(ev.quantity) : undefined;
      if (ev.type === 'QUANTITY_REPORTED') {
        if (q && q > 0) { credit(op, lineId, ev.createdAt, q, ev.leaderId); cumulative += q; }
      } else if (ev.type === 'PAUSED') {
        if (q !== undefined && q !== cumulative) { credit(op, lineId, ev.createdAt, q - cumulative, ev.leaderId); cumulative = q; }
      } else if (ev.type === 'FINISHED') {
        if (q !== undefined && q !== cumulative) credit(op, lineId, ev.createdAt, q - cumulative, ev.leaderId);
        cumulative = 0;
        if (isReworkMarkerEvent(ev)) reworkPhase = true;
      }
    }
  }
  // OP sem nenhum apontamento (histórico importado): conta no dia do fechamento
  for (const op of envOps) {
    if (withQty.has(String(op.id))) continue;
    const qty = Number(op.producedQuantity) || 0;
    if (qty <= 0) continue;
    const day = getOpReferenceDateStr(op);
    if (!day) continue;
    credit(op, op.lineId, op.completedAt || `${day}T12:00:00`, qty);
  }
  for (const e of acc.values()) if (e.qty !== 0) out.push(e);

  // ---------- Manipulação: Kg da OSM no dia da conclusão ----------
  for (const op of realOps) {
    if (op.setor !== 'Manipulação') continue;
    if (isSleeveLineId(op.lineId)) continue;
    const qty = Number(op.producedQuantity) || 0;
    if (qty <= 0) continue;
    const day = getOpReferenceDateStr(op);
    if (!day) continue;
    out.push({
      key: `manip|${op.id}`, day, at: op.completedAt || `${day}T12:00:00`, sector: 'Manipulação', lineId: op.lineId || null,
      opId: String(op.id), number: op.number, product: op.product, lote: op.lote, qty, unit: 'Kg', opStatus: op.status, leaderId: op.leaderId || null,
    });
  }

  // ---------- Pesagem: cada OSM pesada (Kg = o pesado da OSM) ----------
  for (const op of realOps) {
    if (op.setor !== 'Pesagem') continue;
    if (isSleeveLineId(op.lineId)) continue;
    const day = getOpReferenceDateStr(op);
    if (!day) continue;
    out.push({
      key: `pes|${op.id}`, day, at: op.completedAt || op.createdAt || `${day}T12:00:00`, sector: 'Pesagem', lineId: op.lineId || null,
      opId: String(op.id), number: op.number, product: op.product, lote: op.lote,
      qty: Number(op.producedQuantity) || Number(op.plannedQuantity) || 0, unit: 'Kg', opStatus: op.status, leaderId: op.leaderId || null,
    });
  }

  return out;
}

/** Soma por dia de um setor (Envase/Sleev = Un; Manipulação/Pesagem = Kg). */
export function sumLedgerByDay(entries: LedgerEntry[], sector: LedgerSector): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    if (e.sector !== sector) continue;
    m.set(e.day, (m.get(e.day) || 0) + e.qty);
  }
  return m;
}
