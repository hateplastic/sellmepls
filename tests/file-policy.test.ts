import { describe, expect, it } from "vitest";
import { fileExtension, validateFileHeader } from "../lib/file-policy";
describe("Upload content policy", () => {
  it.each([
    "file.exe",
    "file.exe.pdf",
    "file.PS1.zip",
    "file.pdf.exe",
    "file.svg",
    "file.pdf ",
    "../file.zip",
    "file:stream.pdf",
    "file\u202Efdp.exe",
  ])("rejects dangerous names %s", (name) =>
    expect(() => fileExtension(name)).toThrow(),
  );
  it.each(["zip", "pdf", "rar", "7z", "docx", "mp4", "csv"])(
    "accepts declared extension %s",
    (ext) => expect(fileExtension(`Course.${ext.toUpperCase()}`)).toBe(ext),
  );
  it.each(["file.pdf", "file.zip", "file.rar", "file.txt"])(
    "rejects a PE executable renamed to %s",
    (name) =>
      expect(() =>
        validateFileHeader(name, Buffer.from("MZ executable")),
      ).toThrow(/Исполняемый/),
  );
  it("rejects a zip renamed PDF and binary renamed text", () => {
    expect(() =>
      validateFileHeader("file.pdf", Buffer.from("504b0304", "hex")),
    ).toThrow(/не соответствует/);
    expect(() =>
      validateFileHeader("file.txt", Buffer.from([0, 0, 1, 2])),
    ).toThrow();
    expect(() =>
      validateFileHeader("file.txt", Buffer.from("<script>alert(1)</script>")),
    ).toThrow();
  });
  it.each([
    ["file.zip", "504b050600000000"],
    ["file.rar", "526172211a070100"],
    ["file.7z", "377abcaf271c"],
    ["file.png", "89504e470d0a1a0a"],
  ])("accepts matching signature %s", (name, hex) =>
    expect(() =>
      validateFileHeader(name, Buffer.from(hex, "hex")),
    ).not.toThrow(),
  );
  it("accepts PDF and UTF-8 documents", () => {
    expect(() =>
      validateFileHeader("file.pdf", Buffer.from("%PDF-1.4\n")),
    ).not.toThrow();
    expect(() =>
      validateFileHeader("file.md", Buffer.from("# Руководство\nТекст\n")),
    ).not.toThrow();
  });
});
