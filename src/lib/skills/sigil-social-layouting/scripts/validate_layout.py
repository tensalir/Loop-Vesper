#!/usr/bin/env python3
"""
Validate a LayoutSpec JSON against hard rails (safe zones, CTA/legal minimums).
Reads JSON from stdin or first arg path. Exits 0 if valid, 1 if invalid; prints violations to stderr.
"""
import json
import sys

# Safe zone specs (match socialCreativeSpec.ts)
PLATFORMS = {
    "4x5": {"widthPx": 1440, "heightPx": 1800, "topPx": 180, "bottomPx": 180, "leftPx": 80, "rightPx": 80},
    "9x16": {"widthPx": 1440, "heightPx": 2560, "topPx": 240, "bottomPx": 492, "leftPx": 80, "rightPx": 80},
    "1:1": {"widthPx": 1080, "heightPx": 1080, "topPx": 80, "bottomPx": 80, "leftPx": 80, "rightPx": 80},
}
CTA_MIN_H, CTA_MIN_W = 44, 120
LEGAL_MIN_SCALE = 0.65


def validate(spec):
    violations = []
    fid = spec.get("formatId") or "4x5"
    plat = PLATFORMS.get(fid, PLATFORMS["1:1"])
    w, h = spec.get("widthPx", plat["widthPx"]), spec.get("heightPx", plat["heightPx"])
    top_n = plat["topPx"] / h
    bottom_n = 1 - plat["bottomPx"] / h
    left_n = plat["leftPx"] / w
    right_n = 1 - plat["rightPx"] / w

    for block in spec.get("textBlocks", []):
        bid = block.get("id", "?")
        bbox = block.get("bbox", {})
        x, y = bbox.get("x", 0), bbox.get("y", 0)
        bw, bh = bbox.get("width", 0), bbox.get("height", 0)

        if y < top_n:
            violations.append(f"{bid}: extends into top safe zone")
        if y + bh > bottom_n:
            violations.append(f"{bid}: extends into bottom safe zone")
        if x < left_n:
            violations.append(f"{bid}: extends into left safe zone")
        if x + bw > right_n:
            violations.append(f"{bid}: extends into right safe zone")

        if block.get("role") == "cta":
            pw, ph = bw * w, bh * h
            if ph < CTA_MIN_H or pw < CTA_MIN_W:
                violations.append(f"{bid}: CTA below min size {CTA_MIN_W}x{CTA_MIN_H}px")

        if block.get("role") == "legal":
            scale = block.get("scale", 1)
            if scale < LEGAL_MIN_SCALE:
                violations.append(f"{bid}: legal text scale below minimum")

    return violations


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            spec = json.load(f)
    else:
        spec = json.load(sys.stdin)
    violations = validate(spec)
    for v in violations:
        print(v, file=sys.stderr)
    sys.exit(0 if not violations else 1)


if __name__ == "__main__":
    main()
