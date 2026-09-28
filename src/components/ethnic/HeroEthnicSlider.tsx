import { useState, useEffect, useRef } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Package, MapPin, CalendarCheck, Sparkles, Building2, Truck } from 'lucide-react';
import type { PageId } from '@/types';
import PetroglyphVortexCanvas from './PetroglyphVortexCanvas';

interface HeroEthnicSliderProps {
  onNavigate: (page: PageId, productId?: string) => void;
}

const stats = [
  { icon: Package, value: '1500+', label: 'товаров в наличии' },
  { icon: MapPin, value: '3', label: 'склада по Казахстану' },
  { icon: CalendarCheck, value: '8+', label: 'лет на рынке' },
];

export default function HeroEthnicSlider({ onNavigate }: HeroEthnicSliderProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const slidesCount = 3;

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % slidesCount);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + slidesCount) % slidesCount);
  };

  useEffect(() => {
    if (isPaused) return;
    // Auto-advance slides every 12 seconds (longer time to enjoy the vortex animation!)
    timerRef.current = setTimeout(nextSlide, 12000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [currentSlide, isPaused]);

  return (
    <section
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="relative min-h-[640px] lg:min-h-[760px] flex items-center pt-16 overflow-hidden bg-slate-950"
    >
      {/* ── Background Ambience Layer ── */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Subtle Kazakh geometric watermark pattern in deep background */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: `url(/ethnic/ornament_single_alpha.png)`,
            backgroundSize: '160px 110px',
            backgroundRepeat: 'repeat',
            filter: 'invert(1)',
          }}
        />
        {/* Subtle radial lighting */}
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full bg-brand-600/10 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] rounded-full bg-amber-500/10 blur-[140px]" />
      </div>

      <div className="relative container-w py-12 lg:py-20 z-10 w-full">
        {/* ── SLIDE 1: Степной вихрь времени и наскальные рисунки ── */}
        <div
          className={`transition-all duration-700 ${
            currentSlide === 0 ? 'block opacity-100' : 'hidden opacity-0'
          }`}
        >
          <div className="grid lg:grid-cols-[1.05fr,1fr] gap-10 lg:gap-12 items-center">
            {/* Left Content */}
            <div className="max-w-2xl">
              {/* Steppe Heritage Badge */}
              <div className="inline-flex items-center gap-2.5 rounded-full bg-white/10 backdrop-blur-md border border-amber-500/30 pl-3 pr-4 py-1.5 mb-6 shadow-lg shadow-amber-950/20">
                <img
                  src="/ethnic/ornament_single_alpha.png"
                  alt=""
                  className="h-4 w-auto brightness-0 invert opacity-90"
                />
                <span className="text-xs font-semibold text-amber-300 tracking-wider uppercase">
                  Наследие Великой Степи & Современность
                </span>
              </div>

              <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold text-white leading-tight">
                Оптовые поставки
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-brand-300 to-amber-200">
                  ковровых покрытий
                </span>
              </h1>

              <p className="mt-4 sm:mt-6 text-base sm:text-lg text-slate-300 font-body leading-relaxed max-w-xl">
                От 3000-летних традиций степного искусства и наскальных рисунков Тамгалы до роскошных
                шедевров Турции, Бельгии и Ирана. Прямые поставки без посредников.
              </p>

              {/* CTAs */}
              <div className="mt-8 flex flex-wrap gap-3 sm:gap-4">
                <button
                  onClick={() => onNavigate('catalog')}
                  className="btn-primary inline-flex items-center justify-center gap-2 shadow-lg shadow-brand-900/30"
                >
                  Перейти в каталог
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onNavigate('contacts')}
                  className="btn-secondary border-amber-500/30 bg-white/5 text-amber-200 backdrop-blur-sm hover:bg-white/15 inline-flex items-center justify-center gap-2"
                >
                  Связаться с нами
                </button>
              </div>

              {/* Stats Row */}
              <div className="mt-12 grid grid-cols-3 gap-4 sm:gap-8 max-w-lg pt-6 border-t border-white/10">
                {stats.map((stat) => (
                  <div key={stat.label} className="text-center sm:text-left">
                    <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
                      <stat.icon className="h-4 w-4 text-amber-400 hidden sm:block" />
                      <span className="font-display text-2xl sm:text-3xl font-bold text-white">
                        {stat.value}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-400 font-body">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: The Interactive Petroglyph Vortex Canvas */}
            <div className="w-full">
              <PetroglyphVortexCanvas />
            </div>
          </div>
        </div>

        {/* ── SLIDE 2: Премиальные коллекции мировых брендов ── */}
        <div
          className={`transition-all duration-700 ${
            currentSlide === 1 ? 'block opacity-100' : 'hidden opacity-0'
          }`}
        >
          <div className="grid lg:grid-cols-[1fr,1.05fr] gap-10 lg:gap-14 items-center">
            {/* Left Content */}
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-brand-500/20 backdrop-blur-md border border-brand-400/30 px-3.5 py-1.5 mb-6 text-brand-300 text-xs font-semibold tracking-wide uppercase">
                <Sparkles className="h-3.5 w-3.5 text-brand-400" />
                Эксклюзивный ассортимент
              </div>

              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight">
                Коллекции 2026:
                <span className="block text-brand-400">Турция, Бельгия, Иран</span>
              </h2>

              <p className="mt-4 sm:mt-6 text-base sm:text-lg text-slate-300 font-body leading-relaxed">
                Шелковистая вискоза, премиальный жаккард, бамбуковый шелк и высокоплотная шерсть.
                Прямой импорт с фабрик-производителей для ваших розничных магазинов и дизайн-проектов.
              </p>

              {/* Collection highlights */}
              <div className="mt-6 grid grid-cols-2 gap-3 text-xs sm:text-sm text-slate-300">
                <div className="flex items-center gap-2 bg-white/5 rounded-lg p-2.5 border border-white/10">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  Плотность до 1.5 млн узлов/м²
                </div>
                <div className="flex items-center gap-2 bg-white/5 rounded-lg p-2.5 border border-white/10">
                  <span className="w-2 h-2 rounded-full bg-brand-400" />
                  Более 40 эксклюзивных дизайнов
                </div>
                <div className="flex items-center gap-2 bg-white/5 rounded-lg p-2.5 border border-white/10">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Эко-сертификаты Oeko-Tex
                </div>
                <div className="flex items-center gap-2 bg-white/5 rounded-lg p-2.5 border border-white/10">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  Ковры и рулонные дорожки
                </div>
              </div>

              <div className="mt-8 flex gap-4">
                <button
                  onClick={() => onNavigate('catalog')}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  Смотреть коллекции
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Right: Layered Luxury Carpet & Kazakh Ornament Showcase */}
            <div className="relative flex items-center justify-center p-4">
              {/* Decorative Kazakh corner ornaments */}
              <img
                src="/ethnic/diamond_ornament_1_gold.png"
                alt=""
                className="absolute -top-3 -left-3 w-12 h-12 object-contain opacity-70 z-20"
              />
              <img
                src="/ethnic/diamond_ornament_1_gold.png"
                alt=""
                className="absolute -bottom-3 -right-3 w-12 h-12 object-contain opacity-70 z-20"
              />

              <div className="relative w-full max-w-lg h-[340px] sm:h-[400px] rounded-2xl overflow-hidden shadow-2xl border border-white/15 bg-gradient-to-tr from-slate-900 to-brand-950">
                <img
                  src="https://images.pexels.com/photos/6580227/pexels-photo-6580227.jpeg?auto=compress&cs=tinysrgb&w=1200"
                  alt="Премиальные ковры"
                  className="w-full h-full object-cover opacity-85 hover:scale-105 transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent" />

                {/* Floating pill badges on carpet */}
                <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between">
                  <div className="px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/20 text-xs text-white">
                    Коллекция: <span className="text-amber-300 font-semibold">AFGAN & HYPNOSE</span>
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-brand-700/80 backdrop-blur-md text-xs font-medium text-white shadow-md">
                    В наличии на складе
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── SLIDE 3: Складская сеть и оперативная логистика ── */}
        <div
          className={`transition-all duration-700 ${
            currentSlide === 2 ? 'block opacity-100' : 'hidden opacity-0'
          }`}
        >
          <div className="grid lg:grid-cols-[1fr,1fr] gap-10 lg:gap-14 items-center">
            {/* Left Content */}
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 backdrop-blur-md border border-emerald-400/30 px-3.5 py-1.5 mb-6 text-emerald-300 text-xs font-semibold tracking-wide uppercase">
                <Truck className="h-3.5 w-3.5 text-emerald-400" />
                Собственная логистическая сеть
              </div>

              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight">
                Отгрузка со складов
                <span className="block text-emerald-400">в течение 24 часов</span>
              </h2>

              <p className="mt-4 sm:mt-6 text-base sm:text-lg text-slate-300 font-body leading-relaxed">
                Собственные современные логистические комплексы в ключевых регионах Казахстана.
                Синхронизация складских остатков в реальном времени, быстрая комплектация и доставка в любую точку страны.
              </p>

              <div className="mt-8 flex gap-4">
                <button
                  onClick={() => onNavigate('catalog')}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  Проверить остатки
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onNavigate('contacts')}
                  className="btn-secondary border-emerald-500/30 bg-white/5 text-emerald-200 hover:bg-white/15"
                >
                  Адреса складов
                </button>
              </div>
            </div>

            {/* Right: Interactive Logistics Hubs Card */}
            <div className="grid gap-3.5 max-w-lg w-full">
              {[
                {
                  city: 'Алматы',
                  role: 'Центральный распределительный склад',
                  stock: '950+ наименований',
                  status: 'Отгрузка 24/7',
                  icon: Building2,
                  active: true,
                },
                {
                  city: 'Астана',
                  role: 'Северный региональный хаб',
                  stock: '420+ наименований',
                  status: 'Экспресс-доставка',
                  icon: Building2,
                  active: false,
                },
                {
                  city: 'Шымкент',
                  role: 'Южный логистический комплекс',
                  stock: '280+ наименований',
                  status: 'Прямой транзит',
                  icon: Building2,
                  active: false,
                },
              ].map((wh) => (
                <div
                  key={wh.city}
                  className="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 backdrop-blur-md transition-all group"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                      <wh.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-white font-semibold text-base flex items-center gap-2">
                        {wh.city}
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      </h4>
                      <p className="text-xs text-slate-400">{wh.role}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-semibold text-emerald-300 block">{wh.stock}</span>
                    <span className="text-[10px] text-slate-400">{wh.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Slide Navigation Controls ── */}
        <div className="mt-8 lg:mt-12 flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-white/10">
          {/* Slide Tab Buttons */}
          <div className="flex items-center gap-2 sm:gap-3">
            {[
              { id: 0, title: '01 Наследие степи (Вихрь)', icon: Sparkles },
              { id: 1, title: '02 Коллекции 2026', icon: Package },
              { id: 2, title: '03 Склады и опт 24/7', icon: Truck },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCurrentSlide(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  currentSlide === tab.id
                    ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 shadow-sm'
                    : 'text-slate-400 hover:text-white bg-white/5 border border-transparent'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.title}</span>
                <span className="sm:hidden">{tab.id + 1}</span>
              </button>
            ))}
          </div>

          {/* Arrows */}
          <div className="flex items-center gap-2">
            <button
              onClick={prevSlide}
              aria-label="Предыдущий слайд"
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white transition-all border border-white/10"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={nextSlide}
              aria-label="Следующий слайд"
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white transition-all border border-white/10"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
