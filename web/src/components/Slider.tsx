import React from "react";

interface Props {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  formatValue?: (v: number) => string;
}

/** Labeled slider used for Weirdness, Style Influence, Volume and Speed. */
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  formatValue = (v) => `${v}%`,
}: Props) {
  const id = `slider-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="slider-row">
      <label htmlFor={id} className="field-label" style={{ marginBottom: 0 }}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      <span className="slider-value">{formatValue(value)}</span>
    </div>
  );
}
