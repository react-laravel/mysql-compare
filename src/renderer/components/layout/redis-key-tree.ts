// Redis keys are flat on the wire; the ':' convention is what makes them
// browsable. These builders were pure functions inside `SidebarTree.tsx` and
// moved here verbatim (blueprint risk 3) so the tree rewrite cannot regress
// them.

export interface RedisKeyTreeNode {
  id: string
  label: string
  keyName?: string
  count: number
  children: RedisKeyTreeNode[]
}

interface RedisKeyBuildNode {
  id: string
  label: string
  keyName?: string
  count: number
  children: Map<string, RedisKeyBuildNode>
}

export function buildRedisKeyTree(keys: string[]): RedisKeyTreeNode[] {
  const root = new Map<string, RedisKeyBuildNode>()

  keys.forEach((key) => {
    const parts = key.split(':')
    if (parts.length <= 1) {
      root.set(`leaf:${key}`, createRedisBuildLeaf(key, key))
      return
    }

    let siblings = root
    let path = ''
    parts.forEach((part, index) => {
      const label = part || '(empty)'
      path = path ? `${path}:${part}` : part
      const last = index === parts.length - 1

      if (last) {
        siblings.set(`leaf:${key}`, createRedisBuildLeaf(label, key))
        return
      }

      const folderMapKey = `folder:${path}`
      let folder = siblings.get(folderMapKey)
      if (!folder) {
        folder = { id: path, label, count: 0, children: new Map() }
        siblings.set(folderMapKey, folder)
      }
      folder.count += 1
      siblings = folder.children
    })
  })

  return sortRedisTreeNodes(Array.from(root.values()).map(toRedisKeyTreeNode))
}

function createRedisBuildLeaf(label: string, keyName: string): RedisKeyBuildNode {
  return { id: keyName, label, keyName, count: 1, children: new Map() }
}

function toRedisKeyTreeNode(node: RedisKeyBuildNode): RedisKeyTreeNode {
  return {
    id: node.id,
    label: node.label,
    keyName: node.keyName,
    count: node.count,
    children: Array.from(node.children.values()).map(toRedisKeyTreeNode)
  }
}

function sortRedisTreeNodes(nodes: RedisKeyTreeNode[]): RedisKeyTreeNode[] {
  return nodes
    .map((node) => ({ ...node, children: sortRedisTreeNodes(node.children) }))
    .sort((left, right) => {
      if (Boolean(left.keyName) !== Boolean(right.keyName)) return left.keyName ? 1 : -1
      return left.label.localeCompare(right.label)
    })
}
