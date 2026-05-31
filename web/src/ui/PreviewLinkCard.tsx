import type { ReactNode } from 'react';

interface PreviewLinkCardProps {
  title: ReactNode;
  description?: ReactNode;
  href?: string;
  meta?: ReactNode;
  icon?: ReactNode;
  external?: boolean;
  onClick?: () => void;
  className?: string;
}

export function PreviewLinkCard({
  title,
  description,
  href,
  meta,
  icon,
  external = false,
  onClick,
  className,
}: PreviewLinkCardProps) {
  const body = (
    <>
      {icon ? <span className="ui-preview-link-icon" aria-hidden="true">{icon}</span> : null}
      <span className="ui-preview-link-content">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
        {meta ? <small>{meta}</small> : null}
      </span>
    </>
  );
  const classes = ['ui-preview-link-card', className].filter(Boolean).join(' ');

  if (href) {
    return (
      <a className={classes} href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
        {body}
      </a>
    );
  }

  return (
    <button className={classes} type="button" onClick={onClick}>
      {body}
    </button>
  );
}
