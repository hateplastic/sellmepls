# Первый тест Sellmepls

Код работает с Base Sepolia, Arbitrum Sepolia и Solana Devnet. Реальные деньги для первого теста не нужны. Для входа и публикации нужны Supabase и приватный bucket. EVM-покупки дополнительно требуют развёрнутых платёжных контрактов; для Solana отдельный контракт не требуется.

Локальная копия настроена 13 октября 2026: схема Supabase применена, Ethereum/Solana Web3 включены, Site URL и redirect разрешены для `http://localhost:3000`, CORS приватного R2 настроен. Проверены настоящие подписи входа обеих сетей, профиль, кабинет, загрузка через API приложения, приватность файлов и скачивание по ссылке на 15 минут. Временные тестовые аккаунты и файлы удалены. Существующий `.env.local` сохраняйте; схему повторно не запускайте. Платёжные контракты Base/Arbitrum пока не развёрнуты, покупка в блокчейне отдельно ещё не проверена.

Для первого входа откройте `http://localhost:3000` в браузере с расширением MetaMask или Phantom, нажмите «Подключить кошелёк» и подтвердите подпись. Во встроенном браузере Codex расширение кошелька может отсутствовать.

## 1. Локальный конфиг

Из папки проекта:

```sh
npm ci
npm run setup:keys
npm run dev
```

Откройте http://localhost:3000. `setup:keys` создаёт `.env.local` на основе `.env.example`, если файла ещё нет, и заполняет три серверных секрета. Существующие значения сохраняются. В вашем Windows окружении, если короткая команда `npm` не работает, используйте:

```powershell
& 'C:/Program Files/nodejs/node.exe' 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' run dev
```

Оставьте `NEXT_PUBLIC_CHAIN_ENV=testnet`. Публичные тестовые RPC уже записаны в примере; для регулярной нагрузки используйте собственные RPC endpoints. После изменения `.env.local` перезапустите dev-сервер.

## 2. Адреса платформы

- В MetaMask создайте отдельный тестовый аккаунт. Нажмите на имя/адрес аккаунта и скопируйте адрес `0x…`. Запишите его как `PLATFORM_EVM_WALLET`. Один EVM адрес используется в Base Sepolia и Arbitrum Sepolia.
- В Phantom создайте тестовый кошелёк. Откройте «Получить» → Solana → скопируйте публичный адрес. Запишите в `PLATFORM_SOLANA_WALLET`. В настройках Phantom включите тестовый режим и Solana Devnet.
- Для проверки разделения денег используйте разные аккаунты платформы, продавца, партнёра и покупателя. Публичные адреса можно прислать для настройки; seed-фразы и приватные ключи кошельков в чат не отправляйте.

Кошелёк платформы только получает комиссию. Его приватный ключ веб-сервису не нужен.

## 3. Supabase

1. Создайте отдельный тестовый проект в [Supabase Dashboard](https://supabase.com/dashboard).
2. Откройте SQL Editor и выполните весь `schema.sql` на новой базе. Старую схему поверх не перезапускайте.
3. В настройках API проекта скопируйте Project URL (без `/rest/v1/`) → `NEXT_PUBLIC_SUPABASE_URL`, публичный `sb_publishable_…` либо legacy `anon` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, серверный `sb_secret_…` либо legacy `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`. Серверный ключ вписывайте только локально в `.env.local`.
4. В Authentication включите Web3 Ethereum и Solana, настройте Site URL `http://localhost:3000` и разрешённый redirect `http://localhost:3000/**`. [Документация Web3 Auth](https://supabase.com/docs/guides/auth/auth-web3).

## 4. Файлы в Cloudflare R2

1. Создайте приватный bucket в Cloudflare → R2. Отключите публичный `r2.dev` и публичный домен.
2. Создайте R2 API token с чтением/записью объектов только этого bucket. Скопируйте S3 Access Key ID и Secret Access Key в `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` локально.
3. В настройках bucket возьмите S3 API endpoint → `S3_ENDPOINT`, имя bucket → `S3_BUCKET`; `S3_REGION=auto`.
4. В настройках bucket → CORS Policy добавьте правило из `r2-cors.local.json`: origin `http://localhost:3000`, методы PUT/GET/HEAD, заголовки Content-Type и Content-Length, открытый заголовок ETag. Сохраните остальные правила, если бакет используется другими приложениями. Ключ с правами чтения/записи объектов не разрешает менять CORS: это настраивается в панели Cloudflare. Полные условия и lifecycle описаны в `README.md`. [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/).

AWS S3 также поддерживается: реальный регион, приватный bucket, endpoint можно оставить пустым.

После настройки выполните `npm run check:services`. Команда проверяет таблицы, настоящий вход по подписи Ethereum/Solana и загрузку файла в R2, проверку SHA-256, закрытость S3-доступа, скачивание по ссылке на 15 минут и CORS. Она создаёт отдельные временные аккаунты и файлы для проверки и удаляет их после завершения; транзакций в блокчейн не отправляет. Для подключения кошелька и загрузки товара EVM-контракты не требуются. Их проверяет отдельно `npm run preflight` перед тестированием EVM-покупок.

## 5. Бесплатные тестовые токены

| Для чего                             | Где получить                                                               |
| ------------------------------------ | -------------------------------------------------------------------------- |
| ETH для Base Sepolia, gas и деплоя   | [Список faucets Base](https://docs.base.org/get-started/get-funds)         |
| ETH для Arbitrum Sepolia             | [Список faucets Arbitrum](https://docs.arbitrum.io/chain-info#faucet-list) |
| SOL для Solana Devnet                | [Solana Faucet](https://faucet.solana.com/)                                |
| USDC в каждой из трёх тестовых сетей | [Circle Faucet](https://faucet.circle.com/)                                |

На faucet выбирайте нужную сеть и публичный адрес кошелька покупателя. EVM deployer тоже нужен тестовый ETH. Для первоначального теста USDC достаточно 10 токенов и небольшого количества ETH/SOL для сетевых расходов. [Официальные адреса USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses) уже включены в код. Testnet USDT не предлагается.

## 6. Платёжные контракты

После `setup:keys` серверный подписант цены уже создан. Для деплоя нужен отдельный тестовый EVM аккаунт с тестовым ETH. В PowerShell можно ввести его приватный ключ скрыто, не сохраняя в истории команд:

```powershell
$deploySecret = Read-Host 'Private key отдельного тестового deployer (0x...)' -AsSecureString
$deployPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($deploySecret)
try {
  $env:DEPLOYER_PRIVATE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($deployPointer)
  npm run contracts:build
  npm run contracts:deploy -- base
  npm run contracts:deploy -- arbitrum
} finally {
  Remove-Item Env:DEPLOYER_PRIVATE_KEY -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($deployPointer)
  $deploySecret.Dispose()
}
```

Скрипт покажет **публичные адреса контрактов**. Запишите их в `BASE_PAYMENT_ROUTER` и `ARBITRUM_PAYMENT_ROUTER`. Приватный ключ deployer приложению не нужен. Серверный `QUOTE_SIGNER_PRIVATE_KEY` сохраняйте: его публичный адрес закреплён в этих контрактах. Для смены подписанта понадобится новый контракт. Solana использует стандартные инструкции, собственный program деплоить не требуется.

## 7. Проверка покупки с партнёром

```sh
npm run preflight
npm run dev
```

В отдельном терминале запустите `npm run worker`.

1. Продавец входит кошельком, задаёт имя и адреса выплат, публикует файл и изображение, ставит цену **10 USDC**, включает партнёров и **10%**.
2. Партнёр входит другим кошельком в отдельном профиле браузера, заполняет адреса выплат для сетей товара, получает ссылку с кампанией «Instagram».
3. Покупатель открывает именно `/r/...` в третьем профиле браузера, входит своим кошельком и оплачивает 10 USDC.
4. Проверьте транзакцию: **8 USDC продавцу, 1 USDC платформе, 1 USDC партнёру**. Сетевой gas/rent оплачивается отдельно.
5. Покупатель скачивает файл, обновляет страницу, повторно скачивает из кабинета, оставляет отзыв. Продавец отвечает; рейтинг обновляется на витрине.
6. Партнёр видит переход, лид, продажу, сумму и хеш выплаты. Повторная проверка хеша не добавляет ещё одну выплату.
7. Повторите без реферальной ссылки в чистом профиле браузера: продавец получает 9 USDC, платформа — 1 USDC. Повторите во всех включённых сетях, затем ETH/SOL.

Покупка самого у себя запрещена. Аккаунты EVM и Solana в Supabase отдельные; адреса выплат двух сетей можно сохранить в одном профиле. Одной подписи MetaMask недостаточно для покупки в Solana — нужен вход через Phantom.

## Что ещё не заменяют локальные тесты

Автотесты проверяют локальный PostgreSQL/RLS, локальную EVM, расчёт сумм, подписи, Solana инструкции и атрибуцию. Они не подтверждают, что ваши внешние Supabase, R2, кошельки и RPC уже настроены. Это проверяется `preflight` и сценарием выше. Перед mainnet нужны отдельная инфраструктура, HTTPS, проверка каждого платёжного актива и проверка смарт-контракта.
