import React, { useEffect, useRef, useState } from "react";
import { Cat, GoalArt, Icon, Logo, Ribbon } from "./components/Art.jsx";
import {
  calculateLoan,
  DEMO_RATE,
  monthLabel,
  rub,
  validateCompany,
} from "./finance.js";
import { sendChatMessage } from "./api.js";
const GOALS = [
  {
    title: "Оборотные средства",
    description: "Поддержка текущей деятельности",
    items: ["Закупка товаров и сырья", "Оплата текущих расходов"],
  },
  {
    title: "На оборудование",
    description: "Новые возможности для бизнеса",
    items: ["Покупка оборудования", "Обновление производства"],
  },
  {
    title: "Развитие бизнеса",
    description: "Инвестиции в следующий этап",
    items: ["Открытие новых точек", "Расширение команды"],
  },
];
const STATUSES = {
  review: {
    label: "На рассмотрении",
    tone: "blue",
    hint: "Проверяем данные. Сейчас от вас ничего не требуется.",
  },
  documents: {
    label: "Нужны документы",
    tone: "orange",
    hint: "Добавьте выписку за последний завершённый месяц.",
  },
  offer: {
    label: "Есть предложение",
    tone: "green",
    hint: "Демонстрационное предложение готово к просмотру.",
  },
  issued: {
    label: "Условия приняты",
    tone: "green",
    hint: "Вы приняли условия в демо-режиме. Деньги не перечисляются.",
  },
};
const EMPTY_COMPANY = {
  type: "ООО",
  name: "",
  inn: "",
  ogrn: "",
  address: "",
  contact: "",
  phone: "",
  email: "",
};
const DEMO_COMPANY = {
  type: "ООО",
  name: "ООО «Пример»",
  inn: "7700000000",
  ogrn: "1027700000000",
  address: "Москва, ул. Примерная, д. 1",
  contact: "Юлия Иванова",
  phone: "+7 999 000-00-00",
  email: "demo@example.com",
};
const INITIAL_DRAFT = {
  goal: 0,
  amount: 2000000,
  months: 24,
  step: 0,
  company: EMPTY_COMPANY,
  revenue: "",
  tax: "УСН",
  documents: [],
};
const SEEDS = [
  {
    id: "ДЕМО-1042",
    goal: 0,
    amount: 2000000,
    months: 24,
    date: "2026-10-20T10:00:00.000Z",
    status: "review",
    company: DEMO_COMPANY,
    documents: [],
    history: [
      "Демо-заявка создана",
      "Данные переданы на демонстрационное рассмотрение",
    ],
  },
  {
    id: "ДЕМО-1038",
    goal: 1,
    amount: 1500000,
    months: 18,
    date: "2026-10-18T10:00:00.000Z",
    status: "documents",
    company: DEMO_COMPANY,
    documents: [],
    history: ["Демо-заявка создана", "Запрошена выписка по расчётному счёту"],
  },
  {
    id: "ДЕМО-1021",
    goal: 2,
    amount: 3000000,
    months: 36,
    date: "2026-10-12T10:00:00.000Z",
    status: "offer",
    company: DEMO_COMPANY,
    documents: [],
    history: [
      "Демо-заявка создана",
      "Подготовлено демонстрационное предложение",
    ],
  },
];
const dateLabel = (v) =>
  new Date(v).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
function useStored(key, initial, validate = () => true) {
  const [value, setValue] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v !== null && validate(v) ? v : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue];
}
function Button({ children, variant = "primary", className = "", ...props }) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
function Badge({ status }) {
  const s = STATUSES[status] || STATUSES.review;
  return (
    <span className={`badge ${s.tone}`}>
      <i />
      {s.label}
    </span>
  );
}
function Field({ label, error, children, hint }) {
  return (
    <label className={`field ${error ? "invalid" : ""}`}>
      <span>{label}</span>
      {children}
      {error ? (
        <small role="alert">{error}</small>
      ) : hint ? (
        <small className="muted">{hint}</small>
      ) : null}
    </label>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  const panel = useRef(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement,
      old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = panel.current;
    el.focus();
    function handler(e) {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const nodes = [
          ...el.querySelectorAll(
            'button,input,select,a[href],textarea,[tabindex="0"]',
          ),
        ].filter((n) => !n.disabled);
        if (!nodes.length) {
          e.preventDefault();
          return;
        }
        const first = nodes[0],
          last = nodes.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === el)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function PageTitle({ title, subtitle }) {
  return (
    <div className="page-title">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}
function CatSlider({ label, value, onChange, min, max, step, format, ticks }) {
  const progress = ((value - min) / (max - min)) * 100;
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(String(value));
  useEffect(() => setRaw(String(value)), [value]);
  function commit() {
    const n = Number(raw);
    if (Number.isFinite(n))
      onChange(Math.min(max, Math.max(min, Math.round(n / step) * step)));
    else setRaw(String(value));
    setEditing(false);
  }
  return (
    <section className="slider-section">
      <div className="slider-heading">
        <span>{label}</span>
        {editing ? (
          <input
            className="amount-edit"
            autoFocus
            aria-label={`Точное значение: ${label}`}
            type="number"
            min={min}
            max={max}
            step={step}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setRaw(String(value));
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            className="value-button"
            title="Нажмите, чтобы ввести значение"
            onClick={() => setEditing(true)}
          >
            {format(value)}
            <span>✎</span>
          </button>
        )}
      </div>
      <div className="range-wrap">
        <div
          className="range-track"
          style={{
            background: `linear-gradient(to right,var(--red) ${progress}%,#e5e6e9 ${progress}%)`,
          }}
        />
        <div
          className="cat-marker"
          style={{ left: `calc(28px + (100% - 56px) * ${progress / 100})` }}
        >
          <span className="cat-tooltip">{format(value)}</span>
          <Cat />
        </div>
        <input
          className="range-input"
          aria-label={`${label}: ползунок`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      <div className="range-labels">
        {ticks.map((t) => (
          <span key={t.value}>{t.label}</span>
        ))}
      </div>
    </section>
  );
}
function UploadBox({ documents, onChange, notify }) {
  const input = useRef(null);
  function addFiles(files) {
    const supported = [
        "pdf",
        "png",
        "jpg",
        "jpeg",
        "xlsx",
        "xls",
        "csv",
        "doc",
        "docx",
      ],
      accepted = [];
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) {
        notify(`«${file.name}»: размер больше 20 МБ`);
        continue;
      }
      if (!supported.includes(file.name.split(".").pop().toLowerCase())) {
        notify(`«${file.name}»: неподдерживаемый формат`);
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
      });
    }
    onChange([...documents, ...accepted]);
  }
  return (
    <div>
      <div
        className="upload-box"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles([...e.dataTransfer.files]);
        }}
      >
        <span className="upload-symbol">
          <Icon name="upload" size={28} />
        </span>
        <strong>Перетащите документы сюда</strong>
        <p>PDF, изображения, Word или Excel · до 20 МБ на файл</p>
        <Button variant="secondary" onClick={() => input.current.click()}>
          Выбрать файлы
        </Button>
        <input
          ref={input}
          aria-label="Прикрепить документы"
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.doc,.docx"
          hidden
          onChange={(e) => {
            addFiles([...e.target.files]);
            e.target.value = "";
          }}
        />
      </div>
      <div className="document-list">
        {documents.map((doc) => (
          <div className="document" key={doc.id}>
            <span className="file-symbol">
              <Icon name="file" />
            </span>
            <div>
              <strong>{doc.name}</strong>
              <small>
                {Math.max(1, Math.round(doc.size / 1024))} КБ ·{" "}
                {doc.demo ? "Демо-документ" : "Выбран локально"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label={`Удалить ${doc.name}`}
              onClick={() => onChange(documents.filter((x) => x.id !== doc.id))}
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
      </div>
      <p className="micro">
        Файлы не отправляются на сервер. После перезагрузки сохраняются только
        названия и размеры.
      </p>
    </div>
  );
}
export default function App() {
  const [session, setSession] = useStored(
    "bc-session-v1",
    false,
    (v) => typeof v === "boolean",
  );
  const [draft, setDraft] = useStored(
    "bc-draft-v1",
    INITIAL_DRAFT,
    (v) =>
      v.company &&
      Array.isArray(v.documents) &&
      v.amount >= 500000 &&
      v.amount <= 5000000 &&
      v.months >= 6 &&
      v.months <= 36 &&
      Number.isInteger(v.goal) &&
      v.goal >= 0 &&
      v.goal < 3 &&
      Number.isInteger(v.step) &&
      v.step >= 0 &&
      v.step <= 3,
  );
  const [applications, setApplications] = useStored(
    "bc-applications-v1",
    SEEDS,
    (v) =>
      Array.isArray(v) &&
      v.every(
        (x) =>
          x.id &&
          STATUSES[x.status] &&
          x.goal >= 0 &&
          x.goal < 3 &&
          Number.isFinite(x.amount) &&
          Number.isInteger(x.months) &&
          Array.isArray(x.history) &&
          Array.isArray(x.documents),
      ),
  );
  const [page, setPage] = useState("home"),
    [finView, setFinView] = useState("goals"),
    [filter, setFilter] = useState("all"),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [menu, setMenu] = useState(false),
    [errors, setErrors] = useState({}),
    [consent, setConsent] = useState(false);
  const [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [loginError, setLoginError] = useState("");
  const [messages, setMessages] = useStored(
    "bc-messages-v1",
    [
      {
        id: "welcome",
        role: "assistant",
        text: "Здравствуйте, Юлия! Я Альфа-помощник в демо-режиме. Помогу разобраться с заявкой и расчётом. Что хотите узнать?",
      },
    ],
    (v) =>
      Array.isArray(v) &&
      v.every(
        (x) =>
          typeof x.text === "string" && ["user", "assistant"].includes(x.role),
      ),
  );
  const [chatInput, setChatInput] = useState(""),
    [sending, setSending] = useState(false),
    [operator, setOperator] = useState(false),
    [chatDocs, setChatDocs] = useState([]);
  const chatEnd = useRef(null),
    chatFile = useRef(null),
    notifyTimer = useRef(null),
    sendingRef = useRef(false);
  const calculation = calculateLoan(draft.amount, draft.months),
    selectedApp =
      modal?.type === "application"
        ? applications.find((a) => a.id === modal.id)
        : null;
  const current =
    applications.find((a) => a.status === "documents") ||
    applications.find((a) => a.status === "review") ||
    applications[0];
  function notify(message) {
    setToast(message);
    clearTimeout(notifyTimer.current);
    notifyTimer.current = setTimeout(() => setToast(""), 4500);
  }
  useEffect(() => () => clearTimeout(notifyTimer.current), []);
  useEffect(() => {
    if (page === "chat")
      chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, sending, page]);
  function navigate(next) {
    setPage(next);
    setMenu(false);
    setErrors({});
    window.scrollTo({ top: 0 });
  }
  function startFinance(view = "goals") {
    setFinView(view);
    navigate("finance");
  }
  function patch(p) {
    setDraft((d) => ({ ...d, ...p }));
  }
  function demoLogin() {
    setPassword("");
    setSession(true);
    navigate("home");
  }
  function openApplication(a) {
    setModal({ type: "application", id: a.id });
  }
  function nextStep() {
    if (draft.step === 1) {
      const e = validateCompany(draft.company);
      setErrors(e);
      if (Object.keys(e).length) return;
    }
    if (draft.step === 2) {
      const e = {};
      if (!draft.revenue || Number(draft.revenue) <= 0)
        e.revenue = "Укажите годовую выручку больше нуля";
      if (!draft.documents.length)
        e.documents = "Добавьте документ или используйте демо-выписку";
      setErrors(e);
      if (Object.keys(e).length) return;
    }
    setErrors({});
    patch({ step: Math.min(3, draft.step + 1) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function submitApplication() {
    const companyErrors = validateCompany(draft.company);
    if (Object.keys(companyErrors).length) {
      setErrors(companyErrors);
      patch({ step: 1 });
      return;
    }
    if (!draft.documents.length || Number(draft.revenue) <= 0) {
      setErrors({ documents: "Добавьте документы и укажите выручку" });
      patch({ step: 2 });
      return;
    }
    if (!consent) {
      setErrors({ consent: "Подтвердите отправку демо-заявки" });
      return;
    }
    const a = {
      id: `ДЕМО-${Date.now().toString().slice(-7)}`,
      goal: draft.goal,
      amount: draft.amount,
      months: draft.months,
      date: new Date().toISOString(),
      status: "review",
      company: { ...draft.company },
      documents: [...draft.documents],
      history: [
        "Заявка создана в демонстрационном режиме",
        "Данные приняты для демонстрационного рассмотрения",
      ],
    };
    setApplications((prev) => [a, ...prev]);
    setDraft(INITIAL_DRAFT);
    setConsent(false);
    navigate("applications");
    setModal({ type: "submitted", id: a.id });
  }
  async function sendMessage(text) {
    const value = text.trim();
    if (!value || sendingRef.current) return;
    sendingRef.current = true;
    setChatInput("");
    setSending(true);
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", text: value },
    ]);
    try {
      const result = await sendChatMessage(value);
      if (result.operator) setOperator(true);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", text: result.text },
      ]);
    } catch {
      notify("Не удалось получить ответ. Попробуйте ещё раз.");
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }
  function updateApplication(id, changes, event) {
    setApplications((list) =>
      list.map((a) =>
        a.id === id ? { ...a, ...changes, history: [...a.history, event] } : a,
      ),
    );
  }
  function renderSummary() {
    return (
      <aside className="card summary">
        <div className="section-label">
          <span className="red-icon">
            <Icon name="file" />
          </span>
          <h3>Предварительный расчёт</h3>
        </div>
        <p>Ежемесячный платёж</p>
        <strong className="payment">{rub(calculation.payment)}</strong>
        <dl>
          <div>
            <dt>Сумма переплаты</dt>
            <dd>{rub(calculation.overpayment)}</dd>
          </div>
          <div>
            <dt>Полная сумма выплат</dt>
            <dd>{rub(calculation.total)}</dd>
          </div>
          <div>
            <dt>Ставка в демо-расчёте</dt>
            <dd>{DEMO_RATE}% годовых</dd>
          </div>
        </dl>
        <div className="notice">
          <Icon name="info" />
          <span>
            Демо-расчёт без комиссий и страховки. Это не предложение банка.
          </span>
        </div>
        <button
          className="text-button schedule-link"
          onClick={() => setModal({ type: "schedule" })}
        >
          <Icon name="clock" />
          Посмотреть график
          <Icon name="chevron" />
        </button>
        {draft.step < 3 ? (
          <Button onClick={nextStep}>
            Продолжить <Icon name="arrow" />
          </Button>
        ) : (
          <Button onClick={submitApplication}>
            Отправить заявку <Icon name="arrow" />
          </Button>
        )}
        <p className="micro">
          Суммы округлены до рублей. В графике — точность до копеек.
        </p>
      </aside>
    );
  }
  function renderWizard() {
    const company = draft.company;
    function companyChange(key, value) {
      patch({ company: { ...company, [key]: value } });
      setErrors((e) => ({ ...e, [key]: undefined }));
    }
    return (
      <>
        <PageTitle
          title={
            [
              "Настройте кредит под свой бизнес",
              "Расскажите о компании",
              "Добавьте финансовые данные",
              "Проверьте вашу заявку",
            ][draft.step]
          }
          subtitle={
            [
              "Укажите параметры — мы рассчитаем предварительные условия",
              "Контакты и реквизиты для вашей заявки",
              "Прикрепите выписку и укажите выручку",
              "Убедитесь, что всё верно, перед отправкой",
            ][draft.step]
          }
        />
        <Ribbon className="wizard-ribbon" />
        <div className="stepper">
          {["Условия", "Компания", "Данные", "Проверка"].map((s, i) => (
            <React.Fragment key={s}>
              <button
                disabled={i > draft.step}
                className={`step ${i === draft.step ? "active" : ""} ${i < draft.step ? "done" : ""}`}
                onClick={() => {
                  patch({ step: i });
                  setErrors({});
                }}
              >
                <span>
                  {i < draft.step ? (
                    <Icon name="check" size={18} />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                {s}
              </button>
              {i < 3 && <i />}
            </React.Fragment>
          ))}
        </div>
        <div className="wizard-grid">
          <section className="card form-card">
            {draft.step === 0 ? (
              <>
                <h3>Цель финансирования</h3>
                <div className="selected-goal">
                  <span className="red-icon">
                    <Icon name="finance" size={30} />
                  </span>
                  <div>
                    <h3>{GOALS[draft.goal].title}</h3>
                    <p>{GOALS[draft.goal].description}</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setFinView("goals")}
                  >
                    Изменить <Icon name="chevron" size={16} />
                  </button>
                </div>
                <CatSlider
                  label="Сумма кредита"
                  value={draft.amount}
                  onChange={(amount) => patch({ amount })}
                  min={500000}
                  max={5000000}
                  step={50000}
                  format={rub}
                  ticks={[
                    { value: 0, label: "500 тыс." },
                    { value: 1, label: "1 млн" },
                    { value: 2, label: "2 млн" },
                    { value: 3, label: "3 млн" },
                    { value: 4, label: "4 млн" },
                    { value: 5, label: "5 млн" },
                  ]}
                />
                <div className="quick-amounts">
                  {[500000, 1000000, 2000000, 3000000, 5000000].map((n) => (
                    <button
                      className={draft.amount === n ? "selected" : ""}
                      key={n}
                      onClick={() => patch({ amount: n })}
                    >
                      {n === 500000 ? "500 тыс." : `${n / 1000000} млн`}
                    </button>
                  ))}
                </div>
                <CatSlider
                  label="Срок кредита"
                  value={draft.months}
                  onChange={(months) => patch({ months })}
                  min={6}
                  max={36}
                  step={1}
                  format={monthLabel}
                  ticks={[6, 12, 18, 24, 30, 36].map((n) => ({
                    value: n,
                    label: n,
                  }))}
                />
              </>
            ) : draft.step === 1 ? (
              <>
                <div className="form-heading">
                  <h2>Сведения о компании</h2>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      patch({ company: { ...DEMO_COMPANY } });
                      setErrors({});
                      notify("Подставлены вымышленные реквизиты для демо");
                    }}
                  >
                    Заполнить демо
                  </Button>
                </div>
                <p className="muted">
                  Используйте вымышленные данные. Автопоиск по реестрам пока не
                  подключён.
                </p>
                <div className="segmented">
                  {["ООО", "ИП"].map((t) => (
                    <button
                      key={t}
                      className={company.type === t ? "selected" : ""}
                      onClick={() => companyChange("type", t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="fields-grid">
                  <Field label="Название компании или ИП" error={errors.name}>
                    <input
                      value={company.name}
                      onChange={(e) => companyChange("name", e.target.value)}
                      placeholder="ООО «Название»"
                    />
                  </Field>
                  <Field label="ИНН" error={errors.inn}>
                    <input
                      inputMode="numeric"
                      maxLength={company.type === "ООО" ? 10 : 12}
                      value={company.inn}
                      onChange={(e) =>
                        companyChange("inn", e.target.value.replace(/\D/g, ""))
                      }
                      placeholder={
                        company.type === "ООО" ? "10 цифр" : "12 цифр"
                      }
                    />
                  </Field>
                  <Field
                    label={company.type === "ООО" ? "ОГРН" : "ОГРНИП"}
                    error={errors.ogrn}
                  >
                    <input
                      inputMode="numeric"
                      value={company.ogrn}
                      onChange={(e) =>
                        companyChange("ogrn", e.target.value.replace(/\D/g, ""))
                      }
                    />
                  </Field>
                  <Field label="Юридический адрес" error={errors.address}>
                    <input
                      value={company.address}
                      onChange={(e) => companyChange("address", e.target.value)}
                    />
                  </Field>
                  <Field label="Контактное лицо" error={errors.contact}>
                    <input
                      value={company.contact}
                      onChange={(e) => companyChange("contact", e.target.value)}
                    />
                  </Field>
                  <Field label="Телефон" error={errors.phone}>
                    <input
                      type="tel"
                      value={company.phone}
                      onChange={(e) => companyChange("phone", e.target.value)}
                      placeholder="+7 999 000-00-00"
                    />
                  </Field>
                  <Field label="Email" error={errors.email}>
                    <input
                      type="email"
                      value={company.email}
                      onChange={(e) => companyChange("email", e.target.value)}
                      placeholder="demo@example.com"
                    />
                  </Field>
                </div>
              </>
            ) : draft.step === 2 ? (
              <>
                <h2>Финансы и документы</h2>
                <p className="muted">
                  Для прототипа достаточно выручки и одного документа.
                </p>
                <div className="fields-grid">
                  <Field
                    label="Выручка за последние 12 месяцев, ₽"
                    error={errors.revenue}
                  >
                    <input
                      type="number"
                      min="1"
                      value={draft.revenue}
                      onChange={(e) => patch({ revenue: e.target.value })}
                      placeholder="Например, 12000000"
                    />
                  </Field>
                  <Field label="Система налогообложения">
                    <select
                      value={draft.tax}
                      onChange={(e) => patch({ tax: e.target.value })}
                    >
                      <option>УСН</option>
                      <option>ОСНО</option>
                      <option>ПСН</option>
                      <option>ЕСХН</option>
                    </select>
                  </Field>
                </div>
                <h3>Выписка и отчётность</h3>
                <p className="muted">
                  Загрузите выписку по счёту. Точный список документов определит
                  будущий backend.
                </p>
                <UploadBox
                  documents={draft.documents}
                  onChange={(documents) => patch({ documents })}
                  notify={notify}
                />
                {errors.documents && (
                  <p className="error" role="alert">
                    {errors.documents}
                  </p>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    patch({
                      documents: [
                        ...draft.documents,
                        {
                          id: crypto.randomUUID(),
                          name: "Демо-выписка.pdf",
                          size: 248000,
                          demo: true,
                        },
                      ],
                      revenue: draft.revenue || "12000000",
                    });
                    setErrors({});
                  }}
                >
                  Использовать демо-выписку
                </Button>
              </>
            ) : (
              <>
                <h2>Всё готово к отправке</h2>
                <div className="review-block">
                  <h3>Ваш запрос</h3>
                  <dl>
                    <div>
                      <dt>Цель</dt>
                      <dd>{GOALS[draft.goal].title}</dd>
                    </div>
                    <div>
                      <dt>Сумма и срок</dt>
                      <dd>
                        {rub(draft.amount)} · {monthLabel(draft.months)}
                      </dd>
                    </div>
                  </dl>
                  <button
                    className="text-button"
                    onClick={() => patch({ step: 0 })}
                  >
                    Изменить условия
                  </button>
                </div>
                <div className="review-block">
                  <h3>{company.name}</h3>
                  <dl>
                    <div>
                      <dt>ИНН</dt>
                      <dd>{company.inn}</dd>
                    </div>
                    <div>
                      <dt>{company.type === "ООО" ? "ОГРН" : "ОГРНИП"}</dt>
                      <dd>{company.ogrn}</dd>
                    </div>
                    <div>
                      <dt>Адрес</dt>
                      <dd>{company.address}</dd>
                    </div>
                    <div>
                      <dt>Контакт</dt>
                      <dd>
                        {company.contact}
                        <br />
                        {company.email}
                        <br />
                        {company.phone}
                      </dd>
                    </div>
                    <div>
                      <dt>Выручка за год</dt>
                      <dd>{rub(Number(draft.revenue))}</dd>
                    </div>
                    <div>
                      <dt>Документы</dt>
                      <dd>{draft.documents.map((d) => d.name).join(", ")}</dd>
                    </div>
                  </dl>
                  <button
                    className="text-button"
                    onClick={() => patch({ step: 1 })}
                  >
                    Изменить данные
                  </button>
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    Подтверждаю создание демо-заявки. Понимаю, что данные не
                    отправляются в банк.
                  </span>
                </label>
                {errors.consent && (
                  <p className="error" role="alert">
                    {errors.consent}
                  </p>
                )}
              </>
            )}
            <div className="form-footer">
              <Button
                variant="secondary"
                onClick={() => {
                  if (draft.step === 0) setFinView("goals");
                  else patch({ step: draft.step - 1 });
                  setErrors({});
                }}
              >
                <Icon name="back" size={18} />
                Назад
              </Button>
              <span className="saved">
                <Icon name="check" size={17} />
                Черновик в браузере
              </span>
            </div>
          </section>
          {renderSummary()}
        </div>
      </>
    );
  }
  if (!session)
    return (
      <div className="login-page">
        <aside className="login-sidebar">
          <Logo />
          <div className="login-sidebar-note">
            Финансирование
            <br />
            вашего бизнеса
          </div>
        </aside>
        <section className="login-hero">
          <span className="eyebrow">БИЗНЕС КАБИНЕТ</span>
          <h1>
            Бизнес
            <br />
            растёт.
            <br />
            Мы рядом.
          </h1>
          <p>
            Финансирование,
            <br />
            оборудование, развитие —<br />в одном кабинете.
          </p>
          <Ribbon />
          <div className="hero-bottom">
            От идеи — к следующему шагу <Icon name="arrow" />
          </div>
        </section>
        <section className="login-form-area">
          <div className="login-form">
            <span className="mini-label">ВАШ БИЗНЕС. ВАШИ ВОЗМОЖНОСТИ.</span>
            <h2>Вход в кабинет</h2>
            <p className="muted">Рады видеть вас снова</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!login.trim() || !password) {
                  setLoginError(
                    "Введите демо-логин и пароль или нажмите «Демо-вход»",
                  );
                  return;
                }
                demoLogin();
              }}
            >
              <Field label="Логин">
                <input
                  autoComplete="off"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="Любой демо-логин"
                />
              </Field>
              <Field label="Пароль">
                <div className="password-input">
                  <input
                    autoComplete="off"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Любой демо-пароль"
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={
                      showPassword ? "Скрыть пароль" : "Показать пароль"
                    }
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    <Icon name="eye" size={20} />
                  </button>
                </div>
              </Field>
              {loginError && (
                <p className="error" role="alert">
                  {loginError}
                </p>
              )}
              <Button type="submit">
                Войти <Icon name="arrow" size={19} />
              </Button>
              <Button type="button" variant="secondary" onClick={demoLogin}>
                Демо-вход
              </Button>
            </form>
            <div className="notice">
              <Icon name="info" />
              <span>
                Демонстрационный кабинет. Используйте вымышленные данные и
                пароль.
              </span>
            </div>
          </div>
          <span className="login-bottom">
            Бизнес кабинет · Интерфейс для хакатона
          </span>
        </section>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <nav aria-label="Основное меню">
          {[
            { id: "home", name: "Главная", icon: "home" },
            { id: "finance", name: "Финансирование", icon: "finance" },
            { id: "applications", name: "Мои заявки", icon: "file" },
            { id: "chat", name: "Помощь", icon: "chat" },
          ].map((n) => (
            <div
              className="nav-item"
              key={n.id}
              onMouseEnter={() => {
                if (n.id === "finance") setMenu(true);
              }}
              onMouseLeave={() => {
                if (n.id === "finance") setMenu(false);
              }}
            >
              <button
                className={`nav-button ${page === n.id ? "active" : ""}`}
                aria-current={page === n.id ? "page" : undefined}
                onFocus={() => {
                  if (n.id === "finance") setMenu(true);
                }}
                onClick={() =>
                  n.id === "finance" ? startFinance() : navigate(n.id)
                }
              >
                <Icon name={n.icon} />
                <span>{n.name}</span>
              </button>
              {n.id === "finance" && menu && (
                <div
                  className="finance-menu"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setMenu(false);
                  }}
                >
                  <span className="mini-label">ФИНАНСИРОВАНИЕ</span>
                  <h3>
                    Следующий шаг
                    <br />
                    для вашего бизнеса
                  </h3>
                  {GOALS.map((g, i) => (
                    <button
                      key={g.title}
                      onClick={() => {
                        patch({ goal: i, step: 0 });
                        startFinance("wizard");
                      }}
                    >
                      {g.title}
                      <Icon name="arrow" size={18} />
                    </button>
                  ))}
                  <button
                    className="menu-calculator"
                    onClick={() => startFinance("wizard")}
                  >
                    Продолжить черновик
                    <Icon name="chevron" size={18} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </nav>
        <button className="sidebar-help" onClick={() => navigate("chat")}>
          <Cat />
          <span>
            Есть вопрос?<small>Мы рядом</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <div className="sidebar-footer">
          <span className="demo-dot" />
          Демо-режим
          <button
            className="icon-button"
            title="Выйти"
            aria-label="Выйти из кабинета"
            onClick={() => {
              setSession(false);
              setPassword("");
              setLogin("");
            }}
          >
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="topbar-caption">Финансирование бизнеса</span>
          <div className="top-actions">
            <button
              className="icon-button notification-button"
              aria-label="Уведомления"
              onClick={() => setModal({ type: "notifications" })}
            >
              <Icon name="bell" />
              <i />
            </button>
            <span className="top-divider" />
            <button
              className={`profile-button ${page === "profile" ? "chosen" : ""}`}
              onClick={() => navigate("profile")}
            >
              <span className="avatar mini">ЮИ</span>
              <span>
                Личный кабинет<small>Юлия Иванова</small>
              </span>
              <Icon name="down" size={17} />
            </button>
          </div>
        </header>
        <main className={`main page-${page}`}>
          <div className="breadcrumbs">
            <button aria-label="На главную" onClick={() => navigate("home")}>
              <Icon name="home" size={15} />
            </button>
            <Icon name="chevron" size={13} />
            <span>
              {
                {
                  home: "Главная",
                  finance: "Финансирование",
                  applications: "Мои заявки",
                  chat: "Помощь",
                  profile: "Личный кабинет",
                }[page]
              }
            </span>
            {page === "finance" && finView === "wizard" && (
              <>
                <span>/</span>
                <span>Расчёт условий</span>
              </>
            )}
          </div>
          {page === "home" && (
            <>
              <PageTitle
                title="Главная"
                subtitle="Статус финансирования и следующий шаг для вашего бизнеса"
              />
              {current ? (
                <section className="card current-application">
                  <div className="title-line">
                    <h2>Текущая заявка</h2>
                    <Badge status={current.status} />
                  </div>
                  <p className="muted">
                    № {current.id} · {GOALS[current.goal].title}
                  </p>
                  <div className="current-body">
                    <div>
                      <span className="muted">Сумма кредита</span>
                      <strong>{rub(current.amount)}</strong>
                    </div>
                    <div>
                      <span className="muted">Срок кредита</span>
                      <strong>{monthLabel(current.months)}</strong>
                    </div>
                    <div className="current-next">
                      <p>{STATUSES[current.status].hint}</p>
                      <Button onClick={() => openApplication(current)}>
                        Открыть заявку
                        <Icon name="arrow" size={18} />
                      </Button>
                    </div>
                  </div>
                </section>
              ) : (
                <section className="card empty-state">
                  <h2>Начните с вашей цели</h2>
                  <p>Подберите параметры и создайте первую заявку.</p>
                  <Button onClick={() => startFinance()}>
                    Подобрать условия
                  </Button>
                </section>
              )}
              <div className="home-bottom">
                <div>
                  <span className="eyebrow muted">СЛЕДУЮЩИЙ ШАГ</span>
                  <h2>
                    Новые планы?
                    <br />
                    Найдём возможности.
                  </h2>
                  <p className="muted">
                    Рассчитайте финансирование под задачи бизнеса.
                  </p>
                  <Button variant="secondary" onClick={() => startFinance()}>
                    Подобрать условия
                    <Icon name="arrow" size={18} />
                  </Button>
                </div>
                <Ribbon />
              </div>
            </>
          )}
          {page === "finance" &&
            (finView === "goals" ? (
              <>
                <PageTitle
                  title="На что нужны деньги?"
                  subtitle="Выберите задачу — подберём финансирование под ваш бизнес"
                />
                <div className="goal-grid">
                  {GOALS.map((goal, i) => (
                    <button
                      key={goal.title}
                      className={`goal-card ${draft.goal === i ? "selected" : ""}`}
                      onClick={() => patch({ goal: i })}
                      aria-pressed={draft.goal === i}
                    >
                      <span className="selection-circle">
                        {draft.goal === i && <Icon name="check" size={16} />}
                      </span>
                      <GoalArt type={i} />
                      <div className="goal-copy">
                        <h2>{goal.title}</h2>
                        <p>{goal.description}</p>
                        <ul>
                          {goal.items.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="goal-bottom">
                  <div className="goal-note">
                    <span className="red-icon">
                      <Icon name="info" />
                    </span>
                    <div>
                      <strong>От замысла — к делу</strong>
                      <p>Выберите сумму и срок на следующем шаге</p>
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      patch({ step: 0 });
                      setFinView("wizard");
                    }}
                  >
                    Рассчитать условия
                    <Icon name="arrow" />
                  </Button>
                </div>
                <div className="demo-caption">
                  Демонстрационные условия · без обращения в банк
                </div>
              </>
            ) : (
              renderWizard()
            ))}
          {page === "applications" && (
            <>
              <div className="page-heading-with-action">
                <PageTitle
                  title="Мои заявки"
                  subtitle="Статусы, условия и дальнейшие действия — в одном месте"
                />
                <Button onClick={() => startFinance()}>
                  Новая заявка <span>＋</span>
                </Button>
              </div>
              <div className="application-tabs">
                {[
                  ["all", "Все заявки"],
                  ["review", "На рассмотрении"],
                  ["documents", "Нужны документы"],
                  ["offer", "Предложения"],
                ].map(([id, label]) => (
                  <button
                    className={filter === id ? "active" : ""}
                    key={id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                    <span>
                      {
                        applications.filter(
                          (a) => id === "all" || a.status === id,
                        ).length
                      }
                    </span>
                  </button>
                ))}
              </div>
              <div className="applications-list">
                {applications
                  .filter((a) => filter === "all" || a.status === filter)
                  .map((a) => (
                    <section className="application-row" key={a.id}>
                      <div className="row-title">
                        <h2>{GOALS[a.goal].title}</h2>
                        <Badge status={a.status} />
                        <span className="muted row-number">
                          № {a.id} · {dateLabel(a.date)}
                        </span>
                      </div>
                      <div className="application-row-body">
                        <div>
                          <small>Сумма кредита</small>
                          <strong>{rub(a.amount)}</strong>
                        </div>
                        <div>
                          <small>Срок кредита</small>
                          <strong>{monthLabel(a.months)}</strong>
                        </div>
                        <p>{STATUSES[a.status].hint}</p>
                        <Button
                          variant={
                            a.status === "documents" ? "primary" : "secondary"
                          }
                          onClick={() => openApplication(a)}
                        >
                          {a.status === "documents"
                            ? "Добавить документы"
                            : a.status === "offer"
                              ? "Посмотреть предложение"
                              : "Подробнее"}
                          <Icon name="chevron" size={16} />
                        </Button>
                      </div>
                    </section>
                  ))}
                {!applications.some(
                  (a) => filter === "all" || a.status === filter,
                ) && (
                  <div className="empty-state">
                    <Icon name="file" size={40} />
                    <h2>Здесь пока нет заявок</h2>
                    <p className="muted">
                      Заявки с выбранным статусом появятся здесь.
                    </p>
                  </div>
                )}
              </div>
              <p className="micro">
                Все заявки в этом кабинете демонстрационные.
              </p>
            </>
          )}
          {page === "profile" && (
            <>
              <PageTitle
                title="Личный кабинет"
                subtitle="Ваш профиль и компания"
              />
              <section className="profile-card card">
                <div className="avatar large">ЮИ</div>
                <div>
                  <span className="mini-label">ВАШ ПРОФИЛЬ</span>
                  <h2>Юлия Иванова</h2>
                  <p className="muted">Руководитель компании · Демо-профиль</p>
                  <div className="profile-contacts">
                    <span>demo@example.com</span>
                    <span>+7 999 000-00-00</span>
                  </div>
                </div>
              </section>
              {current && (
                <section className="card current-application">
                  <div className="title-line">
                    <h2>Текущая заявка</h2>
                    <Badge status={current.status} />
                  </div>
                  <p className="muted">
                    № {current.id} · {GOALS[current.goal].title}
                  </p>
                  <div className="current-body">
                    <div>
                      <span className="muted">Сумма кредита</span>
                      <strong>{rub(current.amount)}</strong>
                    </div>
                    <div>
                      <span className="muted">Срок кредита</span>
                      <strong>{monthLabel(current.months)}</strong>
                    </div>
                    <div className="current-next">
                      <p>{STATUSES[current.status].hint}</p>
                      <Button onClick={() => openApplication(current)}>
                        Открыть заявку
                        <Icon name="arrow" size={18} />
                      </Button>
                    </div>
                  </div>
                </section>
              )}
              <section className="card company-card">
                <div className="section-label">
                  <span className="red-icon">
                    <Icon name="building" />
                  </span>
                  <div>
                    <span className="mini-label">МОЯ КОМПАНИЯ</span>
                    <h2>
                      {applications[0]?.company?.name || DEMO_COMPANY.name}
                    </h2>
                  </div>
                </div>
                <dl className="company-details">
                  <div>
                    <dt>ИНН</dt>
                    <dd>{applications[0]?.company?.inn || DEMO_COMPANY.inn}</dd>
                  </div>
                  <div>
                    <dt>
                      {applications[0]?.company?.type === "ИП"
                        ? "ОГРНИП"
                        : "ОГРН"}
                    </dt>
                    <dd>
                      {applications[0]?.company?.ogrn || DEMO_COMPANY.ogrn}
                    </dd>
                  </div>
                  <div>
                    <dt>Юридический адрес</dt>
                    <dd>
                      {applications[0]?.company?.address ||
                        DEMO_COMPANY.address}
                    </dd>
                  </div>
                </dl>
              </section>
              <p className="micro">
                Реквизиты показаны из последней заявки. Контакты профиля
                демонстрационные.
              </p>
            </>
          )}
          {page === "chat" && (
            <>
              <PageTitle
                title="Поможем на каждом шаге"
                subtitle="Задайте вопрос помощнику или посмотрите подсказки по заявке"
              />
              <div className="chat-grid">
                <section className="card chat-card">
                  <div className="chat-header">
                    <Cat />
                    <div>
                      <h3>
                        {operator
                          ? "Запрос специалисту · демо"
                          : "Альфа-помощник"}
                      </h3>
                      <span className="online">
                        <i />
                        {operator ? "Оператор не подключён" : "Демо-помощник"}
                      </span>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => sendMessage("Позвать оператора")}
                    >
                      Позвать оператора
                    </Button>
                  </div>
                  <div
                    className="chat-messages"
                    aria-live="polite"
                    aria-relevant="additions"
                  >
                    {messages.map((m) => (
                      <div className={`message ${m.role}`} key={m.id}>
                        {m.role === "assistant" && <Cat />}
                        <div>
                          <span>{m.text}</span>
                          <small>
                            {m.role === "assistant"
                              ? "Альфа-помощник · демо"
                              : "Вы"}
                          </small>
                        </div>
                      </div>
                    ))}
                    {sending && (
                      <span className="muted">Помощник печатает…</span>
                    )}
                    <div ref={chatEnd} />
                  </div>
                  <div className="chat-quick">
                    {[
                      "Какие нужны документы?",
                      "Как узнать статус заявки?",
                      "Как рассчитывается платёж?",
                    ].map((q) => (
                      <button
                        key={q}
                        disabled={sending}
                        onClick={() => sendMessage(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  {chatDocs.length > 0 && (
                    <div className="chat-attachments">
                      {chatDocs.map((d) => (
                        <span key={d.id}>
                          {d.name}
                          <button
                            aria-label={`Убрать ${d.name}`}
                            onClick={() =>
                              setChatDocs((ds) =>
                                ds.filter((x) => x.id !== d.id),
                              )
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <form
                    className="chat-compose"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!chatInput.trim() && !chatDocs.length) return;
                      const attachments = chatDocs.length
                        ? `\nПрикреплены локально: ${chatDocs.map((d) => d.name).join(", ")}`
                        : "";
                      sendMessage(
                        (chatInput || "Вопрос по документам") + attachments,
                      );
                      setChatDocs([]);
                    }}
                  >
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Прикрепить файл в чат"
                      onClick={() => chatFile.current.click()}
                    >
                      <Icon name="clip" />
                    </button>
                    <input
                      ref={chatFile}
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files[0];
                        if (f) {
                          if (f.size > 20 * 1024 * 1024)
                            notify("Размер файла не должен превышать 20 МБ");
                          else
                            setChatDocs((d) => [
                              ...d,
                              { id: crypto.randomUUID(), name: f.name },
                            ]);
                        }
                        e.target.value = "";
                      }}
                    />
                    <input
                      aria-label="Сообщение помощнику"
                      maxLength={2000}
                      placeholder="Напишите ваш вопрос…"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                    />
                    <button
                      className="send-button"
                      aria-label="Отправить сообщение"
                      disabled={
                        sending || (!chatInput.trim() && !chatDocs.length)
                      }
                    >
                      <Icon name="arrow" />
                    </button>
                  </form>
                  <p className="micro chat-disclaimer">
                    Ответы и оператор демонстрационные. Файлы на сервер не
                    отправляются.
                  </p>
                </section>
                <aside className="chat-context card">
                  <h3>Обсуждаем заявку</h3>
                  {current && (
                    <>
                      <Badge status={current.status} />
                      <h2>{GOALS[current.goal].title}</h2>
                      <p className="muted">№ {current.id}</p>
                      <dl>
                        <div>
                          <dt>Сумма</dt>
                          <dd>{rub(current.amount)}</dd>
                        </div>
                        <div>
                          <dt>Срок</dt>
                          <dd>{monthLabel(current.months)}</dd>
                        </div>
                      </dl>
                      <p className="muted">{STATUSES[current.status].hint}</p>
                      <Button
                        variant="secondary"
                        onClick={() => openApplication(current)}
                      >
                        Открыть заявку
                      </Button>
                    </>
                  )}
                  <div className="notice">
                    <Icon name="info" />
                    <span>
                      Для ответа достаточно вопроса. Не отправляйте пароли и
                      паспортные данные.
                    </span>
                  </div>
                </aside>
              </div>
            </>
          )}
        </main>
        <footer className="workspace-footer">
          <span>Бизнес кабинет</span>
          <span>Демонстрационный проект · Без банковских операций</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Icon name="info" />
          {toast}
          <button aria-label="Закрыть уведомление" onClick={() => setToast("")}>
            ×
          </button>
        </div>
      )}
      {modal?.type === "schedule" && (
        <Modal title="График платежей" wide onClose={() => setModal(null)}>
          <p className="muted">
            {rub(draft.amount)} · {monthLabel(draft.months)} · {DEMO_RATE}%
            годовых, демо
          </p>
          <Schedule calculation={calculation} />
        </Modal>
      )}
      {modal?.type === "notifications" && (
        <Modal title="Уведомления" onClose={() => setModal(null)}>
          {applications
            .filter((a) => ["documents", "offer"].includes(a.status))
            .map((a) => (
              <button
                className="notification-row"
                key={a.id}
                onClick={() => openApplication(a)}
              >
                <Badge status={a.status} />
                <strong>Заявка {a.id}</strong>
                <span>{STATUSES[a.status].hint}</span>
                <Icon name="chevron" size={18} />
              </button>
            ))}
          {!applications.some((a) =>
            ["documents", "offer"].includes(a.status),
          ) && <p className="muted">Новых уведомлений нет.</p>}
          <p className="micro">Демонстрационные события</p>
        </Modal>
      )}
      {modal?.type === "submitted" && (
        <Modal title="Демо-заявка создана" onClose={() => setModal(null)}>
          <div className="success-icon">
            <Icon name="check" size={32} />
          </div>
          <h2>Всё получилось</h2>
          <p>
            Заявка № {modal.id} появилась в разделе «Мои заявки» со статусом «На
            рассмотрении».
          </p>
          <p className="muted">
            Это демонстрация: сведения не отправлены в банк.
          </p>
          <Button onClick={() => setModal(null)}>
            К моим заявкам
            <Icon name="arrow" />
          </Button>
        </Modal>
      )}
      {selectedApp && (
        <Modal
          key={selectedApp.id}
          title={`Заявка № ${selectedApp.id}`}
          wide
          onClose={() => setModal(null)}
        >
          <ApplicationDetails
            application={selectedApp}
            update={updateApplication}
            notify={notify}
          />
        </Modal>
      )}
    </div>
  );
}
function Schedule({ calculation }) {
  return (
    <>
      <div className="schedule-totals">
        <span>
          Всего выплат <strong>{rub(calculation.total, 2)}</strong>
        </span>
        <span>
          Переплата <strong>{rub(calculation.overpayment, 2)}</strong>
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Месяц</th>
              <th>Платёж</th>
              <th>Основной долг</th>
              <th>Проценты</th>
              <th>Остаток долга</th>
            </tr>
          </thead>
          <tbody>
            {calculation.schedule.map((r) => (
              <tr key={r.month}>
                <td>{r.month}</td>
                <td>{rub(r.payment, 2)}</td>
                <td>{rub(r.principal, 2)}</td>
                <td>{rub(r.interest, 2)}</td>
                <td>{rub(r.balance, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="micro">
        Условная ставка, без комиссий. Последний платёж скорректирован для
        полного погашения.
      </p>
    </>
  );
}
function ApplicationDetails({ application: a, update, notify }) {
  const [tab, setTab] = useState("overview"),
    [docs, setDocs] = useState([]),
    [accept, setAccept] = useState(false),
    [error, setError] = useState("");
  const calc = calculateLoan(a.amount, a.months);
  return (
    <>
      <div className="detail-top">
        <Badge status={a.status} />
        <span className="muted">{dateLabel(a.date)}</span>
      </div>
      <h2>{GOALS[a.goal].title}</h2>
      <p className="muted">{STATUSES[a.status].hint}</p>
      <div className="detail-metrics">
        <div>
          <span>Сумма кредита</span>
          <strong>{rub(a.amount)}</strong>
        </div>
        <div>
          <span>Срок</span>
          <strong>{monthLabel(a.months)}</strong>
        </div>
        <div>
          <span>Платёж в демо</span>
          <strong>{rub(calc.payment)}</strong>
        </div>
      </div>
      <div className="application-tabs">
        {[
          ["overview", "Обзор"],
          ["documents", "Документы"],
          ["history", "История"],
          ["schedule", "График"],
        ].map(([key, title]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {title}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <>
          <div className="notice">
            <Icon name="info" />
            <span>
              Демонстрационная заявка. Настоящая проверка и выдача кредита не
              выполняются.
            </span>
          </div>
          <dl>
            <div>
              <dt>Компания</dt>
              <dd>{a.company.name}</dd>
            </div>
            <div>
              <dt>ИНН</dt>
              <dd>{a.company.inn}</dd>
            </div>
            <div>
              <dt>Переплата в демо</dt>
              <dd>{rub(calc.overpayment)}</dd>
            </div>
            <div>
              <dt>Полная сумма выплат</dt>
              <dd>{rub(calc.total)}</dd>
            </div>
          </dl>
          {a.status === "documents" && (
            <Button onClick={() => setTab("documents")}>
              Добавить документы
              <Icon name="upload" size={18} />
            </Button>
          )}
          {a.status === "offer" && (
            <div className="offer-action">
              <h3>Предложение · демо</h3>
              <p>
                Условная ставка {DEMO_RATE}% годовых. Сумма и срок совпадают с
                запросом.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={accept}
                  onChange={(e) => setAccept(e.target.checked)}
                />
                <span>Хочу принять условия в демонстрационном режиме</span>
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <Button
                onClick={() => {
                  if (!accept) {
                    setError("Отметьте подтверждение");
                    return;
                  }
                  update(
                    a.id,
                    { status: "issued" },
                    "Условия приняты в демо-режиме",
                  );
                  notify(
                    "Условия приняты в демо-режиме. Деньги не перечисляются.",
                  );
                }}
              >
                Принять условия
              </Button>
            </div>
          )}
        </>
      )}
      {tab === "documents" && (
        <>
          <h3>Документы по заявке</h3>
          {a.documents.length > 0 ? (
            <div className="document-list">
              {a.documents.map((d) => (
                <div key={d.id} className="document">
                  <Icon name="file" />
                  <div>
                    <strong>{d.name}</strong>
                    <small>Метаданные документа · содержимое не хранится</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Документы пока не добавлены.</p>
          )}
          {a.status === "documents" && (
            <>
              <UploadBox documents={docs} onChange={setDocs} notify={notify} />
              <Button
                disabled={!docs.length}
                onClick={() => {
                  update(
                    a.id,
                    { status: "review", documents: [...a.documents, ...docs] },
                    "Документы добавлены локально; демо-заявка повторно на рассмотрении",
                  );
                  setDocs([]);
                  notify("Документы добавлены в демо-заявку");
                }}
              >
                Добавить в демо-заявку
                <Icon name="arrow" size={18} />
              </Button>
            </>
          )}
        </>
      )}
      {tab === "history" && (
        <ol className="timeline">
          {a.history.map((item, i) => (
            <li key={i}>
              <span className="timeline-dot" />
              <strong>{item}</strong>
              <small>{i === 0 ? dateLabel(a.date) : "Демо-событие"}</small>
            </li>
          ))}
        </ol>
      )}
      {tab === "schedule" && <Schedule calculation={calc} />}
    </>
  );
}
