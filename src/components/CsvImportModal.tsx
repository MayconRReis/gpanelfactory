import React, { useState, useRef } from 'react';
import { 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  Download, 
  Trash2, 
  ArrowRight,
  Sparkles,
  Info,
  Sliders,
  Tag
} from 'lucide-react';
import { Button } from './ui/button';
import { importOPsBatch } from '../services/db';
import { ProductionOrder } from '../types';

export interface ParsedCsvOp {
  number: string;
  product: string;
  lote: string;
  plannedQuantity: number;
  granel: string;
  priority: 'Crítica' | 'Alta' | 'Normal' | 'Baixa';
  status: 'pending' | 'in_progress' | 'paused' | 'completed';
  isValid: boolean;
  validationError?: string;
}

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (imported: ProductionOrder[]) => void;
}

const PRIORITY_OPTIONS: Array<'Crítica' | 'Alta' | 'Normal' | 'Baixa'> = ['Normal', 'Alta', 'Crítica', 'Baixa'];

export function CsvImportModal({ isOpen, onClose, onSuccess }: CsvImportModalProps) {
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedCsvOp[]>([]);
  const [defaultPriority, setDefaultPriority] = useState<'Crítica' | 'Alta' | 'Normal' | 'Baixa'>('Normal');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Parser robusto de CSV
  const parseCsvText = (text: string, currentDefaultPriority: 'Crítica' | 'Alta' | 'Normal' | 'Baixa' = 'Normal') => {
    try {
      setErrorMessage(null);
      const lines = text
        .split(/\r\n|\n|\r/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length === 0) {
        setErrorMessage('O arquivo selecionado está vazio.');
        setParsedRows([]);
        return;
      }

      // Detecta separador (;, vírgula ou tab)
      const firstLine = lines[0].replace(/^\uFEFF/, '');
      let separator = ';';
      if ((firstLine.match(/,/g) || []).length > (firstLine.match(/;/g) || []).length) {
        separator = ',';
      } else if (firstLine.includes('\t')) {
        separator = '\t';
      }

      // Função para separar linha respeitando aspas, vírgulas/ponto-e-vírgula e caracteres especiais (BOM, NBSP)
      const splitLine = (line: string): string[] => {
        const cleanLine = line.replace(/^\uFEFF/, '').replace(/\u00A0/g, ' ');
        const result: string[] = [];
        let current = '';
        let insideQuotes = false;

        for (let i = 0; i < cleanLine.length; i++) {
          const char = cleanLine[i];
          if (char === '"') {
            insideQuotes = !insideQuotes;
          } else if (char === separator && !insideQuotes) {
            result.push(current.trim().replace(/^"|"$/g, ''));
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim().replace(/^"|"$/g, ''));
        return result;
      };

      const rawHeaders = splitLine(lines[0]);
      const normalizedHeaders = rawHeaders.map((h) =>
        h
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^A-Z0-9]/g, '')
      );

      // Encontra posições das colunas obrigatórias e opcionais
      const getColumnIndex = (candidates: string[]) => {
        return normalizedHeaders.findIndex((h) =>
          candidates.some((c) => h === c || h.includes(c))
        );
      };

      const opIdx = getColumnIndex(['OP', 'NUMERO', 'ORDEM', 'NUMEROOP', 'CODIGOOP', 'CODOP']);
      const nomeIdx = getColumnIndex(['NOME', 'PRODUTO', 'DESCRICAO', 'ITEM', 'NOMEPRODUTO', 'PROD']);
      const loteIdx = getColumnIndex(['LOTE', 'BATCH', 'LOT', 'NUMEROLOTE']);
      const qtdIdx = getColumnIndex(['QUANTIDADE', 'QUANTIDE', 'QTD', 'QUANT', 'QUANTIDADEPLANEJADA', 'QTDPLANEJADA']);
      const granelIdx = getColumnIndex(['GRANEL', 'BULK', 'LOTEGRANEL', 'CODGRANEL', 'MATERIAPRIMA', 'GRANELCOD']);
      const priorityIdx = getColumnIndex(['PRIORIDADE', 'PRIORITY', 'STATUSPRIORIDADE', 'NIVEL', 'URGENCIA']);

      // Se a primeira linha não for cabeçalho com nomes conhecidos, assume ordem padrão: OP, NOME, LOTE, QUANTIDADE, GRANEL
      const hasRecognizedHeaders = opIdx !== -1 || nomeIdx !== -1 || qtdIdx !== -1;
      const startIndex = hasRecognizedHeaders ? 1 : 0;

      const finalOpIdx = hasRecognizedHeaders && opIdx !== -1 ? opIdx : 0;
      const finalNomeIdx = hasRecognizedHeaders && nomeIdx !== -1 ? nomeIdx : 1;
      const finalLoteIdx = hasRecognizedHeaders && loteIdx !== -1 ? loteIdx : 2;
      const finalQtdIdx = hasRecognizedHeaders && qtdIdx !== -1 ? qtdIdx : 3;
      const finalGranelIdx = hasRecognizedHeaders && granelIdx !== -1 ? granelIdx : 4;
      const finalPriorityIdx = hasRecognizedHeaders && priorityIdx !== -1 ? priorityIdx : -1;

      const parsed: ParsedCsvOp[] = [];

      for (let i = startIndex; i < lines.length; i++) {
        const row = splitLine(lines[i]);
        if (row.length === 0 || (row.length === 1 && !row[0])) continue;

        const opNumber = (row[finalOpIdx] || '').trim();
        const productName = (row[finalNomeIdx] || '').trim();
        const lote = (row[finalLoteIdx] || '').trim();
        const rawQtd = (row[finalQtdIdx] || '').replace(/[^\d.,]/g, '').replace(',', '.');
        const plannedQuantity = parseFloat(rawQtd) || 0;
        const granel = (row[finalGranelIdx] || '').trim();

        // Extrai ou define a prioridade/status
        let rowPriority: 'Crítica' | 'Alta' | 'Normal' | 'Baixa' = currentDefaultPriority;
        if (finalPriorityIdx !== -1 && row[finalPriorityIdx]) {
          const rawP = row[finalPriorityIdx].trim().toLowerCase();
          if (rawP.includes('crit') || rawP.includes('urg')) rowPriority = 'Crítica';
          else if (rawP.includes('alt')) rowPriority = 'Alta';
          else if (rawP.includes('baix')) rowPriority = 'Baixa';
          else if (rawP.includes('norm')) rowPriority = 'Normal';
        }

        let isValid = true;
        let validationError: string | undefined;

        if (!opNumber) {
          isValid = false;
          validationError = 'Número da OP ausente';
        } else if (!productName) {
          isValid = false;
          validationError = 'Nome do produto ausente';
        } else if (plannedQuantity <= 0) {
          isValid = false;
          validationError = 'Quantidade inválida ou zerada';
        }

        parsed.push({
          number: opNumber,
          product: productName,
          lote,
          plannedQuantity,
          granel,
          priority: rowPriority,
          status: 'pending',
          isValid,
          validationError,
        });
      }

      if (parsed.length === 0) {
        setErrorMessage('Nenhum registro de OP pôde ser identificado no arquivo.');
      }

      setParsedRows(parsed);
    } catch (err: any) {
      setErrorMessage(`Erro ao processar o arquivo CSV: ${err?.message || 'Formato incompatível'}`);
      setParsedRows([]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      parseCsvText(text, defaultPriority);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        parseCsvText(text, defaultPriority);
      };
      reader.readAsText(file, 'UTF-8');
    }
  };

  // Alterar prioridade global para todas as OPs carregadas
  const handleBulkPriorityChange = (newP: 'Crítica' | 'Alta' | 'Normal' | 'Baixa') => {
    setDefaultPriority(newP);
    setParsedRows((prev) => prev.map((row) => ({ ...row, priority: newP })));
  };

  // Alterar prioridade de uma linha específica
  const handleRowPriorityChange = (index: number, newP: 'Crítica' | 'Alta' | 'Normal' | 'Baixa') => {
    setParsedRows((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], priority: newP };
      }
      return updated;
    });
  };

  const handleDownloadTemplate = () => {
    const csvContent = 
      'OP;NOME;LOTE;QUANTIDADE;GRANEL;PRIORIDADE\r\n' +
      '40240;Shampoo Hidratante Liso Intenso 500ml;LT-24-101;2500;GR-SH-910;Normal\r\n' +
      '40241;Condicionador Nutritivo Argan 300ml;LT-24-102;3000;GR-CD-912;Normal\r\n' +
      '40242;Máscara Reconstrutora Queratina 500g;LT-24-103;1800;GR-MC-550;Alta\r\n' +
      '40243;Leave-in Finalizador Termoativo 200ml;LT-24-104;1200;GR-LV-300;Normal\r\n' +
      '40244;Sérum Capilar Iluminador Gold 60ml;LT-24-105;4000;GR-SR-110;Crítica\r\n';

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'modelo_importacao_estoque_ops.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const validRows = parsedRows.filter((r) => r.isValid);
  const invalidRows = parsedRows.filter((r) => !r.isValid);
  const totalVolume = validRows.reduce((acc, r) => acc + r.plannedQuantity, 0);

  const handleConfirmImport = async () => {
    if (validRows.length === 0) return;

    setIsProcessing(true);
    try {
      const itemsToImport = validRows.map((r) => ({
        number: r.number,
        product: r.product,
        lote: r.lote,
        plannedQuantity: r.plannedQuantity,
        granel: r.granel,
        priority: r.priority,
        status: r.status,
        lineId: null,
      }));

      const res = await importOPsBatch(itemsToImport);
      onSuccess(res.imported);
      handleReset();
      onClose();
    } catch (err: any) {
      setErrorMessage(`Erro ao importar OPs para o estoque: ${err?.message || 'Falha de comunicação'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setFileName(null);
    setParsedRows([]);
    setDefaultPriority('Normal');
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getPriorityBadgeClass = (priority: string) => {
    switch (priority) {
      case 'Crítica':
        return 'bg-red-950/80 text-red-400 border-red-800/60 font-bold';
      case 'Alta':
        return 'bg-amber-950/80 text-amber-400 border-amber-800/60 font-bold';
      case 'Baixa':
        return 'bg-zinc-800/80 text-zinc-400 border-zinc-700/60 font-semibold';
      case 'Normal':
      default:
        return 'bg-blue-950/80 text-blue-400 border-blue-800/60 font-bold';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#111116] border border-[#272730] w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        
        {/* Header do Modal */}
        <div className="p-5 border-b border-[#202026] flex items-center justify-between bg-[#14141a]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shadow-lg shadow-blue-900/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#f4f4f5] uppercase tracking-wider">
                  Importar OPs em Estoque via CSV
                </h3>
                <span className="text-[10px] bg-blue-950/80 text-blue-400 border border-blue-800/40 px-2 py-0.5 rounded-full font-bold">
                  Estoque de OPs
                </span>
              </div>
              <p className="text-xs text-[#71717a] mt-0.5">
                Importe ordens de produção com as colunas: <strong>OP</strong>, <strong>NOME</strong>, <strong>LOTE</strong>, <strong>QUANTIDADE</strong>, <strong>GRANEL</strong> e <strong>STATUS/PRIORIDADE</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadTemplate}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 hover:bg-blue-950/40 border border-blue-800/30 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 transition-all"
              title="Baixar planilha modelo com as colunas corretas"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Modelo CSV</span>
            </button>
            <button
              onClick={onClose}
              className="text-[#71717a] hover:text-[#f4f4f5] p-1.5 rounded-lg hover:bg-[#1f1f28] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Conteúdo Principal */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          
          {/* Caixa de Upload / Drag & Drop */}
          {parsedRows.length === 0 && (
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center ${
                dragActive
                  ? 'border-blue-500 bg-blue-600/10 scale-[0.99]'
                  : 'border-[#2c2c36] hover:border-blue-500/60 bg-[#0c0c10] hover:bg-[#121218]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv, .txt, text/csv, application/vnd.ms-excel"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="w-14 h-14 rounded-2xl bg-blue-600/15 text-blue-400 border border-blue-500/30 flex items-center justify-center mb-3 shadow-inner">
                <Upload className="w-7 h-7" />
              </div>

              <h4 className="text-sm font-bold text-[#f4f4f5] mb-1">
                Arraste seu arquivo CSV aqui ou clique para selecionar
              </h4>
              <p className="text-xs text-[#71717a] max-w-md mb-4">
                Suporta planilhas exportadas do SAP, TOTVS Protheus, Excel ou qualquer ERP industrial.
              </p>

              {/* Informação das colunas */}
              <div className="bg-[#16161d] border border-[#262630] rounded-xl p-3 max-w-2xl w-full flex items-center justify-around text-center flex-wrap gap-2">
                <div className="px-2">
                  <span className="text-[10px] text-[#71717a] uppercase font-bold block">Coluna 1</span>
                  <span className="text-xs font-mono font-bold text-blue-400">OP</span>
                </div>
                <div className="w-px h-6 bg-[#262630] hidden sm:block" />
                <div className="px-2">
                  <span className="text-[10px] text-[#71717a] uppercase font-bold block">Coluna 2</span>
                  <span className="text-xs font-bold text-[#f4f4f5]">NOME</span>
                </div>
                <div className="w-px h-6 bg-[#262630] hidden sm:block" />
                <div className="px-2">
                  <span className="text-[10px] text-[#71717a] uppercase font-bold block">Coluna 3</span>
                  <span className="text-xs font-mono text-emerald-400">LOTE</span>
                </div>
                <div className="w-px h-6 bg-[#262630] hidden sm:block" />
                <div className="px-2">
                  <span className="text-[10px] text-[#71717a] uppercase font-bold block">Coluna 4</span>
                  <span className="text-xs font-bold text-purple-400">QUANTIDADE</span>
                </div>
                <div className="w-px h-6 bg-[#262630] hidden sm:block" />
                <div className="px-2">
                  <span className="text-[10px] text-[#71717a] uppercase font-bold block">Coluna 5</span>
                  <span className="text-xs font-mono text-amber-400">GRANEL</span>
                </div>
                <div className="w-px h-6 bg-[#262630] hidden sm:block" />
                <div className="px-2">
                  <span className="text-[10px] text-[#71717a] uppercase font-bold block">Coluna 6 (Opcional)</span>
                  <span className="text-xs font-bold text-cyan-400">PRIORIDADE (Normal)</span>
                </div>
              </div>
            </div>
          )}

          {/* Erro de leitura */}
          {errorMessage && (
            <div className="bg-red-950/80 border border-red-800 text-red-200 p-3.5 rounded-xl text-xs flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Prévia dos Dados Processados */}
          {parsedRows.length > 0 && (
            <div className="space-y-3">
              
              {/* Barra de Resumo & Seletor de Status / Prioridade Global */}
              <div className="bg-[#15151c] border border-[#262632] rounded-xl p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[#f4f4f5]">{fileName}</span>
                      <span className="text-[10px] text-emerald-400 bg-emerald-950/70 border border-emerald-800/40 px-2 py-0.2 rounded-full font-bold">
                        {validRows.length} OPs válidas
                      </span>
                      {invalidRows.length > 0 && (
                        <span className="text-[10px] text-rose-400 bg-rose-950/70 border border-rose-800/40 px-2 py-0.2 rounded-full font-bold">
                          {invalidRows.length} com aviso
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#71717a] mt-0.5">
                      Volume total a ser inserido no estoque:{' '}
                      <strong className="text-[#f4f4f5] font-mono">
                        {totalVolume.toLocaleString('pt-BR')} un
                      </strong>
                    </p>
                  </div>
                </div>

                {/* Controle de Status / Prioridade Padrão */}
                <div className="flex items-center gap-3 flex-wrap self-stretch md:self-auto justify-between md:justify-end border-t md:border-t-0 pt-2 md:pt-0 border-[#222228]">
                  <div className="flex items-center gap-2 bg-[#0c0c10] border border-[#272732] rounded-xl px-2.5 py-1.5">
                    <span className="text-[11px] text-[#a1a1aa] font-semibold flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-blue-400" />
                      Prioridade Padrão:
                    </span>
                    <select
                      value={defaultPriority}
                      onChange={(e) => handleBulkPriorityChange(e.target.value as any)}
                      className="bg-[#17171f] border border-[#30303e] rounded-lg text-xs font-bold px-2 py-1 text-[#f4f4f5] focus:outline-none focus:border-blue-500 cursor-pointer"
                    >
                      {PRIORITY_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt} {opt === 'Normal' ? '(Padrão)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleReset}
                    className="h-8 text-xs bg-[#1a1a22] hover:bg-[#252530] border-[#2f2f3c] text-[#a1a1aa] hover:text-white rounded-lg flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    <span>Trocar Arquivo</span>
                  </Button>
                </div>
              </div>

              {/* Tabela de Pré-Visualização */}
              <div className="bg-[#0e0e12] border border-[#222228] rounded-xl overflow-hidden shadow-xl max-h-[42vh] overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#17171d] text-[#71717a] uppercase font-bold text-[10px] tracking-wider border-b border-[#24242c] sticky top-0 z-10">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">OP</th>
                      <th className="py-2.5 px-3">Nome do Produto</th>
                      <th className="py-2.5 px-3">Lote</th>
                      <th className="py-2.5 px-3 text-right">Quantidade</th>
                      <th className="py-2.5 px-3">Granel</th>
                      <th className="py-2.5 px-3">Status / Prioridade</th>
                      <th className="py-2.5 px-3 text-center">Validação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e1e24]">
                    {parsedRows.map((row, idx) => (
                      <tr
                        key={idx}
                        className={`transition-colors ${
                          !row.isValid
                            ? 'bg-rose-950/20 text-rose-300'
                            : 'hover:bg-[#14141a]'
                        }`}
                      >
                        <td className="py-2.5 px-3 text-[#71717a] font-mono text-[11px]">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-400">
                          {row.number || <span className="text-rose-400 italic">Vazio</span>}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-[#f4f4f5] max-w-xs truncate">
                          {row.product || <span className="text-rose-400 italic">Vazio</span>}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-emerald-400">
                          {row.lote ? (
                            <span className="bg-emerald-950/60 border border-emerald-800/30 px-1.5 py-0.5 rounded text-[10px] font-bold">
                              {row.lote}
                            </span>
                          ) : (
                            <span className="text-[#52525b] italic">S/ Lote</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#f4f4f5]">
                          {row.plannedQuantity > 0 ? (
                            `${row.plannedQuantity.toLocaleString('pt-BR')} un`
                          ) : (
                            <span className="text-rose-400">Inválida</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-amber-400">
                          {row.granel ? (
                            <span className="bg-amber-950/60 border border-amber-800/30 px-1.5 py-0.5 rounded text-[10px] font-bold">
                              {row.granel}
                            </span>
                          ) : (
                            <span className="text-[#52525b] italic">S/ Granel</span>
                          )}
                        </td>
                        
                        {/* Seletor de Prioridade por Linha */}
                        <td className="py-2 px-3">
                          <select
                            value={row.priority}
                            onChange={(e) => handleRowPriorityChange(idx, e.target.value as any)}
                            className={`text-[11px] font-bold rounded-lg px-2 py-1 border cursor-pointer focus:outline-none transition-colors ${getPriorityBadgeClass(row.priority)}`}
                          >
                            <option value="Normal" className="bg-[#121218] text-blue-400 font-bold">Normal</option>
                            <option value="Alta" className="bg-[#121218] text-amber-400 font-bold">Alta</option>
                            <option value="Crítica" className="bg-[#121218] text-red-400 font-bold">Crítica</option>
                            <option value="Baixa" className="bg-[#121218] text-zinc-400 font-semibold">Baixa</option>
                          </select>
                        </td>

                        <td className="py-2.5 px-3 text-center">
                          {row.isValid ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Pronta
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] text-rose-400 font-bold"
                              title={row.validationError}
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                              {row.validationError || 'Erro'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        {/* Rodapé com Botões de Ação */}
        <div className="p-4 border-t border-[#202026] bg-[#14141a] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-[#71717a] flex items-center gap-1.5">
            <Info className="w-4 h-4 text-blue-400 shrink-0" />
            <span>As OPs serão gravadas no estoque com o status e prioridade selecionados.</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="h-9 text-xs text-[#a1a1aa] hover:text-white"
            >
              Cancelar
            </Button>
            
            <Button
              disabled={validRows.length === 0 || isProcessing}
              onClick={handleConfirmImport}
              className="h-9 px-5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-[0_0_15px_rgba(37,99,235,0.35)] disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Importando para o Estoque...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {validRows.length > 0
                      ? `Confirmar Importação (${validRows.length} OPs)`
                      : 'Nenhuma OP Válida'}
                  </span>
                </>
              )}
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
