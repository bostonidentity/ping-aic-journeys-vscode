import type { SelectPayload } from "../../../messages";

interface Props {
  payload: Extract<SelectPayload, { kind: "emailTemplate" }>;
}

export function EmailTemplateCard({ payload }: Props) {
  const { name, host, realmName, template } = payload;
  return (
    <article className="card">
      <header>
        <span className="kind-badge">Email template</span>
        <h1>{name}</h1>
      </header>
      <dl>
        <dt>Host</dt>
        <dd>
          <code>{host}</code>
        </dd>
        <dt>Realm</dt>
        <dd>{realmName}</dd>
        <dt>Template name</dt>
        <dd>
          <code>{name}</code>
        </dd>
        {template ? (
          <>
            <dt>Enabled</dt>
            <dd>{template.enabled ? "Yes" : "No"}</dd>
            {template.from ? (
              <>
                <dt>From</dt>
                <dd>
                  <code>{template.from}</code>
                </dd>
              </>
            ) : null}
            {template.subject?.en ? (
              <>
                <dt>Subject (en)</dt>
                <dd>{template.subject.en}</dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>
      {template ? null : (
        <p className="hint">Email template resolution failed; showing name only.</p>
      )}
    </article>
  );
}
