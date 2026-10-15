import json, re, sys
from collections import Counter
packet = json.load(open(sys.argv[1], encoding="utf-8"))
pages = {(d["id"], p["page"]): p["printed_content"] for d in packet["documents"] for p in d["pages"]}
NUM = re.compile(r"-?\d[\d,]*\.?\d*")
def nums(t):
    out=set()
    for m in NUM.findall(t):
        try: out.add(round(float(m.replace(",","").rstrip(".")),2))
        except: pass
    return out
c=Counter()
for ev in packet["extracted_values"]:
    t = pages.get((ev["document_id"], ev["page"]), "")
    v = ev["value"]
    if ev["value_type"] in ("money","quantity","integer","percent") and isinstance(v,(int,float)):
        ns = nums(t)
        if round(float(v),2) not in ns and round(-float(v),2) not in ns:
            c[ev["document_id"]]+=1
            print("NUM", ev["id"], ev["document_id"], ev["page"], ev["field"], v, repr(ev["text_as_read"]), ev["confidence"])
    elif ev["value_type"] in ("text","ein","ssn","code","account_number") and isinstance(v,str) and v and v not in t:
        c["txt"+ev["document_id"]]+=1
        print("TXT", ev["id"], ev["document_id"], ev["page"], ev["field"], repr(v), repr(ev["text_as_read"]), ev["confidence"])
print(c)
