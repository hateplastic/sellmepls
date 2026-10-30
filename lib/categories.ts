export const CATEGORIES = {
  software: "Софт и приложения",
  courses: "Курсы и обучение",
  ebooks: "Книги и PDF",
  video: "Видео",
  audio: "Музыка и аудио",
  graphics: "Дизайн и графика",
  photos: "Фотографии",
  templates: "Шаблоны и документы",
  code: "Код и скрипты",
  games: "Игры и игровые материалы",
  accounts: "Аккаунты",
  proxies: "Прокси",
  licenses: "Ключи и лицензии",
  guides: "Мануалы и инструкции",
  plans: "Схемы и чертежи",
  data: "Данные и исследования",
  models: "3D-модели",
  fonts: "Шрифты",
  presets: "Пресеты и эффекты",
  marketing: "Маркетинг и контент",
  other: "Другое",
} as const;
export type Category = keyof typeof CATEGORIES;
export function isCategory(value: string): value is Category {
  return Object.hasOwn(CATEGORIES, value);
}
