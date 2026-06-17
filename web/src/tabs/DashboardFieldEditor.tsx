import type { Dispatch, SetStateAction } from 'react';
import type { JobDashboardField, JobParamDraftValue } from '../app-types';
import {
  addStringListDraftValue,
  fieldListPlaceholder,
  stringListDraftIncludes,
  stringListDraftItems,
  stringListDraftRows,
  toggleStringListDraftValue,
} from '../app-helpers';

interface DashboardFieldEditorProps {
  field: JobDashboardField;
  value: JobParamDraftValue;
  onChange: (value: JobParamDraftValue) => void;
  customListItemDrafts: Record<string, string>;
  setCustomListItemDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  draftKey?: string;
}

export function DashboardFieldEditor({
  field,
  value,
  onChange,
  customListItemDrafts,
  setCustomListItemDrafts,
  draftKey = field.key,
}: DashboardFieldEditorProps) {
  if (field.type === 'boolean') {
    return (
      <label className="field checkbox">
        <span>{field.label}</span>
        <input
          type="checkbox"
          checked={typeof value === 'boolean' ? value : field.defaultValue}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.helpText ? <small>{field.helpText}</small> : null}
      </label>
    );
  }

  if (field.type === 'string-list') {
    const rows = stringListDraftRows(value);
    const suggestions = field.suggestions ?? [];
    const customDraft = customListItemDrafts[draftKey] ?? '';
    const placeholder = field.placeholder ?? fieldListPlaceholder(field);

    function addCustomItem() {
      const item = customDraft.trim();
      if (!item) return;
      onChange(addStringListDraftValue(value, item));
      setCustomListItemDrafts((current) => ({ ...current, [draftKey]: '' }));
    }

    return (
      <div className={`field list-field${suggestions.length > 0 ? ' has-suggestions' : ''}`}>
        <span>{field.label}</span>
        {field.helpText ? <small>{field.helpText}</small> : null}

        {suggestions.length > 0 ? (
          <div className="suggestion-picker">
            <span>Suggestions</span>
            <div className="suggestion-chip-grid">
              {suggestions.map((suggestion) => {
                const selected = stringListDraftIncludes(value, suggestion);
                return (
                  <button
                    key={suggestion}
                    type="button"
                    className={`suggestion-chip${selected ? ' selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => onChange(toggleStringListDraftValue(value, suggestion))}
                  >
                    {suggestion}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* For suggestion-based fields, hide the editor until at least one item is selected.
            Items arrive via chip clicks or the custom-entry below, not by typing in an empty row. */}
        {(suggestions.length === 0 || stringListDraftItems(value).length > 0) ? (
          <div className="list-editor">
            {suggestions.length > 0 ? (
              <span className="list-editor-label">Selected</span>
            ) : null}
            {rows.map((item, index) => (
              <div className="list-editor-row" key={`${field.key}-${index}`}>
                <input
                  type="text"
                  value={item}
                  placeholder={placeholder}
                  onChange={(event) => {
                    const nextRows = rows.slice();
                    nextRows[index] = event.target.value;
                    onChange(nextRows.join('\n'));
                  }}
                />
                <button
                  type="button"
                  aria-label={`Remove ${field.label.toLowerCase()} item ${index + 1}`}
                  title="Remove item"
                  onClick={() => {
                    const nextRows = rows.slice();
                    nextRows.splice(index, 1);
                    onChange(nextRows.join('\n'));
                  }}
                  disabled={rows.length <= 1 && item.trim().length === 0}
                >
                  -
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {suggestions.length > 0 ? (
          <div className="list-custom-entry">
            <input
              type="text"
              value={customDraft}
              placeholder={placeholder}
              onChange={(event) =>
                setCustomListItemDrafts((current) => ({ ...current, [draftKey]: event.target.value }))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCustomItem();
                }
              }}
            />
            <button type="button" onClick={addCustomItem} disabled={!customDraft.trim()}>
              Add item
            </button>
          </div>
        ) : (
          <div className="field-actions">
            <button
              type="button"
              onClick={() => onChange([...rows, ''].join('\n'))}
            >
              Add item
            </button>
          </div>
        )}
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <label className="field prompt-field">
        <span>{field.label}</span>
        <textarea
          value={String(value)}
          rows={field.rows ?? 4}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        {field.helpText ? <small>{field.helpText}</small> : null}
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <label className="field">
        <span>{field.label}</span>
        <select
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.helpText ? <small>{field.helpText}</small> : null}
      </label>
    );
  }

  return (
    <label className="field">
      <span>{field.label}</span>
      <input
        type={field.type === 'number' ? 'number' : field.type === 'secret-reference' ? 'password' : 'text'}
        value={value as string | number}
        placeholder={field.type === 'secret-reference' || field.type === 'text' ? field.placeholder : undefined}
        min={field.type === 'number' ? field.min : undefined}
        max={field.type === 'number' ? field.max : undefined}
        step={field.type === 'number' ? field.step : undefined}
        autoComplete={field.type === 'secret-reference' ? 'off' : undefined}
        onChange={(event) => onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)}
      />
      {field.helpText ? <small>{field.helpText}</small> : null}
    </label>
  );
}
