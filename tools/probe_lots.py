import json, re, sys
from collections import defaultdict
p = json.load(open(sys.argv[1], encoding="utf-8"))
docs = {d["id"]: d for d in p["documents"]}
LOT = re.compile(r"\b([MNX]\d+) (.+?) ([\d.]+) sh acquired (\S+) sold (\S+) proceeds ([\d,.]+) basis ([\d,.]+|\(not reported\)) (?:wash sale loss disallowed ([\d,.]+) )?(short|long)-term (covered|noncovered)")
f = lambda s: float(s.replace(",", "")) if s and s[0].isdigit() else None
truth = {}
for did in ["D28", "D30", "D31", "D74"]:
    for pg in docs[did]["pages"]:
        for m in LOT.finditer(pg["printed_content"]):
            lid, desc, q, acq, sold, pr, ba, wa, term, cov = m.groups()
            truth[(did, lid)] = dict(page=pg["page"], desc=desc, acq=acq, sold=sold, proceeds=f(pr), basis=f(ba), wash=f(wa) if wa else 0.0, term=term)
print("lots parsed", len(truth))
evs = defaultdict(dict)
for e in p["extracted_values"]:
    if e["document_id"] in ("D28", "D30", "D31", "D74") and "_" in e["field"]:
        lid, fld = e["field"].split("_", 1)
        evs[(e["document_id"], lid)][fld] = e
alias = {"description": "desc", "acquired": "acq"}
for k, t in sorted(truth.items()):
    ev = evs.get(k)
    if not ev:
        print("NOT EXTRACTED", k, t); continue
    for fld, e in ev.items():
        tf = alias.get(fld, fld)
        if tf in t and t[tf] is not None and e["value"] != t[tf]:
            print("MISMATCH", k, fld, "read", e["value"], "printed", t[tf], e["id"], e["confidence"])
# 8949 lines vs truth
v3 = p["return_versions"][2]
for l in v3["lines"]:
    m = re.match(r"F8949\.([A-Z])\.([A-Z]+\d+)$", l["key"])
    if not m: continue
    box, lid = m.groups()
    if lid[0] in "MNX":
        did = "D31" if lid[0] == "M" else ("D28" if lid[0] == "N" else "D74")
        t = truth.get((did, lid))
        lab = l["label"]
        mm = re.search(r"proceeds ([\d,.]+), basis ([\d,.]+)(?:, adjustment ([\d,.-]+))?", lab)
        if t and mm:
            pr, ba = f(mm.group(1)), f(mm.group(2))
            exp_term = "short" if box in "ABC" else "long"
            issues = []
            if abs(pr - t["proceeds"]) > .005: issues.append(f"proceeds {pr} vs {t['proceeds']}")
            if t["basis"] is not None and abs(ba - t["basis"]) > .005: issues.append(f"basis {ba} vs {t['basis']}")
            if exp_term != t["term"]: issues.append(f"term box {box} vs printed {t['term']}")
            if issues: print("8949", l["key"], issues, "|", lab[:160])
missing = [k for k in truth if k[0] != "D30" and not any(l["key"].endswith("." + k[1]) for l in v3["lines"])]
print("lots not on 8949:", missing)
print("sample 8949 label:", next(l for l in v3["lines"] if l["key"].startswith("F8949.A.X"))["label"])
