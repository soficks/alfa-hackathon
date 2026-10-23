import type { Company } from '../domain/types.ts';
import { checkInn, completeOgrn, completeOgrnip } from '../domain/requisites.ts';
import { DAY } from '../domain/time.ts';
import { intBetween, pick, rng } from './random.ts';

/**
 * Мок ЕГРЮЛ/ЕГРИП. ИНН и ОГРН сгенерированы scripts/gen-requisites.ts и проходят контрольные суммы.
 * Срок работы задан в месяцах и отсчитывается от текущей даты.
 */
interface RegistryRecord {
  inn: string;
  ogrn: string;
  name: string;
  address: string;
  ageMonths: number;
  okved: string;
  okvedName: string;
  status: 'active' | 'liquidated';
  head: string;
}

export const KNOWN_COMPANIES: RegistryRecord[] = [
  {
    inn: '7704123450',
    ogrn: '1227700412345',
    name: 'ООО «Пример»',
    address: 'г. Москва, ул. Примерная, д. 1, офис 12',
    ageMonths: 50,
    okved: '46.90',
    okvedName: 'Торговля оптовая неспециализированная',
    status: 'active',
    head: 'Иванова Юлия Сергеевна',
  },
  {
    inn: '7701111110',
    ogrn: '1237700111110',
    name: 'ООО «АльфаТех»',
    address: 'г. Москва, Технопарковая ул., д. 8',
    ageMonths: 38,
    okved: '62.01',
    okvedName: 'Разработка компьютерного программного обеспечения',
    status: 'active',
    head: 'Тихонов Максим Андреевич',
  },
  {
    inn: '7715234560',
    ogrn: '1217700523457',
    name: 'ООО «Вектор»',
    address: 'г. Москва, Заводской пр-д, д. 4',
    ageMonths: 62,
    okved: '25.62',
    okvedName: 'Обработка металлических изделий механическая',
    status: 'active',
    head: 'Гусев Алексей Николаевич',
  },
  {
    inn: '500312345614',
    ogrn: '320500300123457',
    name: 'ИП Морозова Елена Викторовна',
    address: 'Московская обл., г. Химки, ул. Лесная, д. 3',
    ageMonths: 74,
    okved: '47.71',
    okvedName: 'Торговля розничная одеждой',
    status: 'active',
    head: 'Морозова Елена Викторовна',
  },
  {
    inn: '772834567838',
    ogrn: '324770002345675',
    name: 'ИП Соколова Ирина Андреевна',
    address: 'г. Москва, ул. Садовая, д. 21',
    ageMonths: 26,
    okved: '56.10',
    okvedName: 'Деятельность ресторанов и услуги по доставке продуктов питания',
    status: 'active',
    head: 'Соколова Ирина Андреевна',
  },
  {
    inn: '7810345670',
    ogrn: '1197800345676',
    name: 'ООО «Север»',
    address: 'г. Санкт-Петербург, Складская ул., д. 15',
    ageMonths: 86,
    okved: '49.41',
    okvedName: 'Деятельность автомобильного грузового транспорта',
    status: 'active',
    head: 'Лебедев Игорь Павлович',
  },
  {
    inn: '5027456784',
    ogrn: '1175000456784',
    name: 'ООО «Маяк»',
    address: 'Московская обл., г. Люберцы, ул. Строителей, д. 7',
    ageMonths: 110,
    okved: '41.20',
    okvedName: 'Строительство жилых и нежилых зданий',
    status: 'active',
    head: 'Захаров Виктор Сергеевич',
  },
  {
    inn: '7732567898',
    ogrn: '1207700567898',
    name: 'ООО «Орион»',
    address: 'г. Москва, ул. Звёздная, д. 2',
    ageMonths: 66,
    okved: '46.69',
    okvedName: 'Торговля оптовая прочими машинами и оборудованием',
    status: 'liquidated',
    head: 'Белов Сергей Игоревич',
  },
  {
    inn: '771956789000',
    ogrn: '326770005678903',
    name: 'ИП Новикова Ольга Петровна',
    address: 'г. Москва, ул. Новая, д. 10',
    ageMonths: 4,
    okved: '96.02',
    okvedName: 'Предоставление услуг парикмахерскими и салонами красоты',
    status: 'active',
    head: 'Новикова Ольга Петровна',
  },
  {
    inn: '5008678904',
    ogrn: '1245000678900',
    name: 'ООО «Гранит»',
    address: 'Московская обл., г. Долгопрудный, Промышленный пр-д, д. 9',
    ageMonths: 22,
    okved: '23.61',
    okvedName: 'Производство изделий из бетона для строительства',
    status: 'active',
    head: 'Савельев Роман Олегович',
  },
  {
    inn: '770367890190',
    ogrn: '325770006789013',
    name: 'ИП Белова Анна Игоревна',
    address: 'г. Москва, ул. Пятницкая, д. 30',
    ageMonths: 10,
    okved: '74.10',
    okvedName: 'Деятельность специализированная в области дизайна',
    status: 'active',
    head: 'Белова Анна Игоревна',
  },
  {
    inn: '502478901250',
    ogrn: '323500307890121',
    name: 'ИП Кузнецов Дмитрий Олегович',
    address: 'Московская обл., г. Одинцово, Транспортная ул., д. 5',
    ageMonths: 34,
    okved: '45.20',
    okvedName: 'Техническое обслуживание и ремонт автотранспортных средств',
    status: 'active',
    head: 'Кузнецов Дмитрий Олегович',
  },
  {
    inn: '7726789010',
    ogrn: '1227700789018',
    name: 'ООО «Лидер»',
    address: 'г. Москва, Варшавское ш., д. 47',
    ageMonths: 48,
    okved: '73.11',
    okvedName: 'Деятельность рекламных агентств',
    status: 'active',
    head: 'Орлова Мария Дмитриевна',
  },
  {
    inn: '7730890126',
    ogrn: '1237700890129',
    name: 'ООО «Ромашка»',
    address: 'г. Москва, ул. Полевая, д. 6',
    ageMonths: 37,
    okved: '10.71',
    okvedName: 'Производство хлеба и хлебобулочных изделий',
    status: 'active',
    head: 'Фёдорова Наталья Ивановна',
  },
  {
    inn: '7716901231',
    ogrn: '1207700901231',
    name: 'ООО «Полюс»',
    address: 'г. Москва, Северная ул., д. 11',
    ageMonths: 70,
    okved: '33.12',
    okvedName: 'Ремонт машин и оборудования',
    status: 'active',
    head: 'Комаров Павел Евгеньевич',
  },
  {
    inn: '7725123450',
    ogrn: '1227700123452',
    name: 'ООО «Комета»',
    address: 'г. Москва, Каширское ш., д. 18',
    ageMonths: 30,
    okved: '47.19',
    okvedName: 'Торговля розничная прочая в неспециализированных магазинах',
    status: 'active',
    head: 'Яковлев Артём Игоревич',
  },
];

export const DEMO_CLIENT_INN = '7704123450';
export const LIQUIDATED_INN = '7732567898';
export const YOUNG_INN = '771956789000';
/** Действующая компания с текущей просрочкой в БКИ — авто-отказ уже на авто-проверках */
export const OVERDUE_INN = '7725123450';

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

function toCompany(r: RegistryRecord, now: Date): Company {
  const form = r.inn.length === 12 ? 'ИП' : 'ООО';
  // дата регистрации: ageMonths назад, день — детерминированный, чтобы срок работы не «прыгал»
  const reg = new Date(now.getTime() - r.ageMonths * 30.44 * DAY - (Number(r.inn.slice(-2)) % 20) * DAY);
  return {
    inn: r.inn,
    ogrn: r.ogrn,
    form,
    name: r.name,
    address: r.address,
    registeredAt: new Date(reg.getFullYear(), reg.getMonth(), reg.getDate()).toISOString(),
    okved: r.okved,
    okvedName: r.okvedName,
    status: r.status,
    head: r.head,
  };
}

const NAMES = ['Альтаир', 'Восход', 'Горизонт', 'Дельта', 'Импульс', 'Квант', 'Меридиан', 'Нова', 'Ориентир', 'Прогресс', 'Ресурс', 'Статус'];
const SURNAMES = ['Алексеев', 'Борисов', 'Васильев', 'Григорьев', 'Дмитриев', 'Егоров', 'Жуков', 'Зайцев'];
const FIRST = ['Андрей', 'Борис', 'Виктор', 'Георгий', 'Денис', 'Евгений'];
const PATRONYMIC = ['Александрович', 'Михайлович', 'Сергеевич', 'Петрович'];
const OKVEDS: [string, string][] = [
  ['46.90', 'Торговля оптовая неспециализированная'],
  ['43.39', 'Производство прочих отделочных и завершающих работ'],
  ['62.02', 'Деятельность консультативная в области компьютерных технологий'],
  ['47.11', 'Торговля розничная в неспециализированных магазинах'],
  ['49.41', 'Деятельность автомобильного грузового транспорта'],
];

/** Компания для неизвестного ИНН: генерируется детерминированно, seed — сам ИНН. */
function generate(inn: string, now: Date): Company {
  const r = rng(inn);
  const form = inn.length === 12 ? 'ИП' : 'ООО';
  const ageMonths = intBetween(r, 14, 120);
  const year = String(now.getFullYear() - Math.floor(ageMonths / 12)).slice(-2);
  const tail = String(intBetween(r, 0, 9_999_999)).padStart(7, '0');
  const head = `${pick(r, SURNAMES)} ${pick(r, FIRST)} ${pick(r, PATRONYMIC)}`;
  const [okved, okvedName] = pick(r, OKVEDS);
  const record: RegistryRecord = {
    inn,
    ogrn: form === 'ИП' ? completeOgrnip(`3${year}${inn.slice(0, 2)}${tail}00`.slice(0, 14)) : completeOgrn(`1${year}${inn.slice(0, 2)}${tail}`),
    name: form === 'ИП' ? `ИП ${head}` : `ООО «${pick(r, NAMES)}»`,
    address: `г. Москва, ул. ${pick(r, ['Ленина', 'Мира', 'Гагарина', 'Победы'])}, д. ${intBetween(r, 1, 80)}`,
    ageMonths,
    okved,
    okvedName,
    status: 'active',
    head,
  };
  return toCompany(record, now);
}

/** Выписка из реестра. Невалидный ИНН — ошибка. */
export function lookupCompany(inn: string, now = new Date()): Company {
  const check = checkInn(inn);
  if (!check.ok) throw new RegistryError(check.error ?? 'Некорректный ИНН');
  const known = KNOWN_COMPANIES.find((c) => c.inn === inn);
  return known ? toCompany(known, now) : generate(inn, now);
}
