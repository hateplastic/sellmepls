import Link from "next/link";
import { Wallet, Globe, ArrowUpRight } from "lucide-react";
import { WalletAuth } from "@/components/wallet-auth";
import { paymentAvailability } from "@/lib/payment-routers";
import { TESTNET, isNetworkOffered } from "@/lib/network";
export const dynamic = "force-dynamic";
const wallets = [
  {
    name: "MetaMask",
    initials: "MM",
    color: "bg-orange-400/15 text-orange-300",
    networks: "Base · Arbitrum · BNB Chain",
    url: "https://metamask.io/download/",
    text: "Расширение браузера или встроенный браузер мобильного кошелька. Выберите EVM при входе.",
  },
  {
    name: "Phantom",
    initials: "P",
    color: "bg-purple-400/15 text-purple-300",
    networks: "Solana · Base · BNB Chain",
    url: "https://phantom.com/download",
    text: "Для Solana и EVM используются разные адреса и входы. BNB Chain доступна в актуальной версии Phantom. Для Arbitrum выберите другой совместимый кошелёк.",
  },
  {
    name: "Solflare",
    initials: "S",
    color: "bg-yellow-400/15 text-yellow-300",
    networks: "Solana",
    url: "https://www.solflare.com/download/",
    text: "Подключение через Wallet Standard. После установки обновите страницу и выберите Solflare · Solana.",
  },
  {
    name: "Trust Wallet",
    initials: "TW",
    color: "bg-blue-400/15 text-blue-300",
    networks: "Base · Arbitrum · BNB Chain",
    url: "https://trustwallet.com/browser-extension",
    text: "Подключение EVM через расширение. Другие установленные EVM-кошельки тоже обнаруживаются автоматически.",
  },
  {
    name: "TronLink",
    initials: "T",
    color: "bg-red-400/15 text-red-300",
    networks: "TRON",
    url: "https://www.tronlink.org/",
    text: "Расширение или мобильный браузер TronLink. Для покупки нужен USDT TRC20, для сетевых расходов — TRX или ресурсы Energy и Bandwidth.",
  },
] as const;
export default async function Wallets() {
  const availability = await paymentAvailability();
  return (
    <section className="shell py-14">
      <p className="eyebrow mb-4">Сети и кошельки</p>
      <h1 className="text-4xl sm:text-5xl mb-5">Выберите удобный кошелёк.</h1>
      <p className="text-muted max-w-2xl leading-7 mb-8">
        Вход подтверждается подписью без перевода средств. Покупка — отдельная
        транзакция. Сейчас сайт использует{" "}
        {TESTNET
          ? "тестовые сети и тестовые токены"
          : "основные сети и реальные средства"}
        . Перед пополнением проверьте сеть выбранного товара.
      </p>
      <div className="grid sm:grid-cols-3 gap-4 mb-10">
        {(
          [
            ["base", "Base", "USDC · ETH", "ETH"],
            [
              "arbitrum",
              "Arbitrum",
              TESTNET ? "USDC · ETH" : "USDC · USDT0 · ETH",
              "ETH",
            ],
            [
              "ethereum",
              "Ethereum",
              TESTNET ? "USDC · ETH" : "USDC · USDT · ETH",
              "ETH",
            ],
            [
              "bsc",
              "BNB Smart Chain",
              TESTNET
                ? "Токены mainnet недоступны в тестовой сети"
                : "Binance-Peg USDT (BEP20)",
              "BNB",
            ],
            [
              "tron",
              "TRON",
              TESTNET ? "USDT mainnet недоступен в Nile" : "USDT (TRC20)",
              "TRX",
            ],
            [
              "solana",
              "Solana",
              TESTNET ? "USDC · SOL" : "USDC · USDT · SOL",
              "SOL",
            ],
          ] as const
        )
          .filter(([id]) => isNetworkOffered(id))
          .map(([id, name, assets, gas]) => (
            <div key={id} className="panel p-5">
              <Globe className="text-acid mb-3" size={20} />
              <h2 className="text-xl">
                {name}
                {TESTNET &&
                  ` ${id === "solana" ? "Devnet" : id === "tron" ? "Nile" : id === "bsc" ? "Testnet" : "Sepolia"}`}
              </h2>
              <p className="text-sm mt-2">{assets}</p>
              <p className="text-xs text-muted mt-3">
                Для комиссии сети нужен {gas}
              </p>
              <p
                className={`text-xs mt-3 ${availability[id] ? "text-acid" : "text-amber-200"}`}
              >
                {availability[id]
                  ? "Приём платежей настроен"
                  : "Приём платежей ещё настраивается"}
              </p>
            </div>
          ))}
      </div>
      <div className="grid md:grid-cols-2 gap-5 mb-10">
        {wallets
          .filter((w) => w.name !== "TronLink")
          .map((w) => (
            <article key={w.name} className="panel p-6">
              <div className="flex gap-4 items-center mb-4">
                <span
                  className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold ${w.color}`}
                >
                  {w.initials}
                </span>
                <div>
                  <h2 className="text-xl">{w.name}</h2>
                  <p className="text-xs text-acid mt-1">{w.networks}</p>
                </div>
              </div>
              <p className="text-sm text-muted leading-6 mb-5">{w.text}</p>
              <a
                href={w.url}
                target="_blank"
                rel="noopener noreferrer"
                className="button-secondary"
              >
                Официальная установка <ArrowUpRight size={15} />
              </a>
            </article>
          ))}
      </div>
      <div className="panel p-6 max-w-3xl">
        <Wallet className="text-acid mb-4" />
        <h2 className="text-2xl mb-4">Как подключиться</h2>
        <ol className="list-decimal ml-5 space-y-3 text-sm text-muted mb-6">
          <li>
            Установите кошелёк, создайте аккаунт и обновите страницу. Кнопка
            входа покажет доступные совместимые расширения.
          </li>
          <li>
            Выберите сеть: адрес 0x… используется для Base / Arbitrum / BNB
            Chain, адрес Solana — для Solana. Один человек может иметь несколько
            отдельных аккаунтов на сайте.
          </li>
          <li>
            Для смены адреса нажмите «Сменить аккаунт» на сайте и заново
            подпишите вход. Одного переключения аккаунта в расширении
            недостаточно.
          </li>
          <li>
            На телефоне откройте ссылку на товар во встроенном браузере
            кошелька. QR на товаре ведёт на страницу покупки. Ссылка localhost
            работает только на компьютере, где запущен сайт; для телефона нужен
            опубликованный HTTPS-адрес.
          </li>
        </ol>
        <WalletAuth />
        <p className="text-xs text-muted mt-6">
          Solana-кошельки подключаются, если предоставляют Wallet Standard с
          подписью сообщений и транзакций. Доступность конкретного расширения
          определяется его возможностями. Для Solana-токенов покупателю может
          понадобиться SOL на создание счетов получателей.
        </p>
      </div>
      <Link href="/#market" className="text-acid block mt-8">
        К товарам ↗
      </Link>
    </section>
  );
}
