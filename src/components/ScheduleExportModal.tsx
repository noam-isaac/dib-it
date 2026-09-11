import { Button, Stack, Text } from "@mantine/core"
import { useState } from "react"
import { createScheduleImage, downloadBlob } from "../utilities"

export default function ScheduleExportModal({ semester }: { semester: string }) {
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const exportImage = async (copy: boolean) => {
    setWorking(true)
    setError("")
    setMessage("")
    try {
      if (copy) {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
          throw new Error("הדפדפן לא תומך בהעתקת תמונות. אפשר לבחור בשמירה כתמונה.")
        }
        // Start the clipboard write during the click; Safari requires user activation.
        const image = createScheduleImage()
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": image })])
        } finally { await image.catch(() => {}) }
        setMessage("התמונה הועתקה — אפשר להדביק אותה כעת.")
      } else {
        downloadBlob(`dibit-${semester}.png`, await createScheduleImage())
        setMessage("התמונה נשמרה.")
      }
    } catch (error) {
      setError(error instanceof Error && error.name !== "NotAllowedError" ? error.message
        : "לא ניתן להעתיק ללוח. אפשר לנסות שוב או לבחור בשמירה כתמונה.")
    } finally { setWorking(false) }
  }
  return <Stack dir="rtl" className="dont-print">
    <Button variant="default" disabled={working} onClick={() => window.print()}>הדפסה / PDF</Button>
    <Button variant="default" disabled={working} onClick={() => exportImage(true)}>העתקת תמונה</Button>
    <Button variant="default" disabled={working} onClick={() => exportImage(false)}>שמירת תמונה (PNG)</Button>
    {working && <Text size="sm" role="status">מכין את התמונה…</Text>}
    {message && <Text size="sm" role="status">{message}</Text>}
    {error && <Text size="sm" c="red" role="alert">{error}</Text>}
  </Stack>
}
