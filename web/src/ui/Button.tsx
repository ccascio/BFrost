import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function Button({
  variant = 'default',
  size = 'md',
  leading,
  trailing,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={['ui-button', `ui-button-${variant}`, `ui-button-${size}`, className].filter(Boolean).join(' ')}
    >
      {leading ? <span className="ui-button-icon" aria-hidden="true">{leading}</span> : null}
      <span className="ui-button-label">{children}</span>
      {trailing ? <span className="ui-button-icon" aria-hidden="true">{trailing}</span> : null}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function IconButton({
  label,
  variant = 'default',
  size = 'md',
  className,
  children,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      title={label}
      className={['ui-icon-button', `ui-button-${variant}`, `ui-button-${size}`, className].filter(Boolean).join(' ')}
    >
      {children}
    </button>
  );
}
