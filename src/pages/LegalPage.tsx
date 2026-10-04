import { useState, useEffect } from 'react';
import { ArrowLeft, RotateCcw, Truck, ShieldCheck, FileText, CheckCircle2, Clock, MapPin, Building, CreditCard } from 'lucide-react';
import type { PageId } from '@/types';

export type LegalDocType = 'delivery' | 'returns' | 'privacy' | 'terms';

interface LegalPageProps {
  initialDoc?: LegalDocType;
  onNavigate: (page: PageId) => void;
}

const COMPANY_INFO = {
  name: 'ТОО «Синэнергия Груп»',
  bin: '250140013808',
  regDate: '15.01.2025',
  legalAddress: 'Республика Казахстан, г. Астана, район Байконыр, шоссе Алаш, здание 13, индекс 010000',
  warehouseAddress: 'Республика Казахстан, г. Астана, шоссе Астана-Караганда, 39/1',
  phone: '+7 (778) 580-68-66',
  email: 'synergiya.group@gmail.com',
  workingHours: 'Пн — Пт: 09:00 — 17:00, Сб — Вс: выходной',
};

export default function LegalPage({ initialDoc = 'returns', onNavigate }: LegalPageProps) {
  const [activeDoc, setActiveDoc] = useState<LegalDocType>(initialDoc);

  useEffect(() => {
    if (initialDoc) setActiveDoc(initialDoc);
  }, [initialDoc]);

  const navDoc = (doc: LegalDocType) => {
    setActiveDoc(doc);
    onNavigate(doc);
  };

  const tabs: Array<{ id: LegalDocType; label: string; icon: any }> = [
    { id: 'returns', label: 'Возврат и обмен (14 дней)', icon: RotateCcw },
    { id: 'delivery', label: 'Доставка и оплата', icon: Truck },
    { id: 'privacy', label: 'Конфиденциальность и Cookies', icon: ShieldCheck },
    { id: 'terms', label: 'Публичная оферта', icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-slate-50 pt-20 pb-24 lg:pb-12">
      <div className="container-w py-6 sm:py-8 max-w-5xl">
        {/* Back navigation */}
        <button
          onClick={() => onNavigate('home')}
          className="mb-6 inline-flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-500 hover:text-brand-700 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>На главную</span>
        </button>

        {/* Tab switch pills */}
        <div className="mb-8 flex overflow-x-auto no-scrollbar gap-2 p-1.5 bg-slate-200/60 rounded-2xl">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => navDoc(id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap cursor-pointer shrink-0 ${
                activeDoc === id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0 text-brand-600" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Document Content Card */}
        <div className="card p-6 sm:p-10 bg-white border border-slate-200/80 shadow-xs space-y-8">
          {activeDoc === 'returns' && (
            <article className="space-y-6 text-slate-700">
              <div className="border-b border-slate-100 pb-5">
                <span className="text-xs font-bold uppercase tracking-wider text-brand-700">Закон РК «О защите прав потребителей»</span>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1">Политика возврата и обмена товаров</h1>
                <p className="text-sm text-slate-500 mt-1">Регламент возврата и гарантийных обязательств компании {COMPANY_INFO.name}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm mb-1">
                    <Clock className="h-4 w-4" />
                    <span>Срок возврата — 14 дней</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Покупатель вправе обменять или вернуть товар надлежащего качества в течение 14 календарных дней с даты фактического получения.
                  </p>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                  <div className="flex items-center gap-2 text-blue-800 font-bold text-sm mb-1">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Возврат средств: 3–5 дней</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Денежные средства возвращаются безналичным расчётом на расчётный счет или карту покупателя в срок от 3 до 5 банковских дней.
                  </p>
                </div>
              </div>

              <section className="space-y-3">
                <h2 className="text-lg font-bold text-slate-900">1. Условия возврата качественного товара</h2>
                <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-600">
                  <li>Товар не был в употреблении, сохранены его первоначальный товарный вид, потребительские свойства, фабричные ярлыки и пломбы.</li>
                  <li>Сохранена оригинальная защитная упаковка рулона/ковра, отсутствуют следы механических повреждений, загрязнений, заломов ворса или запахов.</li>
                  <li>Имеется документ, подтверждающий факт приобретения (накладная, электронная счет-фактура или номер заказа на портале).</li>
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-bold text-slate-900">2. Оплата транспортных расходов при возврате</h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  <strong>Возврат товара надлежащего качества:</strong> транспортные расходы по доставке ковра на центральный склад в г. Астана несёт покупатель.<br />
                  <strong>Возврат при производственном браке:</strong> в случае выявления дефекта или несоответствия заказу все расходы на обратную транспортировку, замену и повторную доставку берет на себя {COMPANY_INFO.name}.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-bold text-slate-900">3. Порядок оформления возврата</h2>
                <ol className="list-decimal pl-5 space-y-1.5 text-sm text-slate-600">
                  <li>Свяжитесь с вашим менеджером по телефону {COMPANY_INFO.phone} или отправьте заявление на {COMPANY_INFO.email}.</li>
                  <li>Передайте товар на центральный склад компании по адресу: {COMPANY_INFO.warehouseAddress}.</li>
                  <li>После приёмки товара экспертом склада и проверки товарного вида осуществляется возврат денежных средств.</li>
                </ol>
              </section>
            </article>
          )}

          {activeDoc === 'delivery' && (
            <article className="space-y-6 text-slate-700">
              <div className="border-b border-slate-100 pb-5">
                <span className="text-xs font-bold uppercase tracking-wider text-brand-700">Логистика и расчёты</span>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1">Условия доставки и способы оплаты</h1>
                <p className="text-sm text-slate-500 mt-1">Регламент отгрузок со склада в Астане и региональной доставки по Республике Казахстан</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center gap-2 text-slate-900 font-bold text-sm mb-1">
                    <MapPin className="h-4 w-4 text-brand-600" />
                    <span>Центральный склад в Астане</span>
                  </div>
                  <p className="text-xs text-slate-600">{COMPANY_INFO.warehouseAddress}. Экспресс-самовывоз бесплатно в день заказа.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center gap-2 text-slate-900 font-bold text-sm mb-1">
                    <CreditCard className="h-4 w-4 text-brand-600" />
                    <span>Официальные способы расчёта</span>
                  </div>
                  <p className="text-xs text-slate-600">Безналичный платёж с ЭСФ, Kaspi QR, оплата банковскими картами.</p>
                </div>
              </div>

              <section className="space-y-3">
                <h2 className="text-lg font-bold text-slate-900">1. Варианты и сроки доставки</h2>
                <div className="space-y-3 text-sm text-slate-600">
                  <div className="p-3.5 rounded-lg border border-slate-100 bg-slate-50">
                    <p className="font-semibold text-slate-900">Самовывоз со склада (г. Астана):</p>
                    <p className="text-xs mt-0.5">Бесплатно. Комплектация заказа от 1 часа. График: {COMPANY_INFO.workingHours}.</p>
                  </div>
                  <div className="p-3.5 rounded-lg border border-slate-100 bg-slate-50">
                    <p className="font-semibold text-slate-900">Доставка по г. Астана:</p>
                    <p className="text-xs mt-0.5">Курьерской службой в течение 1–2 рабочих дней до двери или торгового объекта.</p>
                  </div>
                  <div className="p-3.5 rounded-lg border border-slate-100 bg-slate-50">
                    <p className="font-semibold text-slate-900">Доставка по городам Казахстана:</p>
                    <p className="text-xs mt-0.5">Транспортными компаниями (Jet Logistic, DPD, ABT, Казпочта) от 3 до 7 рабочих дней. Отгрузка до терминала ТК в день подтверждения оплаты.</p>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-bold text-slate-900">2. Тарифы на транспортировку</h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Стоимость межрегиональной доставки рассчитывается индивидуально исходя из веса рулона, его линейных габаритов и удалённости населённого пункта. При крупных оптовых заказах доставка до терминала транспортной компании осуществляется бесплатно.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-bold text-slate-900">3. Формы оплаты</h2>
                <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-600">
                  <li><strong>Безналичный расчёт для юридических лиц и ИП:</strong> оплата по официальному банковскому счёту с выставлением ЭСФ, акта выполненных работ и накладных.</li>
                  <li><strong>Kaspi QR / Kaspi Pay:</strong> моментальная онлайн-оплата с фискальным чеком.</li>
                  <li><strong>Банковские карты:</strong> Visa, MasterCard через платёжный шлюз банка.</li>
                </ul>
              </section>
            </article>
          )}

          {activeDoc === 'privacy' && (
            <article className="space-y-6 text-slate-700">
              <div className="border-b border-slate-100 pb-5">
                <span className="text-xs font-bold uppercase tracking-wider text-brand-700">Закон РК «О персональных данных и их защите»</span>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1">Политика конфиденциальности и Cookies</h1>
                <p className="text-sm text-slate-500 mt-1">Правила обработки персональных данных и применения файлов cookie компанией {COMPANY_INFO.name}</p>
              </div>

              <section className="space-y-3">
                <h2 className="text-lg font-bold text-slate-900">1. Общие положения</h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Настоящая Политика определяет порядок обработки и защиты персональной информации пользователей B2B-портала {COMPANY_INFO.name} (БИН {COMPANY_INFO.bin}). Мы соблюдаем требования законодательства Республики Казахстан и международных стандартов безопасности.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-bold text-slate-900">2. Какие данные собираются</h2>
                <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-600">
                  <li>Имя, контактный номер телефона, адрес электронной почты ответственного лица.</li>
                  <li>Реквизиты компании-контрагента (наименование, БИН/ИИН, юридический и фактический адрес доставки).</li>
                  <li>История заказов, составленные заявки и параметры резервирования складских остатков.</li>
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-bold text-slate-900">3. Использование файлов Cookie</h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Портал использует технические, аналитические и сессионные файлы cookie для:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                  <li>Сохранения содержимого корзины и выбранных фильтров каталога ковров.</li>
                  <li>Безопасной авторизации в личном кабинете дилера.</li>
                  <li>Аналитики качества работы веб-ресурса (Google Analytics / Яндекс.Метрика).</li>
                </ul>
                <p className="text-xs text-slate-500">
                  Пользователь может отключить поддержку cookies в настройках своего интернет-браузера, однако в этом случае функционал корзины может работать некорректно.
                </p>
              </section>
            </article>
          )}

          {activeDoc === 'terms' && (
            <article className="space-y-6 text-slate-700">
              <div className="border-b border-slate-100 pb-5">
                <span className="text-xs font-bold uppercase tracking-wider text-brand-700">Юридический договор</span>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1">Публичная оферта на поставку ковровых изделий</h1>
                <p className="text-sm text-slate-500 mt-1">Условия поставки ковровых покрытий юридическим лицам и индивидуальным предпринимателям</p>
              </div>

              <section className="space-y-3">
                <h2 className="text-lg font-bold text-slate-900">1. Предмет договора</h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Поставщик ({COMPANY_INFO.name}) обязуется поставить, а Покупатель — принять и оплатить ковровые изделия в ассортименте, количестве и по ценам, зафиксированным в оформленном заказе на портале либо в договоре поставки 1С:ERP.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-bold text-slate-900">2. Момент заключения договора</h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Акцептом настоящей публичной оферты является подтверждение заказа покупателем через B2B-портал либо оплата выставленного счета на оплату.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-bold text-slate-900">3. Качество и приёмка товара</h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Качество поставляемой продукции соответствует стандартам заводов-изготовителей. Приёмка по количеству и качеству производится в момент получения товара на складе Поставщика либо в терминале транспортной компании.
                </p>
              </section>
            </article>
          )}

          {/* Legal Requisites Box */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 sm:p-6 space-y-3 mt-8">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Building className="h-4 w-4 text-brand-600" />
              <span>Официальные реквизиты компании</span>
            </div>
            <div className="grid gap-2 text-xs sm:text-sm text-slate-600 sm:grid-cols-2">
              <div><strong className="text-slate-900">Компания:</strong> {COMPANY_INFO.name}</div>
              <div><strong className="text-slate-900">БИН:</strong> {COMPANY_INFO.bin}</div>
              <div><strong className="text-slate-900">Дата регистрации:</strong> {COMPANY_INFO.regDate}</div>
              <div><strong className="text-slate-900">Телефон:</strong> {COMPANY_INFO.phone}</div>
              <div className="sm:col-span-2"><strong className="text-slate-900">Юр. адрес:</strong> {COMPANY_INFO.legalAddress}</div>
              <div className="sm:col-span-2"><strong className="text-slate-900">Склад:</strong> {COMPANY_INFO.warehouseAddress}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
