import React from "react";

type Variant = "primary" | "secondary" | "ghost" | "icon" | "pill" | "danger";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  /** For icon buttons: accessible label (required by a11y guidelines). */
  label?: string;
  large?: boolean;
  active?: boolean;
}

/** Shared button. Variants map onto the pill-heavy Juno visual language. */
export function Button({
  variant = "secondary",
  loading,
  label,
  large,
  active,
  className = "",
  children,
  disabled,
  ...rest
}: Props) {
  const cls = [
    "btn",
    variant === "primary" && "btn-primary",
    variant === "ghost" && "btn-ghost",
    variant === "danger" && "btn-danger",
    variant === "icon" && "btn-icon",
    large && "btn-lg",
    active && "on",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      className={cls}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
