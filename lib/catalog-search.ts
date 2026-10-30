import { isCategory } from "./categories";
import type { Price, Product } from "./catalog";

export const CATALOG_SORTS = {
  newest: "Сначала новые",
  price_asc: "Цена: сначала дешевле",
  price_desc: "Цена: сначала дороже",
  title_asc: "Название: А → Я",
  title_desc: "Название: Я → А",
  rating: "По оценке покупателей",
  reviews: "По числу отзывов",
} as const;
export type CatalogSort = keyof typeof CATALOG_SORTS;
export type CatalogParams = Record<string, string | string[] | undefined>;
export function catalogFilters(params: CatalogParams) {
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] || "" : value || "";
  };
  const category = first("category");
  const sort = first("sort");
  return {
    q: first("q").trim().replace(/\s+/g, " ").slice(0, 120),
    category: isCategory(category) ? category : "",
    sort: (Object.hasOwn(CATALOG_SORTS, sort) ? sort : "newest") as CatalogSort,
    page: Math.max(
      1,
      Math.min(100000, Number.parseInt(first("page"), 10) || 1),
    ),
  };
}
export function catalogHref(
  filters: ReturnType<typeof catalogFilters>,
  page: number,
) {
  const params = new URLSearchParams({
    q: filters.q,
    category: filters.category,
    sort: filters.sort,
    page: String(page),
  });
  return `/?${params.toString()}#market`;
}
export type CatalogItem = {
  product: Product;
  rating: number | null;
  review_count: number;
  price_usd: number | null;
  display_price: Price | null;
  total_count: number;
};
