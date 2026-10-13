import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";
import { normalizeMediaImage } from "./image-conversion.js";

describe("image conversion", () => {
  const formats = ["image/png", "image/jpeg"];
  it.each(["webp", "avif", "tiff"] as const)(
    "converts %s to PNG with real pixels",
    async (format) => {
      const input = await sharp({
        create: { width: 8, height: 5, channels: 4, background: "#ff400080" },
      })
        .toFormat(format)
        .toBuffer();
      const result = await normalizeMediaImage(input, formats);
      expect(result.type).toMatchObject({
        mimeType: "image/png",
        extension: "png",
      });
      expect(await sharp(result.converted).metadata()).toMatchObject({
        width: 8,
        height: 5,
        format: "png",
      });
    },
  );
  it("keeps an already supported PNG unchanged", async () => {
    const input = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    expect(
      (await normalizeMediaImage(input, formats)).converted,
    ).toBeUndefined();
  });
  it("rasterizes a passive SVG and never returns SVG to the client", async () => {
    const result = await normalizeMediaImage(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>',
      ),
      formats,
    );
    expect(result.type.mimeType).toBe("image/png");
    expect(await sharp(result.converted).metadata()).toMatchObject({
      format: "png",
      width: 4,
    });
  });
  it.each([
    "<script>alert(1)</script>",
    '<image href="http://127.0.0.1/image"/>',
    '<rect onclick="doSomething()"/>',
  ])("rejects active SVG content %s", async (content) => {
    const input = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">${content}</svg>`,
    );
    await expect(normalizeMediaImage(input, formats)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it("rejects arbitrary bytes and oversized dimensions", async () => {
    await expect(
      normalizeMediaImage(Buffer.from("not an image"), formats),
    ).rejects.toBeInstanceOf(BadRequestException);
    const input = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"/>',
    );
    await expect(normalizeMediaImage(input, formats)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
