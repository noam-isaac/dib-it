import type { OptionsFilter } from "@mantine/core"
import MiniSearch from "minisearch"

// ponytail: retain four recent datasets; increase only if additional controls cause index churn.
const indexes = new Map<string, MiniSearch>()

export const prepareSearch = (items: { label: string }[]) => {
  const key = JSON.stringify(items.map(item => item.label))
  let index = indexes.get(key)
  if (!index) {
    index = new MiniSearch({
      fields: ["label"],
      processTerm: (term, fieldName) => {
        term = term.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
        // Index an unprefixed form too, so מדע can find למדעים.
        return fieldName && /^[ובכלמשה][א-ת]{3,}$/u.test(term) ? [term, term.slice(1)] : term
      },
      searchOptions: {
        prefix: true,
        fuzzy: 0.3,
        combineWith: "AND",
        weights: { fuzzy: 0.2, prefix: 0.8 },
      },
    })
    index.addAll(items.map((item, id) => ({ id, label: item.label })))
  }
  indexes.delete(key)
  indexes.set(key, index)
  if (indexes.size > 4) indexes.delete(indexes.keys().next().value!)
  return index
}

export const searchItems = <T extends { label: string }>(items: T[], search: string, limit?: number): T[] => {
  if (!search.trim()) return items.slice(0, limit)
  // Course numbers must still match literally, even when names contain typos.
  const numbers = search.match(/\d+/g) ?? []
  const textQuery = search.replace(/\d+/g, " ").trim()
  if (!textQuery) return items.filter(item => numbers.every(number => item.label.includes(number))).slice(0, limit)
  return prepareSearch(items).search(textQuery).map(result => items[result.id])
    .filter(item => numbers.every(number => item.label.includes(number))).slice(0, limit)
}

export const filterSearchOptions: OptionsFilter = ({ options, search, limit }) =>
  searchItems(options.flatMap(option => "group" in option ? option.items : [option]), search, limit)
