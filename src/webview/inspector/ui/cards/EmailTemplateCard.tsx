import type { EmailTemplate } from "../../../../domain/types";
import type { ExportComponentKind, SelectPayload } from "../../../messages";

interface Props {
  payload: Extract<SelectPayload, { kind: "emailTemplate" }>;
  onOpenBody?: (host: string, name: string, locale: string) => void;
  onExport?: (
    host: string,
    realm: string,
    kind: ExportComponentKind,
    id: string,
    name?: string,
  ) => void;
}

export function EmailTemplateCard({ payload, onOpenBody, onExport }: Props) {
  const { name, host, realmName, template } = payload;
  const heading = template?.displayName || name;
  return (
    <article className="card">
      <header>
        <span className="kind-badge">
          Email template{template?.enabled === false ? " · Disabled" : ""}
        </span>
        <h1>{heading}</h1>
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
        {template ? <TemplateFields template={template} /> : null}
      </dl>
      {template ? (
        <Bodies template={template} host={host} name={name} onOpenBody={onOpenBody} />
      ) : null}
      {template ? null : (
        <p className="hint">Email template resolution failed; showing name only.</p>
      )}
      {onExport ? (
        <div className="card-actions">
          <button
            type="button"
            className="primary"
            onClick={() =>
              onExport(host, realmName, "emailTemplate", name, template?.displayName ?? name)
            }
          >
            <i className="codicon codicon-export" aria-hidden />
            Export…
          </button>
        </div>
      ) : null}
    </article>
  );
}

function TemplateFields({ template }: { template: EmailTemplate }) {
  return (
    <>
      <dt>Enabled</dt>
      <dd>{template.enabled ? "Yes" : "No"}</dd>
      {template.displayName ? (
        <>
          <dt>Display name</dt>
          <dd>{template.displayName}</dd>
        </>
      ) : null}
      {template.description ? (
        <>
          <dt>Description</dt>
          <dd>{template.description}</dd>
        </>
      ) : null}
      {template.defaultLocale ? (
        <>
          <dt>Default locale</dt>
          <dd>
            <code>{template.defaultLocale}</code>
          </dd>
        </>
      ) : null}
      {template.mimeType ? (
        <>
          <dt>MIME type</dt>
          <dd>
            <code>{template.mimeType}</code>
          </dd>
        </>
      ) : null}
      {template.from ? (
        <>
          <dt>From</dt>
          <dd>
            <code>{template.from}</code>
          </dd>
        </>
      ) : null}
      {template.subject ? <SubjectRows subjects={template.subject} /> : null}
    </>
  );
}

function SubjectRows({ subjects }: { subjects: Record<string, string> }) {
  const locales = Object.keys(subjects).sort();
  return (
    <>
      {locales.map((loc) => (
        <Row key={loc} dt={`Subject (${loc})`} dd={subjects[loc]} />
      ))}
    </>
  );
}

function Row({ dt, dd }: { dt: string; dd: string }) {
  return (
    <>
      <dt>{dt}</dt>
      <dd>{dd}</dd>
    </>
  );
}

function Bodies({
  template,
  host,
  name,
  onOpenBody,
}: {
  template: EmailTemplate;
  host: string;
  name: string;
  onOpenBody?: (host: string, name: string, locale: string) => void;
}) {
  const locales = Object.keys(template.message ?? {}).sort();
  if (locales.length === 0) return null;
  return (
    <section className="deps">
      <h2>
        Body ({locales.length} {locales.length === 1 ? "locale" : "locales"})
      </h2>
      <ul>
        {locales.map((loc) => (
          <li key={loc}>
            <code>{loc}</code>
            {onOpenBody ? (
              <>
                {" "}
                <button type="button" className="link" onClick={() => onOpenBody(host, name, loc)}>
                  Open body
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
