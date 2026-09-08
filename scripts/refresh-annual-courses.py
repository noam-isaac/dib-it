"""Refresh verified annual group IDs from TAU's public annual-only search.

Run explicitly before reviewing a data update. With no arguments, discover the
offered years from the live catalog and the app's FIRST_SEMESTER lower bound.
Optional developer usage: python3 scripts/refresh-annual-courses.py 2026
Years use Dib It's convention: 2026 means academic year 2025/2026.
No login, third-party packages, or application runtime requests are needed.
"""
import argparse
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
ROOT = Path(__file__).resolve().parents[1]
CATALOG_INFO = "https://arazim-project.com/data/info.json"


def offered_years(info, first_semester):
    semesters = info.get("semesters")
    if not isinstance(semesters, dict) or not semesters:
        raise ValueError("Missing catalog semesters; cannot verify annual coverage")
    if any(not re.fullmatch(r"\d{4}[ab]", semester) for semester in semesters):
        raise ValueError("Unexpected catalog semester format")
    years = sorted({int(semester[:4]) for semester in semesters if semester >= first_semester})
    if not years:
        raise ValueError("No offered academic years")
    return years


def discover_years():
    lower_bound = re.search(r'export const FIRST_SEMESTER = "(\d{4}[ab])"', (ROOT / "src/utilities.ts").read_text())
    if not lower_bound:
        raise ValueError("Cannot read the app's FIRST_SEMESTER; review year discovery")
    with urllib.request.urlopen(CATALOG_INFO, timeout=60) as response:
        return offered_years(json.load(response), lower_bound[1])


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


def refresh(years, target, feed=False):
    previous = json.loads(target.read_text()) if target.exists() else None
    if feed and previous is not None and (previous.get("version") != 1 or not isinstance(previous.get("years"), dict)):
        raise ValueError("Unsupported annual feed; preserve it for review")
    data = (previous["years"] if feed else previous) if previous is not None else {}
    for year in years:
        data[str(year)] = {"source": BASE + "Search_P.aspx", "filter": "ckSem=0", "verifiedAt": datetime.date.today().isoformat(), "groups": collect(year)}
    # Publish only a complete refresh. A failed source request must leave the existing snapshot intact.
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps({"version": 1, "years": data} if feed else data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(target)


def self_test():
    import tempfile
    from unittest.mock import patch

    page = Page("""<select name="lstDep1"><option value=""></option>
      <option value="08">כל הפקולטה לאמנויות</option></select>
      <a href="/Tal/Syllabus/Syllabus_L.aspx?course=1031310301&amp;year=2025">סילבוס</a>
      <input type="hidden" name="__VIEWSTATE" value="next-page-token">
      <input id="next" type="submit">""")
    assert page.schools == {"lstDep1": [("08", "כל הפקולטה לאמנויות")]}
    assert page.groups == {("10313103", "01", "2025")}
    assert page.next and page.hidden == {"__VIEWSTATE": "next-page-token"}
    assert offered_years({"semesters": {"2000a": {}, "2023a": {}, "2028a": {}, "2028b": {}}}, "2023a") == [2023, 2028]
    for invalid in [{}, {"semesters": {}}, {"semesters": {"2028c": {}}}]:
        try:
            offered_years(invalid, "2023a")
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid catalog was accepted")
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "annualGroups.json"
        target.write_text('{"2026":{"groups":{"10313103":["01"]}}}')
        previous = target.read_text()
        with patch(__name__ + ".collect", side_effect=[{"10313103": ["01"]}, RuntimeError("TAU unavailable")]):
            try:
                refresh([2026, 2027], target)
            except RuntimeError:
                pass
            else:
                raise AssertionError("Source failure was ignored")
        assert target.read_text() == previous
        with patch(__name__ + ".collect", return_value={"10313103": ["01"]}):
            refresh([2028], target)
        assert list(json.loads(target.read_text())) == ["2026", "2028"]
        assert json.loads(target.read_text())["2026"] == json.loads(previous)["2026"]
        feed = Path(directory) / "annual-groups.json"
        with patch(__name__ + ".collect", return_value={"10313103": ["01"]}):
            refresh([2028], feed, True)
        assert json.loads(feed.read_text())["version"] == 1
        assert json.loads(feed.read_text())["years"]["2028"]["groups"] == {"10313103": ["01"]}
    print("PASS annual source: parsing, new-year discovery, atomic refresh, source failure, retained years")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        raise SystemExit(0)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("years", nargs="*", type=int)
    parser.add_argument("--output", type=Path, default=ROOT / "src/annualGroups.json")
    parser.add_argument("--feed", action="store_true", help="Write the independently published versioned feed")
    args = parser.parse_args()
    years = args.years or discover_years()
    print(f"Verifying annual groups for offered years: {years}", flush=True)
    refresh(years, args.output, args.feed)
