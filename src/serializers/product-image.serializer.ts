/**
 * Keep only the public fields and in a predictable order:
 * imageId, productId, url, variant, alt
 */

import type { ProductImageAttributes } from '../types/product-image.js';

type AnyImage = Partial<ProductImageAttributes> & Record<string, unknown>;

export function serializeProductImage(image: AnyImage) {
  return {
    imageId: image.imageId as string,
    productId: image.productId as string,
    url: image.url as string,
    variant: image.variant as string,
    alt: (image.alt ?? null) as string | null,
  };
}

export function serializeProductImages(images: unknown[]) {
  return (images as AnyImage[]).map(serializeProductImage);
}
