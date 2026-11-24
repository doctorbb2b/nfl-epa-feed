#!/usr/bin/env python3
"""Build NFL 2026 per-team game EPA records using nflverse processed play-by-play.

Runs on GitHub Actions, outside Apps Script; retains the original 26-column
NFL_refresh2026() aggregation logic and numeric units.
"""
import csv
import gzip
import io
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

SEASON = int(os.getenv("NFL_SEASON", "2026"))
SOURCE_URL = f"https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{SEASON}.csv.gz"
OUTPUT = Path(f"data/nfl_{SEASON}_team_games.csv")
STATUS = Path(f"data/nfl_{SEASON}_status.json")
FIELDS = [
    "season", "week", "game_id", "game_date", "team", "opponent", "side", "plays",
    "off_epa_per_play", "def_epa_per_play_allowed", "off_success_rate",
    "def_success_rate_allowed", "off_pass_epa_per_dropback",
    "def_pass_epa_per_dropback_allowed", "off_rush_epa_per_rush",
    "def_rush_epa_per_rush_allowed", "off_explosive_pass_rate",
    "def_explosive_pass_rate_allowed", "off_explosive_rush_rate",
    "def_explosive_rush_rate_allowed", "off_sack_rate_allowed", "def_sack_rate_generated",
    "off_cpoe", "def_cpoe_allowed", "off_first_down_rate", "def_first_down_rate_allowed"
]
REQUIRED = [
    "game_id", "week", "game_date", "home_team", "away_team", "posteam",
    "defteam", "epa", "success", "play_type", "yards_gained", "qb_dropback",
    "sack", "cpoe", "first_down"
]

def num(v):
    if v in (None, ""):
        return None
    try:
        x = float(v)
        return x if x == x and abs(x) != float("inf") else None
    except (ValueError, TypeError):
        return None

def fresh_bucket():
    return {k: 0.0 for k in ("n", "epa", "succ", "pn", "pepa", "rn", "repa",
                                  "px", "rx", "sacks", "drop", "cpoe", "cn", "fd")}

def add(bucket, row):
    play = row["play_type"]
    if play not in ("pass", "run"):
        return
    epa = num(row["epa"])
    if epa is None:
        return
    bucket["n"] += 1
    bucket["epa"] += epa
    bucket["succ"] += num(row["success"]) or 0
    yards = num(row["yards_gained"]) or 0
    if play == "pass":
        bucket["pn"] += 1
        bucket["pepa"] += epa
        bucket["px"] += int(yards >= 20)
    else:
        bucket["rn"] += 1
        bucket["repa"] += epa
        bucket["rx"] += int(yards >= 10)
    bucket["fd"] += int(row["first_down"] in ("1", "1.0"))
    if num(row["qb_dropback"]) == 1:
        bucket["drop"] += 1
        bucket["sacks"] += int(num(row["sack"]) == 1)
    cpoe = num(row["cpoe"])
    if cpoe is not None:
        bucket["cpoe"] += cpoe
        bucket["cn"] += 1

def rate(n, d):
    return n / d if d else ""

def row_for(g):
    a, d = g["off"], g["def"]
    if not a["n"] or not d["n"]:
        return None
    return [
        SEASON, g["week"], g["id"], g["date"], g["team"], g["opp"], g["side"], int(a["n"]),
        rate(a["epa"], a["n"]), rate(d["epa"], d["n"]),
        rate(a["succ"], a["n"]), rate(d["succ"], d["n"]),
        rate(a["pepa"], a["pn"]), rate(d["pepa"], d["pn"]),
        rate(a["repa"], a["rn"]), rate(d["repa"], d["rn"]),
        rate(a["px"], a["pn"]), rate(d["px"], d["pn"]),
        rate(a["rx"], a["rn"]), rate(d["rx"], d["rn"]),
        rate(a["sacks"], a["drop"]), rate(d["sacks"], d["drop"]),
        rate(a["cpoe"], a["cn"]), rate(d["cpoe"], d["cn"]),
        rate(a["fd"], a["n"]), rate(d["fd"], d["n"])
    ]

def aggregate(source_rows):
    groups = {}
    for r in source_rows:
        gid, off, defense = r["game_id"], r["posteam"], r["defteam"]
        home, away = r["home_team"], r["away_team"]
        if not (gid and off and defense and off != defense):
            continue
        if off not in (home, away) or defense not in (home, away):
            continue
        for team, opp, kind in ((off, defense, "off"), (defense, off, "def")):
            key = (gid, team)
            if key not in groups:
                groups[key] = {
                    "id": gid, "week": r["week"], "date": r["game_date"],
                    "team": team, "opp": opp, "side": "H" if team == home else "A",
                    "off": fresh_bucket(), "def": fresh_bucket()
                }
            add(groups[key][kind], r)
    out = [x for x in (row_for(g) for g in groups.values()) if x is not None]
    out.sort(key=lambda r: (int(r[1]), str(r[2]), str(r[4])))
    by_game = defaultdict(list)
    for row in out:
        by_game[row[2]].append(row)
    for gid, pair in by_game.items():
        if len(pair) != 2 or {x[6] for x in pair} != {"H", "A"}:
            raise RuntimeError(f"Incomplete/malformed team pair: {gid}")
        if not (pair[0][4] == pair[1][5] and pair[1][4] == pair[0][5]
                and pair[0][3] == pair[1][3]):
            raise RuntimeError(f"Nonreciprocal team pair: {gid}")
    return out

def main():
    req = Request(SOURCE_URL, headers={"User-Agent": "nfl-epa-incremental-feed/1.0"})
    with urlopen(req, timeout=120) as response, gzip.GzipFile(fileobj=response) as gz:
        reader = csv.DictReader(io.TextIOWrapper(gz, encoding="utf-8", newline=""))
        missing = sorted(set(REQUIRED) - set(reader.fieldnames or []))
        if missing:
            raise RuntimeError("nflverse schema changed: " + ", ".join(missing))
        rows = aggregate(reader)
    if not rows:
        raise RuntimeError("No team-game records; refusing to publish an empty feed")
    prior = []
    if OUTPUT.exists():
        with OUTPUT.open(newline="", encoding="utf-8") as fh:
            prior = list(csv.DictReader(fh))
    if len(rows) < len(prior):
        raise RuntimeError(f"Upstream shrank: {len(rows)} new vs {len(prior)} published")
    if prior and max(row[3] for row in rows) < max(r["game_date"] for r in prior):
        raise RuntimeError("Upstream latest game regressed; preserving existing feed")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(FIELDS)
        writer.writerows(rows)
    STATUS.write_text(json.dumps({
        "season": SEASON, "source": SOURCE_URL,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "team_rows": len(rows), "games": len(rows) // 2,
        "latest_game_date": max(row[3] for row in rows)
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Published {len(rows)} team rows; latest game {max(row[3] for row in rows)}")

if __name__ == "__main__":
    main()
