"use client";
import { FEE_SUMMARY } from "@/lib/pricing";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { formatUnits, type EIP1193Provider } from "viem";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowUpRight,
  CheckCircle2,
  Download,
  LoaderCircle,
  LockKeyhole,
  QrCode,
  RefreshCw,
} from "lucide-react";
import {
  ASSETS,
  isAssetEnabled,
  isAssetOffered,
  displayAmount,
  atomicPrice,
  saleParts,
  type AssetId,
  type Product,
  type Sale,
} from "@/lib/catalog";
import { api, walletError } from "@/lib/wallet";
import { payOrder } from "@/lib/pay";
import {
  CHAIN_ENV,
  isEvmNetwork,
  walletFamily,
  type WalletFamily,
  type PaymentAvailability,
} from "@/lib/network";
import type { TronPrepared } from "@/lib/pay-tron";
import type { EvmEstimate } from "@/lib/evm-preflight";
import { WalletAuth } from "./wallet-auth";
import Link from "next/link";
import type { SolanaEstimate } from "@/lib/solana-preflight";
export function Checkout({
  product,
  initialOrder,
  appUrl,
  referralCode,
  referralBps = 0,
  viewer,
  availability,
  stockAvailable,
}: {
  product: Product;
  initialOrder: Sale | null;
  appUrl: string;
  referralCode?: string;
  referralBps?: number;
  viewer: { id: string; address: string; chain: WalletFamily } | null;
  availability: PaymentAvailability;
  stockAvailable: number | null;
}) {
  const account = useAccount(),
    { connectors, connectAsync } = useConnect();
  const [asset, setAsset] = useState<AssetId>(
      initialOrder?.asset ||
        product.prices.find(
          (p) =>
            availability[ASSETS[p.asset].network] &&
            walletFamily(ASSETS[p.asset].network) === viewer?.chain,
        )?.asset ||
        product.prices.find((p) => availability[ASSETS[p.asset].network])
          ?.asset ||
        product.prices[0].asset,
    ),
    [order, setOrder] = useState<Sale | null>(initialOrder),
    [hash, setHash] = useState(initialOrder?.tx_hash || ""),
    [busy, setBusy] = useState(false),
    [polling, setPolling] = useState(Boolean(initialOrder?.tx_hash)),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [review, setReview] = useState(false),
    [rejected, setRejected] = useState(false),
    [download, setDownload] = useState<{ url: string; expires: string } | null>(
      null,
    ),
    [qr, setQr] = useState(false),
    [manual, setManual] = useState("");
  const checking = useRef(false),
    tries = useRef(0);
  const stock = product.delivery_mode === "stock";
  const [quantity, setQuantity] = useState(initialOrder?.quantity || 1);
  const checkoutKey = useRef<string | null>(null);
  const [solanaEstimate, setSolanaEstimate] = useState<SolanaEstimate | null>(
    null,
  );
  const [tronEstimate, setTronEstimate] = useState<
    TronPrepared["estimate"] | null
  >(null);
  const [evmEstimate, setEvmEstimate] = useState<EvmEstimate | null>(null);
  const cacheKey = `sellmepls:v3:order:${CHAIN_ENV}:${viewer?.id || "guest"}:${product.id}`;
  function saveCache(sale: Sale, tx: string) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ order: sale, hash: tx }));
    } catch {
      /* Payment verification does not depend on browser storage. */
    }
  }
  function clearCache() {
    try {
      localStorage.removeItem(cacheKey);
    } catch {
      /* Storage may be disabled in a wallet browser. */
    }
  }
  useEffect(() => {
    if (initialOrder) return;
    try {
      const saved = localStorage.getItem(cacheKey);
      if (saved) {
        if (saved.length > 20000) throw new Error("Invalid checkout cache");
        const p = JSON.parse(saved) as { order: Sale; hash: string };
        if (
          p.order.product_id === product.id &&
          p.order.buyer_id === viewer?.id &&
          p.order.chain_environment === CHAIN_ENV &&
          isAssetEnabled(p.order.asset) &&
          typeof p.hash === "string"
        ) {
          saleParts(p.order);
          setOrder(p.order);
          setAsset(p.order.asset);
          setHash(p.hash);
          setQuantity(p.order.quantity || 1);
          setPolling(Boolean(p.hash));
        }
      }
    } catch {
      try {
        localStorage.removeItem(cacheKey);
      } catch {}
    }
  }, [product.id, initialOrder, cacheKey, viewer?.id]);
  useEffect(() => {
    if (!order || !hash || !polling) return;
    let cancelled = false;
    tries.current = 0;
    const check = async () => {
      if (checking.current) return;
      checking.current = true;
      try {
        const response = await fetch("/api/verify-tx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: order.id, txHash: hash }),
        });
        const data = await response.json();
        if (cancelled) return;
        if (response.status === 202) {
          setStatus("Транзакция отправлена. Ожидаем подтверждение сети…");
        } else if (response.ok) {
          setDownload({ url: data.downloadUrl, expires: data.expiresAt });
          setPolling(false);
          setStatus("Платёж подтверждён");
          setError("");
        } else if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
          setError(data.error);
          setPolling(false);
          setRejected(response.status === 422);
        } else {
          setStatus("Проверка временно недоступна. Повторяем…");
        }
      } catch {
        if (!cancelled)
          setStatus("Нет соединения с сервером. Повторяем проверку…");
      } finally {
        checking.current = false;
        tries.current++;
        if (!cancelled && tries.current >= 120) {
          setPolling(false);
          setStatus(
            "Проверка приостановлена. Можно повторить по сохранённому хешу.",
          );
        }
      }
    };
    void check();
    const timer = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [order, hash, polling]);
  function remember(sale: Sale, tx: string) {
    setRejected(false);
    setHash(tx);
    saveCache(sale, tx);
    setPolling(true);
    setStatus("Проверяем платёж в блокчейне…");
  }
  async function prepare() {
    setBusy(true);
    setError("");
    setSolanaEstimate(null);
    setTronEstimate(null);
    setReview(false);
    setEvmEstimate(null);
    try {
      checkoutKey.current ||= crypto.randomUUID();
      const sale = await api<Sale>("/api/orders", {
        productId: product.id,
        asset,
        quantity: stock ? quantity : 1,
        checkoutKey: checkoutKey.current,
      });
      setOrder(sale);
      setAsset(sale.asset);
      setQuantity(sale.quantity);
      saveCache(sale, sale.tx_hash || "");
      if (sale.tx_hash) {
        remember(sale, sale.tx_hash);
        return;
      }
      if (sale.network === "tron") {
        const prepared = await api<TronPrepared>("/api/tron/transaction", {
          action: "prepare",
          orderId: sale.id,
        });
        setTronEstimate(prepared.estimate);
      }
      if (isEvmNetwork(sale.network)) {
        const estimate = await api<EvmEstimate>("/api/evm/estimate", {
          orderId: sale.id,
        });
        setEvmEstimate(estimate);
        if (!estimate.ready) {
          setError(estimate.issues.join("\n"));
          return;
        }
      }
      if (sale.network === "solana") {
        const estimate = await api<SolanaEstimate>("/api/solana/transaction", {
          action: "inspect",
          orderId: sale.id,
        });
        setSolanaEstimate(estimate);
        if (!estimate.ready) {
          setReview(false);
          setStatus(
            "Оплата пока недоступна. Исправьте причину ниже и проверьте заказ ещё раз.",
          );
          setError(estimate.issues.join("\n"));
          return;
        }
      }
      setReview(true);
      setStatus(
        "Проверьте сумму, сеть и адреса. Затем подтвердите оплату в кошельке.",
      );
    } catch (error) {
      setError(walletError(error));
    } finally {
      setBusy(false);
    }
  }
  async function buy() {
    if (!order) return;
    const sale = order;
    setBusy(true);
    setError("");
    try {
      if (Date.parse(sale.expires_at) <= Date.now() + 15000) {
        setReview(false);
        throw new Error(
          "Срок расчёта истёк. Нажмите «Проверить заказ», чтобы обновить сумму.",
        );
      }
      let provider: EIP1193Provider | null = null;
      if (isEvmNetwork(sale.network)) {
        const connector = account.connector || connectors[0];
        if (!connector)
          throw new Error(
            "Откройте сайт в MetaMask или установите расширение.",
          );
        if (
          sale.network === "arbitrum" &&
          connector.name.toLowerCase().includes("phantom")
        )
          throw new Error(
            "Phantom не поддерживает Arbitrum. Выберите оплату в Base или войдите через MetaMask / другой EVM-кошелёк.",
          );
        if (!account.isConnected) await connectAsync({ connector });
        provider = (await connector.getProvider()) as EIP1193Provider;
      }
      await payOrder(sale, provider, (h) => remember(sale, h), setStatus);
    } catch (error) {
      setError(walletError(error));
    } finally {
      setBusy(false);
    }
  }
  const price = product.prices.find((p) => p.asset === asset),
    locked = busy || polling || Boolean(hash),
    neededChain = walletFamily(ASSETS[asset].network),
    wrongFamily = Boolean(viewer && viewer.chain !== neededChain),
    ready = availability[ASSETS[asset].network];
  const validQuantity =
    Number.isInteger(quantity) && quantity >= 1 && quantity <= 1000;
  const total = order
    ? order.amount
    : price
      ? (
          atomicPrice(price) * BigInt(stock && validQuantity ? quantity : 1)
        ).toString()
      : "0";
  if (!order && !product.prices.some((p) => isAssetOffered(p.asset)))
    return (
      <div className="panel p-6">
        <p>Продавец пока не добавил цену в доступной сети.</p>
        <p className="text-muted text-sm mt-2">
          Новые оплаты доступны в Base, Arbitrum, BNB Chain и Solana.
        </p>
      </div>
    );
  return (
    <div className="panel p-6 sm:p-8 lg:sticky lg:top-8">
      <p className="eyebrow mb-5">Ваша следующая находка</p>
      {download ? (
        <div>
          <CheckCircle2 size={38} className="text-acid mb-5" />
          <h2 className="text-2xl">Теперь это ваше.</h2>
          <p className="text-muted text-sm my-4">
            Оплата подтверждена. Ссылка действует до{" "}
            {new Date(download.expires).toLocaleTimeString("ru-RU")}.
          </p>
          <a
            href={download.url}
            className="button-primary w-full"
            rel="noreferrer"
          >
            <Download size={18} />
            {stock
              ? `Скачать ${order?.quantity || quantity} шт. · TXT`
              : "Скачать файл"}
          </a>
          <button
            className="mt-4 text-muted text-sm flex gap-2 items-center"
            onClick={() => {
              setDownload(null);
              setPolling(true);
            }}
          >
            <RefreshCw size={14} />
            Получить новую ссылку
          </button>
          {stock && (
            <button
              className="button-secondary w-full mt-4"
              onClick={() => {
                clearCache();
                window.location.assign(`/p/${product.id}`);
              }}
            >
              Купить ещё
            </button>
          )}
          <Link
            href="/dashboard#purchases"
            className="text-acid text-sm block mt-4"
          >
            Все мои покупки ↗
          </Link>
        </div>
      ) : (
        <>
          <div className="text-4xl tracking-tight mb-2">
            {formatUnits(BigInt(total), ASSETS[asset].decimals)}{" "}
            <span className="text-2xl text-acid">{ASSETS[asset].symbol}</span>
          </div>
          {ASSETS[asset].network === "solana" && (
            <p className="text-sm text-muted mb-4">
              {ASSETS[asset].symbol === "SOL"
                ? "Оплата обычным SOL: сумма и выплаты остаются в SOL. USDC и USDT не требуются."
                : `Оплата ${ASSETS[asset].symbol}: нужен именно этот токен в сети Solana и немного SOL для комиссии. Обмена SOL на ${ASSETS[asset].symbol} здесь нет.`}
            </p>
          )}
          {tronEstimate && (
            <div className="rounded-xl bg-white/5 p-4 mb-4 text-xs space-y-2">
              <p>
                TRON: {tronEstimate.tokenBalance} USDT ·{" "}
                {tronEstimate.nativeBalance} TRX
              </p>
              <p>
                Лимит расходов следующей операции: {tronEstimate.maximumFee} TRX
              </p>
              <p>
                {tronEstimate.needsApproval
                  ? "Сначала кошелёк запросит разрешение только суммы заказа. Затем отдельно рассчитаем и подтвердим сам платёж."
                  : "Разрешение токена уже есть. Следующий шаг — оплата."}
              </p>
            </div>
          )}
          {evmEstimate && (
            <div className="rounded-xl bg-white/5 p-4 mb-4 text-xs space-y-2">
              <p className="text-acid">
                {ASSETS[asset].label} ·{" "}
                {evmEstimate.ready ? "Готово к подписи" : "Нужно исправить"}
              </p>
              <p>
                Баланс: {evmEstimate.nativeBalance} {evmEstimate.nativeSymbol}
                {evmEstimate.tokenBalance !== null && (
                  <>
                    {" "}
                    + {evmEstimate.tokenBalance} {evmEstimate.tokenSymbol}
                  </>
                )}
              </p>
              {evmEstimate.maximumFee && (
                <p>
                  Расчётный запас на комиссию текущей операции:{" "}
                  {evmEstimate.maximumFee} {evmEstimate.nativeSymbol}
                </p>
              )}
              <p>
                {evmEstimate.step === "pay"
                  ? "Следующий шаг — оплата. Итоговую комиссию покажет кошелёк."
                  : "Сначала — разрешение на списание суммы заказа. Оплата потребует отдельной транзакции и комиссии сети."}
              </p>
            </div>
          )}
          {solanaEstimate && (
            <div className="rounded-xl bg-white/5 p-4 mb-4 text-xs space-y-2">
              <p className="text-acid">
                Проверка Solana ·{" "}
                {solanaEstimate.ready ? "Готово к подписи" : "Нужно исправить"}
              </p>
              <p>
                Баланс покупателя: {solanaEstimate.nativeBalance} SOL
                {solanaEstimate.tokenBalance !== null
                  ? ` + ${solanaEstimate.tokenBalance} ${solanaEstimate.asset}`
                  : ""}
              </p>
              <p>Комиссия сети: {solanaEstimate.networkFee} SOL</p>
              {solanaEstimate.accountRent !== "0" && (
                <p>
                  Создание счетов получателей: {solanaEstimate.accountRent} SOL
                </p>
              )}
              <p>
                Всего списание SOL: {solanaEstimate.totalSolCost}
                {solanaEstimate.asset !== "SOL"
                  ? `, плюс ${displayAmount(order!.amount, order!.asset)}`
                  : ""}
              </p>
              <p className="text-muted">
                Расчёт обновляется перед подписью. Обычный ненулевой остаток SOL
                должен быть не ниже {solanaEstimate.minimumRemainingSol}.
              </p>
            </div>
          )}
          <p className="text-xs text-muted mb-6">
            {CHAIN_ENV === "mainnet"
              ? "Основная сеть · реальные средства"
              : "Тестовая сеть · тестовые токены"}{" "}
            · комиссия сети отдельно
          </p>
          {stock && (
            <div className="space-y-3 mb-6">
              <p className="text-sm text-muted">
                {order
                  ? displayAmount(order.unit_amount, order.asset)
                  : `${price?.amount} ${ASSETS[asset].symbol}`}{" "}
                / шт. · Доступно: {stockAvailable ?? 0} шт.
              </p>
              <label>
                Количество
                <input
                  className="mt-2"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={Math.max(1, Math.min(1000, stockAvailable ?? 0))}
                  step={1}
                  value={quantity || ""}
                  disabled={locked || Boolean(order)}
                  onChange={(event) => {
                    setQuantity(Number(event.target.value));
                    checkoutKey.current = null;
                  }}
                />
              </label>
              <p className="text-xs text-muted">
                До 1000 шт. за заказ. После оплаты получите TXT только с вашими
                единицами. Комиссия рассчитывается от общей суммы заказа.
              </p>
              {order && !order.reservation_released_at && !hash && (
                <p className="text-xs text-acid">
                  {order.quantity} шт. зарезервировано до{" "}
                  {new Date(order.expires_at).toLocaleTimeString("ru-RU")}.
                </p>
              )}
              {order?.reservation_released_at && (
                <p role="alert" className="text-amber-200 text-sm">
                  Резерв закрыт.{" "}
                  <a
                    href={`/p/${product.id}`}
                    onClick={clearCache}
                    className="underline"
                  >
                    Создать новую покупку
                  </a>
                </p>
              )}
              {order &&
                !order.reservation_released_at &&
                !hash &&
                Date.parse(order.expires_at) <= Date.now() && (
                  <p role="alert" className="text-amber-200 text-sm">
                    Срок оплаты истёк. Возврат резерва проверяется сервером.{" "}
                    <a
                      href={`/p/${product.id}`}
                      onClick={clearCache}
                      className="underline"
                    >
                      Обновить доступность для новой покупки
                    </a>
                  </p>
                )}
            </div>
          )}
          <label>
            Валюта и сеть
            <select
              className="mt-2"
              disabled={locked || (stock && Boolean(order))}
              value={asset}
              onChange={(e) => {
                setAsset(e.target.value as AssetId);
                setEvmEstimate(null);
                setSolanaEstimate(null);
                setTronEstimate(null);
                setOrder(null);
                setReview(false);
                setStatus("");
                setError("");
                clearCache();
                checkoutKey.current = null;
              }}
            >
              {product.prices
                .filter(
                  (p) => isAssetOffered(p.asset) || order?.asset === p.asset,
                )
                .map((p) => (
                  <option key={p.asset} value={p.asset}>
                    {ASSETS[p.asset].label} — {p.amount}
                    {availability[ASSETS[p.asset].network]
                      ? ""
                      : " · ещё не настроена"}
                  </option>
                ))}
            </select>
          </label>
          <div className="my-6 border-y border-white/10 py-5 space-y-3 text-sm text-muted">
            <p className="flex justify-between">
              <span>Создателю</span>
              <span className="text-white">
                {order
                  ? displayAmount(saleParts(order).seller, order.asset)
                  : "Остаток после комиссий"}
              </span>
            </p>
            <p className="flex justify-between">
              <span>Комиссия платформы</span>
              <span className="text-white">
                {order
                  ? displayAmount(order.fee, order.asset)
                  : "После расчёта заказа"}
              </span>
            </p>
            {(order ? Boolean(order.affiliate_id) : Boolean(referralBps)) && (
              <p className="flex justify-between gap-3">
                <span>Партнёру</span>
                <span className="text-acid">
                  {order
                    ? displayAmount(order.affiliate_amount, order.asset)
                    : `${referralBps / 100}%`}
                </span>
              </p>
            )}
            <p className="text-xs">
              {FEE_SUMMARY}. Комиссии включены в цену. Для ETH/SOL курс и тариф
              фиксируются при создании заказа. USDC/USDT учитываются как $1 за
              токен.
              {order && (
                <span className="block mt-2">
                  Тариф этого заказа:{" "}
                  {order.fee_bps === 1000
                    ? "10%, без фиксированной части"
                    : "5% + $0.50"}
                  .
                </span>
              )}
            </p>
          </div>
          <div className="mb-4">
            <WalletAuth compact preferredChain={neededChain} />
            {viewer && (
              <p className="text-xs text-muted break-all mt-3">
                Вход на сайт: {viewer.address} ·{" "}
                {viewer.chain === "tron"
                  ? "TRON"
                  : viewer.chain === "solana"
                    ? "Solana"
                    : "EVM"}
              </p>
            )}
            {wrongFamily && (
              <p className="text-sm text-amber-200 mt-3">
                Для этой оплаты нужен вход{" "}
                {neededChain === "tron"
                  ? "адресом TRON"
                  : neededChain === "solana"
                    ? "адресом Solana"
                    : "EVM-адресом"}
                . Смените аккаунт на сайте или выберите валюту своей сети.
              </p>
            )}
            {!ready && (
              <p className="text-sm text-amber-200 mt-3">
                Оплата в этой сети ещё не настроена владельцем платформы.
                Выберите доступную сеть. Настройка платёжных контрактов
                находится в админке.
              </p>
            )}
            {viewer?.id === product.seller_id && (
              <p className="text-sm text-amber-200 mt-3">
                Это ваш товар. Для проверки покупки войдите отдельным аккаунтом
                покупателя.
              </p>
            )}
            <Link href="/wallets" className="text-acid text-xs block mt-3">
              Поддерживаемые сети и кошельки ↗
            </Link>
          </div>
          {review && order && !hash && (
            <div className="rounded-xl border border-acid/30 p-4 mb-4 text-xs space-y-3">
              <p className="text-acid">
                Проверка платежа · {ASSETS[order.asset].label}
              </p>
              <p>
                {stock && (
                  <span className="block">
                    Количество: {order.quantity} шт. ×{" "}
                    {displayAmount(order.unit_amount, order.asset)}
                  </span>
                )}
                Сумма: {displayAmount(order.amount, order.asset)} + комиссия
                сети
              </p>
              <p className="break-all">Продавец: {order.seller_wallet}</p>
              <p className="break-all">Платформа: {order.platform_wallet}</p>
              {order.affiliate_wallet && (
                <p className="break-all">Партнёр: {order.affiliate_wallet}</p>
              )}
              {order.network === "solana" && (
                <p className="text-muted">
                  Нужен SOL на комиссию сети и, для токенов, создание
                  недостающих счетов получателей. Эти расходы не входят в цену
                  товара.
                </p>
              )}
            </div>
          )}
          <button
            className="button-primary w-full"
            disabled={
              busy ||
              polling ||
              Boolean(hash) ||
              !viewer ||
              wrongFamily ||
              !ready ||
              Boolean(order?.reservation_released_at) ||
              (stock &&
                (!validQuantity ||
                  (!order && quantity > (stockAvailable ?? 0)))) ||
              viewer.id === product.seller_id
            }
            onClick={review ? buy : prepare}
          >
            {busy || polling ? (
              <LoaderCircle className="animate-spin" size={18} />
            ) : (
              <ArrowUpRight size={18} />
            )}{" "}
            {busy
              ? "Подождите…"
              : polling
                ? "Проверяем оплату"
                : hash
                  ? "Транзакция сохранена"
                  : !viewer
                    ? "Сначала войдите кошельком"
                    : review
                      ? "Подтвердить оплату в кошельке"
                      : "Проверить заказ"}
          </button>
          {hash && !polling && (
            <button
              onClick={() => {
                setError("");
                setPolling(true);
              }}
              className="button-secondary w-full mt-3"
            >
              <RefreshCw size={16} />
              Проверить ещё раз
            </button>
          )}
          {rejected && !polling && (
            <button
              className="button-secondary w-full mt-3"
              onClick={() => {
                setHash("");
                setRejected(false);
                setError("");
                setStatus("");
                clearCache();
              }}
            >
              Очистить отклонённый платёж
            </button>
          )}
          {order && !polling && !busy && (
            <details className="mt-4 text-xs text-muted">
              <summary className="cursor-pointer">
                Восстановить платёж по хешу
              </summary>
              <p className="my-3">
                Используйте транзакцию этого заказа. Не отправляйте обычный
                перевод на адрес продавца.
              </p>
              <input
                aria-label="Хеш транзакции"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Transaction hash / signature"
              />
              <button
                className="button-secondary mt-2"
                disabled={!manual}
                onClick={() => {
                  setError("");
                  remember(order, manual.trim());
                }}
              >
                Проверить хеш
              </button>
            </details>
          )}
        </>
      )}
      {status && (
        <p role="status" className="text-xs text-acid mt-4">
          {status}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="text-sm text-red-300 mt-4 break-words whitespace-pre-line"
        >
          {error}
        </p>
      )}
      {hash && (
        <p className="font-mono text-[10px] text-muted break-all mt-3">
          TX: {hash}
        </p>
      )}
      <div className="mt-6 text-xs text-muted flex gap-2">
        <LockKeyhole size={14} className="shrink-0" />
        <span>Защищённая загрузка после подтверждения платежа</span>
      </div>
      <button
        onClick={() => setQr(!qr)}
        className="mt-6 flex items-center gap-2 text-sm text-muted"
      >
        <QrCode size={17} />
        Оплатить с телефона
      </button>
      {qr && (
        <div className="mt-4">
          <div className="bg-white p-4 rounded-xl w-fit">
            <QRCodeSVG
              value={
                referralCode
                  ? `${appUrl}/r/${referralCode}`
                  : `${appUrl}/p/${product.id}`
              }
              size={180}
              level="M"
            />
          </div>
          <p className="text-xs text-muted mt-3 leading-5">
            QR открывает этот товар. Откройте ссылку в браузере совместимого
            кошелька, войдите и подтвердите покупку.
          </p>
        </div>
      )}
    </div>
  );
}
