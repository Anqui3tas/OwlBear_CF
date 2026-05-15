import blobToBuffer from "./blobToBuffer";
import Vector2 from "./Vector2";

import { Outline } from "../types/Outline";

const lightnessDetectionOffset = 0.1;

function cross(origin: Vector2, a: Vector2, b: Vector2) {
  return (
    (a.x - origin.x) * (b.y - origin.y) -
    (a.y - origin.y) * (b.x - origin.x)
  );
}

function convexHull(points: Vector2[]): Vector2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Vector2[] = [];
  for (let point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Vector2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function getOpaqueBoundary(image: HTMLImageElement): Vector2[] {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    return [];
  }

  context.drawImage(image, 0, 0);
  const { data, width, height } = context.getImageData(
    0,
    0,
    image.width,
    image.height
  );

  const opaque = (x: number, y: number) =>
    x >= 0 &&
    x < width &&
    y >= 0 &&
    y < height &&
    data[(y * width + x) * 4 + 3] > 1;

  const points: Vector2[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        opaque(x, y) &&
        (!opaque(x - 1, y) ||
          !opaque(x + 1, y) ||
          !opaque(x, y - 1) ||
          !opaque(x, y + 1))
      ) {
        points.push({ x, y });
      }
    }
  }

  return points;
}

/**
 * @param {HTMLImageElement} image
 * @returns {boolean} True is the image is light
 */
export function getImageLightness(image: HTMLImageElement): boolean {
  const width = image.width;
  const height = image.height;
  let canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  let context = canvas.getContext("2d");
  if (!context) {
    return false;
  }

  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, width, height);

  const data = imageData.data;
  let lightPixels = 0;
  let darkPixels = 0;
  // Loop over every pixels rgba values
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const max = Math.max(Math.max(r, g), b);
    if (max < 128) {
      darkPixels++;
    } else {
      lightPixels++;
    }
  }

  const norm = (lightPixels - darkPixels) / (width * height);
  return norm + lightnessDetectionOffset >= 0;
}

type CanvasImage = {
  file: Uint8Array;
  width: number;
  height: number;
  mime: string;
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} type
 * @param {number} quality
 * @returns {Promise<CanvasImage>}
 */
export async function canvasToImage(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<CanvasImage | undefined> {
  return new Promise((resolve) => {
    canvas.toBlob(
      async (blob) => {
        if (blob) {
          const file = await blobToBuffer(blob);
          resolve({
            file,
            width: canvas.width,
            height: canvas.height,
            mime: type,
          });
        } else {
          resolve(undefined);
        }
      },
      type,
      quality
    );
  });
}

/**
 * @param {HTMLImageElement} image the image to resize
 * @param {number} size the size of the longest edge of the new image
 * @param {string} type the mime type of the image
 * @param {number} quality if image is a jpeg or webp this is the quality setting
 * @returns {Promise<CanvasImage | undefined>}
 */
export async function resizeImage(
  image: HTMLImageElement,
  size: number,
  type: string,
  quality: number
): Promise<CanvasImage | undefined> {
  const width = image.width;
  const height = image.height;
  const ratio = width / height;
  let canvas = document.createElement("canvas");
  if (ratio > 1) {
    canvas.width = size;
    canvas.height = Math.round(size / ratio);
  } else {
    canvas.width = Math.round(size * ratio);
    canvas.height = size;
  }
  let context = canvas.getContext("2d");
  if (context) {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } else {
    return undefined;
  }
  return await canvasToImage(canvas, type, quality);
}

/**
 * Create a image file with resolution `size`x`size` with cover cropping
 * @param {HTMLImageElement} image the image to resize
 * @param {string} type the mime type of the image
 * @param {number} size the width and height of the thumbnail
 * @param {number} quality if image is a jpeg or webp this is the quality setting
 */
export async function createThumbnail(
  image: HTMLImageElement,
  type: string,
  size = 300,
  quality = 0.5
): Promise<CanvasImage | undefined> {
  let canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  let context = canvas.getContext("2d");
  const ratio = image.width / image.height;
  if (ratio > 1) {
    const center = image.width / 2;
    const halfHeight = image.height / 2;
    if (context) {
      context.drawImage(
        image,
        center - halfHeight,
        0,
        image.height,
        image.height,
        0,
        0,
        canvas.width,
        canvas.height
      );
    }
  } else {
    const center = image.height / 2;
    const halfWidth = image.width / 2;
    if (context) {
      context.drawImage(
        image,
        0,
        center - halfWidth,
        image.width,
        image.width,
        0,
        0,
        canvas.width,
        canvas.height
      );
    }
  }

  return await canvasToImage(canvas, type, quality);
}

/**
 * Get the outline of an image
 * @param {HTMLImageElement} image
 * @returns {Outline}
 */
export function getImageOutline(
  image: HTMLImageElement,
  maxPoints: number = 100
): Outline {
  // Basic rect outline for fail conditions
  const defaultOutline: Outline = {
    type: "rect",
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  };
  try {
    let outlinePoints = convexHull(getOpaqueBoundary(image));

    if (outlinePoints.length > 0) {
      if (outlinePoints.length > maxPoints) {
        outlinePoints = Vector2.resample(outlinePoints, maxPoints);
      }
      const bounds = Vector2.getBoundingBox(outlinePoints);

      // Reject outline if it's area is less than 5% of the image
      const imageArea = image.width * image.height;
      const area = bounds.width * bounds.height;
      if (area < imageArea * 0.05) {
        return defaultOutline;
      }

      // Detect if the outline is a rectangle or circle
      if (Vector2.rectangular(outlinePoints)) {
        return {
          type: "rect",
          x: Math.round(bounds.min.x),
          y: Math.round(bounds.min.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        };
      } else if (
        Vector2.circular(
          outlinePoints,
          Math.max(bounds.width / 10, bounds.height / 10)
        )
      ) {
        return {
          type: "circle",
          x: Math.round(bounds.center.x),
          y: Math.round(bounds.center.y),
          radius: Math.round(Math.min(bounds.width, bounds.height) / 2),
        };
      } else {
        // Flatten and round outline to save on storage size
        const points = outlinePoints
          .map(({ x, y }) => [Math.round(x), Math.round(y)])
          .flat();
        return { type: "path", points };
      }
    } else {
      return defaultOutline;
    }
  } catch {
    return defaultOutline;
  }
}
