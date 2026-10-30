"""증권사 리포트 PDF 글자 뽑기 — 📑 리포트 요약(config/reports.yaml)을 쓸 때 원문 숫자를 읽는 용도 (화면에는 원문을 올리지 않음).
  .venv\\Scripts\\python.exe -X utf8 tools\\report_text.py <PDF 주소> [쪽 수, 기본 2]"""
import io
import sys

import pypdf
import requests

r = requests.get(sys.argv[1], headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
r.raise_for_status()
pages = pypdf.PdfReader(io.BytesIO(r.content)).pages
for p in pages[: int(sys.argv[2]) if len(sys.argv) > 2 else 2]:
    print(p.extract_text())
    print("-" * 40)
