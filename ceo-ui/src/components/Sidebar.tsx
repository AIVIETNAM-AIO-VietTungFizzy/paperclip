import {
  Inbox,
  CircleDot,
  Target,
  LayoutDashboard,
  DollarSign,
  History,
  SquarePen,
  Network,
  ShieldCheck,
  FolderKanban,
  Users,
  Settings,
} from "lucide-react";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { useDialogActions } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { SidebarCompanyMenu } from "./SidebarCompanyMenu";

export function Sidebar() {
  const { openNewIssue } = useDialogActions();
  const { selectedCompanyId } = useCompany();
  const inboxBadge = useInboxBadge(selectedCompanyId);

  return (
    <aside className="w-full h-full min-h-0 border-r border-border bg-background flex flex-col">
      <div className="flex items-center gap-1 px-3 h-12 shrink-0">
        <SidebarCompanyMenu />
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => openNewIssue()}
            className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            <SquarePen className="h-4 w-4 shrink-0" />
            <span className="truncate">New Task</span>
          </button>
          <SidebarNavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} />
          <SidebarNavItem to="/goals" label="Goals" icon={Target} />
        </div>

        <SidebarSection label="Work">
          <SidebarNavItem to="/work/tasks" label="Work / Tasks" icon={CircleDot} />
          <SidebarNavItem to="/work/projects" label="Projects" icon={FolderKanban} />
          <SidebarNavItem
            to="/work/inbox"
            label="My Follow-ups"
            icon={Inbox}
            badge={inboxBadge.inbox}
            badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
            alert={inboxBadge.failedRuns > 0}
          />
        </SidebarSection>

        <SidebarSection label="Agents & Org">
          <SidebarNavItem to="/agents/all" label="Agents" icon={Users} />
          <SidebarNavItem to="/org" label="Org Chart" icon={Network} />
        </SidebarSection>

        <SidebarSection label="Governance">
          <SidebarNavItem to="/approvals/pending" label="Approvals" icon={ShieldCheck} />
          <SidebarNavItem to="/costs" label="Costs" icon={DollarSign} />
          <SidebarNavItem to="/activity" label="Activity" icon={History} />
        </SidebarSection>

        <SidebarSection label="Company">
          <SidebarNavItem to="/company/settings" label="Settings" icon={Settings} />
        </SidebarSection>
      </nav>
    </aside>
  );
}
