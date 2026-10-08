import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { getColaboradores, Colaborador } from '../services/db';

/**
 * Campo de nome do colaborador com sugestões enquanto digita. As sugestões
 * vêm da relação de colaboradores da fábrica (tabela colaboradores) + nomes já
 * usados antes (`extraNames`). Busca sem diferenciar maiúsculas nem acentos e
 * por pedaços do nome ("jo sil" acha "JOÃO DA SILVA"). Aceita
 * também um nome que não está na lista (ex.: free novo).
 */

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

interface Suggestion {
  nome: string;
  detalhe?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  extraNames?: string[];
  placeholder?: string;
  className?: string;
}

const MAX_SUGGESTIONS = 8;

export function EmployeeNameInput({ value, onChange, extraNames = [], placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [roster, setRoster] = useState<Colaborador[]>([]);

  useEffect(() => {
    let cancelled = false;
    getColaboradores().then(list => { if (!cancelled) setRoster(list); });
    return () => { cancelled = true; };
  }, []);

  // Relação da fábrica primeiro; nomes já usados entram só se não estiverem nela
  const all = useMemo<Suggestion[]>(() => {
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (const c of roster) {
      const k = norm(c.nome);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ nome: c.nome, detalhe: [c.funcao, c.turno].filter(Boolean).join(' · ') });
    }
    for (const n of extraNames) {
      const k = norm(n);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ nome: n.trim(), detalhe: 'Já lançado antes' });
    }
    return out;
  }, [roster, extraNames]);

  const suggestions = useMemo(() => {
    const q = norm(value);
    if (!q) return all.slice(0, MAX_SUGGESTIONS);
    const tokens = q.split(/\s+/);
    const scored: { s: Suggestion; score: number }[] = [];
    for (const s of all) {
      const name = norm(s.nome);
      const words = name.split(/\s+/);
      if (name === q) continue; // já escolhido
      let score: number;
      if (name.startsWith(q)) score = 0;
      else if (tokens.every(t => words.some(w => w.startsWith(t)))) score = 1;
      else if (name.includes(q)) score = 2;
      else continue;
      scored.push({ s, score });
    }
    return scored
      .sort((a, b) => a.score - b.score || a.s.nome.localeCompare(b.s.nome))
      .slice(0, MAX_SUGGESTIONS)
      .map(x => x.s);
  }, [all, value]);

  useEffect(() => { setActive(0); }, [value]);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const pick = (s: Suggestion) => {
    onChange(s.nome);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive(a => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && suggestions[active]) {
      e.preventDefault();
      pick(suggestions[active]);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
    }
  };

  const showList = open && suggestions.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-[#25252c] bg-[#121216] shadow-2xl py-1"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.nome}
              role="option"
              aria-selected={i === active}
              // mousedown (não click) para escolher antes do input perder o foco
              onMouseDown={e => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setActive(i)}
              className={`px-2.5 py-1.5 cursor-pointer ${i === active ? 'bg-blue-600/25' : ''}`}
            >
              <div className="text-xs font-semibold text-[#f4f4f5] truncate">{s.nome}</div>
              {s.detalhe && <div className="text-[10px] text-[#71717a] truncate">{s.detalhe}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
