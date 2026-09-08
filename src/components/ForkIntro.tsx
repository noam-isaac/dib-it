import { Anchor, Button, List, Modal, Stack, Text } from "@mantine/core"
import { useState } from "react"

const seenKey = "Dib It Fork Intro Seen"

const ForkIntro = () => {
  const [opened, setOpened] = useState(() => {
    try {
      return localStorage.getItem(seenKey) !== "true"
    } catch {
      return true
    }
  })
  const close = () => {
    setOpened(false)
    try {
      localStorage.setItem(seenKey, "true")
    } catch {
      // The introduction can still close when browser storage is unavailable.
    }
  }

  return (
    <>
      <Anchor
        component="button"
        type="button"
        className="text-accent"
        inherit
        onClick={() => setOpened(true)}
      >מה חדש בגרסה הזו?</Anchor>
      <Modal
        opened={opened}
        onClose={close}
        title="מה נוסף ביחס ל־Dib It המקורי?"
        centered
        size="lg"
        dir="rtl"
        closeButtonProps={{ "aria-label": "סגירת ההסבר" }}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            זו הגרסה של נועם, המבוססת על Dib It של פרויקט ארזים, עם תוספות לתכנון הלימודים:
          </Text>
          <List spacing="sm" size="sm">
            <List.Item><b>כמה מערכות שעות במקביל</b> — שמרו חלופות, שכפלו מערכת ועברו ביניהן בלי לאבד את התכנון הקודם.</List.Item>
            <List.Item><b>חיפוש לפי תאריך בחינה</b> — מצאו קורסים לפי יום או טווח תאריכים, וסננו לפי קורס או פקולטה.</List.Item>
            <List.Item><b>טופסי רישום ב־Word</b> — הורידו את הטופס המקורי עם הקורסים והקבוצות שבחרתם, מחולק לפי חוגים. בדקו את הטפסים לפני ההגשה.</List.Item>
            <List.Item><b>חיפוש משופר ומעבר בין תוכניות</b> — חיפוש גמיש יותר בעברית ושמירת תוכניות לימודים למעבר מהיר.</List.Item>
            <List.Item><b>ייצוא מתוקן ליומן</b> — שעות ודקות מדויקות, כולל מעברי שעון קיץ, בקובץ לייבוא ידני ל־Google או Apple Calendar.</List.Item>
            <List.Item><b>גיבוי ושחזור עם תצוגה מקדימה</b> — כל המערכות בגיבוי אחד, עם אפשרות לגבות את המצב הנוכחי לפני החלפתו.</List.Item>
            <List.Item><b>פחות עומס בממשק</b> — הסתירו לשוניות שאינכם משתמשים בהן דרך ההגדרות.</List.Item>
          </List>
          <Text size="xs" c="dimmed">אפשר לפתוח את ההסבר שוב דרך ״מה חדש בגרסה הזו?״ בתחתית המסך.</Text>
          <Button onClick={close} data-autofocus>למערכת השעות</Button>
        </Stack>
      </Modal>
    </>
  )
}

export default ForkIntro
