import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  Download, 
  Trash2, 
  Sliders, 
  ClipboardPaste, 
  Plus, 
  Layers, 
  Info 
} from 'lucide-react';
import { Button } from './ui/button';
import { importOPsBatch } from '../services/db';
import { ProductionOrder } from '../types';

export interface ParsedCsvOp {
  id?: string;
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

// Helper para converter números em formato brasileiro ou internacional com precisão
export function parseFlexibleNumber(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val);
  if (!val) return 0;
  let s = String(val).trim();
  
  // Remove texto como "un", "unidades", "cx", "pecas" etc
  s = s.replace(/(unidades|unidade|unid|un|cx|pecas|pçs|pç|l|kg|g)/gi, '').trim();
  // Remove caracteres que não sejam dígitos, pontos, vírgulas ou hífens
  s = s.replace(/[^\d.,\-]/g, '');
  if (!s) return 0;

  // Caso 1: Contém tanto ponto quanto vírgula (ex: "1.500,00" ou "1,500.00")
  if (s.includes('.') && s.includes(',')) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastComma > lastDot) {
      // Padrão brasileiro: "1.500,50" -> remove pontos e troca vírgula por ponto
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // Padrão americano: "1,500.50" -> remove vírgulas
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    // Apenas vírgula: pode ser decimal "1500,50" ou milhar "1,500"
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && !parts[1].includes('.')) {
      // Provável milhar "1,500" -> 1500
      s = parts.join('');
    } else {
      // Decimal "1500,50"
      s = s.replace(',', '.');
    }
  } else if (s.includes('.')) {
    // Apenas ponto: pode ser milhar brasileiro "1.500" ou "10.000" ou decimal americano "1500.5"
    const parts = s.split('.');
    if (parts.length > 2) {
      // Múltiplos pontos: "1.000.000" -> milhar
      s = parts.join('');
    } else if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 4) {
      // Provável milhar brasileiro: "2.500" ou "25.000" -> 2500 / 25000
      s = parts.join('');
    }
  }

  const num = parseFloat(s);
  return isNaN(num) ? 0 : Math.round(num);
}

// Detecta separador mais provável
function detectSeparator(lines: string[]): string {
  const sample = lines.slice(0, 5).join('\n');
  const countTab = (sample.match(/\t/g) || []).length;
  const countSemicolon = (sample.match(/;/g) || []).length;
  const countComma = (sample.match(/,/g) || []).length;
  const countPipe = (sample.match(/\|/g) || []).length;

  if (countTab > countSemicolon && countTab > countComma && countTab > 0) return '\t';
  if (countSemicolon >= countComma && countSemicolon > 0) return ';';
  if (countPipe > countComma && countPipe > countSemicolon && countPipe > 0) return '|';
  if (countComma > 0) return ',';
  return ';';
}

// Divide linha respeitando aspas
function splitCsvLine(line: string, separator: string): string[] {
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
}

export function CsvImportModal({ isOpen, onClose, onSuccess }: CsvImportModalProps) {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [pasteText, setPasteText] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawLines, setRawLines] = useState<string[]>([]);
  const [availableHeaders, setAvailableHeaders] = useState<string[]>([]);
  const [detectedSeparator, setDetectedSeparator] = useState<string>(';');
  
  // Mapeamento manual de colunas (índice da coluna no CSV)
  const [columnMapping, setColumnMapping] = useState<{
    op: number;
    product: number;
    lote: number;
    quantity: number;
    granel: number;
    priority: number;
  }>({
    op: 0,
    product: 1,
    lote: 2,
    quantity: 3,
    granel: 4,
    priority: 5,
  });

  const [parsedRows, setParsedRows] = useState<ParsedCsvOp[]>([]);
  const [defaultPriority, setDefaultPriority] = useState<'Crítica' | 'Alta' | 'Normal' | 'Baixa'>('Normal');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showAdvancedMapping, setShowAdvancedMapping] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset de estado
  const handleReset = useCallback(() => {
    setFileName(null);
    setParsedRows([]);
    setRawLines([]);
    setPasteText('');
    setDefaultPriority('Normal');
    setErrorMessage(null);
    setShowAdvancedMapping(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  useEffect(() => {
    if (!isOpen) {
      handleReset();
    }
  }, [isOpen, handleReset]);

  // Reconstrói as linhas a partir do mapeamento atual
  const rebuildRows = (
    lines: string[],
    separator: string,
    mapping: typeof columnMapping,
    currentPriority: 'Crítica' | 'Alta' | 'Normal' | 'Baixa'
  ) => {
    if (lines.length === 0) return;

    // Verifica se a linha 0 é cabeçalho ou dados diretos
    const firstRowCols = splitCsvLine(lines[0], separator);
    const hasHeaderWords = firstRowCols.some((col) => {
      const u = col.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return ['OP', 'PRODUTO', 'DESCRICAO', 'NOME', 'QUANTIDADE', 'QTD', 'LOTE', 'GRANEL'].some((w) => u.includes(w));
    });

    const startIndex = hasHeaderWords ? 1 : 0;
    const rows: ParsedCsvOp[] = [];

    for (let i = startIndex; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i], separator);
      if (cols.length === 0 || (cols.length === 1 && !cols[0])) continue;

      let opNumber = mapping.op !== -1 && cols[mapping.op] ? cols[mapping.op].trim() : '';
      let productName = mapping.product !== -1 && cols[mapping.product] ? cols[mapping.product].trim() : '';
      let lote = mapping.lote !== -1 && cols[mapping.lote] ? cols[mapping.lote].trim() : '';
      let rawQtd = mapping.quantity !== -1 && cols[mapping.quantity] ? cols[mapping.quantity].trim() : '';
      let granel = mapping.granel !== -1 && cols[mapping.granel] ? cols[mapping.granel].trim() : '';
      
      const plannedQuantity = parseFlexibleNumber(rawQtd);

      // Se OP vazia mas tem produto, gera OP automática
      if (!opNumber && productName) {
        opNumber = `OP-${Date.now().toString().slice(-4)}-${i + 1}`;
      }

      // Se produto vazio mas tem OP, define nome genérico
      if (!productName && opNumber) {
        productName = `Produto OP ${opNumber}`;
      }

      // Determina prioridade
      let rowPriority: 'Crítica' | 'Alta' | 'Normal' | 'Baixa' = currentPriority;
      if (mapping.priority !== -1 && cols[mapping.priority]) {
        const rawP = cols[mapping.priority].trim().toLowerCase();
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
        validationError = 'Quantidade inválida ou zerada (clique para corrigir)';
      }

      rows.push({
        id: `row-${i}-${Date.now()}`,
        number: opNumber,
        product: productName,
        lote: lote || 'A DEFINIR',
        plannedQuantity: plannedQuantity > 0 ? plannedQuantity : 1000,
        granel: granel || '-',
        priority: rowPriority,
        status: 'pending',
        isValid: plannedQuantity > 0 && Boolean(opNumber) && Boolean(productName),
        validationError: plannedQuantity <= 0 ? 'Quantidade ajustada para 1.000 un (edite se necessário)' : undefined,
      });
    }

    if (rows.length === 0) {
      setErrorMessage('Nenhum registro de OP pôde ser identificado. Verifique o separador ou use a aba "Colar do Excel".');
    }

    setParsedRows(rows);
  };

  // Processa texto bruto em linhas e detecta colunas
  const processRawText = (text: string, currentPriority = defaultPriority) => {
    try {
      setErrorMessage(null);
      const lines = text
        .split(/\r\n|\n|\r/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length === 0) {
        setErrorMessage('O conteúdo informado está vazio.');
        setParsedRows([]);
        setRawLines([]);
        return;
      }

      const separator = detectSeparator(lines);
      setDetectedSeparator(separator);
      setRawLines(lines);

      // Lê a primeira linha como cabeçalho
      const firstRowCols = splitCsvLine(lines[0], separator);
      setAvailableHeaders(firstRowCols);

      // Normaliza cabeçalhos para encontrar correspondências inteligentes
      const normalizedHeaders = firstRowCols.map((h) =>
        h
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^A-Z0-9]/g, '')
      );

      const findBestIndex = (candidates: string[], defaultIdx: number) => {
        const found = normalizedHeaders.findIndex((h) =>
          candidates.some((c) => h === c || h.includes(c))
        );
        return found !== -1 ? found : (defaultIdx < firstRowCols.length ? defaultIdx : -1);
      };

      const opIdx = findBestIndex(['OP', 'NUMERO', 'ORDEM', 'NUMEROOP', 'CODIGOOP', 'CODOP', 'DOC', 'DOCUMENTO', 'IDOP', 'NROP'], 0);
      const prodIdx = findBestIndex(['PRODUTO', 'DESCRICAO', 'NOME', 'ITEM', 'NOMEPRODUTO', 'DESCPROD', 'MATERIAL', 'MERCADORIA', 'SKU'], 1);
      const loteIdx = findBestIndex(['LOTE', 'BATCH', 'LOT', 'NUMEROLOTE', 'CODLOTE', 'NLOTE'], 2);
      const qtdIdx = findBestIndex(['QUANTIDADE', 'QUANTIDE', 'QTD', 'QUANT', 'QTDPLANEJADA', 'QUANTIDADEPLANEJADA', 'META', 'VOLUME', 'TOTAL', 'PROGRAMADO'], 3);
      const granelIdx = findBestIndex(['GRANEL', 'BULK', 'LOTEGRANEL', 'CODGRANEL', 'MATERIAPRIMA', 'MASSA', 'TANQUE', 'CALDEIRA'], 4);
      const priorIdx = findBestIndex(['PRIORIDADE', 'PRIORITY', 'URGENCIA', 'FAROL', 'NIVEL', 'STATUSPRIORIDADE'], 5);

      const newMapping = {
        op: opIdx !== -1 ? opIdx : 0,
        product: prodIdx !== -1 ? prodIdx : 1,
        lote: loteIdx !== -1 ? loteIdx : 2,
        quantity: qtdIdx !== -1 ? qtdIdx : 3,
        granel: granelIdx !== -1 ? granelIdx : (firstRowCols.length > 4 ? 4 : -1),
        priority: priorIdx !== -1 ? priorIdx : -1,
      };

      setColumnMapping(newMapping);

      // Gera as linhas parseadas com o mapeamento detectado
      rebuildRows(lines, separator, newMapping, currentPriority);
    } catch (err: any) {
      setErrorMessage(`Erro ao interpretar dados: ${err?.message || 'Formato incompatível'}`);
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
      processRawText(text, defaultPriority);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handlePasteSubmit = () => {
    if (!pasteText.trim()) {
      setErrorMessage('Cole as linhas da planilha antes de continuar.');
      return;
    }
    setFileName('Dados Colados da Área de Transferência');
    processRawText(pasteText, defaultPriority);
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
        processRawText(text, defaultPriority);
      };
      reader.readAsText(file, 'UTF-8');
    }
  };

  // Alterar prioridade global para todas as OPs carregadas
  const handleBulkPriorityChange = (newP: 'Crítica' | 'Alta' | 'Normal' | 'Baixa') => {
    setDefaultPriority(newP);
    setParsedRows((prev) => prev.map((row) => ({ ...row, priority: newP })));
  };

  // Atualização inline de um campo de uma linha
  const handleUpdateRowField = (index: number, field: keyof ParsedCsvOp, value: any) => {
    setParsedRows((prev) => {
      const updated = [...prev];
      const row = { ...updated[index] };

      if (field === 'plannedQuantity') {
        const num = parseFlexibleNumber(value);
        row.plannedQuantity = num;
        row.isValid = num > 0 && Boolean(row.number) && Boolean(row.product);
        row.validationError = num <= 0 ? 'Quantidade zerada' : undefined;
      } else if (field === 'number') {
        row.number = String(value).trim();
        row.isValid = Boolean(row.number) && Boolean(row.product) && row.plannedQuantity > 0;
      } else if (field === 'product') {
        row.product = String(value).trim();
        row.isValid = Boolean(row.number) && Boolean(row.product) && row.plannedQuantity > 0;
      } else {
        (row as any)[field] = value;
      }

      updated[index] = row;
      return updated;
    });
  };

  // Excluir linha da prévia
  const handleDeleteRow = (index: number) => {
    setParsedRows((prev) => prev.filter((_, i) => i !== index));
  };

  // Adicionar linha vazia na prévia
  const handleAddManualRow = () => {
    const newRow: ParsedCsvOp = {
      id: `manual-${Date.now()}`,
      number: `OP-${Math.floor(10000 + Math.random() * 90000)}`,
      product: 'Novo Produto',
      lote: 'LT-24-001',
      plannedQuantity: 2000,
      granel: 'GR-001',
      priority: defaultPriority,
      status: 'pending',
      isValid: true,
    };
    setParsedRows((prev) => [newRow, ...prev]);
  };

  // Atualizar mapeamento de coluna
  const handleMappingChange = (field: keyof typeof columnMapping, newIdx: number) => {
    const newMapping = { ...columnMapping, [field]: newIdx };
    setColumnMapping(newMapping);
    if (rawLines.length > 0) {
      rebuildRows(rawLines, detectedSeparator, newMapping, defaultPriority);
    }
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
    link.setAttribute('download', 'modelo_estoque_ops.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const validRows = parsedRows.filter((r) => r.isValid);
  const invalidRows = parsedRows.filter((r) => !r.isValid);
  const totalVolume = validRows.reduce((acc, r) => acc + (Number(r.plannedQuantity) || 0), 0);

  const handleConfirmImport = async () => {
    if (validRows.length === 0) {
      setErrorMessage('Nenhuma OP válida pronta para importação.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const itemsToImport = validRows.map((r) => ({
        number: r.number.trim(),
        product: r.product.trim(),
        lote: (r.lote || '').trim(),
        plannedQuantity: Number(r.plannedQuantity) || 0,
        granel: (r.granel || '').trim(),
        priority: r.priority,
        status: r.status,
        lineId: null,
        packageAvailability: 10000,
      }));

      const res = await importOPsBatch(itemsToImport);
      if (res.imported && res.imported.length > 0) {
        onSuccess(res.imported);
        handleReset();
        onClose();
      } else {
        setErrorMessage('Não foi possível gravar as OPs no banco. Tente novamente.');
      }
    } catch (err: any) {
      setErrorMessage(`Erro ao importar OPs para o estoque: ${err?.message || 'Falha na gravação'}`);
    } finally {
      setIsProcessing(false);
    }
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-[#111116] border border-[#272730] w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header do Modal */}
        <div className="p-4 sm:p-5 border-b border-[#202026] flex items-center justify-between bg-[#14141a]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shadow-lg shadow-blue-900/20 shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#f4f4f5] uppercase tracking-wider">
                  Importar Produtos & OPs (Estoque)
                </h3>
                <span className="text-[10px] bg-blue-950/80 text-blue-400 border border-blue-800/40 px-2 py-0.5 rounded-full font-bold">
                  CSV / Excel
                </span>
              </div>
              <p className="text-xs text-[#71717a] mt-0.5">
                Carregue arquivos CSV, planilhas do Excel ou copie e cole direto as colunas de produção.
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
              <span className="hidden sm:inline">Modelo CSV</span>
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
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          
          {/* Tabs de Seleção: Arquivo vs Colar Texto */}
          {parsedRows.length === 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-[#242430] pb-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('upload')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-2 transition-all ${
                    activeTab === 'upload'
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40 shadow-sm'
                      : 'text-[#71717a] hover:text-white hover:bg-[#171720]'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Carregar Arquivo (.csv, .xlsx, .txt)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('paste')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-2 transition-all ${
                    activeTab === 'paste'
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40 shadow-sm'
                      : 'text-[#71717a] hover:text-white hover:bg-[#171720]'
                  }`}
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>Colar Tabela do Excel (Ctrl+V)</span>
                </button>
              </div>

              {activeTab === 'upload' ? (
                /* Caixa de Upload / Drag & Drop */
                <div
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center ${
                    dragActive
                      ? 'border-blue-500 bg-blue-600/10 scale-[0.99]'
                      : 'border-[#2c2c36] hover:border-blue-500/60 bg-[#0c0c10] hover:bg-[#121218]'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv, .txt, .tsv, text/csv, text/plain, application/vnd.ms-excel"
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
                    Suporta arquivos exportados do SAP, TOTVS Protheus, Sankhya, Excel ou qualquer planilha.
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
                      <span className="text-xs font-bold text-[#f4f4f5]">PRODUTO</span>
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
                      <span className="text-[10px] text-[#71717a] uppercase font-bold block">Coluna 6</span>
                      <span className="text-xs font-bold text-cyan-400">PRIORIDADE</span>
                    </div>
                  </div>
                </div>
              ) : (
                /* Aba: Colar Tabela do Excel */
                <div className="space-y-3 bg-[#0c0c10] border border-[#262632] p-4 rounded-2xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#f4f4f5] flex items-center gap-2">
                      <ClipboardPaste className="w-4 h-4 text-blue-400" />
                      Cole as linhas copiadas do Excel ou Bloco de Notas:
                    </span>
                    <span className="text-[11px] text-[#71717a]">
                      Copie no Excel com Ctrl+C e cole aqui com Ctrl+V
                    </span>
                  </div>

                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={`Exemplo:\nOP\tPRODUTO\tLOTE\tQUANTIDADE\tGRANEL\tPRIORIDADE\n40240\tShampoo Hidratante 500ml\tLT-24-101\t2.500\tGR-SH-910\tNormal\n40241\tCondicionador Argan 300ml\tLT-24-102\t3.000\tGR-CD-912\tAlta`}
                    rows={7}
                    className="w-full bg-[#14141a] border border-[#2e2e3e] rounded-xl p-3 text-xs font-mono text-[#f4f4f5] placeholder-[#52525b] focus:outline-none focus:border-blue-500 transition-colors resize-y"
                  />

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      disabled={!pasteText.trim()}
                      onClick={handlePasteSubmit}
                      className="h-9 px-4 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Processar Tabela Colada</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Erro de leitura */}
          {errorMessage && (
            <div className="bg-red-950/80 border border-red-800 text-red-200 p-3.5 rounded-xl text-xs flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-red-400 hover:text-white p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
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
                        {validRows.length} OPs prontas
                      </span>
                      {invalidRows.length > 0 && (
                        <span className="text-[10px] text-amber-400 bg-amber-950/70 border border-amber-800/40 px-2 py-0.2 rounded-full font-bold">
                          {invalidRows.length} ajustadas
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#71717a] mt-0.5">
                      Volume total a ser inserido:{' '}
                      <strong className="text-[#f4f4f5] font-mono">
                        {totalVolume.toLocaleString('pt-BR')} unidades
                      </strong>
                    </p>
                  </div>
                </div>

                {/* Controles: Prioridade Padrão, Mapeamento e Trocar Arquivo */}
                <div className="flex items-center gap-2 flex-wrap self-stretch md:self-auto justify-between md:justify-end border-t md:border-t-0 pt-2 md:pt-0 border-[#222228]">
                  
                  {/* Seletor de Mapeamento */}
                  {availableHeaders.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowAdvancedMapping(!showAdvancedMapping)}
                      className={`h-8 text-xs rounded-lg flex items-center gap-1.5 transition-all ${
                        showAdvancedMapping
                          ? 'bg-blue-600/20 border-blue-500/40 text-blue-400'
                          : 'bg-[#181822] hover:bg-[#20202c] border-[#2c2c3c] text-[#a1a1aa] hover:text-white'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Mapear Colunas</span>
                    </Button>
                  )}

                  {/* Prioridade Global */}
                  <div className="flex items-center gap-2 bg-[#0c0c10] border border-[#272732] rounded-xl px-2.5 py-1">
                    <span className="text-[11px] text-[#a1a1aa] font-semibold flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-blue-400" />
                      Prioridade:
                    </span>
                    <select
                      value={defaultPriority}
                      onChange={(e) => handleBulkPriorityChange(e.target.value as any)}
                      className="bg-[#17171f] border border-[#30303e] rounded-lg text-xs font-bold px-2 py-0.5 text-[#f4f4f5] focus:outline-none focus:border-blue-500 cursor-pointer"
                    >
                      {PRIORITY_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddManualRow}
                    className="h-8 text-xs bg-[#181822] hover:bg-[#222230] border-[#2e2e3e] text-emerald-400 hover:text-emerald-300 rounded-lg flex items-center gap-1"
                    title="Adicionar uma linha avulsa"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Linha</span>
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleReset}
                    className="h-8 text-xs bg-[#1a1a22] hover:bg-[#252530] border-[#2f2f3c] text-red-400 hover:text-red-300 rounded-lg flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Limpar</span>
                  </Button>
                </div>
              </div>

              {/* Mapeador de Colunas Expansível */}
              {showAdvancedMapping && availableHeaders.length > 0 && (
                <div className="bg-[#121218] border border-[#2b2b38] rounded-xl p-3.5 animate-in fade-in duration-150 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5" />
                      Mapeamento de Colunas do Arquivo:
                    </span>
                    <span className="text-[11px] text-[#71717a]">
                      Separador detectado: <strong className="text-white font-mono">{detectedSeparator === '\t' ? 'TAB (Excel)' : detectedSeparator}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                    <div>
                      <label className="text-[10px] text-[#71717a] font-bold block mb-1">Coluna OP</label>
                      <select
                        value={columnMapping.op}
                        onChange={(e) => handleMappingChange('op', Number(e.target.value))}
                        className="w-full bg-[#181820] border border-[#303040] rounded-lg p-1.5 text-xs text-white font-mono"
                      >
                        {availableHeaders.map((h, i) => (
                          <option key={i} value={i}>Col {i + 1}: {h || `(Vazia ${i+1})`}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-[#71717a] font-bold block mb-1">Coluna PRODUTO</label>
                      <select
                        value={columnMapping.product}
                        onChange={(e) => handleMappingChange('product', Number(e.target.value))}
                        className="w-full bg-[#181820] border border-[#303040] rounded-lg p-1.5 text-xs text-white font-mono"
                      >
                        {availableHeaders.map((h, i) => (
                          <option key={i} value={i}>Col {i + 1}: {h || `(Vazia ${i+1})`}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-[#71717a] font-bold block mb-1">Coluna LOTE</label>
                      <select
                        value={columnMapping.lote}
                        onChange={(e) => handleMappingChange('lote', Number(e.target.value))}
                        className="w-full bg-[#181820] border border-[#303040] rounded-lg p-1.5 text-xs text-white font-mono"
                      >
                        <option value={-1}>-- Ignorar / Em Branco --</option>
                        {availableHeaders.map((h, i) => (
                          <option key={i} value={i}>Col {i + 1}: {h || `(Vazia ${i+1})`}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-[#71717a] font-bold block mb-1">Coluna QUANTIDADE</label>
                      <select
                        value={columnMapping.quantity}
                        onChange={(e) => handleMappingChange('quantity', Number(e.target.value))}
                        className="w-full bg-[#181820] border border-[#303040] rounded-lg p-1.5 text-xs text-white font-mono"
                      >
                        {availableHeaders.map((h, i) => (
                          <option key={i} value={i}>Col {i + 1}: {h || `(Vazia ${i+1})`}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-[#71717a] font-bold block mb-1">Coluna GRANEL</label>
                      <select
                        value={columnMapping.granel}
                        onChange={(e) => handleMappingChange('granel', Number(e.target.value))}
                        className="w-full bg-[#181820] border border-[#303040] rounded-lg p-1.5 text-xs text-white font-mono"
                      >
                        <option value={-1}>-- Ignorar / Em Branco --</option>
                        {availableHeaders.map((h, i) => (
                          <option key={i} value={i}>Col {i + 1}: {h || `(Vazia ${i+1})`}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-[#71717a] font-bold block mb-1">Coluna PRIORIDADE</label>
                      <select
                        value={columnMapping.priority}
                        onChange={(e) => handleMappingChange('priority', Number(e.target.value))}
                        className="w-full bg-[#181820] border border-[#303040] rounded-lg p-1.5 text-xs text-white font-mono"
                      >
                        <option value={-1}>-- Padrão ({defaultPriority}) --</option>
                        {availableHeaders.map((h, i) => (
                          <option key={i} value={i}>Col {i + 1}: {h || `(Vazia ${i+1})`}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabela Editável de Pré-Visualização */}
              <div className="bg-[#0e0e12] border border-[#222228] rounded-xl overflow-hidden shadow-xl max-h-[44vh] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#17171d] text-[#71717a] uppercase font-bold text-[10px] tracking-wider border-b border-[#24242c] sticky top-0 z-10">
                    <tr>
                      <th className="py-2.5 px-3 w-10">#</th>
                      <th className="py-2.5 px-3 min-w-[110px]">OP</th>
                      <th className="py-2.5 px-3 min-w-[200px]">Nome do Produto</th>
                      <th className="py-2.5 px-3 min-w-[110px]">Lote</th>
                      <th className="py-2.5 px-3 min-w-[110px] text-right">Qtd (un)</th>
                      <th className="py-2.5 px-3 min-w-[100px]">Granel</th>
                      <th className="py-2.5 px-3 min-w-[110px]">Prioridade</th>
                      <th className="py-2.5 px-2 text-center w-12">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e1e24]">
                    {parsedRows.map((row, idx) => (
                      <tr
                        key={row.id || idx}
                        className={`transition-colors group ${
                          !row.isValid
                            ? 'bg-amber-950/15 text-amber-200'
                            : 'hover:bg-[#14141a]'
                        }`}
                      >
                        <td className="py-2 px-3 text-[#71717a] font-mono text-[11px]">
                          {idx + 1}
                        </td>

                        {/* Input editável: OP */}
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={row.number}
                            onChange={(e) => handleUpdateRowField(idx, 'number', e.target.value)}
                            className="w-full bg-[#15151c] border border-transparent group-hover:border-[#2a2a38] focus:border-blue-500 rounded px-2 py-1 font-mono font-bold text-blue-400 text-xs focus:outline-none"
                            placeholder="Nº OP"
                          />
                        </td>

                        {/* Input editável: Produto */}
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={row.product}
                            onChange={(e) => handleUpdateRowField(idx, 'product', e.target.value)}
                            className="w-full bg-[#15151c] border border-transparent group-hover:border-[#2a2a38] focus:border-blue-500 rounded px-2 py-1 font-semibold text-[#f4f4f5] text-xs focus:outline-none"
                            placeholder="Descrição do Produto"
                          />
                        </td>

                        {/* Input editável: Lote */}
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={row.lote}
                            onChange={(e) => handleUpdateRowField(idx, 'lote', e.target.value)}
                            className="w-full bg-[#15151c] border border-transparent group-hover:border-[#2a2a38] focus:border-emerald-500 rounded px-2 py-1 font-mono text-emerald-400 text-xs focus:outline-none"
                            placeholder="Lote"
                          />
                        </td>

                        {/* Input editável: Quantidade */}
                        <td className="py-1.5 px-2 text-right">
                          <input
                            type="number"
                            value={row.plannedQuantity}
                            onChange={(e) => handleUpdateRowField(idx, 'plannedQuantity', e.target.value)}
                            className="w-full bg-[#15151c] border border-transparent group-hover:border-[#2a2a38] focus:border-purple-500 rounded px-2 py-1 font-mono font-bold text-right text-purple-300 text-xs focus:outline-none"
                            placeholder="0"
                          />
                        </td>

                        {/* Input editável: Granel */}
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={row.granel}
                            onChange={(e) => handleUpdateRowField(idx, 'granel', e.target.value)}
                            className="w-full bg-[#15151c] border border-transparent group-hover:border-[#2a2a38] focus:border-amber-500 rounded px-2 py-1 font-mono text-amber-400 text-xs focus:outline-none"
                            placeholder="Granel"
                          />
                        </td>
                        
                        {/* Seletor de Prioridade */}
                        <td className="py-1.5 px-2">
                          <select
                            value={row.priority}
                            onChange={(e) => handleUpdateRowField(idx, 'priority', e.target.value)}
                            className={`text-[11px] font-bold rounded-lg px-2 py-1 border cursor-pointer focus:outline-none transition-colors w-full ${getPriorityBadgeClass(row.priority)}`}
                          >
                            <option value="Normal" className="bg-[#121218] text-blue-400 font-bold">Normal</option>
                            <option value="Alta" className="bg-[#121218] text-amber-400 font-bold">Alta</option>
                            <option value="Crítica" className="bg-[#121218] text-red-400 font-bold">Crítica</option>
                            <option value="Baixa" className="bg-[#121218] text-zinc-400 font-semibold">Baixa</option>
                          </select>
                        </td>

                        {/* Ação Excluir */}
                        <td className="py-1.5 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(idx)}
                            className="text-[#71717a] hover:text-red-400 p-1 rounded hover:bg-red-950/30 transition-colors"
                            title="Remover linha"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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
            <span>As OPs serão gravadas no Estoque de OPs para posterior atribuição às linhas de envase.</span>
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
                      : 'Nenhuma OP Pronta'}
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
