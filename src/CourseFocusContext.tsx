import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

type FocusRequest = { courseId: string; highlight: boolean; origin: Element | null; scope: string }
const CourseFocusContext = createContext<{
  request: FocusRequest | null
  revealCourse: (courseId: string, highlight?: boolean) => void
  complete: (request: FocusRequest) => void
}>({ request: null, revealCourse: () => {}, complete: () => {} })

export const CourseFocusProvider = ({ scope, courseIds, children }: { scope: string; courseIds: readonly string[]; children: ReactNode }) => {
  const [request, setRequest] = useState<FocusRequest | null>(null)
  useEffect(() => {
    setRequest(current => current && (current.scope !== scope || !courseIds.includes(current.courseId)) ? null : current)
  }, [scope, courseIds])

  useEffect(() => {
    if (!request) return
    const cancel = () => setRequest(current => current === request ? null : current)
    const events = ["focusin", "pointerdown", "keydown"]
    events.forEach(event => document.addEventListener(event, cancel, true))
    return () => events.forEach(event => document.removeEventListener(event, cancel, true))
  }, [request])

  return <CourseFocusContext.Provider value={{
    request: request?.scope === scope ? request : null,
    revealCourse: (courseId, highlight = false) => setRequest({ courseId, highlight, origin: document.activeElement, scope }),
    complete: completed => setRequest(current => current === completed ? null : current),
  }}>{children}</CourseFocusContext.Provider>
}

export const useCourseFocus = () => useContext(CourseFocusContext)
