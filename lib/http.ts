import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appEnv } from "@/lib/env";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function sameOrigin(request: Request) {
  if (
    request.headers.get("origin") !==
    new URL(appEnv().NEXT_PUBLIC_APP_URL).origin
  )
    throw new HttpError(403, "Недопустимый источник запроса");
}
export async function readJson(request: Request) {
  if (!request.body) throw new HttpError(400, "Отсутствует JSON");
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new HttpError(413, "Запрос слишком большой");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Некорректный JSON");
  }
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store", Vary: "Cookie" },
  });
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return json(
      { error: "Проверьте поля запроса", fields: error.flatten().fieldErrors },
      400,
    );
  const id = crypto.randomUUID();
  console.error(
    `Request ${id}`,
    error instanceof Error ? error.name : "Unknown error",
  );
  return json({ error: `Сервис временно недоступен. Код: ${id}` }, 503);
}
