import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";

export type VisionRegionInput = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type NormalizedVisionRegion = VisionRegionInput & {
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  sourceWidth: number;
  sourceHeight: number;
};

type DecodedPng = {
  width: number;
  height: number;
  pixels: Buffer;
};

type ColorBlobCandidate = {
  pixelCount: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type FindColorBlobsResult =
  | {
      ok: true;
      width: number;
      height: number;
      colorProfile: ColorBlobProfile;
      candidates: ColorBlobCandidate[];
      searchRegion: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      };
    }
  | {
      ok: false;
      error: string;
      width?: number;
      height?: number;
      searchRegion?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      };
    };

type PreparedVisionImage =
  | {
      ok: true;
      path: string;
      cleanup: () => void;
      sourceWidth: number;
      sourceHeight: number;
      region: NormalizedVisionRegion;
      scale: number;
    }
  | {
      ok: false;
      error: string;
    };

const PNG_SIGNATURE = "89504e470d0a1a0a";

export function readPngDimensions(filePath: string) {
  const raw = fs.readFileSync(filePath);
  if (raw.length < 24 || raw.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
    throw new Error("png_signature_invalid");
  }

  const ihdrLength = raw.readUInt32BE(8);
  const ihdrType = raw.subarray(12, 16).toString("ascii");
  if (ihdrType !== "IHDR" || ihdrLength < 13) {
    throw new Error("png_ihdr_missing");
  }

  return {
    width: raw.readUInt32BE(16),
    height: raw.readUInt32BE(20),
  };
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function paethPredictor(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(filePath: string): DecodedPng {
  const raw = fs.readFileSync(filePath);
  if (raw.length < 8 || raw.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
    throw new Error("png_signature_invalid");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  while (offset + 8 <= raw.length) {
    const length = raw.readUInt32BE(offset);
    const type = raw.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > raw.length) {
      throw new Error("png_chunk_truncated");
    }

    const data = raw.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0) {
    throw new Error("png_dimensions_invalid");
  }
  if (bitDepth !== 8) {
    throw new Error("png_bit_depth_unsupported");
  }
  if (![2, 6].includes(colorType)) {
    throw new Error("png_color_type_unsupported");
  }
  if (interlace !== 0) {
    throw new Error("png_interlace_unsupported");
  }

  const channels = colorType === 6 ? 4 : 3;
  const bytesPerPixel = channels;
  const stride = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const expected = height * (stride + 1);
  if (inflated.length < expected) {
    throw new Error("png_inflate_truncated");
  }

  const pixels = Buffer.alloc(width * height * 4);
  let srcOffset = 0;
  let dstOffset = 0;
  let prevScanline = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filterType = inflated.readUInt8(srcOffset);
    srcOffset += 1;
    const scanline = inflated.subarray(srcOffset, srcOffset + stride);
    srcOffset += stride;
    const recon = Buffer.alloc(stride);

    for (let i = 0; i < stride; i += 1) {
      const rawByte = scanline[i];
      const left = i >= bytesPerPixel ? recon[i - bytesPerPixel] : 0;
      const up = prevScanline[i];
      const upLeft = i >= bytesPerPixel ? prevScanline[i - bytesPerPixel] : 0;

      if (filterType === 0) {
        recon[i] = rawByte;
      } else if (filterType === 1) {
        recon[i] = (rawByte + left) & 0xff;
      } else if (filterType === 2) {
        recon[i] = (rawByte + up) & 0xff;
      } else if (filterType === 3) {
        recon[i] = (rawByte + Math.floor((left + up) / 2)) & 0xff;
      } else if (filterType === 4) {
        recon[i] = (rawByte + paethPredictor(left, up, upLeft)) & 0xff;
      } else {
        throw new Error("png_filter_unsupported");
      }
    }

    for (let x = 0; x < width; x += 1) {
      const src = x * bytesPerPixel;
      pixels[dstOffset] = recon[src];
      pixels[dstOffset + 1] = recon[src + 1];
      pixels[dstOffset + 2] = recon[src + 2];
      pixels[dstOffset + 3] = channels === 4 ? recon[src + 3] : 255;
      dstOffset += 4;
    }

    prevScanline = recon;
  }

  return { width, height, pixels };
}

function normalizeRegion(
  width: number,
  height: number,
  region?: VisionRegionInput
): NormalizedVisionRegion {
  const left = clampInteger(Number(region?.left ?? 0), 0, Math.max(width - 1, 0));
  const top = clampInteger(Number(region?.top ?? 0), 0, Math.max(height - 1, 0));
  const requestedWidth = Number(region?.width ?? width);
  const requestedHeight = Number(region?.height ?? height);
  const normalizedWidth = clampInteger(
    Number.isFinite(requestedWidth) ? requestedWidth : width,
    1,
    Math.max(width - left, 1)
  );
  const normalizedHeight = clampInteger(
    Number.isFinite(requestedHeight) ? requestedHeight : height,
    1,
    Math.max(height - top, 1)
  );
  const right = left + normalizedWidth;
  const bottom = top + normalizedHeight;
  return {
    left,
    top,
    width: normalizedWidth,
    height: normalizedHeight,
    right,
    bottom,
    centerX: Math.round(left + normalizedWidth / 2),
    centerY: Math.round(top + normalizedHeight / 2),
    sourceWidth: width,
    sourceHeight: height,
  };
}

function writeRgbAsPpm(filePath: string, width: number, height: number, rgb: Buffer) {
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  fs.writeFileSync(filePath, Buffer.concat([header, rgb]));
}

function cropAndScaleToRgb(
  image: DecodedPng,
  region: NormalizedVisionRegion,
  scale: number
) {
  const outputWidth = region.width * scale;
  const outputHeight = region.height * scale;
  const rgb = Buffer.alloc(outputWidth * outputHeight * 3);

  for (let outY = 0; outY < outputHeight; outY += 1) {
    const srcY = region.top + Math.min(Math.floor(outY / scale), region.height - 1);
    for (let outX = 0; outX < outputWidth; outX += 1) {
      const srcX = region.left + Math.min(Math.floor(outX / scale), region.width - 1);
      const srcIndex = (srcY * image.width + srcX) * 4;
      const alpha = image.pixels[srcIndex + 3] / 255;
      const dstIndex = (outY * outputWidth + outX) * 3;

      rgb[dstIndex] = Math.round(image.pixels[srcIndex] * alpha + 255 * (1 - alpha));
      rgb[dstIndex + 1] = Math.round(image.pixels[srcIndex + 1] * alpha + 255 * (1 - alpha));
      rgb[dstIndex + 2] = Math.round(image.pixels[srcIndex + 2] * alpha + 255 * (1 - alpha));
    }
  }

  return { width: outputWidth, height: outputHeight, rgb };
}

function isLikelyGreenActionButton(r: number, g: number, b: number, a: number) {
  return a >= 180 && g >= 95 && g - r >= 20 && g - b >= 10 && r <= 190 && b <= 190;
}

type ColorBlobProfile = "green_action";

function matchesColorBlobProfile(
  profile: ColorBlobProfile,
  r: number,
  g: number,
  b: number,
  a: number
) {
  switch (profile) {
    case "green_action":
      return isLikelyGreenActionButton(r, g, b, a);
    default:
      return false;
  }
}

function isLikelyNeutralInputFieldPixel(r: number, g: number, b: number, a: number) {
  if (a < 180) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const brightness = (r + g + b) / 3;
  return brightness >= 172 && max - min <= 42;
}

function isLikelyBrightInputFieldPixel(r: number, g: number, b: number, a: number) {
  if (a < 200) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const brightness = (r + g + b) / 3;
  return brightness >= 198 && max - min <= 24;
}

function findTextInputCandidateInRegion(input: {
  image: DecodedPng;
  region: NormalizedVisionRegion;
  pixelMatcher: (r: number, g: number, b: number, a: number) => boolean;
  minPixelCount: number;
  minWidthRatio: number;
  maxWidthRatio: number;
  minHeightRatio: number;
  maxHeightRatio: number;
  minFillRatio: number;
  scoreBias: number;
}) {
  const { image, region } = input;
  const width = image.width;
  const height = image.height;
  const regionWidth = region.width;
  const regionHeight = region.height;
  if (regionWidth <= 0 || regionHeight <= 0) return null;

  const mask = new Uint8Array(regionWidth * regionHeight);
  for (let y = region.top; y < region.bottom; y += 1) {
    for (let x = region.left; x < region.right; x += 1) {
      const regionIndex = (y - region.top) * regionWidth + (x - region.left);
      const pixelIndex = (y * width + x) * 4;
      const r = image.pixels[pixelIndex];
      const g = image.pixels[pixelIndex + 1];
      const b = image.pixels[pixelIndex + 2];
      const a = image.pixels[pixelIndex + 3];
      if (input.pixelMatcher(r, g, b, a)) {
        mask[regionIndex] = 1;
      }
    }
  }

  const visited = new Uint8Array(mask.length);
  const queue: number[] = [];
  let best:
    | {
        score: number;
        pixelCount: number;
        left: number;
        right: number;
        top: number;
        bottom: number;
        width: number;
        height: number;
        centerX: number;
        centerY: number;
      }
    | null = null;

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 1 || visited[index] === 1) continue;
    visited[index] = 1;
    queue.length = 0;
    queue.push(index);

    let head = 0;
    let pixelCount = 0;
    let minLeft = regionWidth - 1;
    let maxRight = 0;
    let minTop = regionHeight - 1;
    let maxBottom = 0;
    let sumX = 0;
    let sumY = 0;

    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      const y = Math.floor(current / regionWidth);
      const x = current % regionWidth;
      pixelCount += 1;
      minLeft = Math.min(minLeft, x);
      maxRight = Math.max(maxRight, x);
      minTop = Math.min(minTop, y);
      maxBottom = Math.max(maxBottom, y);
      sumX += x;
      sumY += y;

      const neighbors = [
        current - 1,
        current + 1,
        current - regionWidth,
        current + regionWidth,
      ];

      for (const next of neighbors) {
        if (next < 0 || next >= mask.length) continue;
        const nextY = Math.floor(next / regionWidth);
        const nextX = next % regionWidth;
        if (Math.abs(nextY - y) + Math.abs(nextX - x) !== 1) continue;
        if (mask[next] !== 1 || visited[next] === 1) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }

    const componentWidth = maxRight - minLeft + 1;
    const componentHeight = maxBottom - minTop + 1;
    const widthRatio = componentWidth / Math.max(width, 1);
    const heightRatio = componentHeight / Math.max(height, 1);
    const fillRatio = pixelCount / Math.max(componentWidth * componentHeight, 1);
    if (
      pixelCount < input.minPixelCount ||
      widthRatio < input.minWidthRatio ||
      widthRatio > input.maxWidthRatio ||
      heightRatio < input.minHeightRatio ||
      heightRatio > input.maxHeightRatio ||
      fillRatio < input.minFillRatio
    ) {
      continue;
    }

    const absoluteLeft = region.left + minLeft;
    const absoluteRight = region.left + maxRight;
    const absoluteTop = region.top + minTop;
    const absoluteBottom = region.top + maxBottom;
    const centerX = Math.round(region.left + sumX / pixelCount);
    const centerY = Math.round(region.top + sumY / pixelCount);
    const expectedLeft = Math.round(region.left + region.width * 0.08);
    const targetX = Math.round(region.left + region.width * 0.32);
    const targetY = Math.round(region.top + region.height * 0.56);
    const score =
      input.scoreBias +
      componentWidth * 2.6 +
      pixelCount * 0.13 +
      fillRatio * 90 -
      Math.abs(centerX - targetX) * 0.38 -
      Math.abs(centerY - targetY) * 0.62 -
      Math.abs(absoluteLeft - expectedLeft) * 0.14;

    const candidate = {
      score,
      pixelCount,
      left: absoluteLeft,
      right: absoluteRight,
      top: absoluteTop,
      bottom: absoluteBottom,
      width: componentWidth,
      height: componentHeight,
      centerX,
      centerY,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

export function preparePngRegionForOcr(input: {
  path: string;
  region?: VisionRegionInput;
  scale?: number;
}): PreparedVisionImage {
  try {
    const decoded = decodePng(input.path);
    const scale = clampInteger(Number(input.scale ?? 1), 1, 8);
    const region = normalizeRegion(decoded.width, decoded.height, input.region);
    const { width, height, rgb } = cropAndScaleToRgb(decoded, region, scale);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawmobile-ocr-"));
    const preparedPath = path.join(tempDir, "region.ppm");
    writeRgbAsPpm(preparedPath, width, height, rgb);

    return {
      ok: true,
      path: preparedPath,
      cleanup: () => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      },
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      region,
      scale,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: String(error?.message || error || "image_preprocess_failed"),
    };
  }
}

export function mapPreparedBoundsToSource(
  bounds: { left: number; top: number; right: number; bottom: number },
  transform: { region: NormalizedVisionRegion; scale: number }
) {
  const left = clampInteger(
    transform.region.left + Math.floor(Number(bounds.left || 0) / transform.scale),
    transform.region.left,
    Math.max(transform.region.right - 1, transform.region.left)
  );
  const top = clampInteger(
    transform.region.top + Math.floor(Number(bounds.top || 0) / transform.scale),
    transform.region.top,
    Math.max(transform.region.bottom - 1, transform.region.top)
  );
  const right = clampInteger(
    transform.region.left + Math.ceil(Number(bounds.right || 0) / transform.scale),
    left + 1,
    transform.region.right
  );
  const bottom = clampInteger(
    transform.region.top + Math.ceil(Number(bounds.bottom || 0) / transform.scale),
    top + 1,
    transform.region.bottom
  );

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    right,
    bottom,
    centerX: Math.round(left + (right - left) / 2),
    centerY: Math.round(top + (bottom - top) / 2),
  };
}

export function findColorBlobsInPng(input: {
  path: string;
  colorProfile: ColorBlobProfile;
  searchRegion?: VisionRegionInput;
  minXRatio?: number;
  maxXRatio?: number;
  minYRatio?: number;
  maxYRatio?: number;
  minPixelCount?: number;
  minWidthPx?: number;
  minHeightPx?: number;
  maxCandidates?: number;
}): FindColorBlobsResult {
  try {
    const decoded = decodePng(input.path);
    const width = decoded.width;
    const height = decoded.height;
    const explicitRegion = input.searchRegion
      ? normalizeRegion(width, height, input.searchRegion)
      : null;

    const left = explicitRegion
      ? explicitRegion.left
      : clampInteger(Math.round(width * Number(input.minXRatio ?? 0.72)), 0, width - 1);
    const right = explicitRegion
      ? explicitRegion.right - 1
      : clampInteger(
          Math.round(width * Number(input.maxXRatio ?? 1)),
          left,
          width - 1
        );
    const top = explicitRegion
      ? explicitRegion.top
      : clampInteger(Math.round(height * Number(input.minYRatio ?? 0.5)), 0, height - 1);
    const bottom = explicitRegion
      ? explicitRegion.bottom - 1
      : clampInteger(
          Math.round(height * Number(input.maxYRatio ?? 0.98)),
          top,
          height - 1
        );

    const regionWidth = right - left + 1;
    const regionHeight = bottom - top + 1;
    if (regionWidth <= 0 || regionHeight <= 0) {
      return {
        ok: false as const,
        error: "color_region_invalid",
        width,
        height,
      };
    }

    const mask = new Uint8Array(regionWidth * regionHeight);
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const regionIndex = (y - top) * regionWidth + (x - left);
        const pixelIndex = (y * width + x) * 4;
        const r = decoded.pixels[pixelIndex];
        const g = decoded.pixels[pixelIndex + 1];
        const b = decoded.pixels[pixelIndex + 2];
        const a = decoded.pixels[pixelIndex + 3];
        if (matchesColorBlobProfile(input.colorProfile, r, g, b, a)) {
          mask[regionIndex] = 1;
        }
      }
    }

    const visited = new Uint8Array(mask.length);
    const queue: number[] = [];
    const candidates: ColorBlobCandidate[] = [];
    const minPixelCount = Math.max(1, Math.round(Number(input.minPixelCount ?? 60)));
    const minWidthPx = Math.max(1, Math.round(Number(input.minWidthPx ?? 18)));
    const minHeightPx = Math.max(1, Math.round(Number(input.minHeightPx ?? 18)));

    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index] !== 1 || visited[index] === 1) continue;
      visited[index] = 1;
      queue.length = 0;
      queue.push(index);

      let head = 0;
      let pixelCount = 0;
      let minLeft = regionWidth - 1;
      let maxRight = 0;
      let minTop = regionHeight - 1;
      let maxBottom = 0;
      let sumX = 0;
      let sumY = 0;

      while (head < queue.length) {
        const current = queue[head];
        head += 1;
        const y = Math.floor(current / regionWidth);
        const x = current % regionWidth;
        pixelCount += 1;
        minLeft = Math.min(minLeft, x);
        maxRight = Math.max(maxRight, x);
        minTop = Math.min(minTop, y);
        maxBottom = Math.max(maxBottom, y);
        sumX += x;
        sumY += y;

        const neighbors = [
          current - 1,
          current + 1,
          current - regionWidth,
          current + regionWidth,
        ];

        for (const next of neighbors) {
          if (next < 0 || next >= mask.length) continue;
          const nextY = Math.floor(next / regionWidth);
          const nextX = next % regionWidth;
          if (Math.abs(nextY - y) + Math.abs(nextX - x) !== 1) continue;
          if (mask[next] !== 1 || visited[next] === 1) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }

      const componentWidth = maxRight - minLeft + 1;
      const componentHeight = maxBottom - minTop + 1;
      if (pixelCount < minPixelCount || componentWidth < minWidthPx || componentHeight < minHeightPx) {
        continue;
      }

      const centerX = Math.round(left + sumX / pixelCount);
      const centerY = Math.round(top + sumY / pixelCount);
      candidates.push({
        pixelCount,
        left: left + minLeft,
        right: left + maxRight,
        top: top + minTop,
        bottom: top + maxBottom,
        width: componentWidth,
        height: componentHeight,
        centerX,
        centerY,
      });
    }

    if (candidates.length === 0) {
      return {
        ok: false as const,
        error: "color_blob_not_found",
        width,
        height,
        searchRegion: { left, top, right, bottom },
      };
    }

    return {
      ok: true as const,
      width,
      height,
      colorProfile: input.colorProfile,
      candidates: candidates
        .slice()
        .sort((a, b) => Number(b.pixelCount || 0) - Number(a.pixelCount || 0))
        .slice(0, Math.max(1, Math.round(Number(input.maxCandidates ?? 12)))),
      searchRegion: { left, top, right, bottom },
    };
  } catch (error: any) {
    return {
      ok: false as const,
      error: String(error?.message || error || "color_blob_detection_failed"),
    };
  }
}

export function findTextInputFieldInPng(input: {
  path: string;
  searchRegion?: VisionRegionInput;
  minXRatio?: number;
  maxXRatio?: number;
  minYRatio?: number;
  maxYRatio?: number;
}) {
  try {
    const decoded = decodePng(input.path);
    const width = decoded.width;
    const height = decoded.height;
    const explicitRegion = input.searchRegion
      ? normalizeRegion(width, height, input.searchRegion)
      : null;

    const defaultRegion = normalizeRegion(width, height, {
      left: explicitRegion
        ? explicitRegion.left
        : clampInteger(Math.round(width * Number(input.minXRatio ?? 0.03)), 0, width - 1),
      top: explicitRegion
        ? explicitRegion.top
        : clampInteger(Math.round(height * Number(input.minYRatio ?? 0.78)), 0, height - 1),
      width: explicitRegion
        ? explicitRegion.width
        : clampInteger(
            Math.round(width * Number(input.maxXRatio ?? 0.86)),
            1,
            width
          ) -
          clampInteger(Math.round(width * Number(input.minXRatio ?? 0.03)), 0, width - 1),
      height: explicitRegion
        ? explicitRegion.height
        : clampInteger(
            Math.round(height * Number(input.maxYRatio ?? 0.98)),
            1,
            height
          ) -
          clampInteger(Math.round(height * Number(input.minYRatio ?? 0.78)), 0, height - 1),
    });

    if (defaultRegion.width <= 0 || defaultRegion.height <= 0) {
      return {
        ok: false as const,
        error: "text_input_region_invalid",
        width,
        height,
      };
    }

    const searchProfiles = explicitRegion
      ? [
          {
            region: defaultRegion,
            pixelMatcher: isLikelyBrightInputFieldPixel,
            minPixelCount: 220,
            minWidthRatio: 0.18,
            maxWidthRatio: 0.82,
            minHeightRatio: 0.014,
            maxHeightRatio: 0.09,
            minFillRatio: 0.28,
            scoreBias: 26,
          },
          {
            region: defaultRegion,
            pixelMatcher: isLikelyNeutralInputFieldPixel,
            minPixelCount: 180,
            minWidthRatio: 0.16,
            maxWidthRatio: 0.84,
            minHeightRatio: 0.012,
            maxHeightRatio: 0.09,
            minFillRatio: 0.22,
            scoreBias: 18,
          },
        ]
      : [
          {
            region: normalizeRegion(width, height, {
              left: Math.round(width * 0.04),
              top: Math.round(height * 0.84),
              width: Math.round(width * 0.78),
              height: Math.round(height * 0.115),
            }),
            pixelMatcher: isLikelyBrightInputFieldPixel,
            minPixelCount: 220,
            minWidthRatio: 0.18,
            maxWidthRatio: 0.82,
            minHeightRatio: 0.014,
            maxHeightRatio: 0.09,
            minFillRatio: 0.28,
            scoreBias: 28,
          },
          {
            region: normalizeRegion(width, height, {
              left: Math.round(width * 0.04),
              top: Math.round(height * 0.835),
              width: Math.round(width * 0.8),
              height: Math.round(height * 0.12),
            }),
            pixelMatcher: isLikelyNeutralInputFieldPixel,
            minPixelCount: 180,
            minWidthRatio: 0.16,
            maxWidthRatio: 0.84,
            minHeightRatio: 0.012,
            maxHeightRatio: 0.09,
            minFillRatio: 0.22,
            scoreBias: 20,
          },
          {
            region: defaultRegion,
            pixelMatcher: isLikelyNeutralInputFieldPixel,
            minPixelCount: 180,
            minWidthRatio: 0.16,
            maxWidthRatio: 0.88,
            minHeightRatio: 0.012,
            maxHeightRatio: 0.09,
            minFillRatio: 0.2,
            scoreBias: 10,
          },
        ];

    let best: ReturnType<typeof findTextInputCandidateInRegion> | null = null;
    let bestRegion = defaultRegion;

    for (const profile of searchProfiles) {
      const candidate = findTextInputCandidateInRegion({
        image: decoded,
        region: profile.region,
        pixelMatcher: profile.pixelMatcher,
        minPixelCount: profile.minPixelCount,
        minWidthRatio: profile.minWidthRatio,
        maxWidthRatio: profile.maxWidthRatio,
        minHeightRatio: profile.minHeightRatio,
        maxHeightRatio: profile.maxHeightRatio,
        minFillRatio: profile.minFillRatio,
        scoreBias: profile.scoreBias,
      });
      if (!candidate) continue;
      if (!best || candidate.score > best.score) {
        best = candidate;
        bestRegion = profile.region;
      }
    }

    if (!best) {
      return {
        ok: false as const,
        error: "text_input_not_found",
        width,
        height,
        searchRegion: defaultRegion,
      };
    }

    return {
      ok: true as const,
      width,
      height,
      point: {
        x: clampInteger(
          Math.round(best.left + Math.min(best.width * 0.28, Math.max(best.width - 24, 0))),
          best.left,
          best.right
        ),
        y: best.centerY,
      },
      bounds: {
        left: best.left,
        top: best.top,
        width: best.width,
        height: best.height,
        right: best.right,
        bottom: best.bottom,
        centerX: best.centerX,
        centerY: best.centerY,
      },
      pixelCount: best.pixelCount,
      searchRegion: bestRegion,
    };
  } catch (error: any) {
    return {
      ok: false as const,
      error: String(error?.message || error || "text_input_detection_failed"),
    };
  }
}
