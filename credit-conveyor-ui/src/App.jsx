import { useState } from 'react';

// 1. СИНТЕТИЧЕСКИЕ ПРОФИЛИ ДЛЯ ЖЮРИ (Сквозные сценарии)
const DEMO_PROFILES = [
  {
    inn: '7701111111',
    name: 'ООО «Альфа Логистик»',
    role: 'Генеральный директор',
    okved: '49.41 Грузоперевозки',
    scenario: 'APPROVED',
    turnover: 6000000,
    currentDebtPayment: 150000,
    status: 'ACTIVE',
    news: [
      { tag: 'Логистика • 49.41', title: 'Субсидии на лизинг грузового транспорта в 2026 году', desc: 'Государство компенсирует до 15% стоимости тягачей.' },
      { tag: 'Законы', title: 'Новые правила электронных путевых листов с ноября', desc: 'Что нужно изменить в учетной системе транспортной компании.' }
    ]
  },
  {
    inn: '7702222222',
    name: 'ИП Смирнов А.В. (Сеть кофеен)',
    role: 'Собственник бизнеса',
    okved: '56.10 Рестораны и кафе',
    scenario: 'COUNTER_OFFER',
    turnover: 1800000,
    currentDebtPayment: 180000,
    status: 'ACTIVE',
    news: [
      { tag: 'Общепит • 56.10', title: 'Налоговые льготы для кафе и ресторанов', desc: 'Как снизить нагрузку при сохранении штата сотрудников.' },
      { tag: 'Финансы', title: 'Как проходить кассовые разрывы в несезон', desc: 'Разбираем разницу между овердрафтом и оборотным кредитом.' }
    ]
  },
  {
    inn: '7703333333',
    name: 'ООО «ТехноСтрой»',
    role: 'Финансовый директор',
    okved: '41.20 Строительство',
    scenario: 'NEED_INFO',
    turnover: 800000, // В анкете просит много, по счету мало -> нужен документ
    currentDebtPayment: 50000,
    status: 'ACTIVE',
    news: [
      { tag: 'Строительство • 41.20', title: 'Банковское сопровождение госконтрактов по 44-ФЗ', desc: 'Спецсчета и быстрые гарантии для подрядчиков.' },
      { tag: 'Аналитика', title: 'Цены на стройматериалы в IV квартале', desc: 'Прогноз стоимости арматуры и бетона.' }
    ]
  },
  {
    inn: '7705555555',
    name: 'ООО «Вектор Плюс»',
    role: 'Бухгалтер',
    okved: '47.11 Розничная торговля',
    scenario: 'DECLINED',
    turnover: 300000,
    currentDebtPayment: 120000,
    status: 'LIQUIDATING', // Стоп-фактор
    news: [
      { tag: 'Ритейл • 47.11', title: 'Обязательная маркировка новых групп товаров', desc: 'Сроки внедрения и штрафы за нарушения.' }
    ]
  }
];

export default function App() {
  // Навигация: 'login' | 'showcase' | 'calculator' | 'application'
  const [screen, setScreen] = useState('login');
  const [profile, setProfile] = useState(DEMO_PROFILES[0]);

  // Параметры калькулятора
  const [amount, setAmount] = useState(2000000);
  const [term, setTerm] = useState(24);
  const [productName, setProductName] = useState('Оборотный кредит');

  // Стейт-машина заявки: 'DRAFT' | 'SCORING' | 'NEED_INFO' | 'APPROVED' | 'COUNTER_OFFER' | 'DECLINED'
  const [appState, setAppState] = useState('DRAFT');
  const [docUploaded, setDocUploaded] = useState(false);

  // Чат в заявке
  const [messages, setMessages] = useState([
    { from: 'bot', text: 'Подойдёт выписка из другого банка?', time: '12:14', isUser: true },
    { from: 'bot', text: 'Да. Добавьте файл за сентябрь — остальные данные сохранены.', time: '12:15', isUser: false }
  ]);
  const [chatInput, setChatInput] = useState('');

  // Вход под выбранным профилем
  const handleLogin = (selectedProfile) => {
    setProfile(selectedProfile);
    setAppState('DRAFT');
    setDocUploaded(false);
    setScreen('showcase');
  };

  // Запуск конвейера (переход из калькулятора в заявку)
  const startConveyor = () => {
    setScreen('application');
    setAppState('SCORING');

    setTimeout(() => {
      if (profile.status === 'LIQUIDATING') {
        setAppState('DECLINED');
      } else if (profile.scenario === 'NEED_INFO' && !docUploaded) {
        setAppState('NEED_INFO');
      } else if (profile.scenario === 'COUNTER_OFFER' || amount > 4000000) {
        setAppState('COUNTER_OFFER');
      } else {
        setAppState('APPROVED');
      }
    }, 1500);
  };

  // Дозагрузка выписки на экране NEED_INFO
  const handleUploadDoc = () => {
    setDocUploaded(true);
    setAppState('SCORING');
    setTimeout(() => {
      setAppState('APPROVED');
    }, 1200);
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setMessages([...messages, { text: chatInput, time: '12:36', isUser: true }]);
    setChatInput('');
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { text: 'Принято! Наш алгоритмический модуль уже проверяет обновлённые данные.', time: '12:36', isUser: false }
      ]);
    }, 800);
  };

  // ================= ЭКРАН 1: ВХОД В КАБИНЕТ =================
  if (screen === 'login') {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center p-6 font-sans">
        <div className="max-w-5xl w-full bg-white rounded-3xl shadow-xl overflow-hidden flex min-h-[600px]">
          {/* Темный мини-сайдбар */}
          <div className="w-48 bg-[#1e1e1e] text-white p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-10">
                <div className="w-8 h-8 bg-[#ef3124] rounded-lg flex items-center justify-center font-bold">А</div>
                <div className="font-bold text-sm leading-tight">Бизнес<br />кабинет</div>
              </div>
              <div className="space-y-4 text-sm text-gray-400">
                <div className="text-white">⌂ Главная</div>
                <div>▤ Финансирование</div>
                <div>☰ Мои заявки</div>
                <div>? Помощь</div>
              </div>
            </div>
            <div className="text-gray-500 text-xs">« Свернуть</div>
          </div>

          {/* Красный промо-баннер */}
          <div className="w-5/12 bg-gradient-to-br from-[#ef3124] to-[#b0120a] text-white p-10 flex flex-col justify-between relative overflow-hidden">
            <div className="z-10 mt-8">
              <h1 className="text-4xl font-extrabold leading-tight mb-4">
                Бизнес<br />растёт.<br />Мы рядом.
              </h1>
              <p className="text-white/80 text-sm leading-relaxed">
                Финансирование, оборудование, развитие — в одном кабинете.
              </p>
            </div>
            <div className="w-64 h-64 bg-white/10 rounded-full -bottom-20 -right-10 absolute blur-md" />
          </div>

          {/* Форма входа + Демо-профили для жюри */}
          <div className="flex-1 p-10 flex flex-col justify-center bg-gray-50/50">
            <div className="max-w-sm mx-auto w-full bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Вход в кабинет</h2>
              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Логин</label>
                  <input
                    type="text"
                    defaultValue="ivanov@company.ru"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Пароль</label>
                  <input
                    type="password"
                    defaultValue="••••••••••"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm"
                  />
                </div>
                <button
                  onClick={() => handleLogin(DEMO_PROFILES[0])}
                  className="w-full bg-[#ef3124] hover:bg-red-600 text-white font-semibold py-3 rounded-xl transition cursor-pointer"
                >
                  Войти
                </button>
              </div>

              <div className="border-t pt-4">
                <div className="text-xs font-semibold text-gray-400 uppercase mb-3">
                  Демо-вход для жюри (выберите сценарий):
                </div>
                <div className="space-y-2">
                  {DEMO_PROFILES.map((p) => (
                    <button
                      key={p.inn}
                      onClick={() => handleLogin(p)}
                      className="w-full text-left p-2.5 rounded-xl border border-gray-200 hover:border-[#ef3124] hover:bg-red-50/30 transition text-xs flex justify-between items-center cursor-pointer"
                    >
                      <div>
                        <div className="font-bold text-gray-800">{p.name}</div>
                        <div className="text-gray-500">{p.okved}</div>
                      </div>
                      <span className="px-2 py-1 rounded bg-gray-100 font-mono text-[10px] text-gray-700">
                        {p.scenario}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ================= ОБЩИЙ ЛЕЙАУТ КАБИНЕТА (САЙДБАР + КОНТЕНТ) =================
  return (
    <div className="min-h-screen bg-[#f5f6f8] flex font-sans text-gray-900">
      {/* Левый темный сайдбар */}
      <aside className="w-60 bg-[#1e1e1e] text-white p-6 flex flex-col justify-between shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-10">
            <div className="w-9 h-9 bg-[#ef3124] rounded-xl flex items-center justify-center font-bold text-lg">А</div>
            <div className="font-bold text-sm leading-tight">Бизнес<br />кабинет</div>
          </div>

          <nav className="space-y-2 text-sm">
            <button
              onClick={() => setScreen('showcase')}
              className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition cursor-pointer ${
                screen === 'showcase' || screen === 'calculator'
                  ? 'bg-[#ef3124] text-white font-semibold'
                  : 'text-gray-400 hover:bg-white/5'
              }`}
            >
              <span>▤</span> Финансирование
            </button>
            <button
              onClick={() => setScreen('application')}
              className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition cursor-pointer ${
                screen === 'application'
                  ? 'bg-[#ef3124] text-white font-semibold'
                  : 'text-gray-400 hover:bg-white/5'
              }`}
            >
              <span>☰</span> Мои заявки
            </button>
          </nav>
        </div>

        {/* Карточка текущего демо-профиля внизу сайдбара */}
        <div className="bg-white/5 p-4 rounded-2xl text-xs space-y-1 border border-white/10">
          <div className="text-gray-400">Активный профиль:</div>
          <div className="font-bold text-white truncate">{profile.name}</div>
          <div className="text-gray-400">{profile.role}</div>
          <div className="text-[11px] text-red-400 font-mono">ИНН: {profile.inn}</div>
          <button
            onClick={() => setScreen('login')}
            className="mt-2 text-gray-300 underline hover:text-white block cursor-pointer"
          >
            Сменить профиль
          </button>
        </div>
      </aside>

      {/* Правая рабочая область */}
      <main className="flex-1 p-10 overflow-y-auto">
        {/* Верхняя шапка с плашкой сохранения черновика */}
        <div className="flex justify-between items-start mb-8">
          <div>
            {screen === 'showcase' && (
              <>
                <h1 className="text-3xl font-extrabold">Финансирование бизнеса</h1>
                <p className="text-gray-500 text-sm mt-1">Выберите подходящее решение под ваши цели</p>
              </>
            )}
            {screen === 'calculator' && <h1 className="text-3xl font-extrabold">Подберите условия</h1>}
            {screen === 'application' && (
              <button
                onClick={() => setScreen('showcase')}
                className="text-sm text-gray-500 hover:text-gray-800 mb-2 block cursor-pointer"
              >
                ← Мои заявки
              </button>
            )}
          </div>

          <div className="bg-white px-4 py-2 rounded-full shadow-xs border border-gray-100 flex items-center gap-2 text-xs">
            <span className="w-5 h-5 rounded-full bg-green-600 text-white flex items-center justify-center text-[10px]">✓</span>
            <div>
              <div className="font-semibold text-gray-800">Черновик сохранён</div>
              <div className="text-gray-400 text-[10px]">Сегодня, 12:35</div>
            </div>
          </div>
        </div>

        {/* ================= ЭКРАН 2: ВИТРИНА ФИНАНСИРОВАНИЯ ================= */}
        {screen === 'showcase' && (
          <div className="space-y-6 max-w-5xl">
            {/* Главный баннер: Оборотный кредит */}
            <div className="bg-gradient-to-r from-[#fff5f5] to-[#ffe4e4] rounded-3xl p-8 border border-red-100 flex justify-between items-center relative overflow-hidden">
              <div className="max-w-md z-10">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-10 h-10 rounded-xl bg-white text-[#ef3124] font-bold flex items-center justify-center shadow-xs">
                    ₽
                  </span>
                  <h2 className="text-2xl font-extrabold">Оборотный кредит</h2>
                </div>
                <p className="text-gray-600 text-sm mb-6">
                  Поддержка текущей деятельности и закупок товаров и услуг.
                </p>
                <button
                  onClick={() => {
                    setProductName('Оборотный кредит');
                    setScreen('calculator');
                  }}
                  className="bg-[#ef3124] hover:bg-red-600 text-white font-semibold px-8 py-3.5 rounded-xl transition cursor-pointer"
                >
                  Рассчитать
                </button>
              </div>

              <div className="text-xs bg-white/80 px-3 py-1 rounded-full text-gray-600 absolute top-6 right-6">
                Демо-условия
              </div>

              {/* Преимущества внизу карточки */}
              <div className="hidden lg:flex flex-col gap-2 text-xs text-gray-700 bg-white/70 p-4 rounded-2xl backdrop-blur-xs">
                <div>📦 Пополнение оборотных средств</div>
                <div>📅 Удобный график платежей</div>
                <div>⚡ Решение онлайн за 2 минуты</div>
              </div>
            </div>

            {/* Нижние 2 карточки продуктов */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-2xl">🚜</span>
                    <span className="text-[11px] bg-gray-100 px-2.5 py-1 rounded-full text-gray-500">Демо-условия</span>
                  </div>
                  <h3 className="text-lg font-bold mb-1">На оборудование</h3>
                  <p className="text-xs text-gray-500 mb-6">Покупка и лизинг оборудования для развития бизнеса.</p>
                </div>
                <button
                  onClick={() => {
                    setProductName('Кредит на оборудование');
                    setScreen('calculator');
                  }}
                  className="self-start border border-red-300 text-[#ef3124] hover:bg-red-50 px-5 py-2 rounded-xl text-sm font-semibold transition cursor-pointer"
                >
                  Рассчитать ›
                </button>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-2xl">📊</span>
                    <span className="text-[11px] bg-gray-100 px-2.5 py-1 rounded-full text-gray-500">Демо-условия</span>
                  </div>
                  <h3 className="text-lg font-bold mb-1">Развитие бизнеса</h3>
                  <p className="text-xs text-gray-500 mb-6">Инвестиции в новые направления и масштабирование.</p>
                </div>
                <button
                  onClick={() => {
                    setProductName('Инвестиционный кредит');
                    setScreen('calculator');
                  }}
                  className="self-start border border-red-300 text-[#ef3124] hover:bg-red-50 px-5 py-2 rounded-xl text-sm font-semibold transition cursor-pointer"
                >
                  Рассчитать ›
                </button>
              </div>
            </div>

            {/* ПЕРСОНАЛИЗИРОВАННАЯ НОВОСТНАЯ ЛЕНТА ПОД ОКВЭД КЛИЕНТА (Требование слайда 7) */}
            <div className="pt-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Персональная лента для вашей отрасли ({profile.okved})</h3>
                <span className="text-xs text-gray-400">Обновляется динамически по профилю клиента</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {profile.news.map((item, idx) => (
                  <div key={idx} className="bg-white p-5 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#ef3124] bg-red-50 px-2.5 py-1 rounded-md">
                      {item.tag}
                    </span>
                    <h4 className="font-bold text-sm mt-3 mb-1">{item.title}</h4>
                    <p className="text-xs text-gray-500">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================= ЭКРАН 3: КАЛЬКУЛЯТОР ("ПОДБЕРИТЕ УСЛОВИЯ") ================= */}
        {screen === 'calculator' && (
          <div className="max-w-5xl">
            {/* Степпер шагов */}
            <div className="flex items-center gap-4 mb-8 text-sm">
              <div className="flex items-center gap-2 font-bold text-gray-900">
                <span className="w-6 h-6 rounded-full bg-[#ef3124] text-white flex items-center justify-center text-xs">1</span>
                Условия
              </div>
              <div className="h-px bg-gray-300 w-12" />
              <div className="flex items-center gap-2 text-gray-400">
                <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs">2</span>
                Компания
              </div>
              <div className="h-px bg-gray-300 w-12" />
              <div className="flex items-center gap-2 text-gray-400">
                <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs">3</span>
                Данные
              </div>
              <div className="h-px bg-gray-300 w-12" />
              <div className="flex items-center gap-2 text-gray-400">
                <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs">4</span>
                Проверка
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
              {/* Левая карточка с ползунками */}
              <div className="flex-1 bg-white p-8 rounded-3xl border border-gray-100 shadow-xs space-y-8">
                <div>
                  <label className="text-xs text-gray-500 font-semibold">Сумма финансирования</label>
                  <div className="flex justify-between items-center mt-2 mb-4">
                    <div className="text-3xl font-extrabold">{amount.toLocaleString('ru-RU')} ₽</div>
                    <div className="px-4 py-2 border rounded-xl text-sm text-gray-600 bg-gray-50">
                      {amount.toLocaleString('ru-RU')} ₽
                    </div>
                  </div>
                  <input
                    type="range"
                    min="500000"
                    max="10000000"
                    step="100000"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="w-full accent-[#ef3124] cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-2">
                    <span>500 000 ₽</span>
                    <span>10 000 000 ₽</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 font-semibold">Срок кредитования</label>
                  <div className="flex justify-between items-center mt-2 mb-4">
                    <div className="text-3xl font-extrabold">{term} месяца</div>
                    <div className="px-4 py-2 border rounded-xl text-sm text-gray-600 bg-gray-50">
                      {term} мес.
                    </div>
                  </div>
                  <input
                    type="range"
                    min="6"
                    max="60"
                    step="6"
                    value={term}
                    onChange={(e) => setTerm(Number(e.target.value))}
                    className="w-full accent-[#ef3124] cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-2">
                    <span>6 месяцев</span>
                    <span>60 месяцев</span>
                  </div>
                </div>

                <button
                  onClick={() => setScreen('showcase')}
                  className="px-5 py-2.5 border border-gray-200 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-50 cursor-pointer"
                >
                  ← Назад
                </button>
              </div>

              {/* Правая карточка: Предварительный расчёт */}
              <div className="w-full lg:w-80 bg-[#fff5f5] p-6 rounded-3xl border border-red-100 flex flex-col justify-between">
                <div>
                  <h3 className="font-bold text-base mb-5">Предварительный расчёт</h3>
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-1">
                      <span className="text-gray-500">Продукт</span>
                      <span className="font-bold">{productName}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-gray-500">Сумма</span>
                      <span className="font-bold">{amount.toLocaleString('ru-RU')} ₽</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-gray-500">Срок</span>
                      <span className="font-bold">{term} месяца</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-gray-500">Ежемесячный платёж</span>
                      <span className="font-bold text-right">
                        ~{Math.round((amount * 1.18) / term).toLocaleString('ru-RU')} ₽/мес
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-gray-500">Ставка</span>
                      <span className="font-bold text-right">Условия уточним<br />после проверки</span>
                    </div>
                  </div>

                  <div className="mt-6 bg-blue-50/80 border border-blue-200 p-3 rounded-xl text-[11px] text-blue-900">
                    ℹ️ Точные условия, график и ставка будут определены после автоматической проверки по ЕГРЮЛ и БКИ.
                  </div>
                </div>

                <button
                  onClick={startConveyor}
                  className="w-full bg-[#ef3124] hover:bg-red-600 text-white font-bold py-4 rounded-xl mt-6 transition cursor-pointer"
                >
                  Продолжить →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= ЭКРАН 4: КАРТОЧКА ЗАЯВКИ № 12345 + ЧАТ ================= */}
        {screen === 'application' && (
          <div className="flex flex-col lg:flex-row gap-8 max-w-6xl">
            {/* Центральная колонка заявки */}
            <div className="flex-1 bg-white p-8 rounded-3xl border border-gray-100 shadow-xs">
              <div className="flex items-center gap-4 mb-2">
                <h2 className="text-2xl font-extrabold">Заявка № 12345</h2>
                {appState === 'SCORING' && (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                    Проверка данных...
                  </span>
                )}
                {appState === 'NEED_INFO' && (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                    Нужно уточнение
                  </span>
                )}
                {appState === 'APPROVED' && (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                    Одобрено
                  </span>
                )}
                {appState === 'COUNTER_OFFER' && (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
                    Готово спецпредложение
                  </span>
                )}
                {appState === 'DECLINED' && (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                    Отказ
                  </span>
                )}
              </div>

              <div className="text-xs text-gray-500 mb-6">
                {productName} • {amount.toLocaleString('ru-RU')} ₽ • {term} месяца
              </div>

              <div className="border-b mb-6 flex gap-6 text-sm">
                <span className="border-b-2 border-[#ef3124] pb-2 font-bold">Документы и решение</span>
                <span className="text-gray-400 pb-2">История статусов</span>
              </div>

              {/* Лоадер скоринга */}
              {appState === 'SCORING' && (
                <div className="py-12 text-center space-y-3">
                  <div className="w-10 h-10 border-4 border-[#ef3124] border-t-transparent rounded-full animate-spin mx-auto" />
                  <div className="font-bold text-sm">Анализируем профиль по ФНС, БКИ и оборотам...</div>
                  <div className="text-xs text-gray-400">Расчёт CFADS и коэффициента долговой нагрузки (PTI)</div>
                </div>
              )}

              {/* Состояние NEED_INFO (Точь-в-точь как на 4-м экране референса) */}
              {appState === 'NEED_INFO' && (
                <div className="bg-[#fff8f1] border border-orange-200 p-6 rounded-2xl mb-6">
                  <div className="flex items-start gap-4">
                    <div className="text-2xl">📄</div>
                    <div className="flex-1">
                      <h4 className="font-bold text-sm mb-1">Добавьте выписку за сентябрь</h4>
                      <p className="text-xs text-gray-600 mb-4">
                        Заявленная выручка превышает текущие обороты по счёту в банке. Выписка нужна для анализа финансовых потоков компании (CFADS).
                      </p>
                      <button
                        onClick={handleUploadDoc}
                        className="w-full bg-[#ef3124] hover:bg-red-600 text-white font-semibold py-3 rounded-xl text-sm transition cursor-pointer"
                      >
                        Загрузить выписку (Симуляция загрузки PDF)
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Состояние APPROVED */}
              {appState === 'APPROVED' && (
                <div className="bg-green-50 border border-green-200 p-6 rounded-2xl mb-6 space-y-3">
                  <h4 className="font-bold text-green-900 text-base">✅ Финансирование одобрено!</h4>
                  <p className="text-xs text-green-800">
                    Все проверки ЕГРЮЛ и БКИ пройдены. Долговая нагрузка (PTI) в пределах нормы. Средства готовы к зачислению на расчётный счёт.
                  </p>
                  <div className="bg-white p-4 rounded-xl text-xs flex justify-between">
                    <span>Одобренная сумма: <b>{amount.toLocaleString('ru-RU')} ₽</b></span>
                    <span>Ставка: <b>17.5% годовых</b></span>
                  </div>
                </div>
              )}

              {/* Состояние COUNTER_OFFER */}
              {appState === 'COUNTER_OFFER' && (
                <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl mb-6 space-y-4">
                  <h4 className="font-bold text-amber-900 text-base">
                    💡 Одобрено с альтернативными условиями (Контр-оффер)
                  </h4>
                  <p className="text-xs text-amber-800">
                    Для запрашиваемой суммы {amount.toLocaleString('ru-RU')} ₽ текущих оборотов компании ({profile.turnover.toLocaleString('ru-RU')} ₽/мес) недостаточно по нормативу долговой нагрузки. Мы подготовили два доступных варианта:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="bg-white p-4 rounded-xl border border-amber-300">
                      <div className="font-bold mb-1">Вариант 1: Снижение суммы</div>
                      <div>Сумма: <b>1 800 000 ₽</b> на {term} мес.</div>
                      <button
                        onClick={() => {
                          setAmount(1800000);
                          setAppState('APPROVED');
                        }}
                        className="mt-3 w-full bg-[#ef3124] text-white py-2 rounded-lg font-semibold cursor-pointer"
                      >
                        Принять условия
                      </button>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-amber-300">
                      <div className="font-bold mb-1">Вариант 2: Увеличение срока</div>
                      <div>Сумма: <b>{amount.toLocaleString('ru-RU')} ₽</b> на <b>48 мес.</b></div>
                      <button
                        onClick={() => {
                          setTerm(48);
                          setAppState('APPROVED');
                        }}
                        className="mt-3 w-full bg-gray-900 text-white py-2 rounded-lg font-semibold cursor-pointer"
                      >
                        Принять условия
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Состояние DECLINED */}
              {appState === 'DECLINED' && (
                <div className="bg-red-50 border border-red-200 p-6 rounded-2xl mb-6">
                  <h4 className="font-bold text-red-900 text-base mb-1">❌ К сожалению, по заявке получен отказ</h4>
                  <p className="text-xs text-red-700">
                    Причина (Reason Code): По данным государственного реестра ЕГРЮЛ организация находится в стадии ликвидации либо имеет критическую просроченную задолженность.
                  </p>
                </div>
              )}

              {/* Список загруженных документов */}
              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">Загруженные документы</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3.5 border border-gray-100 rounded-xl bg-gray-50/60 text-xs">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-green-600 text-white flex items-center justify-center text-[10px]">✓</span>
                      <div>
                        <div className="font-bold">Выписка за август 2026.pdf</div>
                        <div className="text-gray-400 text-[11px]">PDF • 1,2 МБ • проверено OCR</div>
                      </div>
                    </div>
                    <span className="text-gray-400">⋮</span>
                  </div>

                  {docUploaded && (
                    <div className="flex items-center justify-between p-3.5 border border-green-200 rounded-xl bg-green-50/40 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-green-600 text-white flex items-center justify-center text-[10px]">✓</span>
                        <div>
                          <div className="font-bold">Выписка за сентябрь 2026.pdf</div>
                          <div className="text-gray-500 text-[11px]">PDF • 1,4 МБ • только что</div>
                        </div>
                      </div>
                      <span className="text-gray-400">⋮</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Правая колонка: Чат "Помощь по заявке" */}
            <div className="w-full lg:w-80 bg-white p-6 rounded-3xl border border-gray-100 shadow-xs flex flex-col justify-between h-[520px]">
              <div>
                <div className="flex justify-between items-center pb-4 border-b">
                  <span className="font-bold text-sm">Помощь по заявке</span>
                  <span className="text-gray-400">—</span>
                </div>

                <div className="flex items-center gap-3 py-3">
                  <div className="w-8 h-8 rounded-full bg-[#ef3124] text-white flex items-center justify-center font-bold text-xs">
                    А
                  </div>
                  <div>
                    <div className="text-xs font-bold">ИИ-Помощник</div>
                    <div className="text-[10px] text-gray-400">Отвечаю на вопросы по вашей заявке</div>
                  </div>
                </div>

                {/* Сообщения */}
                <div className="space-y-3 mt-3 overflow-y-auto max-h-64 pr-1">
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-2xl text-xs ${
                        m.isUser
                          ? 'bg-gray-100 text-gray-800 ml-6'
                          : 'bg-[#fff0f0] text-gray-900 mr-6 border border-red-100'
                      }`}
                    >
                      <div>{m.text}</div>
                      <div className="text-[9px] text-gray-400 text-right mt-1">{m.time}</div>
                    </div>
                  ))}
                </div>
              </div>

              <form onSubmit={sendMessage} className="flex items-center gap-2 pt-3 border-t">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Напишите сообщение..."
                  className="flex-1 text-xs px-3 py-2.5 bg-gray-100 rounded-xl focus:outline-none"
                />
                <button
                  type="submit"
                  className="w-9 h-9 bg-[#ef3124] text-white rounded-xl flex items-center justify-center text-xs cursor-pointer"
                >
                  ➤
                </button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}