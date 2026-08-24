#!/usr/bin/env python3
import csv
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
course = json.loads((root / "assets/course-content.json").read_text())
targets = set()
for page in course["pages"]:
    for block in page["blocks"]:
        targets.update(w.lower() for w in re.findall(r"[A-Za-z][A-Za-z'-]*", block["text"]))

source = Path(sys.argv[1])
found = {}
with source.open(encoding="utf-8", newline="") as handle:
    for row in csv.DictReader(handle):
        word = row.get("word", "").strip().lower()
        if word not in targets:
            continue
        clean = lambda value: (value or "").replace("\\n", "\n").strip()
        found[word] = {
            "word": row.get("word", word),
            "phonetic": clean(row.get("phonetic", "")),
            "translation": clean(row.get("translation", "")),
            "definition": clean(row.get("definition", "")),
            "exchange": row.get("exchange", ""),
        }

manual = {
    "standing": ["原告资格；诉讼资格", "Constitutional law: whether the plaintiff is the proper party to bring the claim."],
    "justiciability": ["可诉性；法院可裁判性", "Whether a dispute is suitable for judicial resolution."],
    "ripeness": ["成熟性原则", "Whether a dispute has developed enough for judicial review."],
    "mootness": ["争议失效；案件已无实际意义", "Whether later events have removed the live controversy."],
    "preemption": ["联邦法优先；先占原则", "Federal law displaces conflicting state law."],
    "scrutiny": ["审查标准", "The level of judicial review applied to government action."],
    "injunctive": ["禁令性的", "Relating to a court order requiring or preventing conduct."],
    "jurisdiction": ["管辖权", "A court's legal authority to hear and decide a matter."],
    "precedent": ["判例；先例", "An earlier judicial decision used as authority."],
    "controversy": ["争议；案件或争议", "A real, live dispute rather than an advisory question."],
}
for word, (zh, legal) in manual.items():
    entry = found.setdefault(word, {"word": word, "phonetic": "", "translation": "", "definition": "", "exchange": ""})
    entry["legalTranslation"] = zh
    entry["legalNote"] = legal

payload = {"source": "ECDICT + USBAR legal overlay", "count": len(found), "entries": found}
(root / "assets/course-dictionary.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
print(f"Matched {len(found)} / {len(targets)} unique course tokens")
