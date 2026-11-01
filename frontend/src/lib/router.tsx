import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

function currentPath(): string {
  const path = window.location.pathname.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

export function navigate(to: string) {
  if (currentPath() === to) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);

  return path;
}

type LinkProps = {
  to: string;
  className?: string;
  children: ReactNode;
  current?: boolean;
  title?: string;
};

export function Link({ to, className, children, current, title }: LinkProps) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }

  return (
    <a href={to} className={className} onClick={onClick} aria-current={current ? "page" : undefined} title={title}>
      {children}
    </a>
  );
}
