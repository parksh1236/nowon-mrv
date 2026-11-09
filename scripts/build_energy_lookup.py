#!/usr/bin/env python3
"""Build a compact parcel usage lookup from monthly EAIS electricity/gas dumps."""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path


def load(path: Path, sigungu_cd: str) -> tuple[str, dict[tuple[str, str, str, str], int]]:
    values: dict[tuple[str, str, str, str], int] = defaultdict(int)
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


def build(sigungu_cd: str, electricity: Path, gas: Path) -> dict[str, object]:
    elec_month, elec = load(electricity, sigungu_cd)
    gas_month, gas_usage = load(gas, sigungu_cd)
    if elec_month != gas_month:
        raise ValueError(f"Electricity month {elec_month} and gas month {gas_month} differ")
    keys = sorted(elec.keys() | gas_usage.keys())
    return {
        "sigunguCd": sigungu_cd,
        "ym": elec_month,
        "columns": ["bjdongCd", "platGbCd", "bun", "ji", "elec", "gas"],
        "rows": [[*key, elec.get(key), gas_usage.get(key)] for key in keys],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sigungu", required=True)
    parser.add_argument("--electricity", type=Path, required=True)
    parser.add_argument("--gas", type=Path, required=True)
    args = parser.parse_args()
    payload = build(args.sigungu, args.electricity, args.gas)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"sigunguCd": payload["sigunguCd"], "ym": payload["ym"], "rows": len(payload["rows"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
