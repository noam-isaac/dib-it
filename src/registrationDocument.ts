import type { CourseDetails } from "./catalog"
import JSZip from "jszip"
import manifest from "./assets/registration-template.json"
import {
  fitsRegistrationBoxes,
  getRegistrationDepartments,
  isRegistrationBoxField,
  registrationCourseName,
  registrationRowFitsForm,
  type RegistrationDetails,
  type RegistrationRow,
} from "./registration"

export const REGISTRATION_ROWS_PER_FORM = 14
const templateUrl = new URL("./assets/registration-template.doc", import.meta.url).href
const invisiblePadding = "\u200b"
const error = (message: string): never => { throw new Error(message) }

// These characters are structural in binary Word files, including cell ends.
// eslint-disable-next-line no-control-regex -- Reject Word structural controls in text.
const controls = /[\u0000-\u001f\u007f]/
const brokenUnicode = (value: string) => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

/** Text the student typed: name what they can fix instead of rewriting it for them. */
const checkText = (value: string, label: string) => {
  if (controls.test(value)) error(`${label}: הטקסט כולל תווי בקרה שאינם מתאימים לטופס.`)
  if (brokenUnicode(value)) error(`${label}: הטקסט כולל תו Unicode לא תקין.`)
  return value.trim()
}

/** Catalog text: the student cannot edit it, so clean it instead of blocking the download. */
const cleanText = (value: string) => {
  let cleaned = ""
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) cleaned += " "
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) cleaned += value[i] + value[++i]
    } else if (!(code >= 0xdc00 && code <= 0xdfff)) cleaned += value[i]
  }
  return cleaned.replace(/\s+/g, " ").trim()
}

export interface RegistrationNotes { skipped: RegistrationRow[]; shortened: string[] }
const describeRow = (row: RegistrationRow) => `${row.courseId}/${row.group}`

/** Sentences for the student, describing everything the form could not carry as printed. */
export const registrationNoteMessages = ({ skipped, shortened }: RegistrationNotes) => [
  skipped.length &&
    `קבוצות שאינן מתאימות למשבצות הטופס ולא נכללו בו: ${skipped.map(describeRow).join(", ")}. הוסיפו אותן ידנית ב-Word.`,
  shortened.length &&
    `שמות שקוצרו כדי להיכנס לשורות הטופס: ${shortened.join(", ")}. אפשר להשלים אותם ב-Word.`,
].filter((note): note is string => !!note)

// The retained template has Hebrew runs. Explicit LTR spans keep embedded
// English/numbers readable without changing the template's formatting.
const spans = (value: string) =>
  value.replace(/[A-Za-z0-9]+(?:[./:@_-][A-Za-z0-9]+)*/g, "\u202a$&\u202c")

/** Shorten text to the slot, keeping the bidi spans balanced and code points intact. */
const shorten = (value: string, length: number) => {
  const spanned = spans(value)
  if (spanned.length <= length) return spanned
  const points = Array.from(value)
  for (let count = Math.min(points.length, length); count > 0; count--) {
    const shortened = spans(points.slice(0, count).join("").trimEnd() + "…")
    if (shortened.length <= length) return shortened
  }
  return ""
}

/**
 * Only the two fields the student actually fills can block the download. The rest of the
 * form is preset or comes from the catalog, so an unusable value becomes a blank box the
 * student completes in Word instead of an error they have no way to act on.
 */
const validate = (details: RegistrationDetails, rows: RegistrationRow[]) => {
  if (!rows.length) error("יש לבחור קבוצות לימוד שמתאימות לטופס לפני יצירתו.")
  if (!checkText(details.studentName, "שם התלמיד/ה")) error("יש להזין שם תלמיד/ה.")
  if (!fitsRegistrationBoxes("studentId", details.studentId)) error("מספר ת״ז: יש להזין 9 ספרות.")
}

const slotValue = (key: string, details: RegistrationDetails, rows: RegistrationRow[]) => {
  const parts = key.split(".")
  let values: Record<string, string> = { ...details, year: details.academicYear.slice(-2) }
  if (parts[0] === "rows") {
    const row = rows[Number(parts[1])]
    if (!row) return ""
    values = { ...row, name: registrationCourseName(row), year: values.year, semesterCode: details.semesterCode, framework: details.framework }
    parts.splice(0, 2)
  }
  const field = parts[0]
  const value = values[field] ?? ""
  // Leave a boxed field blank rather than scattering characters the boxes cannot hold.
  if (isRegistrationBoxField(field))
    return fitsRegistrationBoxes(field, value) ? (parts.length === 2 ? value[Number(parts[1])] ?? "" : value) : ""
  return field === "studentName" ? checkText(value, "שם התלמיד/ה") : cleanText(value)
}

/** Inject text into the original DOC's prepared UTF-16 slots. No document is rebuilt. */
export const fillRegistrationTemplate = async (
  template: ArrayBuffer,
  details: RegistrationDetails,
  rows: RegistrationRow[],
  notes?: RegistrationNotes,
): Promise<Blob> => {
  const usable = rows.filter(registrationRowFitsForm)
  for (const row of rows)
    if (!registrationRowFitsForm(row) && notes && !notes.skipped.includes(row)) notes.skipped.push(row)
  validate(details, usable)
  if (usable.length > REGISTRATION_ROWS_PER_FORM)
    error("בטופס המקורי יש 14 שורות. יש לפצל את הקבוצות למספר טפסים.")
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", template)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("")
  if (template.byteLength !== manifest.byteLength || digest !== manifest.sha256)
    error("תבנית הטופס אינה תואמת לגרסה המקורית. רעננו את העמוד ונסו שוב.")
  const output = new Uint8Array(template.slice(0))
  for (const slot of manifest.slots) {
    let value = slotValue(slot.key, details, usable)
    if (slot.length > 1) {
      const fitted = shorten(value, slot.length)
      // The student can shorten their own name; a catalog name is shortened for them.
      if (fitted !== spans(value)) {
        if (slot.key === "studentName")
          error("שם התלמיד/ה ארוך מהמקום שהטופס המקורי מקצה לו. קצרו אותו ונסו שוב.")
        if (notes && !notes.shortened.includes(value)) notes.shortened.push(value)
      }
      value = fitted
    }
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
  info: Readonly<Record<string, CourseDetails | undefined>>,
  template?: ArrayBuffer,
): Promise<{ filename: string; blob: Blob; notes: string[] }> => {
  if (!rows.length) error("יש לבחור קבוצות לימוד לפני יצירת הטופס.")
  const collected: RegistrationNotes = { skipped: rows.filter(row => !registrationRowFitsForm(row)), shortened: [] }
  const usable = rows.filter(registrationRowFitsForm)
  if (!usable.length)
    error("אף אחת מהקבוצות שנבחרו אינה מתאימה למשבצות הטופס המקורי. יש למלא אותן ידנית ב-Word.")
  const departments = getRegistrationDepartments(usable, info)
  const forms: { details: RegistrationDetails; rows: RegistrationRow[]; suffix: string }[] = []
  for (const prefix of new Set(usable.map(row => row.courseId.slice(0, 4)))) {
    const department = departments[prefix]
    const formDetails = {
      ...details,
      registeringDepartment: prefix,
      registeringDepartmentName: department.name,
    }
    const departmentRows = usable.filter(row => row.courseId.startsWith(prefix))
    for (let i = 0; i < departmentRows.length; i += REGISTRATION_ROWS_PER_FORM) {
      const pageRows = departmentRows.slice(i, i + REGISTRATION_ROWS_PER_FORM)
      validate(formDetails, pageRows)
      forms.push({ details: formDetails, rows: pageRows, suffix: `${prefix}-${i / REGISTRATION_ROWS_PER_FORM + 1}` })
    }
  }
  if (!template) {
    const response = await fetch(templateUrl)
    if (!response.ok) error("לא ניתן לטעון את הטופס המקורי. נסו שוב.")
    template = await response.arrayBuffer()
  }
  const stem = `dibit-registration-${details.academicYear}-${details.semesterCode}`
  if (forms.length === 1)
    return {
      filename: `${stem}.doc`,
      blob: await fillRegistrationTemplate(template, forms[0].details, forms[0].rows, collected),
      notes: registrationNoteMessages(collected),
    }
  const zip = new JSZip()
  for (const form of forms) {
    const blob = await fillRegistrationTemplate(template, form.details, form.rows, collected)
    zip.file(`${stem}-${form.suffix}.doc`, await blob.arrayBuffer())
  }
  return {
    filename: `${stem}.zip`,
    blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
    notes: registrationNoteMessages(collected),
  }
}
