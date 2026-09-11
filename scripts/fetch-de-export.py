# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
VENDOR THE GAME'S OWN DATA, AND RECORD WHICH BUILD IT CAME FROM.

WHY THIS EXISTS
---------------
Every catalogue number this app uses arrives from a THIRD PARTY: weapons and
items from WFCD's `warframe-items`, mods from a `Mods.json`. Both are honest
re-publications of Digital Extremes' own export, but a re-publication is a
claim, and it can lag, round, rename or drop a field without saying so. DE
publishes the source at `content.warframe.com/PublicExport`, and this fetches
it.

WHAT DE ACTUALLY PUBLISHES - sixteen files, enumerated rather than assumed:

    ExportCustoms      ExportDrones        ExportFlavour      ExportFusionBundles
    ExportGear         ExportKeys          ExportRecipes      ExportRegions
    ExportRelicArcane  ExportResources     ExportSentinels    ExportSortieRewards
    ExportUpgrades     ExportWarframes     ExportWeapons      ExportManifest

There is NO enemy export. DE does not publish enemy health, shields, armour or
base level anywhere, so an enemy model cannot be "derived from game data" the
way a weapon can - it has to come from datamining or from the wiki, and must say
so. That is a boundary worth knowing exactly rather than discovering later.

WHY PYTHON, in a repo whose scripts are TypeScript
--------------------------------------------------
The index is LZMA1 in the "alone" container with a non-standard header. Node has
no LZMA in its standard library and the alternatives are native addons; Python's
`lzma` is stdlib and handles it with an explicit filter chain. This is a
by-hand vendoring step like the wiki scrape, not runtime code, so a build-time
interpreter costs the app nothing. `uv run` needs no virtualenv and the script
declares no dependencies.

PROVENANCE IS THE POINT
-----------------------
Manifest URLs are content-addressed - `Filename!hash` - and immutable. Every
file written here carries the hash it came from and the moment it was fetched,
so any number in the app can be traced to an exact game build. A vendored file
without its provenance is just a number somebody typed.

    uv run scripts/fetch-de-export.py --list
    uv run scripts/fetch-de-export.py --raw <dir>
"""
from __future__ import annotations

import argparse
import json
import lzma
import pathlib
import sys
import urllib.request
from datetime import datetime, timezone

BASE = "https://content.warframe.com/PublicExport"
INDEX = f"{BASE}/index_en.txt.lzma"

# A courteous identifier. DE publish no rate limit for PublicExport and the
# manifests are immutable, but an anonymous flood is nobody's friend.
UA = "raijiframe-vendor/1.0 (+build-time catalogue fetch; manifests cached by hash)"


def _get(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def index_entries() -> list[str]:
    """
    The manifest list, one `Filename!hash` per line.

    The 13-byte skip is not a guess: the container writes a 13-byte "alone"
    header that Python's FORMAT_ALONE reader rejects on this file, so the
    payload is decoded raw with the filter chain that header would have
    described. Documented in docs/DATA-SOURCES.md.
    """
    raw = _get(INDEX, timeout=30)
    dec = lzma.LZMADecompressor(
        format=lzma.FORMAT_RAW,
        filters=[{"id": lzma.FILTER_LZMA1, "dict_size": 1 << 24, "lc": 3, "lp": 0, "pb": 2}],
    )
    text = dec.decompress(raw[13:]).decode("utf-8", "replace")
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def fetch(entry: str) -> tuple[str, list[dict], str]:
    """
    One manifest, parsed. Returns (name, rows, hash).

    DE'S EXPORT IS NOT VALID JSON. It carries raw control characters inside
    string literals - real ones, in live files, not a transport artefact - and a
    strict parser rejects the whole document over a single byte in one
    description. They are stripped rather than escaped: nothing this app reads
    is a control character, and failing the entire catalogue over one is the
    worse outcome. Tab, newline and carriage return are kept.
    """
    name, _, digest = entry.partition("!")
    body = _get(f"{BASE}/Manifest/{urllib.request.quote(entry)}")
    text = body.decode("utf-8", "replace")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = json.loads("".join(c for c in text if c >= " " or c in "\t\n\r"))
    key = next(iter(data))
    rows = data[key]
    if not isinstance(rows, list):
        raise SystemExit(f"{name}: expected a row array under {key!r}, got {type(rows).__name__}")
    return name, rows, digest


def provenance(entry: str, rows: int) -> dict:
    name, _, digest = entry.partition("!")
    return {
        "source": f"{BASE}/Manifest/{name}!{digest}",
        "file": name,
        "hash": digest,
        "rows": rows,
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--list", action="store_true", help="print the manifest with row counts and sizes")
    ap.add_argument("--raw", metavar="DIR", help="write every manifest verbatim to DIR, with provenance")
    ap.add_argument("--only", nargs="*", help="restrict to these file names")
    a = ap.parse_args()

    entries = index_entries()
    if a.only:
        want = {n if n.endswith(".json") else f"{n}_en.json" for n in a.only}
        entries = [e for e in entries if e.partition("!")[0] in want]
        if not entries:
            raise SystemExit(f"none of {sorted(want)} are in the manifest")

    if not a.list and not a.raw:
        ap.print_help()
        return 2

    out = pathlib.Path(a.raw) if a.raw else None
    if out:
        out.mkdir(parents=True, exist_ok=True)
        (out / "index.txt").write_text("\n".join(entries), encoding="utf-8")

    manifest = []
    for entry in entries:
        name, rows, digest = fetch(entry)
        fields: set[str] = set()
        for r in rows:
            if isinstance(r, dict):
                fields.update(r)
        print(f"{name:<28} {len(rows):>6} rows  {len(fields):>3} fields  {digest[:12]}")
        if a.list:
            print(f"    {', '.join(sorted(fields))}")
        if out:
            (out / name).write_text(json.dumps(rows, indent=1), encoding="utf-8")
        manifest.append(provenance(entry, len(rows)))

    if out:
        (out / "provenance.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
        print(f"\nwrote {len(manifest)} files and provenance.json to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
