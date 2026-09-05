import JSZip from "jszip"
import manifest from "./assets/registration-template.json"
import type { RegistrationDetails, RegistrationRow } from "./registration"

export const REGISTRATION_ROWS_PER_FORM = 14
const templateUrl = new URL("./assets/registration-template.doc", import.meta.url).href
const invisiblePadding = "\u200b"
const error = (message: string): never => { throw new Error(message) }

const checkText = (value: string) => {
  // These characters are structural in binary Word files, including cell ends.
  if (/[\u0000-\u001f\u007f]/.test(value))
    error("הטקסט כולל תווי בקרה שאינם מתאימים לטופס.")
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) error("הטקסט כולל תו Unicode לא תקין.")
    } else if (code >= 0xdc00 && code <= 0xdfff) error("הטקסט כולל תו Unicode לא תקין.")
  }
  return value.trim()
}

const validate = (details: RegistrationDetails, rows: RegistrationRow[]) => {
  if (!rows.length) error("יש לבחור קבוצות לימוד לפני יצירת הטופס.")
  if (!/^20\d{2}$/.test(details.academicYear) || !/^[0123]$/.test(details.semesterCode))
    error("שנה או סמסטר אינם תקינים.")
  for (const [value, length, label] of [
    [details.studentId, 9, "תעודת הזהות"],
    [details.department, 4, "חוג הלימודים"],
    [details.registeringDepartment, 4, "החוג הרושם"],
    [details.framework, 3, "המסגרת"],
  ] as const) {
    if (value && !new RegExp(`^[0-9]{${length}}$`).test(value))
      error(`${label}: יש להזין ${length} ספרות או להשאיר ריק.`)
  }
  for (const row of rows) {
    if (!/^\d{8}$/.test(row.courseId) || !/^\d{2}$/.test(row.group))
      error(`מספר הקורס או הקבוצה אינם מתאימים למשבצות הטופס: ${row.courseId}/${row.group}.`)
    checkText(row.name)
  }
  checkText(details.studentName)
  checkText(details.degree)
}

const slotValue = (key: string, details: RegistrationDetails, rows: RegistrationRow[]) => {
  const parts = key.split(".")
  let values: Record<string, string> = { ...details, year: details.academicYear.slice(-2) }
  if (parts[0] === "rows") {
    const row = rows[Number(parts[1])]
    if (!row) return ""
    values = { ...row, year: values.year, semesterCode: details.semesterCode, framework: details.framework }
    parts.splice(0, 2)
  }
  const value = values[parts[0]] ?? ""
  return parts.length === 2 ? value[Number(parts[1])] ?? "" : checkText(value)
}

/** Inject text into the original DOC's prepared UTF-16 slots. No document is rebuilt. */
export const fillRegistrationTemplate = async (
  template: ArrayBuffer,
  details: RegistrationDetails,
  rows: RegistrationRow[],
): Promise<Blob> => {
  validate(details, rows)
  if (rows.length > REGISTRATION_ROWS_PER_FORM)
    error("בטופס המקורי יש 14 שורות. יש לפצל את הקבוצות למספר טפסים.")
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", template)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("")
  if (template.byteLength !== manifest.byteLength || digest !== manifest.sha256)
    error("תבנית הטופס אינה תואמת לגרסה המקורית. רעננו את העמוד ונסו שוב.")
  const output = new Uint8Array(template.slice(0))
  for (const slot of manifest.slots) {
    let value = slotValue(slot.key, details, rows)
    // The retained template has Hebrew runs. Explicit LTR spans keep embedded
    // English/numbers readable without changing the template's formatting.
    if (slot.length > 1)
      value = value.replace(/[A-Za-z0-9]+(?:[./:@_-][A-Za-z0-9]+)*/g, "\u202a$&\u202c")
    if (value.length > slot.length)
      error("אחד השמות ארוך מדי למשבצת בטופס המקורי. קצרו את השם המודפס ונסו שוב.")
    value = value.padEnd(slot.length, invisiblePadding)
    for (let i = 0; i < slot.length; i++) {
      const low = slot.offsets[2 * i], high = slot.offsets[2 * i + 1]
      const expected = i === 0 ? slot.marker : 0x200b
      if ((output[low] | (output[high] << 8)) !== expected)
        error("משבצות הטופס אינן תקינות. רעננו את העמוד ונסו שוב.")
      const code = value.charCodeAt(i)
      output[low] = code & 0xff
      output[high] = code >>> 8
    }
  }
  return new Blob([output], { type: "application/msword" })
}

export const createRegistrationDownload = async (
  details: RegistrationDetails,
  rows: RegistrationRow[],
  template?: ArrayBuffer,
): Promise<{ filename: string; blob: Blob }> => {
  validate(details, rows)
  if (!template) {
    const response = await fetch(templateUrl)
    if (!response.ok) error("לא ניתן לטעון את הטופס המקורי. נסו שוב.")
    template = await response.arrayBuffer()
  }
  const stem = `dibit-registration-${details.academicYear}-${details.semesterCode}`
  if (rows.length <= REGISTRATION_ROWS_PER_FORM)
    return { filename: `${stem}.doc`, blob: await fillRegistrationTemplate(template, details, rows) }
  // Each additional page is another copy of the exact form, with its 14 rows.
  const zip = new JSZip()
  for (let i = 0; i < rows.length; i += REGISTRATION_ROWS_PER_FORM) {
    const blob = await fillRegistrationTemplate(template, details, rows.slice(i, i + REGISTRATION_ROWS_PER_FORM))
    zip.file(`${stem}-${i / REGISTRATION_ROWS_PER_FORM + 1}.doc`, await blob.arrayBuffer())
  }
  return { filename: `${stem}.zip`, blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }) }
}
