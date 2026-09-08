"""Refresh verified annual group IDs from TAU's public annual-only search.

Usage: python3 scripts/refresh-annual-courses.py 2023 2024 2025 2026 2027
Years use Dib It's convention: 2026 means academic year 2025/2026.
No login, third-party packages, or application runtime requests are needed.
"""
import datetime
import http.cookiejar
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

BASE = "https://www.ims.tau.ac.il/Tal/KR/"


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.schools, self.hidden, self.groups = {}, {}, set()
        self.select = self.option = None
        self.next = False
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "select":
            self.select = attrs.get("name")
        if tag == "option" and self.select and self.select.startswith("lstDep"):
            self.option = attrs.get("value")
        if tag == "input":
            if attrs.get("type") == "hidden" and attrs.get("name"):
                self.hidden[attrs["name"]] = attrs.get("value", "")
            self.next |= attrs.get("id") == "next"
        if tag == "a":
            match = re.search(r"/Tal/Syllabus/Syllabus_L.aspx\?course=(\d{8})(\d{2})&year=(\d{4})", attrs.get("href", ""))
            if match:
                self.groups.add(match.groups())

    def handle_data(self, text):
        if self.option:
            self.schools.setdefault(self.select, []).append((self.option, text.strip()))
            self.option = None

    def handle_endtag(self, tag):
        if tag == "select":
            self.select = None
        if tag == "option":
            self.option = None


def fetch(opener, path, payload=None):
    data = urllib.parse.urlencode(payload).encode() if payload is not None else None
    with opener.open(BASE + path, data=data, timeout=60) as response:
        return response.read().decode("utf-8-sig")


def collect(year):
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    schools = Page(fetch(opener, "Search_P.aspx")).schools
    if len(schools) != 14:
        raise ValueError("TAU school selector changed; review parser before refreshing")
    groups = {}
    pages = 0
    for field, options in schools.items():
        if options[0][1].startswith("כל "):
            options = options[:1]
        for option, _ in options:
            payload = {"lstYear1": str(year - 1), "ckSem": "0", field: option}
            seen = set()
            while True:
                html = fetch(opener, "Search_L.aspx", payload)
                page = Page(html)
                if not page.groups and "אין נתונים מתאימים למאפייני החיפוש" not in html:
                    raise ValueError(f"Unrecognized annual search response: {year} {field} {option}")
                if page.groups and frozenset(page.groups) in seen:
                    raise ValueError("Repeated pagination page")
                seen.add(frozenset(page.groups))
                for course, group, source_year in page.groups:
                    if int(source_year) != year - 1:
                        raise ValueError("Unexpected academic year in response")
                    groups.setdefault(course, set()).add(group)
                pages += 1
                if not page.next:
                    break
                payload = {**page.hidden, "dir1": "1"}
                time.sleep(0.2)
    if not groups:
        raise ValueError("Empty annual catalog")
    print(f"{year}: {len(groups)} annual courses, {sum(map(len, groups.values()))} groups, {pages} pages", flush=True)
    return {course: sorted(values) for course, values in sorted(groups.items())}


def self_test():
    page = Page("""<select name="lstDep1"><option value=""></option>
      <option value="08">כל הפקולטה לאמנויות</option></select>
      <a href="/Tal/Syllabus/Syllabus_L.aspx?course=1031310301&amp;year=2025">סילבוס</a>
      <input type="hidden" name="__VIEWSTATE" value="next-page-token">
      <input id="next" type="submit">""")
    assert page.schools == {"lstDep1": [("08", "כל הפקולטה לאמנויות")]}
    assert page.groups == {("10313103", "01", "2025")}
    assert page.next and page.hidden == {"__VIEWSTATE": "next-page-token"}
    print("PASS official annual search parser: departments, group/year IDs, pagination")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        raise SystemExit(0)
    years = [int(year) for year in sys.argv[1:]]
    if not years:
        raise SystemExit(__doc__)
    target = Path(__file__).resolve().parents[1] / "src/annualGroups.json"
    data = json.loads(target.read_text()) if target.exists() else {}
    for year in years:
        data[str(year)] = {"source": BASE + "Search_P.aspx", "filter": "ckSem=0", "verifiedAt": datetime.date.today().isoformat(), "groups": collect(year)}
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
