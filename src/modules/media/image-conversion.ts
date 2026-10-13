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
    if (metadata.format === "svg") {
      const svg = (
        typeof input === "string" ? await fsExtra.readFile(input) : input
      ).toString("utf8");
      // SVG is only used as raster input; reject entities, active content and
      // external resources rather than saving or serving executable XML.
      if (
        /<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject)\b|\bon\w+\s*=|\b(?:href|xlink:href)\s*=|@import|url\s*\(/i.test(
          svg,
        )
      ) {
        throw new Error("SVG contains active content or external resources.");
      }
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
