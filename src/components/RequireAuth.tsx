import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";

/** Asks the API if we're logged in; on 401 sends the user to /login?next=<current path>. */
export default function RequireAuth() {
  const { pathname } = useLocation();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    fetch("/api/session").then((r) => {
      if (r.status === 401) window.location.href = `/login?next=${encodeURIComponent(pathname)}`;
      else setOk(true);
    });
  }, [pathname]);

  return ok ? <Outlet /> : null;
}
