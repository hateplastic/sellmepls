import Link from "next/link";
export default function NotFound() {
  return (
    <div className="shell py-24">
      <p className="eyebrow">404</p>
      <h1 className="text-4xl mt-4">Товар не найден</h1>
      <p className="text-muted mt-4">
        Ссылка недействительна или продавец снял товар с публикации.
      </p>
      <Link href="/" className="button-primary mt-6">
        На главную
      </Link>
    </div>
  );
}
