import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx"
import JSZip from "jszip"
import { toHebrewJewishDate } from "jewish-date"
import type { RegistrationDetails, RegistrationRow } from "./registration"

const font = { ascii: "Arial", hAnsi: "Arial", eastAsia: "Arial", cs: "Arial" }
const typography = {
  font,
  size: 22,
  sizeComplexScript: 22,
  language: { value: "he-IL", bidirectional: "he-IL" },
}
const program = "התכנית הבין-תחומית לתלמידים מצטיינים ע״ש עדי לאוטמן"

// Separate Latin text/numbers into LTR runs without reversing the stored text.
const runs = (text: string, bold = false, size = 22) =>
  text
    .split(/([A-Za-z0-9]+(?:[./:@_-][A-Za-z0-9]+)*)/)
    .filter(Boolean)
    .map(
      (part) =>
        new TextRun({
          ...typography,
          text: part,
          rightToLeft: !/^[A-Za-z0-9]/.test(part),
          bold,
          boldComplexScript: bold,
          size,
          sizeComplexScript: size,
        }),
    )

const paragraph = (
  text: string,
  options: {
    bold?: boolean
    center?: boolean
    size?: number
    heading?: typeof HeadingLevel.TITLE | typeof HeadingLevel.HEADING_1
  } = {},
) =>
  new Paragraph({
    bidirectional: true,
    ...(options.center ? { alignment: AlignmentType.CENTER } : {}),
    ...(options.heading ? { heading: options.heading } : {}),
    spacing: { after: 100, line: 270 },
    children: runs(text, options.bold, options.size),
  })

const border = { style: BorderStyle.SINGLE, size: 4, color: "777777" }
const table = (values: string[][], widths: number[], header = true) =>
  new Table({
    visuallyRightToLeft: true,
    layout: TableLayoutType.FIXED,
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: values.map(
      (row, index) =>
        new TableRow({
          tableHeader: header && index === 0,
          cantSplit: true,
          children: row.map(
            (text, column) =>
              new TableCell({
                width: { size: widths[column], type: WidthType.DXA },
                margins: { top: 85, bottom: 85, left: 100, right: 100 },
                ...(header && index === 0
                  ? { shading: { fill: "EEEEEE" } }
                  : {}),
                children: [
                  paragraph(text, {
                    bold: header && index === 0,
                    center: header || column === 0,
                    size: 21,
                  }),
                ],
              }),
          ),
        }),
    ),
  })

/** A genuine editable DOCX with the fields from the supplied registration form. */
export const createRegistrationDocument = async (
  details: RegistrationDetails,
  rows: RegistrationRow[],
): Promise<Blob> => {
  if (!rows.length) throw new Error("יש לבחור קבוצות לימוד לפני יצירת הטופס.")
  if (
    !/^20\d{2}$/.test(details.academicYear) ||
    !/^[0123]$/.test(details.semesterCode)
  )
    throw new Error("שנה או סמסטר אינם תקינים.")
  const jewishYear = toHebrewJewishDate({
    year: +details.academicYear + 3760,
    monthName: "Tishri",
    day: 1,
  }).year.slice(1)
  const yearSemester = `${details.academicYear.slice(-2)} / ${details.semesterCode}`
  const blank = "____________________"
  const document = new Document({
    creator: "Dib It",
    title: "טופס רישום לקורסים",
    styles: {
      default: {
        document: { run: typography, paragraph: { spacing: { after: 100 } } },
        title: {
          run: {
            ...typography,
            size: 36,
            sizeComplexScript: 36,
            bold: true,
            boldComplexScript: true,
            color: "000000",
          },
        },
        heading1: {
          run: {
            ...typography,
            bold: true,
            boldComplexScript: true,
            color: "000000",
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 850, bottom: 850, left: 850, right: 850 },
          },
        },
        children: [
          paragraph("טופס רישום לקורסים", {
            center: true,
            bold: true,
            size: 36,
            heading: HeadingLevel.TITLE,
          }),
          paragraph(program, { center: true, bold: true }),
          paragraph(`שנה״ל ${jewishYear}`, { center: true, bold: true }),
          paragraph(""),
          table(
            [
              ["שם התלמיד/ה", details.studentName.trim() || blank],
              ["מספר ת״ז", details.studentId.trim() || blank],
              ["שנה/סמסטר", yearSemester],
              ["לומד בחוג", `${details.department} — ${program}`],
              ["לקראת תואר", details.degree],
              ["חוג רושם", details.registeringDepartment || blank],
            ],
            [2200, 8006],
            false,
          ),
          paragraph(""),
          paragraph("רישום", { bold: true, heading: HeadingLevel.HEADING_1 }),
          table(
            [
              ["שם הקורס", "מסגרת", "מספר הקורס", "קבוצה", "שנה/סמסטר"],
              ...rows.map((row) => [
                row.name,
                details.framework,
                row.courseId,
                row.group,
                yearSemester,
              ]),
            ],
            [4706, 1000, 1800, 1000, 1700],
          ),
          paragraph(""),
          paragraph(
            "יש לציין את הסמסטר: סמסטר א׳ — 1, סמסטר ב׳ — 2, קורס שנתי — 0, סמסטר קיץ — 3.",
            { size: 19 },
          ),
        ],
      },
    ],
  })
  // docx exposes paragraph/table RTL but not section bidi. Add only that OOXML
  // property, before docGrid (or at the section end), preserving schema order.
  const zip = await JSZip.loadAsync(await Packer.toArrayBuffer(document))
  const xml = await zip.file("word/document.xml")!.async("string")
  zip.file(
    "word/document.xml",
    xml.replace(/(<w:docGrid\b|<\/w:sectPr>)/, "<w:bidi/>$1"),
  )
  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  })
}
