#!/usr/bin/env python3
"""Join monthly EAIS usage to bundled Seoul building polygons by parcel key."""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path


Parcel = tuple[str, str, str, str]


def load_usage(path: Path, sigungu_cd: str) -> tuple[str, dict[Parcel, int]]:
    values: dict[Parcel, int] = defaultdict(int)
    months: set[str] = set()
    with path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.reader(source, delimiter="|"):
            if len(row) < 17 or row[2] != sigungu_cd:
                continue
            months.add(row[0])
            key = (row[3], row[7], row[8], row[9])
            try:
                values[key] += int(float(row[16]))
            except ValueError:
                continue
    if len(months) != 1:
        raise ValueError(f"Expected one usage month in {path}, found {sorted(months)}")
    return months.pop(), dict(values)


def points(value: object):
    if isinstance(value, list) and len(value) == 2 and all(isinstance(v, (int, float)) for v in value):
        yield float(value[0]) / 1_000_000, float(value[1]) / 1_000_000
    elif isinstance(value, list):
        for child in value:
            yield from points(child)


def parcel_from_pnu(value: object) -> Parcel | None:
    pnu = str(value or "")
    if len(pnu) != 19 or not pnu.isdigit():
        return None
    return pnu[5:10], "1" if pnu[10] == "2" else "0", pnu[11:15], pnu[15:19]


def address(key: Parcel, dong_names: dict[str, str]) -> str:
    bjdong_cd, plat_gb_cd, bun, ji = key
    number = f"{'산' if plat_gb_cd == '1' else ''}{int(bun)}"
    if int(ji):
        number += f"-{int(ji)}"
    return f"서울특별시 {dong_names.get(bjdong_cd, '')} {number}".replace("  ", " ")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sigungu", required=True)
    parser.add_argument("--sigungu-name", required=True)
    parser.add_argument("--electricity", type=Path, required=True)
    parser.add_argument("--gas", type=Path, required=True)
    parser.add_argument("--tiles", type=Path, required=True)
    parser.add_argument("--bounds", nargs=4, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    args = parser.parse_args()

    elec_month, electricity = load_usage(args.electricity, args.sigungu)
    gas_month, gas = load_usage(args.gas, args.sigungu)
    if elec_month != gas_month:
        raise ValueError(f"Electricity month {elec_month} and gas month {gas_month} differ")
    wanted = electricity.keys() | gas.keys()
    mapped: dict[Parcel, dict[str, object]] = {}
    for path in sorted(args.tiles.glob("*.json")):
        for building in json.loads(path.read_text(encoding="utf-8")):
            if len(building) < 15 or building[12] != args.sigungu:
                continue
            key = parcel_from_pnu(building[1])
            if key not in wanted:
                continue
            coords = list(points(building[14]))
            if not coords:
                continue
            item = mapped.setdefault(key, {"points": [], "type": "", "etc": ""})
            item["points"].extend(coords)
            item["type"] = item["type"] or building[4] or "용도정보 없음"
            item["etc"] = item["etc"] or building[2] or building[3] or ""

    # Legal-dong names are preserved in the EAIS source and keyed by their 5-digit code.
    dong_names: dict[str, str] = {}
    with args.electricity.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.reader(source, delimiter="|"):
            if len(row) >= 7 and row[2] == args.sigungu:
                dong_names[row[3]] = f"{args.sigungu_name} {row[6]}"

    rows: list[dict[str, object]] = []
    for key in sorted(mapped):
        item = mapped[key]
        coords = item.pop("points")
        lat = sum(point[1] for point in coords) / len(coords)
        lng = sum(point[0] for point in coords) / len(coords)
        if args.bounds:
            west, south, east, north = args.bounds
            if not (west <= lng <= east and south <= lat <= north):
                continue
        rows.append({
            "addr": address(key, dong_names),
            "lat": lat,
            "lng": lng,
            "type": item["type"],
            "etc": item["etc"],
            "elec": electricity.get(key),
            "gas": gas.get(key),
            "ym": elec_month,
            "sigunguCd": args.sigungu,
            "bjdongCd": key[0],
            "platGbCd": key[1],
            "bun": key[2],
            "ji": key[3],
        })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "month": elec_month,
        "source_parcels": len(wanted),
        "mapped_parcels": len(rows),
        "unmapped_parcels": len(wanted) - len(rows),
        "electricity_matches": sum(row["elec"] is not None for row in rows),
        "gas_matches": sum(row["gas"] is not None for row in rows),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
