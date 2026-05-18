import type { SelectPayload } from "../../../messages";

interface Props {
  payload: Extract<SelectPayload, { kind: "theme" }>;
}

export function ThemeCard({ payload }: Props) {
  const { themeId, host, realmName, theme } = payload;
  return (
    <article className="card">
      <header>
        <span className="kind-badge">Theme</span>
        <h1>{theme?.name ?? themeId}</h1>
      </header>
      <dl>
        <dt>Host</dt>
        <dd>
          <code>{host}</code>
        </dd>
        <dt>Realm</dt>
        <dd>{realmName}</dd>
        <dt>Theme ID</dt>
        <dd>
          <code>{themeId}</code>
        </dd>
        {theme?.name ? (
          <>
            <dt>Name</dt>
            <dd>{theme.name}</dd>
          </>
        ) : null}
      </dl>
      {theme ? null : <p className="hint">Theme resolution failed; showing id only.</p>}
    </article>
  );
}
