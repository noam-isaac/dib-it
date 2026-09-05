"""Maintenance-only preparation of the supplied binary DOC; never used by the browser.

Requires macOS + Microsoft Word only when replacing the checked-in template.
Run: python3 scripts/prepare-registration-template.py
The source form, document structure, formatting and images are retained. Word
allocates text slots once; the browser subsequently changes only their bytes.
CFB/FIB reader below deliberately supports only the checked-in template shape.
See templates/README.md for the Microsoft format references and verification.
"""
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

u16=lambda b,o:struct.unpack_from('<H',b,o)[0]
u32=lambda b,o:struct.unpack_from('<I',b,o)[0]
class Doc:
 def __init__(self,data):
  self.data=data
  assert data[:8]==bytes.fromhex('d0cf11e0a1b11ae1')
  self.size=1<<u16(data,30)
  assert u32(data,72)==0,'Extended DIFAT unsupported for this fixed template'
  fat=[]
  for i in range(u32(data,44)):
   part=self.sector(u32(data,76+i*4));fat.extend(struct.unpack('<'+'I'*(self.size//4),part))
  self.fat=fat
  directory=b''.join(self.sector(s) for s in self.chain(u32(data,48)))
  self.entries={}
  for o in range(0,len(directory),128):
   e=directory[o:o+128];n=u16(e,64)
   if e[66]==2:self.entries[e[:n-2].decode('utf-16le')]=(u32(e,116),u32(e,120))
  word,self.positions=self.stream('WordDocument')
  self.word=word
  flags=u16(word,10);assert not flags&0x100,'Encrypted document'
  table,_=self.stream('1Table' if flags&0x200 else '0Table')
  p=32;p+=2+2*u16(word,p);p+=2+4*u16(word,p);p+=2
  clxStart,clxSize=struct.unpack_from('<II',word,p+33*8)
  clx=table[clxStart:clxStart+clxSize];p=0
  while clx[p]==1:p+=3+u16(clx,p+1)
  assert clx[p]==2
  plc=clx[p+5:p+5+u32(clx,p+1)];n=(len(plc)-4)//12
  chars=[];offsets=[]
  for i in range(n):
   begin,end=struct.unpack_from('<II',plc,i*4)
   fc=u32(plc,(n+1)*4+i*8+2);compressed=bool(fc&0x40000000);fc&=0x3fffffff
   if compressed:fc//=2
   step=1 if compressed else 2
   for j in range(end-begin):
    o=fc+j*step
    chars.append(chr(word[o]) if compressed else chr(u16(word,o)))
    offsets.append(None if compressed else [self.positions[o],self.positions[o+1]])
  self.text=''.join(chars);self.offsets=offsets
 def sector(self,s):return self.data[(s+1)*self.size:(s+2)*self.size]
 def chain(self,s):
  seen=set()
  while s<0xfffffffa:
   assert s not in seen;seen.add(s);yield s;s=self.fat[s]
 def stream(self,name):
  s,n=self.entries[name];assert n>=4096,'Mini streams not needed by this template'
  chain=list(self.chain(s));p=[(s+1)*self.size+i for s in chain for i in range(self.size)][:n]
  return bytes(self.data[i] for i in p),p

def slots_for_form():
    slots = []
    def add(key, table, row, cell, length=1):
        slots.append(dict(key=key, table=table, row=row, cell=cell, length=length, marker=ord("א")))
    def digits(key, table, row, cell, length):
        for i in range(length):
            add(f"{key}.{length-i-1}", table, row, cell+i)
    add("studentName", 1, 1, 2, 100)
    digits("studentId", 1, 2, 2, 9)
    add("semesterCode", 1, 3, 2)
    digits("year", 1, 3, 3, 2)
    digits("department", 1, 4, 2, 4)
    add("degree", 1, 5, 2, 24)
    digits("registeringDepartment", 1, 6, 2, 4)
    add("registeringDepartmentName", 1, 6, 6, 100)
    for i in range(14):
        prefix, row = f"rows.{i}", i+2
        add(prefix+".semesterCode", 2, row, 1)
        digits(prefix+".year", 2, row, 2, 2)
        digits(prefix+".group", 2, row, 4, 2)
        digits(prefix+".courseId", 2, row, 6, 8)
        digits(prefix+".framework", 2, row, 14, 3)
        add(prefix+".name", 2, row, 17, 160)
    return slots


def main():
    if sys.platform != "darwin":
        raise SystemExit("Template maintenance requires Microsoft Word on macOS. Normal browser export does not.")
    root = Path(__file__).resolve().parent.parent
    original_path = root / "templates/registration-original.doc"
    original = original_path.read_bytes()
    source_hash = hashlib.sha256(original).hexdigest()
    assert source_hash == "a7a94a59512fb9166a1947d743f1f41d7f41b63d63b231b8e3167c1a80e405fc", "Unexpected original form"
    work = Path(tempfile.mkdtemp(prefix="dibit-template-"))
    input_path, output_path = work / "preparing.doc", work / "prepared.doc"
    shutil.copyfile(original_path, input_path)
    slots = slots_for_form()
    # These are application paths we create, never user-supplied document text.
    lines = [
        f'set inputFile to (POSIX file "{input_path}") as text',
        f'set outputFile to (POSIX file "{output_path}") as text',
        'with timeout of 60 seconds', 'tell application "Microsoft Word"',
        'open file name inputFile',
    ]
    for slot in slots:
        marker = "א" + "\u200b" * (slot["length"]-1)
        target = f'cell {slot["cell"]} of row {slot["row"]} of table {slot["table"]} of document "preparing.doc"'
        lines.append(f'set content of text object of {target} to "{marker}"')
    lines.append('set positions to {}')
    for slot in slots:
        target = f'cell {slot["cell"]} of row {slot["row"]} of table {slot["table"]} of document "preparing.doc"'
        lines.append(f'set end of positions to start of content of text object of {target}')
    lines.extend(['save as document "preparing.doc" file name outputFile file format format document97',
                  'return positions', 'end tell', 'end timeout'])
    script = work / "prepare.applescript"
    script.write_text("\n".join(lines), encoding="utf8")
    subprocess.run(["open", "-a", "Microsoft Word", str(input_path)], check=True)
    result = subprocess.run(["osascript", str(script)], capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(f"Word preparation failed: {result.stderr.strip()}\nInspect temporary artifacts: {work}")
    positions = [int(value.strip()) for value in result.stdout.split(",")]
    assert len(positions) == len(slots)
    data = bytearray(output_path.read_bytes())
    doc, source_doc = Doc(data), Doc(original)
    # Retain the source's metadata rather than distributing a developer's name.
    for name in ["\x05SummaryInformation", "\x05DocumentSummaryInformation"]:
        source, _ = source_doc.stream(name)
        target, offsets = doc.stream(name)
        assert len(source) == len(target)
        for offset, byte in zip(offsets, source):
            data[offset] = byte
    mapped, used = [], set()
    for slot, cp in zip(slots, positions):
        expected = "א" + "\u200b" * (slot["length"]-1)
        assert doc.text[cp:cp+slot["length"]] == expected
        pairs = doc.offsets[cp:cp+slot["length"]]
        assert all(pairs), "Slots must use uncompressed UTF-16"
        offsets = [offset for pair in pairs for offset in pair]
        assert not set(offsets) & used
        used.update(offsets)
        mapped.append(dict(key=slot["key"], length=slot["length"], marker=slot["marker"], offsets=offsets))
    manifest = dict(version=1, sourceSha256=source_hash, sha256=hashlib.sha256(data).hexdigest(), byteLength=len(data), slots=mapped)
    assets = root / "src/assets"
    (assets / "registration-template.doc").write_bytes(data)
    (assets / "registration-template.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    assert original_path.read_bytes() == original
    print(f"Prepared {len(mapped)} text slots. Run tests and verify a browser download in Word before shipping.")
    print(f"Preparation artifacts: {work}")


if __name__ == "__main__":
    main()
