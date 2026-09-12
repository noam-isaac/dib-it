import { getLocalStorage, setLocalStorage, useLocalStorage } from "./hooks"
import { dibItSchema, type DibIt } from "./schemas"
export type { DibIt, DibItCourse } from "./schemas"

export const getDibIt = () => getLocalStorage("Dib It", dibItSchema, {})
export const setDibIt = (dibIt: DibIt, quiet = false) =>
  setLocalStorage("Dib It", dibIt, dibItSchema, quiet)
export const useDibIt = () =>
  useLocalStorage({ key: "Dib It", schema: dibItSchema, defaultValue: {} })
