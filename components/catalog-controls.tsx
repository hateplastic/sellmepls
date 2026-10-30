import Link from "next/link";
import { Search } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { CATALOG_SORTS, catalogFilters } from "@/lib/catalog-search";

export function CatalogControls({
  filters,
}: {
  filters: ReturnType<typeof catalogFilters>;
}) {
  return (
    <form
      action="/#market"
      className="panel p-4 sm:p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1.2fr_1.2fr_auto] items-end mb-5"
    >
      <label className="min-w-0 sm:col-span-2 lg:col-span-1">
        Найти товар
        <div className="relative mt-2">
          <Search
            className="absolute left-3 top-3.5 text-muted pointer-events-none"
            size={18}
          />
          <input
            name="q"
            type="search"
            defaultValue={filters.q}
            maxLength={120}
            placeholder="Например, парсер тг"
            style={{ paddingLeft: "2.5rem" }}
          />
        </div>
      </label>
      <label className="min-w-0">
        Категория
        <select
          name="category"
          defaultValue={filters.category}
          className="mt-2"
        >
          <option value="">Все цифровые товары</option>
          {Object.entries(CATEGORIES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0">
        Сортировать
        <select name="sort" defaultValue={filters.sort} className="mt-2">
          {Object.entries(CATALOG_SORTS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1">
        <button className="button-primary" type="submit">
          Найти
        </button>
        {(filters.q || filters.category || filters.sort !== "newest") && (
          <Link href="/#market" className="button-secondary">
            Сбросить
          </Link>
        )}
      </div>
    </form>
  );
}
