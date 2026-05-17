import type { SelectPayload } from "../../../messages";

interface Props {
  payload: Extract<SelectPayload, { kind: "connection" }>;
}

export function ConnectionCard({ payload }: Props) {
  const { connection } = payload;
  return (
    <article className="card">
      <header>
        <span className="kind-badge">Connection</span>
        <h1>{connection.name || connection.host}</h1>
      </header>
      <dl>
        <dt>Host</dt>
        <dd>
          <code>{connection.host}</code>
        </dd>
        <dt>Service Account ID</dt>
        <dd>
          <code>{connection.saId}</code>
        </dd>
        {connection.name ? (
          <>
            <dt>Display name</dt>
            <dd>{connection.name}</dd>
          </>
        ) : null}
      </dl>
    </article>
  );
}
