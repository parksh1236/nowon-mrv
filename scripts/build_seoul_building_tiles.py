"""Build Solar Lab tiles from the Seoul AL_D162 shapefile using pyproj."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
from struct import unpack, unpack_from

from pyproj import CRS, Transformer


def export(source, destination):
    shp_path = next(source.glob("*.shp"))
    projection = CRS.from_wkt(shp_path.with_suffix(".prj").read_text())
    transformer = Transformer.from_crs(projection, 4326, always_xy=True)
    tiles = defaultdict(list)
    records = 0
    with shp_path.open("rb") as shp, shp_path.with_suffix(".dbf").open("rb") as dbf:
        count, header_size, record_size = unpack_from("<IHH", dbf.read(32), 4)
        fields = {}
        offset = 1
        for _ in range((header_size - 33) // 32):
            descriptor = dbf.read(32)
            name = descriptor[:11].split(b"\0", 1)[0].decode("ascii")
            width = descriptor[16]
            fields[name] = slice(offset, offset + width)
            offset += width
        dbf.seek(header_size)
        shp.seek(100)
        for _ in range(count):
            row = dbf.read(record_size)
            _, words = unpack(">2i", shp.read(8))
            shape = shp.read(words * 2)
            if row.startswith(b"*") or unpack_from("<i", shape)[0] != 5:
                continue

            def value(name):
                return row[fields[name]].strip(b" \0").decode("cp949")

            def number(name):
                try:
                    result = float(value(name))
                    return round(result, 2) if result > 0 else None
                except ValueError:
                    return None

            part_count, point_count = unpack_from("<2i", shape, 36)
            starts = unpack_from(f"<{part_count}i", shape, 44)
            pairs = list(unpack_from("<2d", shape, 44 + 4 * part_count + 16 * i) for i in range(point_count))
            lon, lat = transformer.transform(*zip(*pairs))
            points = list(zip((round(x * 1_000_000) for x in lon), (round(y * 1_000_000) for y in lat)))
            rings = [points[a:b-1] for a, b in zip(starts, (*starts[1:], point_count))]
            rings = [ring for ring in rings if len(set(ring)) >= 3]
            if not rings:
                continue
            record = [
                value("A0"), value("A1"), value("A12"), value("A19"), value("A30"), value("A28"),
                number("A31"), number("A32"), number("A33"), number("A23"), number("A24"),
                value("A35"), value("A39"), value("A38"), rings,
            ]
            for x in range(min(p[0] for p in points) // 10000, max(p[0] for p in points) // 10000 + 1):
                for y in range(min(p[1] for p in points) // 10000, max(p[1] for p in points) // 10000 + 1):
                    tiles[x, y].append(record)
            records += 1
    destination.mkdir(parents=True, exist_ok=True)
    for (x, y), rows in sorted(tiles.items()):
        (destination / f"{x}-{y}.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (destination / "index.json").write_text(json.dumps([f"{x}-{y}" for x, y in sorted(tiles)], separators=(",", ":")))
    print(f"{records} of {count} source records in {len(tiles)} tiles")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    export(args.source, args.destination)
