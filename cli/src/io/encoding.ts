/**
 * Input decoding + normalization (PRD R8, TRD §10).
 * Windows PowerShell 5.1 pipes commonly produce UTF-16LE with BOM; terminals
 * paste ANSI escapes; Windows files carry CRLF. Handle all of it before the
 * pipeline sees the text.
 */

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

export type DecodeResult = {
  text: string;
  encoding: 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be';
};

function hasBom(bytes: Uint8Array, bom: number[]): boolean {
  return bom.every((b, i) => bytes[i] === b);
}

function looksLikeUtf16Le(bytes: Uint8Array): boolean {
  // No BOM but many 0x00 bytes at ODD offsets → UTF-16LE (ASCII-range text).
  const sample = bytes.subarray(0, Math.min(bytes.length, 2048));
  let zerosAtOdd = 0;
  let nonZero = 0;
  for (let i = 1; i < sample.length; i += 2) {
    if (sample[i] === 0) zerosAtOdd++;
    else nonZero++;
  }
  return zerosAtOdd >= 4 && zerosAtOdd >= nonZero;
}

function looksLikeUtf16Be(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 2048));
  let zerosAtEven = 0;
  let nonZero = 0;
  for (let i = 0; i < sample.length; i += 2) {
    if (sample[i] === 0) zerosAtEven++;
    else nonZero++;
  }
  return zerosAtEven >= 4 && zerosAtEven >= nonZero;
}

/** Decodes raw bytes to text, detecting BOM/UTF-16 with the TRD §10 rules. */
export function decodeBytes(bytes: Uint8Array): DecodeResult {
  if (hasBom(bytes, UTF8_BOM)) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (hasBom(bytes, UTF16LE_BOM)) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (hasBom(bytes, UTF16BE_BOM)) {
    // TextDecoder has no 'utf-16be' — swap the byte pairs and decode LE.
    const swapped = new Uint8Array(bytes.length - 2);
    for (let i = 2; i < bytes.length; i += 2) {
      swapped[i - 2] = bytes[i + 1] ?? 0;
      swapped[i - 1] = bytes[i] ?? 0;
    }
    return { text: new TextDecoder('utf-16le').decode(swapped), encoding: 'utf-16be' };
  }
  if (looksLikeUtf16Le(bytes)) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' };
  }
  if (looksLikeUtf16Be(bytes)) {
    const swapped = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 2) {
      swapped[i] = bytes[i + 1] ?? 0;
      swapped[i + 1] = bytes[i] ?? 0;
    }
    return { text: new TextDecoder('utf-16le').decode(swapped), encoding: 'utf-16be' };
  }
  // fatal:false → replacement chars instead of a crash on stray bytes.
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), encoding: 'utf-8' };
}

const ANSI_RE =
  // CSI sequences (colors, cursor moves) + OSC sequences (window titles).
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** CRLF → LF, strip ANSI escapes, trim. */
export function normalizeText(text: string): string {
  return text.replace(ANSI_RE, '').replace(/\r\n?/g, '\n').trim();
}
