export const mockProfiles = {
  "7701111111": {
    inn: "7701111111",
    name: "ООО «Альфа Логистик»",
    role: "генеральный директор", //[cite: 3]
    okved: "49.41",
    financials: {
      verified_monthly_turnover: 5000000,
      current_monthly_debt: 200000,
      status: "ACTIVE"
    }
  },
  "7702222222": {
    inn: "7702222222",
    name: "ИП Смирнов А.В.",
    role: "собственник бизнеса", //[cite: 3]
    okved: "56.10",
    financials: {
      verified_monthly_turnover: 1200000,
      current_monthly_debt: 800000, // Высокая нагрузка для демо контр-оффера
      status: "ACTIVE"
    }
  }
};