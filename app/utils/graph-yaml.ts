import { visit } from 'yaml'
import type { Alias, Document, Node } from 'yaml'

/** Detach aliases before canvas mutations, including aliases outside the edited section. */
export function detachGraphAliases(doc: Document) {
  const replacements = new Map<Alias, Node>()
  const active = new Set<object>()
  let count = 0
  function check(value: unknown, depth: number) {
    if (++count > 10000 || depth > 64) throw new Error('Graph aliases exceed canvas editing limits.')
    if (value === null || typeof value !== 'object') return
    if (active.has(value)) throw new Error('Recursive Graph aliases cannot be edited on the canvas.')
    active.add(value)
    for (const child of Object.values(value)) check(child, depth + 1)
    active.delete(value)
  }
  // Resolve against the unchanged document: replacing an alias can remove nested anchors.
  visit(doc, { Alias: (_key, alias) => {
    const value: unknown = alias.toJS(doc, { maxAliasCount: 100 })
    check(value, 0)
    const replacement = doc.createNode(value, { aliasDuplicateObjects: false })
    replacement.comment = alias.comment
    replacement.commentBefore = alias.commentBefore
    replacement.spaceBefore = alias.spaceBefore
    replacements.set(alias, replacement)
  } })
  visit(doc, { Alias: (_key, alias) => replacements.get(alias) })
}
