import { crc32, deflateSync } from "node:zlib";

/** An RGBA PNG with a gradient, so it isn't trivially compressible. */
export function png(width: number, height: number): Buffer {
    const chunk = (type: string, data: Buffer) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body));
        return Buffer.concat([length, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8);

    const rows: number[] = [];
    for (let y = 0; y < height; y++) {
        rows.push(0);
        for (let x = 0; x < width; x++) rows.push((x * 255) / width, (y * 255) / height, 128, 255);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(Buffer.from(rows))),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

/**
 * A looping GIF whose frames each fill the image with one palette color.
 * Image data emits a clear code before every pixel, so codes stay 3 bits wide.
 */
export function animatedGif(size: number, frameColors: number[], delayCs = 20): Buffer {
    const palette = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
    const bytes: number[] = [...Buffer.from("GIF89a"), size, 0, size, 0, 0x81, 0, 0, ...palette];
    bytes.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0);

    for (const color of frameColors) {
        bytes.push(0x21, 0xf9, 4, 0, delayCs, 0, 0, 0);
        bytes.push(0x2c, 0, 0, 0, 0, size, 0, size, 0, 0);
        const codes: number[] = [];
        for (let i = 0; i < size * size; i++) codes.push(4, color);
        codes.push(5);
        const data: number[] = [];
        let acc = 0;
        let bits = 0;
        for (const code of codes) {
            acc |= code << bits;
            bits += 3;
            while (bits >= 8) {
                data.push(acc & 0xff);
                acc >>= 8;
                bits -= 8;
            }
        }
        if (bits) data.push(acc);
        bytes.push(2);
        for (let i = 0; i < data.length; i += 255) {
            const block = data.slice(i, i + 255);
            bytes.push(block.length, ...block);
        }
        bytes.push(0);
    }
    bytes.push(0x3b);
    return Buffer.from(bytes);
}
