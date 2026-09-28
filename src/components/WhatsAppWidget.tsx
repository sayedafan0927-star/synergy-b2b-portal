import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export const WHATSAPP_PHONE = '87785806866';
export const WHATSAPP_INTL = '77785806866';
export const WHATSAPP_DISPLAY = '+7 (778) 580-68-66';

export default function WhatsAppWidget() {
  const { t, language } = useLanguage();
  const [tooltipDismissed, setTooltipDismissed] = useState(false);

  const defaultMsg = language === 'kz'
    ? 'Сәлеметсіз бе! Synergy-Group кілемдерін көтерме сатып алу бойынша сұрағым бар еді.'
    : 'Здравствуйте! Интересуют оптовые поставки ковров Synergy-Group.';

  const waUrl = `https://wa.me/${WHATSAPP_INTL}?text=${encodeURIComponent(defaultMsg)}`;

  return (
    <aside aria-label="WhatsApp Widget" className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-40 flex items-center gap-2.5">
      {/* Tooltip hint (dismissible) */}
      {!tooltipDismissed && (
        <div className="hidden sm:flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-xl ring-1 ring-slate-200/80 animate-fade-in">
          <div className="flex flex-col">
            <span className="text-slate-900">{t('whatsapp.chat')}</span>
            <span className="text-[10px] text-emerald-600 font-normal">{t('whatsapp.online')}</span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTooltipDismissed(true);
            }}
            className="text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-100"
            title="Закрыть"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Main floating button */}
      <a
        href={waUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Написать в WhatsApp"
        className="group relative flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-emerald-500/30 transition-all duration-300 hover:scale-110 hover:bg-[#20bd5a] hover:shadow-xl hover:shadow-emerald-500/40 active:scale-95"
      >
        {/* Radar ping effect */}
        <span className="absolute -inset-1 rounded-full bg-[#25D366]/40 animate-ping opacity-60 pointer-events-none" />
        
        {/* WhatsApp Icon */}
        <svg
          className="h-7 w-7 fill-current relative z-10 transition-transform group-hover:scale-105"
          viewBox="0 0 24 24"
        >
          <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.312.045-.694.078-2.072-.495-1.748-.727-2.88-2.484-2.967-2.6-.088-.116-.708-.941-.708-1.796 0-.855.449-1.275.609-1.448.16-.173.348-.217.464-.217.116 0 .232.001.333.006.107.005.25-.041.391.298.144.347.491 1.2.534 1.288.043.088.072.189.014.305-.058.116-.087.188-.173.289l-.261.304c-.087.086-.177.18-.076.353.101.173.449.742.963 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.102-.116.435-.506.55-.68.116-.174.232-.145.39-.087s1.011.477 1.185.564.29.13.333.203c.044.073.044.42-.1.825z" />
          <path d="M12 2C6.477 2 2 6.477 2 12c0 1.891.524 3.66 1.434 5.176L2 22l4.981-1.309A9.957 9.957 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.05c-1.636 0-3.155-.469-4.442-1.28l-.318-.2-2.97.778.792-2.895-.208-.332A8.024 8.024 0 0 1 3.95 12c0-4.439 3.611-8.05 8.05-8.05s8.05 3.611 8.05 8.05-3.611 8.05-8.05 8.05z" />
        </svg>
      </a>
    </aside>
  );
}
