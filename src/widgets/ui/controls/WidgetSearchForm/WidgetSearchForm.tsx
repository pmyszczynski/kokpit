"use client";

import { useRef, type FormEvent } from "react";
import { joinClassNames } from "../../joinClassNames";
import "./WidgetSearchForm.css";

export interface WidgetSearchFormProps {
  /** Consumer-validated HTTP(S) endpoint without query or fragment. */
  action: string;
  queryParameter: string;
  parameters?: readonly (readonly [string, string])[];
  label: string;
  newTab?: boolean;
  className?: string;
}

/** Native GET submission keeps the query in the browser rather than widget polling. */
export function WidgetSearchForm({ action, queryParameter, parameters = [], label, newTab = true, className }: WidgetSearchFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  /** Reject blank input while retaining the browser's native GET submission. */
  function submit(event: FormEvent<HTMLFormElement>) {
    // Engine parameter names can shadow methods on HTMLFormElement.
    const input = inputRef.current!;
    input.value = input.value.trim();
    if (!input.value) {
      event.preventDefault(); input.setCustomValidity("Enter a search query."); input.reportValidity();
    }
  }
  return <form className={joinClassNames("widget-ui", "widget-search-form", className)} role="search" aria-label={label}
    action={action} method="get" target={newTab ? "_blank" : "_self"} rel="noopener noreferrer" onSubmit={submit}>
    {parameters.filter(([name]) => name !== queryParameter).map(([name, value], index) => <input key={index} type="hidden" name={name} value={value} />)}
    <label className="widget-search-form__field"><span className="widget-search-form__label">Search query</span>
      <input ref={inputRef} className="widget-search-form__input" type="search" name={queryParameter} placeholder="Search the web…" required maxLength={500}
        autoComplete="off" spellCheck={false} onInput={event => event.currentTarget.setCustomValidity("")} />
    </label>
    <button className="widget-search-form__button" type="submit">Search</button>
  </form>;
}
