import { BadRequestException } from "@nestjs/common";
import fileTypeChecker from "file-type-checker";
import fsExtra from "fs-extra";
import sharp from "sharp";
import { readFileHeader } from "../../uploads/streamed-upload.js";

/** Converts unsupported raster images to an allowed image format, never active SVG. */
export async function normalizeMediaImage(
  input: Buffer | string,
  supportedFormats: readonly string[],
) {
  const header =
    typeof input === "string" ? await readFileHeader(input) : input;
  const detected = fileTypeChecker.detectFile(header);
  if (
    detected?.mimeType &&
    detected.mimeType !== "image/svg+xml" &&
    supportedFormats.includes(detected.mimeType)
  ) {
    return { type: detected, converted: undefined };
  }
  const target = supportedFormats.includes("image/png")
    ? "png"
    : supportedFormats.includes("image/jpeg")
      ? "jpeg"
      : supportedFormats.includes("image/webp")
        ? "webp"
        : undefined;
  if (!target)
    throw new BadRequestException(
      "No supported image conversion output is configured.",
    );
  try {
    const textHeader = header.toString("latin1").replace(/\0/g, "").trimStart();
    if (
      (textHeader.startsWith("<") && header.includes(0)) ||
      ["fffe", "feff", "0000feff"].some((bom) =>
        header.toString("hex").startsWith(bom),
      )
    )
      throw new Error("SVG input must use UTF-8 encoding.");
    // Reject XML resources before handing SVG to a native decoder, including
    // XML prologues that extend beyond the header used for MIME detection.
    if (/^\uFEFF?\s*</.test(header.toString("utf8"))) {
      const svg = (
        typeof input === "string" ? await fsExtra.readFile(input) : input
      )
        .toString("utf8")
        .replace(
          /&#(?:x([0-9a-f]{1,8})|([0-9]{1,10}));/gi,
          (
            _match,
            hexadecimal: string | undefined,
            decimal: string | undefined,
          ) =>
            String.fromCodePoint(
              Number.parseInt(hexadecimal ?? decimal!, hexadecimal ? 16 : 10),
            ),
        );
      if (
        /\\|<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject)\b|\bon\w+\s*=|\b(?:href|xlink:href)\s*=|@import|url\s*\(/i.test(
          svg,
        )
      )
        throw new Error("SVG contains active content or external resources.");
    }
    const decoder = sharp(input, {
      limitInputPixels: 16_777_216,
      pages: 1,
      failOn: "warning",
    });
    const metadata = await decoder.metadata();
    if (
      !["avif", "heif", "webp", "png", "tiff", "gif", "jpeg", "svg"].includes(
        metadata.format ?? "",
      )
    ) {
      throw new Error("Not a supported image.");
    }
    const converted = await decoder
      .rotate()
      .timeout({ seconds: 10 })
      .toFormat(target)
      .toBuffer();
    return {
      type: {
        mimeType: `image/${target}`,
        extension: target === "jpeg" ? "jpg" : target,
      },
      converted,
    };
  } catch (error) {
    throw new BadRequestException(
      "This media format cannot be safely converted to a supported image.",
      { cause: error },
    );
  }
}
