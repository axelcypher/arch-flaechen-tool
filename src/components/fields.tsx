import { useEffect, useState } from 'react';
import { fmt2, parseNum } from '../core/format';

/**
 * Zahleneingabe mit Dezimalkomma. Übernimmt den Wert bei Enter oder Fokusverlust,
 * damit nicht jeder Tastendruck einen Undo-Schritt erzeugt.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  digits = 2,
  placeholder,
  allowEmpty = false,
  title,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  digits?: number;
  placeholder?: string;
  allowEmpty?: boolean;
  title?: string;
}) {
  const format = (v: number | undefined) => (v === undefined ? '' : digits === 2 ? fmt2(v).replace(/\./g, '') : v.toFixed(digits).replace('.', ','));
  const [text, setText] = useState(format(value));
  useEffect(() => setText(format(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    const v = parseNum(text);
    if (v === null) {
      if (allowEmpty && text.trim() === '') {
        if (value !== undefined) onChange(undefined);
      } else setText(format(value));
      return;
    }
    let c = v;
    if (min !== undefined) c = Math.max(min, c);
    if (max !== undefined) c = Math.min(max, c);
    if (c !== value) onChange(c);
    setText(format(c));
  };

  return (
    <input
      className="num"
      value={text}
      placeholder={placeholder}
      title={title}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(format(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Texteingabe, die erst bei Enter/Fokusverlust übernimmt. */
export function TextField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onChange(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
