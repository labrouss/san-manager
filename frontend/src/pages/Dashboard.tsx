// =============================================================================
// pages/Dashboard.tsx (v2.9)
// Fixed: double UserManagement render, modal Add Switch, per-switch state reset
// =============================================================================

import { useState, useCallback } from "react";
import { useSwitches, useInterfaceNames, useVsans, deleteSwitch, useSwitch } from "../hooks/useZoningApi";
import { useAuth }              from "../context/AuthContext";
import { useTheme }             from "../context/ThemeContext";
import { ZoningEditor }         from "../components/zoning/ZoningEditor";
import { AliasManager }         from "../components/aliases/AliasManager";
import { SnapshotHistory }      from "../components/zoning/SnapshotHistory";
import { PortInventoryTable }   from "../components/inventory/PortInventoryTable";
import { SfpHealthView }        from "../components/sfp/SfpHealthView";
import { SfpPowerChart }        from "../components/sfp/SfpPowerChart";
import { AddSwitchModal }       from "../components/switches/AddSwitchForm";
import { TopPortsChart }        from "../components/performance/TopPortsChart";
import { PortPerformanceChart } from "../components/performance/PortPerformanceChart";
import { FabricView }           from "../components/fabric/FabricView";
import { UserManagement }       from "../components/auth/UserManagement";
import { SettingsPage }         from "../components/settings/SettingsPage";
import { SwitchSettings }       from "../components/switches/SwitchSettings";
import { cn } from "../lib/utils";
import type { Interface } from "../types/api.types";

const BASE_TABS = [
  { id: "aliases",     label: "FC aliases",     roles: ["ADMIN","OPERATOR","VIEWER"] },
  { id: "zoning",      label: "Zone editor",    roles: ["ADMIN","OPERATOR"] },
  { id: "fabric",      label: "Fabric",         roles: ["ADMIN","OPERATOR","VIEWER"] },
  { id: "inventory",   label: "Port inventory", roles: ["ADMIN","OPERATOR","VIEWER"] },
  { id: "sfp",         label: "SFP health",     roles: ["ADMIN","OPERATOR","VIEWER"] },
  { id: "performance", label: "Performance",    roles: ["ADMIN","OPERATOR","VIEWER"] },
  { id: "snapshots",   label: "Snapshots",      roles: ["ADMIN","OPERATOR"] },
  { id: "users",       label: "Users",          roles: ["ADMIN"] },
  { id: "settings",    label: "Settings",       roles: ["ADMIN"] },
  { id: "switch-settings", label: "Switch settings", roles: ["ADMIN","OPERATOR"] },
] as const;
type TabId = (typeof BASE_TABS)[number]["id"];

// ── Theme toggle ─────────────────────────────────────────────────────────────
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} title={theme === "dark" ? "Light mode" : "Dark mode"}
      className="h-8 w-8 flex items-center justify-center rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground">
      {theme === "dark" ? (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <circle cx="7.5" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M12.5 8A5.5 5.5 0 0 1 7 2.5a5.5 5.5 0 1 0 5.5 5.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}

// ── User menu ─────────────────────────────────────────────────────────────────
function UserMenu({ onNavigate }: { onNavigate?: (tab: TabId) => void }) {
  const { user, logout, isAdmin } = useAuth();
  const [open, setOpen]  = useState(false);
  const ROLE_COLOR: Record<string,string> = {
    ADMIN: "text-purple-500", OPERATOR: "text-blue-500", VIEWER: "text-gray-400",
  };

  const go = (tab: TabId) => { setOpen(false); onNavigate?.(tab); };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="h-8 flex items-center gap-1.5 px-2.5 rounded-md border border-border hover:bg-muted transition-colors text-sm">
        <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
          {user?.username[0].toUpperCase()}
        </div>
        <span className="hidden sm:block">{user?.username}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-muted-foreground">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}/>
          <div className="absolute right-0 top-full mt-1 z-50 bg-card border rounded-lg shadow-lg py-1 min-w-48">
            {/* User info */}
            <div className="px-3 py-2.5 border-b">
              <p className="text-sm font-medium">{user?.username}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
              <p className={cn("text-xs font-medium mt-0.5", ROLE_COLOR[user?.role ?? "VIEWER"])}>{user?.role}</p>
            </div>

            {/* Admin-only links */}
            {isAdmin && (
              <div className="py-1 border-b">
                <button onClick={() => go("users")}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2 text-foreground">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="5" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M1 11.5c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    <path d="M10 5.5v3M11.5 7h-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                  User management
                </button>
                <button onClick={() => go("settings")}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2 text-foreground">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.6 2.6l1 1M10.4 10.4l1 1M2.6 11.4l1-1M10.4 3.6l1-1"
                      stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                  Settings
                </button>
              </div>
            )}

            {/* Sign out */}
            <div className="py-1">
              <button onClick={() => { setOpen(false); logout(); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2 text-foreground">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2M9 10l3-3-3-3M12 7H5"
                    stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────────
function DeleteDialog({ switchName, onConfirm, onCancel, busy }: {
  switchName: string; onConfirm: ()=>void; onCancel: ()=>void; busy: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bg-card border rounded-xl p-6 w-full max-w-sm space-y-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-red-600">
              <path d="M9 3v6M9 13h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="9" cy="9" r="8" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-medium">Remove switch?</h2>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-mono font-medium text-foreground">{switchName}</span>
              {" "}and ALL its data — aliases, zones, snapshots, metrics — will be permanently deleted.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} disabled={busy}
            className="h-8 px-3 text-sm rounded-md border border-border hover:bg-muted">Cancel</button>
          <button onClick={onConfirm} disabled={busy}
            className="h-8 px-4 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
            {busy ? "Removing…" : "Remove switch"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function Dashboard() {
  const { switches, isLoading } = useSwitches();
  const { user, isAdmin }       = useAuth();

  // All per-switch state in one object so reset is atomic
  const [switchId,       setSwitchId]       = useState("");
  const [vsanId,         setVsanId]         = useState(100);
  const [tab,            setTab]            = useState<TabId>("aliases");
  const [selectedIface,  setSelectedIface]  = useState<Interface | null>(null);
  const [sfpInterface,   setSfpInterface]   = useState("");

  // Modal states
  const [showAddSwitch,  setShowAddSwitch]  = useState(false);
  const [confirmDelete,  setConfirmDelete]  = useState(false);
  const [deleting,       setDeleting]       = useState(false);

  const activeSwitchId = switchId || switches[0]?.id || null;
  const activeSwitch   = switches.find(s => s.id === activeSwitchId);
  const noSwitches     = !isLoading && switches.length === 0;

  const { interfaceNames } = useInterfaceNames(activeSwitchId);
  const { switchDetail, refresh: refreshSwitch } = useSwitch(activeSwitchId);
  const { vsanIds }        = useVsans(activeSwitchId);

  const userRole   = (user?.role ?? "VIEWER") as string;
  const visibleTabs = BASE_TABS.filter(t =>
    (t.roles as readonly string[]).includes(userRole)
  );

  // Reset all per-switch state when changing switch
  const handleSwitchChange = useCallback((id: string) => {
    setSwitchId(id); setVsanId(100); setTab("aliases");
    setSelectedIface(null); setSfpInterface(""); setConfirmDelete(false);
  }, []);

  const handleDeleteSwitch = async () => {
    if (!activeSwitchId) return;
    setDeleting(true);
    try {
      await deleteSwitch(activeSwitchId);
      setSwitchId(""); setVsanId(100); setTab("aliases");
      setSelectedIface(null); setSfpInterface(""); setConfirmDelete(false);
    } finally { setDeleting(false); }
  };

  const needsVsan = ["zoning","fabric","snapshots","performance"].includes(tab);

  return (
    <div className="min-h-screen bg-background">

      {/* Modals — rendered at root so they overlay everything */}
      {showAddSwitch && (
        <AddSwitchModal
          onSuccess={() => setShowAddSwitch(false)}
          onCancel={() => setShowAddSwitch(false)}
        />
      )}
      {confirmDelete && activeSwitch && (
        <DeleteDialog
          switchName={activeSwitch.hostname ?? activeSwitch.ipAddress}
          onConfirm={handleDeleteSwitch}
          onCancel={() => setConfirmDelete(false)}
          busy={deleting}
        />
      )}

      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-blue-500">
              <rect x="2" y="5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="6"  cy="10" r="1.5" fill="currentColor"/>
              <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
              <circle cx="14" cy="10" r="1.5" fill="currentColor"/>
            </svg>
            <span className="font-medium text-sm hidden sm:block">SAN Manager</span>
          </div>

          <div className="h-4 w-px bg-border hidden sm:block"/>

          {/* Switch selector */}
          {switches.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select value={activeSwitchId ?? ""} onChange={e => handleSwitchChange(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring max-w-52">
                {switches.map(sw => (
                  <option key={sw.id} value={sw.id}>
                    {(sw as any).displayName ?? sw.hostname ?? sw.ipAddress}{sw.model ? ` — ${sw.model}` : ""}
                  </option>
                ))}
              </select>
              {activeSwitchId && userRole !== "VIEWER" && (
                <button onClick={() => setConfirmDelete(true)} title="Remove switch"
                  className="h-8 w-8 flex items-center justify-center rounded-md border border-border hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600 text-muted-foreground transition-colors">
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M2 3.5h10M5 3.5V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1M5.5 6v4M8.5 6v4M3 3.5l.7 7.7a.5.5 0 0 0 .5.8h5.6a.5.5 0 0 0 .5-.8L11 3.5"
                      stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* VSAN selector */}
          {activeSwitchId && needsVsan && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground hidden sm:block">VSAN</span>
              <select value={vsanId} onChange={e => setVsanId(Number(e.target.value))}
                className="h-8 rounded-md border border-border bg-background px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring">
                {vsanIds.map(v => <option key={v} value={v}>{v}</option>)}
                {!vsanIds.includes(vsanId) && <option value={vsanId}>{vsanId}</option>}
              </select>
              <input type="number" min={1} max={4094} placeholder="+ VSAN"
                className="h-8 w-20 rounded-md border border-border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const v = parseInt((e.target as HTMLInputElement).value);
                    if (v > 0 && v <= 4094) { setVsanId(v); (e.target as HTMLInputElement).value = ""; }
                  }
                }}/>
            </div>
          )}

          {/* Right */}
          <div className="ml-auto flex items-center gap-2">
            {activeSwitch?.lastSeenAt && (
              <span className="text-xs text-muted-foreground hidden xl:block">
                Last seen {new Date(activeSwitch.lastSeenAt).toLocaleTimeString()}
              </span>
            )}
            {userRole !== "VIEWER" && (
              <button onClick={() => setShowAddSwitch(true)}
                className="h-8 px-3 text-xs rounded-md border border-border bg-background hover:bg-muted flex items-center gap-1.5">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Add switch
              </button>
            )}
            <ThemeToggle />
            <UserMenu onNavigate={setTab} />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-screen-xl mx-auto px-4 py-5 space-y-4">


        {/* Tab bar — always rendered so Users/Settings work without a switch */}
        <div className="flex border-b overflow-x-auto">
          {visibleTabs.map(({ id, label }) => (
            <button key={id} onClick={() => setTab(id)}
              className={cn(
                "px-4 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px flex-shrink-0",
                tab === id
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}>
              {label}
            </button>
          ))}
        </div>

        {/* Users tab — never needs a switch */}
        {tab === "users" && isAdmin && (
          <div className="rounded-xl border bg-card p-5"><UserManagement /></div>
        )}

        {/* Settings tab — never needs a switch */}
        {tab === "settings" && isAdmin && (
          <div className="rounded-xl border bg-card p-5"><SettingsPage /></div>
        )}

        {/* Switch settings — needs a switch but not a tab card wrapper */}
        {tab === "switch-settings" && (
          <div className="rounded-xl border bg-card p-5">
            {!activeSwitchId ? (
              <p className="text-sm text-muted-foreground">Select a switch to view its settings.</p>
            ) : switchDetail ? (
              <SwitchSettings
                switchId={activeSwitchId}
                switchData={switchDetail as any}
                onUpdated={refreshSwitch}
                isOperator={userRole === "ADMIN" || userRole === "OPERATOR"}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
          </div>
        )}

        {/* Switch-dependent tabs */}
        {!["users", "settings", "switch-settings"].includes(tab) && (
          <>
            {/* No switch registered yet — show a nudge in the content area */}
            {noSwitches && (
              <div className="rounded-xl border bg-card p-5">
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="opacity-25">
                    <rect x="4" y="10" width="32" height="20" rx="4" stroke="currentColor" strokeWidth="1.5"/>
                    <circle cx="12" cy="20" r="2.5" fill="currentColor"/>
                    <circle cx="20" cy="20" r="2.5" fill="currentColor"/>
                    <circle cx="28" cy="20" r="2.5" fill="currentColor"/>
                  </svg>
                  <p className="text-sm font-medium text-foreground">No switch selected</p>
                  <p className="text-xs">Add a switch to view {tab} data.</p>
                  {userRole !== "VIEWER" && (
                    <button onClick={() => setShowAddSwitch(true)}
                      className="mt-1 h-8 px-4 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
                      Add switch
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Switch selected — render the tab content */}
            {!noSwitches && activeSwitchId && (
              <div className="rounded-xl border bg-card p-5">

                {tab === "aliases"   && <AliasManager    switchId={activeSwitchId} />}
                {tab === "zoning"    && <ZoningEditor    switchId={activeSwitchId} vsanId={vsanId} />}
                {tab === "fabric"    && <FabricView      switchId={activeSwitchId} vsanId={vsanId} />}
                {tab === "snapshots" && <SnapshotHistory switchId={activeSwitchId} vsanId={vsanId} />}

                {tab === "inventory" && (
                  <div className="space-y-5">
                    <PortInventoryTable
                      switchId={activeSwitchId}
                      onSelectInterface={iface => { setSelectedIface(iface); setSfpInterface(iface.name); }}
                      selectedInterfaceId={selectedIface?.id}
                    />
                    {selectedIface && (
                      <div className="rounded-lg border p-4">
                        <SfpPowerChart switchId={activeSwitchId} interfaceName={selectedIface.name} />
                      </div>
                    )}
                  </div>
                )}

                {tab === "sfp" && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="text-sm text-muted-foreground flex-shrink-0">Interface</label>
                      {interfaceNames.length > 0 ? (
                        <select value={sfpInterface} onChange={e => setSfpInterface(e.target.value)}
                          className="h-9 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring">
                          <option value="">— select interface —</option>
                          {interfaceNames.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      ) : (
                        <input
                          className="h-9 w-36 rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="fc1/1" value={sfpInterface} onChange={e => setSfpInterface(e.target.value)}/>
                      )}
                    </div>
                    {sfpInterface ? (
                      <>
                        <SfpHealthView  switchId={activeSwitchId} interfaceName={sfpInterface} />
                        <div className="rounded-lg border p-4">
                          <SfpPowerChart switchId={activeSwitchId} interfaceName={sfpInterface} />
                        </div>
                      </>
                    ) : (
                      <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                        Select an interface above to view SFP diagnostics
                      </div>
                    )}
                  </div>
                )}

                {tab === "performance" && (
                  <div className="space-y-6">
                    <TopPortsChart        switchId={activeSwitchId} vsanId={vsanId} />
                    <div className="border-t pt-6">
                      <PortPerformanceChart switchId={activeSwitchId} />
                    </div>
                  </div>
                )}

              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
