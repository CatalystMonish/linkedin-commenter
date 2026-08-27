import zlib, struct, math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
BLUE = (10, 102, 194)
WHITE = (255, 255, 255)
SS = 4  # supersample factor for antialiasing

def rounded_rect(x, y, w, h, r, px, py):
    if px < x or py < y or px > x + w or py > y + h:
        return False
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r

def bubble(px, py, S):
    """Speech bubble: rounded body + a tail at the bottom left."""
    bx, by, bw, bh = 0.20 * S, 0.24 * S, 0.60 * S, 0.42 * S
    if rounded_rect(bx, by, bw, bh, 0.12 * S, px, py):
        return True
    # tail: triangle hanging off the bottom-left of the body
    tx0, ty0 = 0.30 * S, by + bh - 0.02 * S
    tx1, ty1 = 0.46 * S, by + bh - 0.02 * S
    tx2, ty2 = 0.30 * S, 0.80 * S
    if ty0 <= py <= ty2:
        t = (py - ty0) / max(1e-6, (ty2 - ty0))
        return tx0 <= px <= tx1 + (tx0 - tx1) * t
    return False

def render(size):
    S = size * SS
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(SS):
                for sx in range(SS):
                    px = x * SS + sx + 0.5
                    py = y * SS + sy + 0.5
                    if not rounded_rect(0.02 * S, 0.02 * S, 0.96 * S, 0.96 * S, 0.22 * S, px, py):
                        continue
                    color = WHITE if bubble(px, py, S) else BLUE
                    acc[0] += color[0]; acc[1] += color[1]; acc[2] += color[2]; acc[3] += 255
            n = SS * SS
            a = acc[3] / n
            if a > 0:
                # un-premultiply so edges stay crisp
                row += bytes((int(acc[0] / (acc[3] / 255)), int(acc[1] / (acc[3] / 255)),
                              int(acc[2] / (acc[3] / 255)), int(a)))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    return rows

def png(size, path):
    rows = render(size)
    raw = b"".join(b"\x00" + r for r in rows)
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    blob = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    open(path, "wb").write(blob)
    return len(blob)

for s in (16, 32, 48, 128):
    n = png(s, os.path.join(OUT, f"icon{s}.png"))
    print(s, n)
