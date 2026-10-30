"use client";
import { useEffect, useRef, useState } from "react";
import { Send, RefreshCw } from "lucide-react";
import type { ChatMessage } from "@/lib/messages";

export function Chat({
  conversationId,
  userId,
  initial,
  hasOlder,
}: {
  conversationId: string;
  userId: string;
  initial: ChatMessage[];
  hasOlder: boolean;
}) {
  const [messages, setMessages] = useState(initial),
    [body, setBody] = useState(""),
    [error, setError] = useState("");
  const [sending, setSending] = useState(false),
    [loading, setLoading] = useState(false),
    [older, setOlder] = useState(hasOlder);
  const pollCursor = useRef(initial.at(-1)?.id || 0),
    retry = useRef<{ id: string; body: string } | null>(null);
  const viewport = useRef<HTMLDivElement>(null),
    stick = useRef(true);
  function merge(next: ChatMessage[]) {
    setMessages((previous) =>
      Array.from(
        new Map([...previous, ...next].map((m) => [m.id, m])).values(),
      ).sort((a, b) => a.id - b.id),
    );
  }
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      let delay = 5000;
      try {
        if (document.visibilityState !== "hidden") {
          const response = await fetch(
            `/api/messages?conversation=${conversationId}&after=${pollCursor.current}`,
            { signal: controller.signal, cache: "no-store" },
          );
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error || "Не удалось обновить диалог");
          if (!stopped && result.messages.length) {
            merge(result.messages);
            pollCursor.current = result.messages.at(-1).id;
            if (result.more) delay = 1000;
          }
        }
      } catch (error) {
        if (!stopped) {
          setError(
            error instanceof Error ? error.message : "Проверьте соединение",
          );
          delay = 15000;
        }
      } finally {
        if (!stopped) timer = setTimeout(poll, delay);
      }
    }
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [conversationId]);
  useEffect(() => {
    if (stick.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [messages]);
  async function loadOlder() {
    if (loading || !messages.length) return;
    setLoading(true);
    setError("");
    stick.current = false;
    const element = viewport.current,
      height = element?.scrollHeight || 0,
      top = element?.scrollTop || 0;
    try {
      const response = await fetch(
        `/api/messages?conversation=${conversationId}&before=${messages[0].id}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Не удалось загрузить историю");
      merge(result.messages);
      setOlder(result.more);
      requestAnimationFrame(() => {
        if (element) element.scrollTop = top + element.scrollHeight - height;
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Не удалось загрузить историю",
      );
    } finally {
      setLoading(false);
    }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    if (retry.current?.body !== text)
      retry.current = { id: crypto.randomUUID(), body: text };
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          conversationId,
          clientId: retry.current.id,
          body: text,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Не удалось отправить сообщение");
      stick.current = true;
      merge([result.message]);
      setBody("");
      retry.current = null;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Не удалось отправить сообщение. Текст сохранён для повтора.",
      );
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="panel overflow-hidden">
      <div
        ref={viewport}
        onScroll={() => {
          const e = viewport.current;
          if (e)
            stick.current = e.scrollHeight - e.scrollTop - e.clientHeight < 80;
        }}
        className="h-[55vh] min-h-72 overflow-y-auto p-5 space-y-4"
        role="log"
        aria-label="Переписка"
        aria-live="polite"
      >
        {older && (
          <div className="text-center">
            <button
              className="button-secondary text-xs"
              disabled={loading}
              onClick={loadOlder}
            >
              <RefreshCw size={13} />
              {loading ? "Загрузка…" : "Предыдущие сообщения"}
            </button>
          </div>
        )}
        {!messages.length && (
          <p className="text-muted text-center py-16">
            Задайте вопрос о товаре. Переписка сохранится здесь.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender_id === userId ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.sender_id === userId ? "bg-acid/10 border border-acid/20" : "bg-white/5 border border-white/10"}`}
            >
              <p className="whitespace-pre-wrap break-words text-sm">
                {message.body}
              </p>
              <time
                dateTime={message.created_at}
                className="block mt-2 text-[11px] text-muted"
              >
                {new Date(message.created_at).toLocaleString("ru-RU", {
                  timeZone: "Europe/Chisinau",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="border-t border-white/10 p-4">
        <label htmlFor="chat-message" className="sr-only">
          Сообщение
        </label>
        <textarea
          id="chat-message"
          className="field"
          rows={3}
          maxLength={4000}
          required
          value={body}
          disabled={sending}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Ваш вопрос или ответ…"
        />
        <div className="flex justify-between items-center mt-3 gap-4">
          <span className="text-xs text-muted">
            {body.length}/4000 · Enter — новая строка
          </span>
          <button className="button-primary" disabled={sending || !body.trim()}>
            <Send size={16} />
            {sending ? "Отправка…" : "Отправить"}
          </button>
        </div>
        {error && (
          <p role="alert" className="text-red-300 text-sm mt-3">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
