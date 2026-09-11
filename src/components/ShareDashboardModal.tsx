import React, { useState, useEffect } from 'react';
import { 
  Share2, 
  Copy, 
  Check, 
  ExternalLink, 
  Eye, 
  ShieldCheck, 
  Tv, 
  Radio, 
  X,
  Sparkles,
  Lock
} from 'lucide-react';
import { Button } from './ui/button';

interface ShareDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShareDashboardModal({ isOpen, onClose }: ShareDashboardModalProps) {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      // Define a URL direta do visualizador público
      setShareUrl(`${origin}/view`);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard && shareUrl) {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      }
    } catch (err) {
      console.warn('Erro ao copiar link:', err);
    }
  };

  const handleOpenPreview = () => {
    if (shareUrl) {
      window.open(shareUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div 
      id="share-dashboard-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div 
        className="bg-[#121216] border border-[#272732] rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho do Modal */}
        <div className="p-5 border-b border-[#20202a] flex items-center justify-between bg-gradient-to-r from-blue-950/40 via-transparent to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-[#f4f4f5] flex items-center gap-2">
                Link de Visualização Pública
                <span className="text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded-full font-bold">
                  Somente Leitura
                </span>
              </h3>
              <p className="text-xs text-[#71717a] mt-0.5">
                Compartilhe o Dashboard Geral com diretores e equipes sem exigir login
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#71717a] hover:text-white hover:bg-[#1e1e28] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo do Modal */}
        <div className="p-5 space-y-5 overflow-y-auto">
          
          {/* Caixa do Link Gerado */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-[#a1a1aa] uppercase tracking-wider flex items-center justify-between">
              <span>Link de Acesso Direto</span>
              <span className="text-[10px] text-blue-400 font-normal lowercase">não requer senha</span>
            </label>

            <div className="flex items-center gap-2">
              <div className="flex-1 bg-[#171720] border border-[#2a2a38] rounded-xl px-3.5 py-2.5 text-xs text-[#f4f4f5] font-mono select-all truncate">
                {shareUrl || 'Gerando link...'}
              </div>

              <Button
                id="btn-copy-share-url"
                type="button"
                onClick={handleCopyLink}
                className={`h-10 px-4 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shrink-0 ${
                  copied
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copiar</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Destaques de Segurança e Funcionamento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            
            <div className="bg-[#171720] border border-[#232330] rounded-2xl p-3.5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-950/60 border border-emerald-800/40 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="text-left">
                <h4 className="text-xs font-bold text-[#f4f4f5]">100% Protegido</h4>
                <p className="text-[11px] text-[#71717a] mt-0.5">
                  Quem acessar só pode visualizar os gráficos. Não há permissão para editar, criar OPs ou ver usuários.
                </p>
              </div>
            </div>

            <div className="bg-[#171720] border border-[#232330] rounded-2xl p-3.5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-blue-950/60 border border-blue-800/40 flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
                <Radio className="w-4 h-4" />
              </div>
              <div className="text-left">
                <h4 className="text-xs font-bold text-[#f4f4f5]">Ao Vivo & Automático</h4>
                <p className="text-[11px] text-[#71717a] mt-0.5">
                  Conexão direta com Supabase Realtime. Atualiza números e status automaticamente sem precisar recarregar.
                </p>
              </div>
            </div>

            <div className="bg-[#171720] border border-[#232330] rounded-2xl p-3.5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-purple-950/60 border border-purple-800/40 flex items-center justify-center text-purple-400 shrink-0 mt-0.5">
                <Tv className="w-4 h-4" />
              </div>
              <div className="text-left">
                <h4 className="text-xs font-bold text-[#f4f4f5]">Ideal para Telas e TV</h4>
                <p className="text-[11px] text-[#71717a] mt-0.5">
                  Interface limpa com botão de tela cheia, ideal para projetar no chão de fábrica ou salas de reuniões.
                </p>
              </div>
            </div>

            <div className="bg-[#171720] border border-[#232330] rounded-2xl p-3.5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-cyan-950/60 border border-cyan-800/40 flex items-center justify-center text-cyan-400 shrink-0 mt-0.5">
                <Eye className="w-4 h-4" />
              </div>
              <div className="text-left">
                <h4 className="text-xs font-bold text-[#f4f4f5]">Dashboard Geral</h4>
                <p className="text-[11px] text-[#71717a] mt-0.5">
                  Exibe KPIs dos setores (Pesagem, Manipulação, Envase), os 6 cards operacionais e metas mensais.
                </p>
              </div>
            </div>

          </div>

          {/* Aviso informativo */}
          <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-800/40 text-[11px] text-blue-300 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />
            <span>
              Você pode enviar este link pelo WhatsApp, e-mail ou abrir diretamente em qualquer navegador.
            </span>
          </div>

        </div>

        {/* Rodapé do Modal */}
        <div className="p-4 border-t border-[#20202a] flex items-center justify-between bg-[#0e0e12] gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="h-10 px-4 rounded-xl border-[#2a2a38] text-[#a1a1aa] hover:text-white hover:bg-[#1c1c24] text-xs font-semibold"
          >
            Fechar
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenPreview}
              className="h-10 px-4 rounded-xl border-[#2a2a38] bg-[#171720] text-blue-400 hover:text-blue-300 hover:bg-[#20202c] text-xs font-bold flex items-center gap-2"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Testar em Nova Aba</span>
            </Button>

            <Button
              type="button"
              onClick={handleCopyLink}
              className="h-10 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-600/20"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Link Copiado!' : 'Copiar Link'}</span>
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
