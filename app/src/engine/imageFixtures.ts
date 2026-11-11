/**
 * Shared PNG/JPEG header fixtures for the tests around picture embedding.
 *
 * These are not decodable pictures — they are the *headers* the exporter reads, which is all it
 * needs: pdf-lib only inspects markers before embedding, and this module never touches pixels.
 * Keeping the builders in one file stops a fixture from drifting away from the parser it tests.
 */

export function pngDataUrl(options: {
  width?: number; height?: number; bitDepth?: number; colorType?: number; interlace?: number; extra?: number[];
} = {}): string {
  return toDataUrl('image/png', pngBytes(options));
}

export function pngBytes(options: {
  width?: number; height?: number; bitDepth?: number; colorType?: number; interlace?: number; extra?: number[];
} = {}): Uint8Array {
  const width = options.width ?? 8, height = options.height ?? 8;
  const ihdr = [
    width >>> 24, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    height >>> 24, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    options.bitDepth ?? 8, options.colorType ?? 2, 0, 0, options.interlace ?? 0,
  ];
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk('IHDR', ihdr),
    ...(options.extra ?? []),
    ...pngChunk('IDAT', [0x78, 0x9c, 0, 1, 2, 3]),
    ...pngChunk('IEND'),
  ]);
}

export function pngChunk(type: string, data: number[] = []): number[] {
  // PNG chunks are a four-byte length, the four-letter type, the data and a CRC nobody reads.
  const length = data.length;
  return [length >>> 24, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff,
    ...type.split('').map(char => char.charCodeAt(0)), ...data, 0, 0, 0, 0];
}

/** A JPEG made of the given segments, wrapped in SOI/EOI so a parser accepts it. */
export function jpegBytes(parts: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...parts.flat(), 0xff, 0xd9]);
}

export function jpegDataUrl(parts: number[][]): string {
  return toDataUrl('image/jpeg', jpegBytes(parts));
}

/** A JPEG segment: marker, two-byte length (counting itself), then the payload. */
export function jpegSegment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >>> 8, length & 0xff, ...payload];
}

/** Start-of-frame: precision, height, width, component count — what both pdf-lib and we read. */
export function sof(marker: number, width: number, height: number, components: number): number[] {
  return jpegSegment(marker, [8, height >>> 8, height & 0xff, width >>> 8, width & 0xff, components]);
}

/** Adobe APP14: "Adobe\0", version, two flags, bits per component, two subsampling bytes, transform. */
export function adobeApp14(transform: number | null, bits = 8): number[] {
  if (transform === null) return [];
  return jpegSegment(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, bits, 0, 0, 1, 1, transform]);
}

export function exifApp1(orientation: number, littleEndian = true): number[] {
  const num = (value: number, size: number) => {
    const bytes: number[] = [];
    for (let i = 0; i < size; i++) bytes.push((value >>> (8 * i)) & 0xff);
    return littleEndian ? bytes : bytes.reverse();
  };
  const u16 = (value: number) => num(value, 2);
  const u32 = (value: number) => num(value, 4);
  const tiff = [
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(0x2a), ...u32(8),   // header + IFD0 offset
    ...u16(1),                                                                  // one entry
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0,            // orientation, SHORT, count, value
    ...u32(0),                                                                  // no next IFD
  ];
  return jpegSegment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);            // "Exif\0\0"
}

export function toDataUrl(mime: string, bytes: Uint8Array): string {
  const base64 = typeof Buffer === 'undefined'
    ? btoa(String.fromCharCode(...bytes))
    : Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${base64}`;
}
