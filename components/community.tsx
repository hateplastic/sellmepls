"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star, BadgeCheck } from "lucide-react";
import { api, walletError } from "@/lib/wallet";
export type CommunityEntry = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: { display_name: string };
  rating?: number;
  seller_reply?: string;
};
export function Community({
  productId,
  reviews,
  comments,
  userId,
  isSeller,
  canReview,
  ownReview,
}: {
  productId: string;
  reviews: CommunityEntry[];
  comments: CommunityEntry[];
  userId: string | null;
  isSeller: boolean;
  canReview: boolean;
  ownReview: { rating: number; body: string } | null;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  async function send(payload: unknown) {
    setBusy(true);
    setMessage("");
    try {
      await api("/api/community", payload);
      setMessage("Сохранено");
      router.refresh();
      return true;
    } catch (error) {
      setMessage(walletError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const entries = (items: CommunityEntry[], kind: "review" | "comment") => (
    <div className="divide-y divide-white/10">
      {items.map((item) => (
        <article key={item.id} className="py-6">
          <div className="flex gap-3 items-center flex-wrap">
            <strong>{item.author?.display_name || "Покупатель"}</strong>
            {item.rating && (
              <span className="text-acid inline-flex items-center gap-1">
                <Star size={14} />
                {item.rating}/5
              </span>
            )}
            <time className="text-xs text-muted">
              {new Date(item.created_at).toLocaleDateString("ru-RU", {
                timeZone: "UTC",
              })}
            </time>
          </div>
          {kind === "review" && (
            <p className="text-xs text-muted mt-2 flex gap-1 items-center">
              <BadgeCheck size={14} />
              Подтверждённая покупка
            </p>
          )}
          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted leading-6">
            {item.body}
          </p>
          {item.seller_reply && (
            <blockquote className="border-l-2 border-acid/40 pl-4 mt-4 text-sm whitespace-pre-wrap break-words">
              <strong className="text-acid block mb-2">Ответ продавца</strong>
              {item.seller_reply}
            </blockquote>
          )}
          {isSeller && kind === "review" && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">
                Ответить на отзыв
              </summary>
              <form
                className="mt-3 space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  await send({
                    action: "reply",
                    id: item.id,
                    body: d.get("body"),
                  });
                }}
              >
                <textarea
                  name="body"
                  maxLength={1000}
                  defaultValue={item.seller_reply || ""}
                  aria-label="Ответ продавца"
                />
                <button disabled={busy} className="button-secondary">
                  Сохранить ответ
                </button>
              </form>
            </details>
          )}
          {kind === "comment" && userId === item.author_id && (
            <button
              className="text-xs underline mt-2 text-muted"
              disabled={busy}
              onClick={() => send({ action: "delete-comment", id: item.id })}
            >
              Удалить мой комментарий
            </button>
          )}
        </article>
      ))}
    </div>
  );
  return (
    <section className="mt-12" id="community">
      <h2 className="text-2xl mb-4">Отзывы покупателей</h2>
      {reviews.length ? (
        entries(reviews, "review")
      ) : (
        <p className="text-muted text-sm my-5">
          Пока нет отзывов. Оценки появляются после оплаченных покупок.
        </p>
      )}
      {canReview && (
        <form
          className="panel p-5 space-y-4 mt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            await send({
              action: "review",
              productId,
              rating: Number(d.get("rating")),
              body: d.get("body"),
            });
          }}
        >
          <h3>{ownReview ? "Обновить мой отзыв" : "Оставить отзыв"}</h3>
          <label>
            Оценка
            <select
              name="rating"
              defaultValue={ownReview?.rating || 5}
              className="mt-2"
            >
              {[5, 4, 3, 2, 1].map((v) => (
                <option value={v} key={v}>
                  {v} / 5
                </option>
              ))}
            </select>
          </label>
          <label>
            Ваш опыт
            <textarea
              name="body"
              className="mt-2"
              required
              minLength={10}
              maxLength={2000}
              defaultValue={ownReview?.body || ""}
            />
          </label>
          <button className="button-primary" disabled={busy}>
            Сохранить отзыв
          </button>
        </form>
      )}
      <h2 className="text-2xl mt-10 mb-4">Вопросы и комментарии</h2>
      {entries(comments, "comment")}
      {userId ? (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const d = new FormData(form);
            if (
              await send({ action: "comment", productId, body: d.get("body") })
            )
              form.reset();
          }}
        >
          <label>
            Добавить комментарий
            <textarea
              className="mt-2"
              name="body"
              required
              minLength={2}
              maxLength={1000}
            />
          </label>
          <button disabled={busy} className="button-secondary">
            Отправить
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted">
          Войдите кошельком, чтобы задать вопрос. Для отзыва нужна
          подтверждённая покупка.
        </p>
      )}
      {message && (
        <p className="text-sm text-acid mt-4" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
