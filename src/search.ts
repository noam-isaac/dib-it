import type { OptionsFilter } from "@mantine/core"
import MiniSearch from "minisearch"

export const searchItems = <T extends { label: string }>(items: T[], search: string, limit?: number): T[] => {
  if (!search.trim()) return items.slice(0, limit)
  // Course numbers must still match literally, even when names contain typos.
  const numbers = search.match(/\d+/g) ?? []
  const candidates = numbers.length
    ? items.filter(item => numbers.every(number => item.label.includes(number))) : items
  const textQuery = search.replace(/\d+/g, " ").trim()
  if (!textQuery) return candidates.slice(0, limit)
  const index = new MiniSearch({
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
  index.addAll(candidates.map((item, id) => ({ id, label: item.label })))
  return index.search(textQuery).slice(0, limit).map(result => candidates[result.id])
}

export const filterSearchOptions: OptionsFilter = ({ options, search, limit }) =>
  searchItems(options.flatMap(option => "group" in option ? option.items : [option]), search, limit)
