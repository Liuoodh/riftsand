/**
 * Base64 — reference `util/Base64.ts`, with a pure-JS fallback.
 *
 * The reference relies on `btoa` / `Buffer`. Neither is guaranteed inside a
 * mini-game runtime, so the last-resort branch is a real implementation instead
 * of `unescape(encodeURIComponent(...))` (which is not base64 at all — the
 * reference only gets away with it because that branch is unreachable on its
 * target platforms).
 */
declare const Buffer: any;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Record<string, number> = (() => {
    const table: Record<string, number> = {};
    for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET[i]] = i;
    return table;
})();

/** UTF-8 string -> bytes */
function toBytes(str: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
            const next = str.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                i++;
            }
        }
        if (code < 0x80) {
            out.push(code);
        } else if (code < 0x800) {
            out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
            out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else {
            out.push(
                0xf0 | (code >> 18),
                0x80 | ((code >> 12) & 0x3f),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f),
            );
        }
    }
    return out;
}

/** bytes -> UTF-8 string */
function fromBytes(bytes: number[]): string {
    let out = '';
    let i = 0;
    while (i < bytes.length) {
        const b0 = bytes[i++];
        let code: number;
        if (b0 < 0x80) {
            code = b0;
        } else if (b0 < 0xe0) {
            code = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
        } else if (b0 < 0xf0) {
            code = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        } else {
            code = ((b0 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        }
        if (code > 0xffff) {
            code -= 0x10000;
            out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
        } else {
            out += String.fromCharCode(code);
        }
    }
    return out;
}

function encodeFallback(str: string): string {
    const bytes = toBytes(str);
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = bytes[i + 1];
        const b2 = bytes[i + 2];
        out += ALPHABET[b0 >> 2];
        out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
        out += b1 === undefined ? '=' : ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
        out += b2 === undefined ? '=' : ALPHABET[b2 & 0x3f];
    }
    return out;
}

function decodeFallback(encoded: string): string {
    const clean = encoded.replace(/[^A-Za-z0-9+/]/g, '');
    const bytes: number[] = [];
    for (let i = 0; i < clean.length; i += 4) {
        const c0 = LOOKUP[clean[i]] ?? 0;
        const c1 = LOOKUP[clean[i + 1]] ?? 0;
        const c2 = LOOKUP[clean[i + 2]];
        const c3 = LOOKUP[clean[i + 3]];
        bytes.push((c0 << 2) | (c1 >> 4));
        if (c2 !== undefined) bytes.push(((c1 & 0x0f) << 4) | (c2 >> 2));
        if (c3 !== undefined) bytes.push(((c2 & 0x03) << 6) | c3);
    }
    return fromBytes(bytes);
}

export class Base64 {
    /**
     * Binary-string semantics, exactly like the reference: one char = one byte.
     * This is what `binaryStringToUint8Array(Base64.decode(x))` in `util/string`
     * expects, so encode must NOT run the input through a UTF-8 encoder.
     */
    static encode(str: string): string {
        let out = '';
        for (let i = 0; i < str.length; i += 3) {
            const b0 = str.charCodeAt(i) & 0xff;
            const b1 = i + 1 < str.length ? str.charCodeAt(i + 1) & 0xff : undefined;
            const b2 = i + 2 < str.length ? str.charCodeAt(i + 2) & 0xff : undefined;
            out += ALPHABET[b0 >> 2];
            out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
            out += b1 === undefined ? '=' : ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
            out += b2 === undefined ? '=' : ALPHABET[b2 & 0x3f];
        }
        return out;
    }

    static decode(encodedStr: string): string {
        const clean = encodedStr.replace(/[^A-Za-z0-9+/]/g, '');
        let out = '';
        for (let i = 0; i < clean.length; i += 4) {
            const c0 = LOOKUP[clean[i]] ?? 0;
            const c1 = LOOKUP[clean[i + 1]] ?? 0;
            const c2 = LOOKUP[clean[i + 2]];
            const c3 = LOOKUP[clean[i + 3]];
            out += String.fromCharCode((c0 << 2) | (c1 >> 4));
            if (c2 !== undefined) out += String.fromCharCode(((c1 & 0x0f) << 4) | (c2 >> 2));
            if (c3 !== undefined) out += String.fromCharCode(((c2 & 0x03) << 6) | c3);
        }
        return out;
    }

    /**
     * UTF-8 helpers — not in the reference.
     *
     * The reference's `encode` is a bare `btoa`, which cannot represent anything
     * above U+00FF, and its fallback (`unescape(encodeURIComponent(s))`) produces
     * a byte string that `atob` never turns back into the original text. Anything
     * that needs to round-trip real text (settings blobs, share codes) must use
     * these instead.
     */
    static encodeUtf8(str: string): string {
        return encodeFallback(str);
    }

    static decodeUtf8(encodedStr: string): string {
        return decodeFallback(encodedStr);
    }


    static isBase64(str: string): boolean {
        if (!str || typeof str !== 'string') {
            return false;
        }
        const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
        if (!base64Regex.test(str)) {
            return false;
        }
        const strictBase64Regex = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
        return strictBase64Regex.test(str);
    }
}
