"use client";
import { FEE_SUMMARY } from "@/lib/pricing";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UploadCloud, Check, LoaderCircle } from "lucide-react";
import {
  ASSETS,
  isAssetOffered,
  type AssetId,
  type Price,
  type Product,
} from "@/lib/catalog";
import { api, walletError } from "@/lib/wallet";
import { publishProduct, updateProduct } from "@/app/dashboard/actions";
import { FilePicker } from "@/components/file-picker";
import { FILE_ACCEPT } from "@/lib/file-policy";
import { CATEGORIES } from "@/lib/categories";
import { MAX_GALLERY_IMAGES } from "@/lib/media";
export function ProductForm({
  evmWallet,
  solanaWallet,
  tronWallet = "",
  maxBytes,
  product,
}: {
  evmWallet: string;
  solanaWallet: string;
  tronWallet?: string;
  maxBytes: number;
  product?: Product;
}) {
  const router = useRouter(),
    ref = useRef<HTMLFormElement>(null);
  const [prices, setPrices] = useState<Partial<Record<AssetId, string>>>(
      product
        ? Object.fromEntries(
            product.prices
              .filter((p) => isAssetOffered(p.asset))
              .map((p) => [p.asset, p.amount]),
          )
        : { "base:USDC": "" },
    ),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const [, startTransition] = useTransition();
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [galleryKeep, setGalleryKeep] = useState(product?.gallery_keys || []);
  const [deliveryMode, setDeliveryMode] = useState<"file" | "stock">(
    product?.delivery_mode || "file",
  );
  async function upload(file: File, kind: "file" | "preview") {
    if (file.size < 1 || file.size > (kind === "preview" ? 5242880 : maxBytes))
      throw new Error(
        `Проверьте размер ${kind === "file" ? "файла" : "превью"}`,
      );
    setStatus(`Проверяем ${file.name}…`);
    const hash = await crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    );
    const checksum = btoa(String.fromCharCode(...new Uint8Array(hash)));
    const info = await api<{
      id: string;
      url: string;
      contentType: string;
      checksum: string;
    }>("/api/uploads", {
      kind,
      filename: file.name,
      bytes: file.size,
      contentType: file.type || "application/octet-stream",
      checksum,
    });
    setStatus(`Загружаем ${file.name}…`);
    const result = await fetch(info.url, {
      method: "PUT",
      headers: { "Content-Type": info.contentType },
      body: file,
    });
    if (!result.ok)
      throw new Error(
        "Хранилище отклонило загрузку. Проверьте соединение и CORS.",
      );
    return info.id;
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = new FormData(event.currentTarget);
      if (!product && (!file?.size || !preview?.size))
        throw new Error("Добавьте файл и превью");
      const selected = Object.entries(prices).map(([asset, amount]) => ({
        asset,
        amount,
      })) as Price[];
      if (!selected.length || selected.some((p) => !p.amount))
        throw new Error("Укажите цены для выбранных сетей");
      const fileId = file ? await upload(file, "file") : undefined,
        previewId = preview ? await upload(preview, "preview") : undefined;
      const galleryUploadIds: string[] = [];
      for (const image of galleryFiles)
        galleryUploadIds.push(await upload(image, "preview"));
      setStatus(product ? "Сохраняем изменения…" : "Публикуем товар…");
      const payload = {
        ...(product ? { id: product.id, revision: product.revision } : {}),
        title: data.get("title"),
        description: data.get("description"),
        category: data.get("category"),
        deliveryMode,
        youtubeUrl: data.get("youtubeUrl") || "",
        galleryKeep,
        galleryUploadIds,
        evmWallet: product ? evmWallet : data.get("evmWallet"),
        solanaWallet: product ? solanaWallet : data.get("solanaWallet"),
        tronWallet: product ? tronWallet : data.get("tronWallet"),
        prices: selected,
        fileId,
        previewId,
        affiliateEnabled: data.get("affiliateEnabled") === "on",
        affiliateBps: Math.round(Number(data.get("affiliatePercent")) * 100),
      };
      const result = await new Promise<{ id?: string; error?: string }>(
        (resolve, reject) =>
          startTransition(async () => {
            try {
              resolve(
                await (product
                  ? updateProduct(payload)
                  : publishProduct(payload)),
              );
            } catch (error) {
              reject(error);
            }
          }),
      );
      if (result.error) throw new Error(result.error);
      if (product) {
        router.push("/dashboard?saved=" + product.id);
        router.refresh();
        return;
      }
      setStatus("Товар опубликован");
      setFile(null);
      setPreview(null);
      setGalleryFiles([]);
      setGalleryKeep([]);
      setPrices({ "base:USDC": "" });
      ref.current?.reset();
      router.refresh();
    } catch (error) {
      setError(walletError(error));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={ref} onSubmit={submit} className="panel p-6 sm:p-8 space-y-5">
      <div>
        <p className="eyebrow mb-2">
          {product ? "Управление товаром" : "Новый релиз"}
        </p>
        <h2 className="text-2xl">
          {product ? "Редактировать товар" : "Создать товар"}
        </h2>
        {product && (
          <p className="text-sm text-muted mt-3">
            Ссылка на товар и история продаж сохраняются. Новые цены действуют
            для новых заказов. Заменённый файл станет доступен и прежним
            покупателям.
          </p>
        )}
      </div>
      <label>
        Название
        <input
          className="mt-2"
          name="title"
          defaultValue={product?.title}
          required
          minLength={3}
          maxLength={100}
          placeholder="Название вашей работы"
        />
      </label>
      <label>
        Описание
        <textarea
          className="mt-2 min-h-28"
          name="description"
          defaultValue={product?.description}
          required
          minLength={10}
          maxLength={5000}
          placeholder="Что получит покупатель? Формат, содержимое, условия использования."
        />
      </label>
      <label>
        Категория
        <select
          name="category"
          className="mt-2"
          defaultValue={product?.category || "other"}
          required
        >
          {Object.entries(CATEGORIES).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Как выдавать товар
        <select
          className="mt-2"
          value={deliveryMode}
          disabled={busy || Boolean(product)}
          onChange={(event) => {
            setDeliveryMode(event.target.value as "file" | "stock");
            setFile(null);
          }}
        >
          <option value="file">
            Файл — одинаковая копия каждому покупателю
          </option>
          <option value="stock">Поштучно — уникальные строки из TXT</option>
        </select>
        <span className="block text-xs text-muted mt-2">
          {deliveryMode === "stock"
            ? "Аккаунты, прокси, ключи и другие отдельные единицы. Одна непустая строка TXT — один товар. Покупатель выбирает количество и получает только оплаченные строки."
            : "Подходит для курсов, книг, архивов и других файлов, которые можно продавать многократно."}
        </span>
      </label>
      {product && (
        <div className="rounded-xl bg-white/5 p-4 text-sm space-y-3">
          <p className="break-all">
            {deliveryMode === "stock" ? "Исходная партия" : "Текущий файл"}:{" "}
            {product.file_name} · {(product.file_size / 1048576).toFixed(2)} MB
          </p>
          <img
            src={`/api/preview/${product.id}?v=${product.revision}`}
            alt="Текущее превью"
            className="max-h-40 rounded-lg object-contain"
          />
          <p className="text-muted">
            {deliveryMode === "stock"
              ? "Новые единицы добавляются в разделе «Склад» ниже. Изменения описания и цены не затрагивают уже созданные заказы."
              : "Оставьте выбор файла и превью пустым, чтобы сохранить текущие."}
          </p>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        {!(product && deliveryMode === "stock") && (
          <FilePicker
            label={
              deliveryMode === "stock"
                ? "Партия TXT · до 8 MB / 10 000 строк"
                : `${product ? "Заменить файл" : "Файл товара"} · до ${Math.floor(maxBytes / 1048576)} MB`
            }
            file={file}
            onChange={setFile}
            disabled={busy}
            accept={deliveryMode === "stock" ? ".txt,text/plain" : FILE_ACCEPT}
            hint={
              deliveryMode === "stock"
                ? "UTF-8. Например: login:password или один ключ на строку. Без заголовка. Пустые строки пропускаются, повторы отклоняются. Цена ниже задаётся за одну строку."
                : "ZIP, PDF, RAR, 7Z, документы, изображения, аудио и видео. Прямые исполняемые файлы и скрипты запрещены. ZIP можно перетащить сюда целиком."
            }
          />
        )}
        <FilePicker
          label={product ? "Заменить превью" : "Превью"}
          file={preview}
          onChange={setPreview}
          disabled={busy}
          accept="image/png,image/jpeg,image/webp"
          hint="PNG / JPG / WebP, до 5 MB. Это изображение обложки, а не файл товара."
        />
      </div>
      <div className="space-y-3">
        <label>
          Дополнительные фотографии · до {MAX_GALLERY_IMAGES}
          <input
            className="mt-2"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            disabled={
              busy ||
              galleryKeep.length + galleryFiles.length >= MAX_GALLERY_IMAGES
            }
            onChange={(event) => {
              const files = [...(event.target.files || [])];
              if (
                galleryKeep.length + galleryFiles.length + files.length >
                MAX_GALLERY_IMAGES
              ) {
                setError(
                  "В галерее можно оставить максимум пять дополнительных фото",
                );
                event.target.value = "";
                return;
              }
              if (
                files.some(
                  (f) =>
                    !["image/png", "image/jpeg", "image/webp"].includes(
                      f.type,
                    ) ||
                    f.size > 5242880 ||
                    f.size === 0,
                )
              ) {
                setError("Фотографии: JPG, PNG или WebP, каждая до 5 MB");
                event.target.value = "";
                return;
              }
              setGalleryFiles((current) => [...current, ...files]);
              setError("");
              event.target.value = "";
            }}
          />
        </label>
        {product &&
          galleryKeep.map((key) => (
            <div className="flex items-center gap-3" key={key}>
              <img
                alt="Фотография галереи"
                className="h-14 w-20 rounded object-cover"
                src={`/api/preview/${product.id}?image=${product.gallery_keys.indexOf(key)}&v=${product.revision}`}
              />
              <button
                className="text-sm text-muted"
                type="button"
                disabled={busy}
                onClick={() =>
                  setGalleryKeep((keys) => keys.filter((k) => k !== key))
                }
              >
                Убрать фото
              </button>
            </div>
          ))}
        {galleryFiles.map((image, index) => (
          <div
            className="flex items-center gap-3 text-sm"
            key={`${image.name}:${index}`}
          >
            <span className="break-all flex-1">{image.name}</span>
            <button
              type="button"
              disabled={busy}
              className="text-muted"
              onClick={() =>
                setGalleryFiles((files) => files.filter((_, i) => i !== index))
              }
            >
              Убрать
            </button>
          </div>
        ))}
        <p className="text-xs text-muted">
          Обложка остаётся главным фото. Остальные изображения покупатель сможет
          листать на странице товара.
        </p>
      </div>
      <label>
        Видео YouTube · необязательно
        <input
          name="youtubeUrl"
          className="mt-2"
          type="url"
          maxLength={500}
          defaultValue={
            product?.youtube_id
              ? `https://www.youtube.com/watch?v=${product.youtube_id}`
              : ""
          }
          placeholder="https://www.youtube.com/watch?v=…"
        />
        <span className="block text-xs text-muted mt-2">
          Встроенный плеер, без загрузки видео в хранилище. Автор видео должен
          разрешить встраивание.
        </span>
      </label>
      <fieldset>
        <legend className="text-sm text-muted mb-3">
          {deliveryMode === "stock"
            ? "Цена за одну единицу и принимаемые валюты"
            : "Принимаемые валюты и цены"}
        </legend>
        <div className="space-y-2">
          {Object.entries(ASSETS)
            .filter(([id]) => isAssetOffered(id))
            .map(([id, asset]) => (
              <div key={id} className="flex gap-4 items-center">
                <label className="flex items-center gap-3 w-48 shrink-0">
                  <input
                    type="checkbox"
                    checked={id in prices}
                    onChange={(e) =>
                      setPrices((prev) => {
                        const next = { ...prev };
                        if (e.target.checked) next[id as AssetId] = "";
                        else delete next[id as AssetId];
                        return next;
                      })
                    }
                  />
                  {asset.label}
                </label>
                {id in prices && (
                  <input
                    aria-label={`Цена ${asset.label}`}
                    className="max-w-44"
                    inputMode="decimal"
                    required
                    pattern="[0-9]+(\.[0-9]+)?"
                    value={prices[id as AssetId]}
                    onChange={(e) =>
                      setPrices((prev) => ({ ...prev, [id]: e.target.value }))
                    }
                    placeholder="0.00"
                  />
                )}
              </div>
            ))}
        </div>
        <p className="text-xs text-muted mt-3">
          Цена задаётся отдельно для каждой валюты. Конвертации и обмена токенов
          нет.
        </p>
      </fieldset>
      <fieldset className="panel p-4 space-y-4">
        <legend className="text-sm px-2">Партнёрская программа</legend>
        <label className="flex gap-3 items-center">
          <input
            type="checkbox"
            name="affiliateEnabled"
            defaultChecked={product?.affiliate_enabled}
          />
          Разрешить продвижение этого товара
        </label>
        <label>
          Вознаграждение партнёру, % от цены
          <input
            className="mt-2"
            name="affiliatePercent"
            type="number"
            min="1"
            max="90"
            step="0.01"
            defaultValue={product ? product.affiliate_bps / 100 : 10}
            required
          />
        </label>
        <p className="text-xs text-muted">
          Комиссия платформы: {FEE_SUMMARY}. Из цены также вычитается указанный
          процент партнёру. Без партнёрской продажи его комиссия не
          удерживается.
        </p>
      </fieldset>
      {product ? (
        <p className="text-sm text-muted">
          Кошельки для выплат меняются в{" "}
          <Link href="/dashboard" className="text-acid">
            профиле продавца
          </Link>
          .
        </p>
      ) : (
        <div className="grid gap-4">
          <label>
            EVM кошелёк для выплат
            <input
              name="evmWallet"
              className="mt-2 font-mono text-sm"
              defaultValue={evmWallet}
              required={Object.keys(prices).some(
                (k) => !k.startsWith("solana:") && !k.startsWith("tron:"),
              )}
              placeholder="0x…"
            />
          </label>
          <label>
            Solana кошелёк для выплат
            <input
              name="solanaWallet"
              className="mt-2 font-mono text-sm"
              defaultValue={solanaWallet}
              required={Object.keys(prices).some((k) =>
                k.startsWith("solana:"),
              )}
              placeholder="Адрес Solana"
            />
          </label>
          <input type="hidden" name="tronWallet" value={tronWallet} />
          <p className="text-xs text-muted">
            Эти адреса используются для новых заказов всех ваших товаров.
            Проверьте их перед публикацией.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-sm text-acid flex items-center gap-2">
          {busy ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <Check size={15} />
          )}{" "}
          {status}
        </p>
      )}
      <button disabled={busy} className="button-primary w-full">
        <UploadCloud size={17} />
        {busy
          ? "Сохранение…"
          : product
            ? "Сохранить изменения"
            : "Опубликовать товар"}
      </button>
      {product && (
        <Link href="/dashboard" className="button-secondary w-full">
          Отмена
        </Link>
      )}
      <p className="text-xs text-muted">
        Публикуйте только файлы, на распространение которых у вас есть права.
      </p>
    </form>
  );
}
