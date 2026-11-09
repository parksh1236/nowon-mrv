#!/usr/bin/env python3
"""Build map-ready parcel usage from EAIS dumps and a verified address coordinate cache."""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path


def parcel_address(row: list[str]) -> str:
    number = f"{'산' if row[7] == '1' else ''}{int(row[8])}"
    if int(row[9]):
        number += f"-{int(row[9])}"
    return f"{row[4]} {row[5]} {row[6]} {number}"


def load_usage(path: Path, sigungu_cd: str) -> tuple[str, dict[tuple[str, str, str, str, str], int]]:
    values: dict[tuple[str, str, str, str, str], int] = defaultdict(int)
    months: set[str] = set()
    with path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.reader(source, delimiter="|"):
            if len(row) < 17 or row[2] != sigungu_cd:
                continue
            months.add(row[0])
            key = (row[3], row[7], row[8], row[9], parcel_address(row))
            try:
                values[key] += int(float(row[16]))
            except ValueError:
                continue
    if len(months) != 1:
        raise ValueError(f"Expected one usage month in {path}, found {sorted(months)}")
    return months.pop(), dict(values)


def build(args: argparse.Namespace) -> tuple[list[dict[str, object]], dict[str, int | str]]:
    elec_month, electricity = load_usage(args.electricity, args.sigungu)
    gas_month, gas = load_usage(args.gas, args.sigungu)
    if elec_month != gas_month:
        raise ValueError(f"Electricity month {elec_month} and gas month {gas_month} differ")
    coords = json.loads(args.coords.read_text(encoding="utf-8"))
    metadata: dict[str, dict[str, object]] = {}
    if args.metadata:
        payload = json.loads(args.metadata.read_text(encoding="utf-8"))
        metadata = {item["addr"]: item for item in payload.get("buildings", [])}

    rows: list[dict[str, object]] = []
    all_keys = sorted(electricity.keys() | gas.keys())
    for bjdong_cd, plat_gb_cd, bun, ji, addr in all_keys:
        point = coords.get(addr)
        if not isinstance(point, dict) or not all(isinstance(point.get(k), (int, float)) for k in ("lat", "lng")):
            continue
        info = metadata.get(addr, {})
        rows.append({
            "addr": addr,
            "lat": point["lat"],
            "lng": point["lng"],
            "type": info.get("usage") or "용도정보 없음",
            "etc": info.get("name") or info.get("road") or "",
            "elec": electricity.get((bjdong_cd, plat_gb_cd, bun, ji, addr)),
            "gas": gas.get((bjdong_cd, plat_gb_cd, bun, ji, addr)),
            "ym": elec_month,
            "sigunguCd": args.sigungu,
            "bjdongCd": bjdong_cd,
            "platGbCd": plat_gb_cd,
            "bun": bun,
            "ji": ji,
        })
    return rows, {
        "month": elec_month,
        "source_parcels": len(all_keys),
        "mapped_parcels": len(rows),
        "unmapped_parcels": len(all_keys) - len(rows),
        "electricity_matches": sum(row["elec"] is not None for row in rows),
        "gas_matches": sum(row["gas"] is not None for row in rows),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sigungu", required=True)
    parser.add_argument("--electricity", type=Path, required=True)
    parser.add_argument("--gas", type=Path, required=True)
    parser.add_argument("--coords", type=Path, required=True)
    parser.add_argument("--metadata", type=Path)
    args = parser.parse_args()
    rows, stats = build(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
