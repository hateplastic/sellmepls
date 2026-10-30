export function participantError(input: {
  buyer: string;
  seller: string;
  platform: string;
  solana: boolean;
  ownProduct: boolean;
}) {
  const norm = (v: string) => (input.solana ? v : v.toLowerCase());
  const buyer = norm(input.buyer),
    seller = norm(input.seller),
    platform = norm(input.platform);
  if (seller === platform)
    return "В профиле продавца указан кошелёк платформы. Продавцу нужно изменить адрес выплат в кабинете. Смена кошелька покупателя это не исправит.";
  if (buyer === platform)
    return "Вы вошли кошельком платформы. Для покупки войдите отдельным кошельком покупателя через «Сменить аккаунт».";
  if (input.ownProduct || buyer === seller)
    return "Вы вошли аккаунтом продавца или его кошельком выплат. Для тестовой покупки используйте отдельный аккаунт покупателя: нажмите «Сменить аккаунт» и подпишите вход новым адресом.";
  return null;
}
