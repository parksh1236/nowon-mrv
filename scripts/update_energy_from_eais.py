#!/usr/bin/env python3
"""Update geocoded map samples from monthly EAIS electricity and gas dumps."""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path


def load_usage(path: Path, sigungu_cd: str) -> tuple[str, dict[tuple[str, str, str], int]]:
    usage: dict[tuple[str, str, str], int] = defaultdict(int)
    months: set[str] = set()
    with path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.reader(source, delimiter="|"):
            if len(row) < 17 or row[2] != sigungu_cd:
                continue
            months.add(row[0])
            key = (row[3], row[8], row[9])
            try:
                usage[key] += int(float(row[16]))
            except ValueError:
                continue
    if len(months) != 1:
        raise ValueError(f"Expected one usage month in {path}, found {sorted(months)}")
    return months.pop(), dict(usage)


def update_samples(target: Path, sigungu_cd: str, electricity: Path, gas: Path) -> dict[str, int | str]:
    elec_month, elec = load_usage(electricity, sigungu_cd)
    gas_month, gas_usage = load_usage(gas, sigungu_cd)
    if elec_month != gas_month:
        raise ValueError(f"Electricity month {elec_month} and gas month {gas_month} differ")

    samples = json.loads(target.read_text(encoding="utf-8"))
    elec_matches = gas_matches = with_usage = 0
    for sample in samples:
        key = (sample.get("bjdongCd"), sample.get("bun"), sample.get("ji"))
        sample["elec"] = elec.get(key)
        sample["gas"] = gas_usage.get(key)
        sample["ym"] = elec_month if sample["elec"] is not None or sample["gas"] is not None else None
        elec_matches += sample["elec"] is not None
        gas_matches += sample["gas"] is not None
        with_usage += sample["ym"] is not None

    target.write_text(json.dumps(samples, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {
        "month": elec_month,
        "samples": len(samples),
        "with_usage": with_usage,
        "electricity_matches": elec_matches,
        "gas_matches": gas_matches,
        "electricity_source_parcels": len(elec),
        "gas_source_parcels": len(gas_usage),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--sigungu", required=True)
    parser.add_argument("--electricity", type=Path, required=True)
    parser.add_argument("--gas", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(update_samples(args.target, args.sigungu, args.electricity, args.gas), ensure_ascii=False))


if __name__ == "__main__":
    main()
