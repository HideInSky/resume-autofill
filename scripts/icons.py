"""把图标画成 PNG（16/32/48/128）。不依赖任何第三方库；形状和 icons/icon.svg 保持一致。
用法：python3 scripts/icons.py"""
import struct, zlib, os

BG = (0x12, 0xA5, 0x6F)
RADIUS, HALF = 28, 7
SEGS = [((30, 40), (98, 40)), ((30, 64), (56, 64)), ((58, 88), (72, 100)), ((72, 100), (100, 66))]

def seg_dist(px, py, a, b):
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5

def inside_bg(x, y):
    qx, qy = abs(x - 64) - (64 - RADIUS), abs(y - 64) - (64 - RADIUS)
    return (max(qx, 0) ** 2 + max(qy, 0) ** 2) ** 0.5 + min(max(qx, qy), 0) <= RADIUS

def render(size, ss=4):
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            bg = fg = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = (i + (sx + 0.5) / ss) * 128 / size
                    y = (j + (sy + 0.5) / ss) * 128 / size
                    if inside_bg(x, y):
                        bg += 1
                        if any(seg_dist(x, y, a, b) <= HALF for a, b in SEGS):
                            fg += 1
            n = ss * ss
            if bg:
                w = fg / bg
                rgb = [round(c + (255 - c) * w) for c in BG]
            else:
                rgb = [0, 0, 0]
            row += bytes(rgb + [round(255 * bg / n)])
        rows.append(bytes(row))
    raw = b''.join(rows)
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
for s in (16, 32, 48, 128):
    open(os.path.join(here, f'icon{s}.png'), 'wb').write(render(s))
    print('icon', s)
