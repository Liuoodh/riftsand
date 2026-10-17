/**
 * Little-endian byte cursor. Every Westwood asset format in this folder is a
 * flat little-endian binary blob, so one tiny Reader beats a dependency.
 */

export class Reader {
    private view: DataView;
    pos = 0;

    constructor(private buf: ArrayBuffer, public base = 0, public length = buf.byteLength) {
        this.view = new DataView(buf, 0, buf.byteLength);
    }

    get eof() {
        return this.pos - this.base >= this.length;
    }

    get remaining() {
        return this.length - (this.pos - this.base);
    }

    seek(p: number) {
        this.pos = p;
        return this;
    }

    skip(n: number) {
        this.pos += n;
        return this;
    }

    u8() {
        const v = this.view.getUint8(this.pos);
        this.pos += 1;
        return v;
    }

    i8() {
        const v = this.view.getInt8(this.pos);
        this.pos += 1;
        return v;
    }

    u16() {
        const v = this.view.getUint16(this.pos, true);
        this.pos += 2;
        return v;
    }

    i16() {
        const v = this.view.getInt16(this.pos, true);
        this.pos += 2;
        return v;
    }

    u32() {
        const v = this.view.getUint32(this.pos, true);
        this.pos += 4;
        return v;
    }

    i32() {
        const v = this.view.getInt32(this.pos, true);
        this.pos += 4;
        return v;
    }

    f32() {
        const v = this.view.getFloat32(this.pos, true);
        this.pos += 4;
        return v;
    }

    bytes(n: number): Uint8Array {
        const out = new Uint8Array(this.buf, this.pos, n);
        this.pos += n;
        return out;
    }
}
