"use client";
import { useState } from "react";
import { Play, ChevronLeft, ChevronRight } from "lucide-react";
export function ProductGallery({
  productId,
  revision,
  title,
  images,
  youtubeId,
}: {
  productId: string;
  revision: number;
  title: string;
  images: number;
  youtubeId: string | null;
}) {
  const [selected, setSelected] = useState(0),
    [play, setPlay] = useState(false);
  const count = images + 1 + (youtubeId ? 1 : 0),
    video = !!youtubeId && selected === count - 1;
  const url = (index: number) =>
    `/api/preview/${productId}?v=${revision}${index ? `&image=${index - 1}` : ""}`;
  function select(index: number) {
    setSelected(index);
    setPlay(false);
  }
  return (
    <div>
      <div className="panel overflow-hidden relative aspect-[4/3] bg-black flex items-center justify-center">
        {video ? (
          play ? (
            <iframe
              className="w-full h-full"
              title={`${title} — видео`}
              src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          ) : (
            <button
              className="flex flex-col items-center gap-4 p-8"
              onClick={() => setPlay(true)}
            >
              <Play size={48} className="text-acid" />
              <span>Смотреть видео на YouTube</span>
              <span className="text-xs text-muted">
                Плеер загрузится после нажатия
              </span>
            </button>
          )
        ) : (
          <img
            src={url(selected)}
            alt={`${title} — фото ${selected + 1}`}
            className="w-full h-full object-contain"
          />
        )}
        {count > 1 && !play && (
          <>
            <button
              type="button"
              aria-label="Предыдущее фото"
              className="absolute left-2 top-1/2 rounded-full p-2 bg-black/65"
              onClick={() => select((selected + count - 1) % count)}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              aria-label="Следующее фото"
              className="absolute right-2 top-1/2 rounded-full p-2 bg-black/65"
              onClick={() => select((selected + 1) % count)}
            >
              <ChevronRight />
            </button>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="flex gap-2 overflow-x-auto py-3">
          {Array.from({ length: count }, (_, i) => (
            <button
              type="button"
              key={i}
              onClick={() => select(i)}
              aria-label={
                youtubeId && i === count - 1 ? "Видео YouTube" : `Фото ${i + 1}`
              }
              aria-pressed={selected === i}
              className={`h-16 w-20 shrink-0 rounded-lg overflow-hidden border ${selected === i ? "border-acid" : "border-white/15"}`}
            >
              {youtubeId && i === count - 1 ? (
                <Play size={22} className="mx-auto text-acid" />
              ) : (
                <img
                  src={url(i)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
