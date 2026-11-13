/**
 * Sidebar list filtering (Library and Contacts header filter).
 *
 * Matching is a case-insensitive substring test over each item's searchable
 * fields. Grouped lists keep a group when its own name matches (all of its
 * items stay) or when some of its items match (only those stay); groups left
 * empty are dropped.
 */

/** Normalized query, or null when the filter is effectively off */
export function normalizeQuery(query: string): string | null {
  const q = query.trim().toLowerCase()
  return q === '' ? null : q
}

export function matchesQuery(
  query: string | null,
  fields: Array<string | null | undefined>
): boolean {
  if (query === null) return true
  return fields.some((field) => field?.toLowerCase().includes(query))
}

export function filterItems<T>(
  items: T[],
  query: string | null,
  fields: (item: T) => Array<string | null | undefined>
): T[] {
  if (query === null) return items
  return items.filter((item) => matchesQuery(query, fields(item)))
}

export function filterGroups<G extends { name: string }, T>(
  groups: G[],
  query: string | null,
  getItems: (group: G) => T[],
  withItems: (group: G, items: T[]) => G,
  fields: (item: T) => Array<string | null | undefined>
): G[] {
  if (query === null) return groups
  return groups.flatMap((group) => {
    if (matchesQuery(query, [group.name])) return [group]
    const items = filterItems(getItems(group), query, fields)
    return items.length > 0 ? [withItems(group, items)] : []
  })
}
