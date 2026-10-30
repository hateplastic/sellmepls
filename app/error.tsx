"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="shell py-24">
      <h1 className="text-3xl">Не удалось загрузить страницу</h1>
      <p className="text-muted mt-4">
        Проверьте соединение. Если ошибка повторяется, администратору нужно
        проверить конфигурацию сервиса и журнал сервера.
      </p>
      <button onClick={reset} className="button-primary mt-6">
        Попробовать снова
      </button>
    </div>
  );
}
