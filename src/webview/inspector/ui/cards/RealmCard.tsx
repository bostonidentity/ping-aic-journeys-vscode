import type { SelectPayload } from "../../../messages";

interface Props {
  payload: Extract<SelectPayload, { kind: "realm" }>;
}

export function RealmCard({ payload }: Props) {
  const { realm, host } = payload;
  return (
    <article className="card">
      <header>
        <span className="kind-badge">Realm</span>
        <h1>{realm.name}</h1>
      </header>
      <dl>
        <dt>Host</dt>
        <dd>
          <code>{host}</code>
        </dd>
        <dt>Parent path</dt>
        <dd>
          <code>{realm.parentPath}</code>
        </dd>
        <dt>Status</dt>
        <dd>{realm.active ? "Active" : "Inactive"}</dd>
      </dl>
    </article>
  );
}
