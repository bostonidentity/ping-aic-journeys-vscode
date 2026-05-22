import type { RealmIndexEntity, UsagePathNode, UsagePaths } from "../../../domain/realm-index";
import { DISPLAY_KIND_ICON, displayKindOf } from "./grouping";

interface Props {
  paths: UsagePaths;
  onPreview: (entity: RealmIndexEntity) => void;
}

/** Renders a `findUsagePaths` result — the pruned slice of the realm's
 * dependency graph from each journey (or orphan) root down to the
 * searched entity, which is the leaf of every branch. */
export function UsagePathTree({ paths, onPreview }: Props) {
  if (paths.roots.length === 0) {
    return <div className="search-empty">No paths reach this entity.</div>;
  }
  return (
    <ul className="search-tree">
      {paths.roots.map((root) => (
        // Root keys are distinct entities — no index disambiguation needed.
        <TreeNode key={root.key} node={root} onPreview={onPreview} />
      ))}
    </ul>
  );
}

function TreeNode({
  node,
  onPreview,
}: {
  node: UsagePathNode;
  onPreview: (entity: RealmIndexEntity) => void;
}) {
  const icon = DISPLAY_KIND_ICON[displayKindOf(node.entity)];
  return (
    <li>
      <div className="search-tree-row">
        <i className={`codicon codicon-${icon}`} aria-hidden />
        <button type="button" className="link" onClick={() => onPreview(node.entity)}>
          {node.entity.displayName}
        </button>
        {node.dup ? <span className="search-tree-dup">(dup)</span> : null}
        {node.orphanRoot ? (
          <span className="search-tree-orphan">⚠ no journey reaches this</span>
        ) : null}
        {node.via ? <span className="search-tree-via">via {node.via}</span> : null}
      </div>
      {node.children.length > 0 ? (
        <ul>
          {node.children.map((child, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: sibling keys can repeat (same entity via two `via`s); the index disambiguates, the list is render-stable
            <TreeNode key={`${child.key}#${i}`} node={child} onPreview={onPreview} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
