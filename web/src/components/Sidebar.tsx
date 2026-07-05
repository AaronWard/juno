import React from "react";
import { useJuno } from "../App";
import { Dropdown } from "./Dropdown";

/** Offline Juno sidebar. Intentionally excludes: Upgrade to Pro, Home,
 *  Explore, Notifications, Earn Credits, Labs, Terms & Policies. */
export function Sidebar({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const { route, navigate } = useJuno();

  const items = [
    { icon: "✚", label: "Create", route: "/create" },
    { icon: "▦", label: "Studio", route: "/studio" },
    { icon: "♫", label: "Library", route: "/library" },
  ];

  const isActive = (r: string) =>
    r === "/create"
      ? route === "/create" || route === "/"
      : route.startsWith(r);

  return (
    <nav className="sidebar" aria-label="Primary">
      <div className="sidebar-logo-row">
        {!collapsed && <span className="sidebar-logo">JUNO</span>}
        <button
          className="btn btn-icon"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <button
        className="sidebar-profile"
        aria-label="Local profile and preferences"
        onClick={() => navigate("/settings")}
      >
        <span className="sidebar-avatar" aria-hidden="true" />
        {!collapsed && (
          <span>
            <div className="sidebar-profile-name">local user</div>
            <div className="sidebar-profile-sub">Offline Mode</div>
          </span>
        )}
      </button>

      <div className="sidebar-nav" role="list">
        {items.map((item) => (
          <button
            key={item.route}
            className={`nav-item${isActive(item.route) ? " active" : ""}`}
            onClick={() => navigate(item.route)}
            aria-current={isActive(item.route) ? "page" : undefined}
          >
            <span className="nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            {!collapsed && item.label}
          </button>
        ))}
      </div>

      <div className="sidebar-nav" style={{ marginTop: "auto" }}>
        <Dropdown
          align="left"
          triggerClass={`nav-item${route.startsWith("/settings") || route.startsWith("/trash") ? " active" : ""}`}
          ariaLabel="More"
          trigger={
            <>
              <span className="nav-icon" aria-hidden="true">⋯</span>
              {!collapsed && "More"}
            </>
          }
          items={[
            { id: "settings", label: "Settings", onSelect: () => navigate("/settings") },
            { id: "trash", label: "Trash", onSelect: () => navigate("/trash") },
          ]}
        />
      </div>
    </nav>
  );
}
