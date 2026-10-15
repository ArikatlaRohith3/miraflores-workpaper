"""Probe: compare every extracted value with the printed content of its page.

Prints mismatches so we can see what kinds of extraction errors the packet holds.
Usage: python -I tools/probe_extraction.py data/packet.json
"""
import json
import re
import sys
from collections import Counter

packet = json.load(open(sys.argv[1], encoding="utf-8"))
pages = {(d["id"], p["page"]): p["printed_content"] for d in packet["documents"] for p in d["pages"]}


def num(s):
    s = s.replace(",", "").replace("$", "").strip()
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


kinds = Counter()
for ev in packet["extracted_values"]:
    text = pages.get((ev["document_id"], ev["page"]), "")
    tar = ev.get("text_as_read") or ""
    issues = []
    if tar and tar not in text:
        issues.append("text_not_on_page")
    if ev["value_type"] == "money" and tar:
        n = num(tar)
        if n is not None and ev["value"] is not None and abs(n - float(ev["value"])) > 0.005:
            issues.append("value_differs_from_text")
    if ev["value_type"] in ("text", "ein", "ssn", "date", "code") and tar and str(ev["value"]) != tar and ev["value_type"] != "date":
        issues.append("text_value_differs")
    for i in issues:
        kinds[i] += 1
    if issues:
        print(ev["id"], ev["document_id"], ev["page"], ev["field"], "|", repr(ev["value"]), "| read:", repr(tar), "| conf", ev["confidence"], issues)
print(kinds)
print("low confidence (<0.7):")
for ev in packet["extracted_values"]:
    if ev["confidence"] < 0.7:
        print(" ", ev["id"], ev["document_id"], ev["field"], ev["value"], repr(ev["text_as_read"]), ev["confidence"])
