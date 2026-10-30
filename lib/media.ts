export const MAX_GALLERY_IMAGES = 5;

export function youtubeVideoId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Вставьте полную ссылку на видео YouTube");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Используйте HTTPS-ссылку YouTube");
  let id: string | null = null;
  if (url.hostname === "youtu.be") id = url.pathname.slice(1);
  else if (
    [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "www.youtube-nocookie.com",
    ].includes(url.hostname)
  ) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else
      id =
        /^\/(?:embed|shorts|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1] || null;
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id))
    throw new Error(
      "Нужна ссылка на отдельное видео YouTube, а не канал или плейлист",
    );
  return id;
}
