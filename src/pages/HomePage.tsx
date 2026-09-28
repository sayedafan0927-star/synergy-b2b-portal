import { Truck, Shield, Clock, Warehouse, ArrowRight, Package, MapPin, CalendarCheck } from 'lucide-react';
import type { PageId } from '@/types';
import { categories } from '@/data/categories';
import { useProducts } from '@/hooks/useProductData';
import ProductCard from '@/components/ProductCard';
import HeroEthnicSlider from '@/components/ethnic/HeroEthnicSlider';
import EthnicOrnamentDivider from '@/components/ethnic/EthnicOrnamentDivider';

const advantages = [
  {
    icon: Truck,
    title: 'Оптовые цены',
    description: 'Прямые поставки от производителей без посредников. Гибкая система скидок при крупных заказах.',
  },
  {
    icon: Shield,
    title: 'Гарантия качества',
    description: 'Все товары сертифицированы и проходят контроль качества. Работаем только с проверенными брендами.',
  },
  {
    icon: Clock,
    title: 'Быстрая доставка',
    description: 'Отгрузка в течение 24 часов со склада. Доставка по всему Казахстану и странам СНГ.',
  },
  {
    icon: Warehouse,
    title: 'Складские остатки',
    description: 'Более 1500 наименований всегда в наличии на трёх складах. Актуальные остатки онлайн.',
  },
];

const stats = [
  { icon: Package, value: '1500+', label: 'товаров в наличии' },
  { icon: MapPin, value: '3', label: 'склада по Казахстану' },
  { icon: CalendarCheck, value: '8+', label: 'лет на рынке' },
];

export default function HomePage({ onNavigate }: { onNavigate: (page: PageId, productId?: string) => void }) {
  const { products } = useProducts();
  const featuredProducts = products.slice(0, 4);

  return (
    <div className="pb-16 lg:pb-0">
      {/* ── Dynamic Ethnic Hero Slider with Petroglyph Vortex Canvas ── */}
      <HeroEthnicSlider onNavigate={onNavigate} />

      {/* ── Kazakh Ethnic Ornament Divider Frieze ── */}
      <EthnicOrnamentDivider />

      {/* ── Advantages Section ── */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="container-w">
          <h2 className="section-heading text-center">Почему выбирают нас</h2>
          <p className="section-subheading text-center mx-auto">
            Synergy Group — надёжный оптовый поставщик ковровых покрытий с собственными складами
          </p>

          <div className="mt-10 lg:mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {advantages.map((item) => (
              <div
                key={item.title}
                className="card p-6 text-center sm:text-left"
              >
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-50 text-brand-600 mb-4">
                  <item.icon className="h-6 w-6" />
                </div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-slate-500 font-body leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Categories Section ── */}
      <section className="py-16 lg:py-24 bg-slate-50">
        <div className="container-w">
          <h2 className="section-heading text-center">Категории</h2>
          <p className="section-subheading text-center mx-auto">
            Подберите ковровое покрытие по типу и стилю для любого интерьера
          </p>

          <div className="mt-10 lg:mt-14 grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => onNavigate('catalog')}
                className="group relative aspect-[4/3] overflow-hidden rounded-2xl"
              >
                <img
                  src={category.image}
                  alt={category.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/70 via-slate-900/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                  <h3 className="font-display text-base sm:text-lg font-semibold text-white">
                    {category.name}
                  </h3>
                  <p className="mt-0.5 text-xs sm:text-sm text-slate-300 font-body">
                    {category.count} товаров
                  </p>
                </div>
                <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center opacity-0 translate-x-2 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0">
                  <ArrowRight className="h-4 w-4 text-white" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Featured Products Section ── */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="container-w">
          <div className="flex items-end justify-between mb-10 lg:mb-14">
            <div>
              <h2 className="section-heading">Популярные товары</h2>
              <p className="section-subheading">
                Самые востребованные ковры из нашего каталога
              </p>
            </div>
            <button
              onClick={() => onNavigate('catalog')}
              className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
            >
              Смотреть все
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {featuredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onNavigate={onNavigate}
              />
            ))}
          </div>

          <div className="mt-8 text-center sm:hidden">
            <button
              onClick={() => onNavigate('catalog')}
              className="btn-primary inline-flex items-center gap-2"
            >
              Смотреть все
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* ── CTA Banner Section ── */}
      <section className="py-16 lg:py-24">
        <div className="container-w">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-brand-700 to-brand-800 px-6 py-12 sm:px-12 sm:py-16 lg:px-16 lg:py-20 text-center">
            {/* Decorative shapes */}
            <div className="absolute top-0 right-0 -translate-y-1/3 translate-x-1/3 h-64 w-64 rounded-full bg-white/5" />
            <div className="absolute bottom-0 left-0 translate-y-1/3 -translate-x-1/3 h-48 w-48 rounded-full bg-white/5" />

            <div className="relative max-w-2xl mx-auto">
              <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight">
                Станьте нашим партнёром
              </h2>
              <p className="mt-4 text-base sm:text-lg text-brand-100 font-body leading-relaxed">
                Специальные условия для оптовых покупателей: эксклюзивные цены, персональный менеджер,
                приоритетная отгрузка и отсрочка платежа.
              </p>
              <button
                onClick={() => onNavigate('contacts')}
                className="btn-accent mt-8 inline-flex items-center gap-2 text-base"
              >
                Оставить заявку
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
