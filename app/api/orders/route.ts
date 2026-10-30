import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { getAddress, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { requireUser, rateLimit } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import {
  ASSETS,
  atomicPrice,
  split,
  isAssetEnabled,
  type Sale,
  type AssetId,
  type Price,
} from "@/lib/catalog";
import { paymentEnv, serverEvmRpc } from "@/lib/env";
import { configuredRouter } from "@/lib/payment-routers";
import { evmClient, routerAbi } from "@/lib/web3";
import { chains } from "@/lib/web3";
import { quoteDomain, quoteMessage, quoteTypes } from "@/lib/quote";
import { feeQuote, platformFee } from "@/lib/pricing";
import { referralFor } from "@/lib/referrals";
import {
  CHAIN_ENV,
  isEvmNetwork,
  isNetworkOffered,
  walletFamily,
} from "@/lib/network";
import {
  tronEnv,
  tronRead,
  assertTronNetwork,
  TRON_CHAIN_ID,
} from "@/lib/tron-rpc";
import { tronToEvm } from "@/lib/tron-address";
import { participantError } from "@/lib/payment-participants";
import { sameOrigin, readJson, json, failure, HttpError } from "@/lib/http";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await rateLimit(`order:${user.id}`, 20);
    const input = z
      .object({
        productId: z.string().uuid(),
        asset: z.string().refine(isAssetEnabled),
        quantity: z.number().int().min(1).max(1000).default(1),
        checkoutKey: z.string().uuid().optional(),
      })
      .parse(await readJson(request));
    const asset = ASSETS[input.asset as AssetId],
      db = adminDb();
    const previous = await db
      .from("sales")
      .select("*")
      .eq("product_id", input.productId)
      .eq("buyer_id", user.id)
      .eq("chain_environment", CHAIN_ENV)
      .eq("delivery_mode", "file")
      .or("status.eq.paid,tx_hash.not.is.null")
      .order("status", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previous.error) throw previous.error;
    if (previous.data) {
      if (previous.data.chain_environment !== CHAIN_ENV)
        throw new HttpError(409, "Заказ создан в другом окружении сети");
      return json(previous.data);
    }
    if (!isNetworkOffered(asset.network))
      throw new HttpError(
        409,
        "Новые оплаты в этой сети временно отключены. Выберите Base, Arbitrum, BNB Chain или Solana.",
      );
    if (walletFamily(asset.network) !== user.chain)
      throw new HttpError(
        400,
        asset.network === "tron"
          ? "Для оплаты TRON смените аккаунт и войдите через TronLink."
          : asset.network === "solana"
            ? "Сейчас вы вошли EVM-адресом. Для оплаты в Solana нажмите «Сменить аккаунт» и выберите Solana, либо выберите оплату в Base / Arbitrum."
            : "Сейчас вы вошли адресом Solana. Для оплаты в Base / Arbitrum нажмите «Сменить аккаунт» и выберите EVM, либо выберите оплату в Solana.",
      );
    const { data: product, error } = await db
      .from("products")
      .select("*")
      .eq("id", input.productId)
      .eq("active", true)
      .eq("is_hidden", false)
      .maybeSingle();
    if (error) throw error;
    if (!product) throw new HttpError(404, "Товар не найден");
    if (product.delivery_mode === "file" && input.quantity !== 1)
      throw new HttpError(
        400,
        "Файл продаётся одной покупкой. Количество доступно для поштучных товаров",
      );
    if (product.delivery_mode === "stock" && !input.checkoutKey)
      throw new HttpError(
        400,
        "Обновите страницу для создания поштучного заказа",
      );
    const price = (product.prices as Price[]).find(
      (p) => p.asset === input.asset,
    );
    if (!price) throw new HttpError(400, "Эта валюта не принимается");
    const { data: profile, error: profileError } = await db
      .from("users")
      .select("evm_wallet,solana_wallet,tron_wallet")
      .eq("id", product.seller_id)
      .single();
    if (profileError) throw profileError;
    const e = paymentEnv(),
      unitAmount = atomicPrice(price),
      amount = unitAmount * BigInt(input.quantity);
    if (
      amount >
      (asset.network === "solana" ? 9_000_000_000_000_000n : 10n ** 35n)
    )
      throw new HttpError(
        400,
        "Сумма заказа превышает лимит. Уменьшите количество",
      );
    const signer = privateKeyToAccount(
      e.QUOTE_SIGNER_PRIVATE_KEY as `0x${string}`,
    );
    const platform =
      asset.network === "tron"
        ? tronEnv().platform
        : asset.network === "solana"
          ? new PublicKey(e.PLATFORM_SOLANA_WALLET).toBase58()
          : getAddress(e.PLATFORM_EVM_WALLET);
    const seller =
      asset.network === "tron"
        ? profile.tron_wallet
        : asset.network === "solana"
          ? profile.solana_wallet
          : profile.evm_wallet;
    if (!seller || seller.toLowerCase() === zeroAddress)
      throw new HttpError(400, "Не настроен кошелёк продавца");
    const normalize = (v: string) =>
      isEvmNetwork(asset.network) ? v.toLowerCase() : v;
    const conflict = participantError({
      buyer: user.address,
      seller,
      platform,
      solana: !isEvmNetwork(asset.network),
      ownProduct: user.id === product.seller_id,
    });
    if (conflict) throw new HttpError(400, conflict);
    let router: string | null = null;
    if (asset.network === "tron") {
      router = await configuredRouter("tron");
      if (!router)
        throw new HttpError(
          503,
          "Оплата TRON ещё не активирована владельцем платформы",
        );
      await assertTronNetwork();
      const [recipient, quoteSigner] = await Promise.all([
        tronRead(router, "platform()"),
        tronRead(router, "quoteSigner()"),
      ]);
      if (
        recipient.slice(-40).toLowerCase() !==
          tronToEvm(platform).slice(2).toLowerCase() ||
        quoteSigner.slice(-40).toLowerCase() !==
          signer.address.slice(2).toLowerCase()
      )
        throw new HttpError(503, "Конфигурация TRON не прошла проверку");
    } else if (isEvmNetwork(asset.network)) {
      const configured = await configuredRouter(asset.network);
      if (!configured)
        throw new HttpError(
          503,
          "Оплата в этой EVM-сети ещё не настроена. Выберите Solana или обратитесь к владельцу сервиса.",
        );
      router = getAddress(configured);
      const client = evmClient(asset.network, serverEvmRpc(asset.network));
      const [chainId, recipient, quoteSigner] = await Promise.all([
        client.getChainId(),
        client.readContract({
          address: router as `0x${string}`,
          abi: routerAbi,
          functionName: "platform",
        }),
        client.readContract({
          address: router as `0x${string}`,
          abi: routerAbi,
          functionName: "quoteSigner",
        }),
      ]);
      if (
        chainId !== client.chain.id ||
        getAddress(recipient) !== platform ||
        getAddress(quoteSigner) !== signer.address
      )
        throw new HttpError(503, "Конфигурация платежей не прошла проверку");
    }
    const referral = product.affiliate_enabled
      ? await referralFor(product.id, product.seller_id)
      : null;
    let affiliateWallet: string | null = null,
      affiliateId: string | null = null,
      linkId: string | null = null,
      affiliateBps = 0;
    if (
      referral &&
      referral.user_id !== user.id &&
      referral.user_id !== product.seller_id
    ) {
      const affiliate = await db
        .from("users")
        .select("evm_wallet,solana_wallet,tron_wallet")
        .eq("id", referral.user_id)
        .single();
      if (affiliate.error) throw affiliate.error;
      const wallet =
        asset.network === "tron"
          ? affiliate.data.tron_wallet
          : asset.network === "solana"
            ? affiliate.data.solana_wallet
            : affiliate.data.evm_wallet;
      if (!wallet)
        throw new HttpError(
          409,
          "Партнёр пока не настроил выплаты в этой сети. Выберите другую валюту или попросите его обновить профиль.",
        );
      if (
        wallet &&
        ![seller, platform, user.address, router]
          .filter(Boolean)
          .map((v) => normalize(v!))
          .includes(normalize(wallet))
      ) {
        affiliateWallet = wallet;
        affiliateId = referral.user_id;
        linkId = referral.id;
        affiliateBps = product.affiliate_bps;
      }
    }
    let quote;
    try {
      quote = await feeQuote(input.asset as AssetId);
    } catch {
      throw new HttpError(
        503,
        "Свежий курс ETH/SOL недоступен. Попробуйте позже или выберите USDC.",
      );
    }
    let parts;
    const commission = platformFee(amount, input.asset as AssetId, quote.rate);
    try {
      parts = split(
        amount,
        commission.fixedFee,
        affiliateBps,
        commission.feeBps,
      );
    } catch {
      throw new HttpError(
        400,
        "Цена товара не покрывает комиссию платформы и партнёра. Продавцу нужно повысить цену.",
      );
    }
    const { data: sale, error: saleError } = await db.rpc("create_order", {
      p_sale: {
        product_id: product.id,
        seller_id: product.seller_id,
        buyer_id: user.id,
        buyer_wallet: user.address,
        seller_wallet: seller,
        platform_wallet: platform,
        asset: input.asset,
        network: asset.network,
        amount: amount.toString(),
        fee: parts.fee.toString(),
        fixed_fee: commission.fixedFee.toString(),
        fee_bps: commission.feeBps,
        commission_version: commission.version,
        affiliate_amount: parts.affiliate.toString(),
        affiliate_wallet: affiliateWallet,
        affiliate_id: affiliateId,
        affiliate_link_id: linkId,
        affiliate_bps: affiliateBps,
        usd_rate: quote.rate,
        rate_quoted_at: quote.quotedAt,
        chain_environment: CHAIN_ENV,
        router,
        quantity: input.quantity,
        unit_amount: unitAmount.toString(),
        checkout_key: input.checkoutKey,
        product_revision: product.revision,
      },
    });
    if (saleError) {
      const messages: Record<string, string> = {
        inventory_insufficient:
          "На складе недостаточно единиц. Обновите страницу и уменьшите количество",
        inventory_pending_order:
          "У вас уже есть резерв этого товара с другим количеством или валютой. Откройте его в «Мои покупки» либо дождитесь завершения проверки резерва",
        inventory_pending_limit:
          "Сначала завершите текущие заказы: одновременно доступно до пяти резервов",
        product_edit_conflict:
          "Продавец изменил товар. Обновите страницу для новой цены",
        checkout_conflict: "Параметры заказа изменились. Обновите страницу",
      };
      const match = Object.keys(messages).find((key) =>
        saleError.message.includes(key),
      );
      if (match) throw new HttpError(409, messages[match]);
      throw saleError;
    }
    const order = sale as Sale;
    if (order.reservation_released_at)
      throw new HttpError(
        409,
        "Резерв истёк. Обновите страницу для нового заказа",
      );
    if (
      order.delivery_mode === "stock" &&
      order.status === "pending" &&
      Date.parse(order.expires_at) <= Date.now()
    )
      throw new HttpError(
        409,
        "Истёк срок оплаты. Резерв проверяется в сети; заказ сохранён в «Мои покупки»",
      );
    if (order.chain_environment !== CHAIN_ENV)
      throw new HttpError(409, "Заказ создан в другом окружении сети");
    if (
      order.network !== "solana" &&
      order.status === "pending" &&
      !order.quote_signature
    ) {
      if (!order.router) throw new Error("Missing router");
      if (order.delivery_mode === "stock") {
        const armed = await db.rpc("arm_inventory_payment", { p_id: order.id });
        if (armed.error) throw armed.error;
        if (!armed.data) throw new HttpError(409, "Срок резерва истёк");
      }
      order.quote_signature = await signer.signTypedData({
        domain: quoteDomain(
          order.network === "tron" ? TRON_CHAIN_ID : chains[order.network].id,
          order.network === "tron"
            ? tronToEvm(order.router)
            : getAddress(order.router),
        ),
        types: quoteTypes,
        primaryType: "Quote",
        message: quoteMessage(order),
      });
      const saved = await db
        .from("sales")
        .update({ quote_signature: order.quote_signature })
        .eq("id", order.id)
        .is("quote_signature", null);
      if (saved.error) throw saved.error;
    }
    return json(order, 201);
  } catch (error) {
    return failure(error);
  }
}
