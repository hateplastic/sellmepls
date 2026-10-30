export const FILE_EXTENSIONS = [
  "zip",
  "rar",
  "7z",
  "pdf",
  "epub",
  "docx",
  "xlsx",
  "pptx",
  "txt",
  "md",
  "csv",
  "json",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "mp3",
  "wav",
  "mp4",
  "webm",
] as const;
export const FILE_ACCEPT = FILE_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(",");
const dangerous =
  /\.(exe|com|msi|dll|scr|bat|cmd|ps1|vbs|vbe|js|jse|wsf|hta|html?|svg|lnk|url|reg|jar)(\.|$)/i;
export function fileExtension(name: string) {
  if (
    !name ||
    /[\x00-\x1f\x7f/\\:\u202a-\u202e\u2066-\u2069]/.test(name) ||
    /[. ]$/.test(name) ||
    dangerous.test(name)
  )
    throw new Error("Недопустимое имя или исполняемый формат файла");
  const extension = name.split(".").pop()?.toLowerCase() || "";
  if (!(FILE_EXTENSIONS as readonly string[]).includes(extension))
    throw new Error(
      `Допустимые форматы: ${FILE_EXTENSIONS.join(", ").toUpperCase()}`,
    );
  return extension;
}
export function validateFileHeader(name: string, header: Uint8Array) {
  const extension = fileExtension(name),
    b = header;
  const hex = (signature: string, offset = 0) => {
    const bytes = signature.match(/../g)!.map((s) => parseInt(s, 16));
    return bytes.every((v, i) => b[offset + i] === v);
  };
  const ascii = (value: string, offset = 0) =>
    [...value].every((c, i) => b[offset + i] === c.charCodeAt(0));
  // Executables renamed as documents are rejected before any sealed object is created.
  if (
    ascii("MZ") ||
    hex("7f454c46") ||
    hex("cffaedfe") ||
    hex("feedfacf") ||
    ascii("#!")
  )
    throw new Error(
      "Исполняемый файл нельзя загрузить под видом документа или архива",
    );
  const zip = hex("504b0304") || hex("504b0506") || hex("504b0708");
  let valid = false;
  if (["zip", "epub", "docx", "xlsx", "pptx"].includes(extension)) valid = zip;
  else if (extension === "rar")
    valid = hex("526172211a0700") || hex("526172211a070100");
  else if (extension === "7z") valid = hex("377abcaf271c");
  else if (extension === "pdf") valid = ascii("%PDF-");
  else if (["jpg", "jpeg"].includes(extension)) valid = hex("ffd8ff");
  else if (extension === "png") valid = hex("89504e470d0a1a0a");
  else if (extension === "webp") valid = ascii("RIFF") && ascii("WEBP", 8);
  else if (extension === "wav") valid = ascii("RIFF") && ascii("WAVE", 8);
  else if (extension === "mp3")
    valid = ascii("ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
  else if (extension === "mp4") valid = ascii("ftyp", 4);
  else if (extension === "webm") valid = hex("1a45dfa3");
  else {
    // A binary payload with a text suffix is not accepted. Decode a prefix;
    // streaming mode permits a UTF-8 character split at the prefix boundary.
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(b, {
        stream: true,
      });
      valid =
        !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) &&
        !/^\s*(<!doctype\s+html|<html|<script|<svg|<\?php)/i.test(text);
    } catch {
      valid = false;
    }
  }
  if (!valid)
    throw new Error(
      "Содержимое файла не соответствует расширению. Выберите исходный файл в разрешённом формате.",
    );
}
