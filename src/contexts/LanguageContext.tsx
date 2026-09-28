import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'ru' | 'kz';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, defaultText?: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  ru: {
    // Навигация
    'nav.home': 'Главная',
    'nav.catalog': 'Каталог',
    'nav.contacts': 'Контакты',
    'nav.cart': 'Корзина',
    'nav.profile': 'Личный кабинет',
    'nav.login': 'Войти',
    'nav.logout': 'Выйти',

    // Контакты
    'contacts.title': 'Контакты',
    'contacts.subtitle': 'Свяжитесь с нами для оптового заказа или посетите наш центральный склад в Астане',
    'contacts.warehouse_title': 'Центральный оптовый склад',
    'contacts.address': 'г. Астана, 69-ый проезд, строение 20',
    'contacts.hours': 'Пн-Пт 09:00-18:00, Сб 10:00-15:00',
    'contacts.phone': '+7 (778) 580-68-66',
    'contacts.email': 'synergiya.group@gmail.com',
    'contacts.general_info': 'Общие контакты',
    'contacts.b2b_info_title': 'Для оптовых клиентов',
    'contacts.b2b_info_desc': 'Мы предлагаем индивидуальные условия для оптовых партнёров: специальные цены, отсрочку платежа, прямые поставки с центрального склада в Астане. Заполните форму или напишите нам в WhatsApp.',
    'contacts.feedback_title': 'Обратная связь',
    'contacts.form_name': 'Ваше имя *',
    'contacts.form_name_ph': 'Ваше имя',
    'contacts.form_company': 'Компания',
    'contacts.form_company_ph': 'Название компании / магазина',
    'contacts.form_phone': 'Телефон *',
    'contacts.form_phone_ph': '+7 (___) ___-__-__',
    'contacts.form_email': 'Email',
    'contacts.form_email_ph': 'email@example.com',
    'contacts.form_msg': 'Сообщение',
    'contacts.form_msg_ph': 'Опишите ваш запрос или перечень интересующих коллекций...',
    'contacts.send_btn': 'Отправить заявку',
    'contacts.sending': 'Отправка...',
    'contacts.success_title': 'Заявка отправлена',
    'contacts.success_desc': 'Ваша заявка зарегистрирована в системе. Наш менеджер свяжется с вами в ближайшее время.',
    'contacts.send_more': 'Отправить ещё',

    // Товар и карточка
    'product.back_catalog': 'Назад в каталог',
    'product.sqm_price': 'Цена за 1 м²',
    'product.total_price': 'Итого за штуку',
    'product.shape': 'Форма',
    'product.sizes': 'Размеры',
    'product.article': 'Артикул',
    'product.collection': 'Коллекция',
    'product.add_to_cart': 'В корзину',
    'product.added': 'Добавлено',
    'product.in_stock': 'В наличии',
    'product.in_transit': 'В пути',
    'product.in_showroom': 'В магазине',
    'product.stock_table': 'Наличие на складах',
    'product.login_for_prices': 'Войдите для оптовых цен',
    'product.login_view_prices': 'Войдите, чтобы увидеть оптовые цены',
    'product.runner_prefix': 'Дорожка',
    'product.size_pill_one': 'размер',
    'product.size_pill_few': 'размера',
    'product.size_pill_many': 'размеров',
    'product.characteristics': 'Характеристики',

    // Каталог
    'catalog.title': 'Оптовый каталог ковров',
    'catalog.search_ph': 'Поиск по артикулу, названию, цвету...',
    'catalog.all': 'Все',
    'catalog.filters': 'Фильтры',
    'catalog.reset_filters': 'Сбросить фильтры',
    'catalog.not_found': 'Ковры не найдены',

    // Футер
    'footer.tagline': 'Оптовые поставки ковровых покрытий. Центральный склад в Астане.',
    'footer.nav_title': 'Навигация',
    'footer.contacts_title': 'Контакты',
    'footer.hours_title': 'Режим работы',
    'footer.weekdays': 'Пн — Пт',
    'footer.saturday': 'Сб',
    'footer.sunday': 'Вс: Выходной',
    'footer.rights': 'Все права защищены.',

    // WhatsApp
    'whatsapp.chat': 'Написать в WhatsApp',
    'whatsapp.online': 'Ответим за 5 минут',
  },
  kz: {
    // Навигация
    'nav.home': 'Басты бет',
    'nav.catalog': 'Каталог',
    'nav.contacts': 'Байланыс',
    'nav.cart': 'Себет',
    'nav.profile': 'Жеке кабинет',
    'nav.login': 'Кіру',
    'nav.logout': 'Шығу',

    // Контакты
    'contacts.title': 'Байланыс',
    'contacts.subtitle': 'Көтерме тапсырыс беру үшін бізбен байланысыңыз немесе Астанадағы орталық қоймамызға келіңіз',
    'contacts.warehouse_title': 'Орталық көтерме қойма',
    'contacts.address': 'Астана қ., 69-шы өтпе жол, 20-құрылыс',
    'contacts.hours': 'Дс-Жм 09:00-18:00, Сб 10:00-15:00',
    'contacts.phone': '+7 (778) 580-68-66',
    'contacts.email': 'synergiya.group@gmail.com',
    'contacts.general_info': 'Жалпы байланыс мәліметтері',
    'contacts.b2b_info_title': 'Көтерме клиенттер үшін',
    'contacts.b2b_info_desc': 'Біз көтерме серіктестерге жеке тиімді шарттарды ұсынамыз: арнайы бағалар, төлемді кейінге қалдыру, Астанадағы орталық қоймадан тікелей жеткізу. Өтінімді толтырыңыз немесе WhatsApp-қа жазыңыз.',
    'contacts.feedback_title': 'Кері байланыс',
    'contacts.form_name': 'Аты-жөніңіз *',
    'contacts.form_name_ph': 'Аты-жөніңіз',
    'contacts.form_company': 'Компания',
    'contacts.form_company_ph': 'Компания / дүкен атауы',
    'contacts.form_phone': 'Телефон нөмірі *',
    'contacts.form_phone_ph': '+7 (___) ___-__-__',
    'contacts.form_email': 'Email',
    'contacts.form_email_ph': 'email@example.com',
    'contacts.form_msg': 'Хабарлама',
    'contacts.form_msg_ph': 'Сұранысыңызды немесе қызықтыратын коллекцияларды сипаттаңыз...',
    'contacts.send_btn': 'Өтінім жіберу',
    'contacts.sending': 'Жіберілуде...',
    'contacts.success_title': 'Өтінім қабылданды',
    'contacts.success_desc': 'Сіздің өтініміңіз жүйеге тіркелді. Менеджеріміз жақын арада хабарласады.',
    'contacts.send_more': 'Тағы жіберу',

    // Товар и карточка
    'product.back_catalog': 'Каталогқа оралу',
    'product.sqm_price': '1 м² бағасы',
    'product.total_price': '1 данасы үшін',
    'product.shape': 'Пішіні',
    'product.sizes': 'Өлшемдері',
    'product.article': 'Артикул',
    'product.collection': 'Коллекция',
    'product.add_to_cart': 'Себетке салу',
    'product.added': 'Қосылды',
    'product.in_stock': 'Қоймада бар',
    'product.in_transit': 'Жолда',
    'product.in_showroom': 'Дүкенде бар',
    'product.stock_table': 'Қоймалардағы қалдық',
    'product.login_for_prices': 'Көтерме бағаны көру үшін кіріңіз',
    'product.login_view_prices': 'Көтерме бағаларды көру үшін жүйеге кіріңіз',
    'product.runner_prefix': 'Жол кілем',
    'product.size_pill_one': 'өлшем',
    'product.size_pill_few': 'өлшем',
    'product.size_pill_many': 'өлшем',
    'product.characteristics': 'Сипаттамалары',

    // Каталог
    'catalog.title': 'Кілемдердің көтерме каталогы',
    'catalog.search_ph': 'Артикул, атауы немесе түсі бойынша іздеу...',
    'catalog.all': 'Барлығы',
    'catalog.filters': 'Сүзгілер',
    'catalog.reset_filters': 'Сүзгілерді тазарту',
    'catalog.not_found': 'Кілемдер табылмады',

    // Футер
    'footer.tagline': 'Кілем жабындарын көтерме жеткізу. Астана қаласындағы орталық қойма.',
    'footer.nav_title': 'Навигация',
    'footer.contacts_title': 'Байланыс',
    'footer.hours_title': 'Жұмыс кестесі',
    'footer.weekdays': 'Дс — Жм',
    'footer.saturday': 'Сб',
    'footer.sunday': 'Жс: Демалыс',
    'footer.rights': 'Барлық құқықтар қорғалған.',

    // WhatsApp
    'whatsapp.chat': 'WhatsApp-қа жазу',
    'whatsapp.online': '5 минутта жауап береміз',
  },
};

const LanguageContext = createContext<LanguageContextType>({
  language: 'ru',
  setLanguage: () => {},
  t: (key: string, defaultText?: string) => defaultText || key,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('synergy_lang') as Language;
      if (saved === 'kz' || saved === 'ru') return saved;
    }
    return 'ru';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('synergy_lang', lang);
      document.documentElement.lang = lang === 'kz' ? 'kk' : 'ru';
    }
  };

  useEffect(() => {
    document.documentElement.lang = language === 'kz' ? 'kk' : 'ru';
  }, [language]);

  const t = (key: string, defaultText?: string): string => {
    return translations[language]?.[key] ?? translations.ru[key] ?? defaultText ?? key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
