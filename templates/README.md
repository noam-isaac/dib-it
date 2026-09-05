# Original registration form

`registration-original.doc` is the exact attachment supplied for the Lautman interdisciplinary registration form, תשפ״ז. It has not been regenerated or edited.

- Original SHA256: `a7a94a59512fb9166a1947d743f1f41d7f41b63d63b231b8e3167c1a80e405fc`
- Page: landscape US Letter; original margins, logos, tables and highlighted note.
- Course table: 14 entry rows, with separate cells for each number digit.

`src/assets/registration-template.doc` was prepared by opening a copy of this source in Microsoft Word and inserting preallocated text slots into only the writable cells. No tables, headings, styles, images, rows or sections were rebuilt. Original document metadata streams were restored after preparation. Its paired JSON manifest records a checksum and the exact UTF-16 byte offsets for each slot, including cells split across OLE sectors. A Hebrew placeholder makes the inserted text inherit the original Hebrew formatting. Zero-width spaces reserve the remaining capacity without taking visible space.

At export time the browser downloads that static template, verifies its checksum, and replaces only the allocated text bytes. All formatting, tables, pictures and OLE structures remain byte-identical to the prepared template. The original DOC is the source of the retained template; adding text necessarily changes the output file's bytes. The output remains a binary `.doc`. No Word installation or local service is needed by the user.

## Maintenance

Normal development and deployment use the checked-in assets without preparation. Only when changing this exact template, on a Mac with Microsoft Word installed:

```sh
python3 scripts/prepare-registration-template.py
bun test
bun run build
```

The script works on a temporary copy and leaves the source untouched. Word can finish a save after an AppleEvent timeout; if this occurs, inspect the reported temporary folder and recover the saved document’s cell offsets before validating the manifest. Do not ship partially prepared assets. Its reader is intentionally limited to this known CFB/FIB shape and refuses unsupported structures. After preparation, open actual browser downloads in Word and render them before committing updated assets. Check a short Hebrew example, mixed Hebrew/English, all 14 rows, and a second form after overflow. Compare image bytes, page dimensions, margins, table grids, properties and the original unfilled document. Never accept a Word repair warning.

Format references used to locate text without rebuilding the file:

- [Microsoft MS-DOC: Retrieving Text](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/01d5d8c4-cf9c-4ef9-80fd-439e763cfe01)
- [Microsoft MS-DOC: FcCompressed](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/aa2e55a2-f4f2-4795-bab5-6d9d7a0ed249)
- [Microsoft MS-DOC: Pcd](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/498993c9-0a2d-47aa-8ada-fed27616e275)

Inputs cannot contain Word structural control characters or exceed the reserved capacity. Names reserve 100 UTF-16 units each for the student and registering-department name, and 160 per course (including lesson type); degree reserves 24. Mixed Latin runs consume additional invisible direction markers. Long text can naturally wrap in the original cells; nothing is silently truncated. Separate departments and more than 14 groups produce multiple original forms inside a ZIP.
