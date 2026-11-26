"""Build the static Yongin electricity/gas map dataset from uploaded source files."""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import shapefile
from pyproj import Transformer


DISTRICT_CODES = {"41461", "41463", "41465"}


def parcel_key(parts: list[str]) -> str | None:
    if len(parts) < 17 or parts[2] not in DISTRICT_CODES:
        return None
    bjdong = parts[3].strip().zfill(5)
    plat = parts[7].strip()
    bun = parts[8].strip().zfill(4)
    ji = parts[9].strip().zfill(4)
    if len(bjdong) != 5 or plat not in {"0", "1"}:
        return None
    pnu_land_code = str(int(plat) + 1)
    return f"{parts[2]}{bjdong}{pnu_land_code}{bun}{ji}"


def load_usage(path: Path) -> tuple[dict[str, int], int]:
    totals: dict[str, int] = defaultdict(int)
    records = 0
    with path.open("r", encoding="utf-8", errors="strict") as source:
        for line in source:
            parts = line.rstrip("\r\n").split("|")
            key = parcel_key(parts)
            if key is None:
                continue
            try:
                quantity = int(parts[16])
            except (ValueError, IndexError):
                continue
            if quantity < 0:
                continue
            totals[key] += quantity
            records += 1
    return dict(totals), records


def load_buildings(path: Path, wanted: set[str]) -> dict[str, dict[str, str]]:
    buildings: dict[str, dict[str, str]] = {}
    with zipfile.ZipFile(path) as archive, archive.open("build_gyunggi.txt") as source:
        for raw in source:
            if raw[:5].decode("ascii", errors="ignore") not in DISTRICT_CODES:
                continue
            parts = raw.decode("cp949").rstrip("\r\n").split("|")
            if len(parts) < 26:
                continue
            plat = parts[5].strip()
            pnu_land_code = str(int(plat) + 1)
            key = f"{parts[0][:5]}{parts[0][5:]}{pnu_land_code}{parts[6].strip().zfill(4)}{parts[7].strip().zfill(4)}"
            if key not in wanted or key in buildings:
                continue
            number = str(int(parts[6]))
            if int(parts[7]):
                number += f"-{int(parts[7])}"
            mountain = "산" if plat == "1" else ""
            address = " ".join(value.strip() for value in parts[1:4] if value.strip())
            buildings[key] = {
                "addr": f"{address} {mountain}{number}".strip(),
                "etc": parts[25].strip(),
            }
    return buildings


def load_coordinates(path: Path, wanted: set[str]) -> dict[str, tuple[float, float]]:
    coordinates: dict[str, tuple[float, float]] = {}
    transformer = Transformer.from_crs("EPSG:5186", "EPSG:4326", always_xy=True)
    with zipfile.ZipFile(path) as archive:
        stems = sorted({Path(name).stem for name in archive.namelist() if name.lower().endswith(".shp")})
        for stem in stems:
            with (
                archive.open(f"{stem}.shp") as shp,
                archive.open(f"{stem}.shx") as shx,
                archive.open(f"{stem}.dbf") as dbf,
            ):
                reader = shapefile.Reader(shp=shp, shx=shx, dbf=dbf, encoding="cp949")
                for shape_record in reader.iterShapeRecords():
                    key = str(shape_record.record[2]).strip()
                    if key not in wanted or key in coordinates:
                        continue
                    xmin, ymin, xmax, ymax = shape_record.shape.bbox
                    lng, lat = transformer.transform((xmin + xmax) / 2, (ymin + ymax) / 2)
                    if 126.4 <= lng <= 127.6 and 36.8 <= lat <= 37.6:
                        coordinates[key] = (lat, lng)
    return coordinates


def main() -> int:
    global DISTRICT_CODES
    parser = argparse.ArgumentParser()
    parser.add_argument("--electricity", type=Path, required=True)
    parser.add_argument("--gas", type=Path, required=True)
    parser.add_argument("--building-zip", type=Path, required=True)
    parser.add_argument("--cadastre-zip", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--district", action="append")
    parser.add_argument("--city", default="용인시")
    args = parser.parse_args()
    if args.district:
        DISTRICT_CODES = set(args.district)

    electricity, electricity_records = load_usage(args.electricity)
    gas, gas_records = load_usage(args.gas)
    wanted = set(electricity) | set(gas)
    buildings = load_buildings(args.building_zip, wanted)
    coordinates = load_coordinates(args.cadastre_zip, wanted)

    rows = []
    for key in sorted(wanted):
        if key not in coordinates:
            continue
        sigungu, bjdong, pnu_land, bun, ji = key[:5], key[5:10], key[10], key[11:15], key[15:19]
        plat = str(int(pnu_land) - 1)
        lat, lng = coordinates[key]
        building = buildings.get(key, {})
        rows.append(
            {
                "addr": building.get("addr", f"{args.city} {bun}-{ji}"),
                "lat": lat,
                "lng": lng,
                "type": "",
                "etc": building.get("etc", ""),
                "elec": electricity.get(key),
                "gas": gas.get(key),
                "ym": "202606",
                "sigunguCd": sigungu,
                "bjdongCd": bjdong,
                "platGbCd": plat,
                "bun": bun,
                "ji": ji,
            }
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    summary = {
        "electricityRecords": electricity_records,
        "gasRecords": gas_records,
        "sourceParcels": len(wanted),
        "mappedParcels": len(rows),
        "unmappedParcels": len(wanted) - len(rows),
        "withElectricity": sum(row["elec"] is not None for row in rows),
        "withGas": sum(row["gas"] is not None for row in rows),
        "withBuildingInfo": sum(bool(row["addr"]) for row in rows),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
