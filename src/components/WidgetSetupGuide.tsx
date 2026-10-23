import { useId } from "react";
import type { WidgetSetupGuide as SetupGuide } from "@/widgets";
import "./WidgetSetupGuide.css";

export function WidgetSetupGuide({ guide }: { guide: SetupGuide }) {
  const headingId = useId();

  return (
    <aside className="widget-setup-guide" aria-labelledby={headingId}>
      <p className="widget-setup-guide__eyebrow">Setup guide</p>
      <h3 id={headingId}>{guide.title}</h3>
      <p className="widget-setup-guide__summary">{guide.summary}</p>
      <p className="widget-setup-guide__requirement">{guide.requirement}</p>
      <ol className="widget-setup-guide__steps">
        {guide.steps.map((step) => (
          <li key={step.title}>
            <h4>{step.title}</h4>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
      <details className="widget-setup-guide__troubleshooting">
        <summary>Having trouble connecting?</summary>
        <dl>
          {guide.troubleshooting.map((item) => (
            <div key={item.title}>
              <dt>{item.title}</dt>
              <dd>{item.description}</dd>
            </div>
          ))}
        </dl>
      </details>
      <a className="widget-setup-guide__documentation" href={guide.documentationUrl} target="_blank" rel="noopener noreferrer" aria-label="Official documentation (opens in a new tab)">
        Official documentation
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M6 3H3v10h10v-3M9 3h4v4M7 9l6-6" />
        </svg>
      </a>
      <p className="widget-setup-guide__disclaimer">
        These instructions may become outdated. If you spot an old step,{" "}
        <a href="https://github.com/pmyszczynski/kokpit/issues/new" target="_blank" rel="noopener noreferrer" aria-label="Open a GitHub issue (opens in a new tab)">
          open a GitHub issue
        </a>{" "}
        so we can update it.
      </p>
    </aside>
  );
}
