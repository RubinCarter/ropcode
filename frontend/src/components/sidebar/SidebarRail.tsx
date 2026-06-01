import React from 'react';
import {
  BarChart3,
  Bot,
  FileText,
  FolderOpen,
  GitBranch,
  Info,
  MessageSquare,
  MoreVertical,
  Network,
  Plus,
  Server,
  Settings,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipProvider, TooltipSimple } from '@/components/ui/tooltip-modern';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export type SidebarPanelMode = 'projects' | 'sessions';

interface SidebarRailProps {
  mode: SidebarPanelMode;
  collapsed: boolean;
  activeSystemTabType?: string;
  onModeChange: (mode: SidebarPanelMode) => void;
  onOpenProject: () => void;
  onCloneProject: () => void;
  onSyncFromSSH: () => void;
  onAgentsClick?: () => void;
  onUsageClick?: () => void;
  onSettingsClick?: () => void;
  onClaudeClick?: () => void;
  onMCPClick?: () => void;
  onInfoClick?: () => void;
}

type RailButtonProps = {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
};

const RailButton: React.FC<RailButtonProps> = ({ label, active, onClick, children }) => (
  <TooltipSimple content={label} side="right">
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground',
        active && 'bg-accent text-accent-foreground shadow-sm'
      )}
    >
      {children}
    </motion.button>
  </TooltipSimple>
);

export const SidebarRail: React.FC<SidebarRailProps> = ({
  mode,
  collapsed,
  activeSystemTabType,
  onModeChange,
  onOpenProject,
  onCloneProject,
  onSyncFromSSH,
  onAgentsClick,
  onUsageClick,
  onSettingsClick,
  onClaudeClick,
  onMCPClick,
  onInfoClick,
}) => {
  const { t } = useTranslation();
  return (
    <TooltipProvider>
      <div className="flex h-full w-16 flex-shrink-0 flex-col items-center border-r border-border/50 bg-background py-2">
        <div className="flex flex-col items-center gap-1">
          <RailButton
            label={t('sidebar.projects')}
            active={!collapsed && mode === 'projects'}
            onClick={() => onModeChange('projects')}
          >
            <FolderOpen className="h-4 w-4" />
          </RailButton>
          <RailButton
            label={t('sidebar.sessions')}
            active={!collapsed && mode === 'sessions'}
            onClick={() => onModeChange('sessions')}
          >
            <MessageSquare className="h-4 w-4" />
          </RailButton>
        </div>

        <div className="mt-3 flex flex-col items-center gap-1">
          <DropdownMenu>
            <TooltipSimple content={t('sidebar.addProject')} side="right">
              <DropdownMenuTrigger asChild>
                <motion.button
                  type="button"
                  aria-label={t('sidebar.addProject')}
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Plus className="h-4 w-4" />
                </motion.button>
              </DropdownMenuTrigger>
            </TooltipSimple>
            <DropdownMenuContent align="start" side="right" className="w-48">
              <DropdownMenuItem onClick={onOpenProject}>
                <FolderOpen className="mr-2 h-4 w-4" />
                {t('sidebar.openProject')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCloneProject}>
                <GitBranch className="mr-2 h-4 w-4" />
                {t('sidebar.cloneFromUrl')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onSyncFromSSH}>
                <Server className="mr-2 h-4 w-4" />
                {t('sidebar.fromSsh')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-auto flex flex-col items-center gap-1">
          {onAgentsClick && (
            <RailButton
              label={t('sidebar.agents')}
              active={activeSystemTabType === 'agents'}
              onClick={onAgentsClick}
            >
              <Bot className="h-4 w-4" />
            </RailButton>
          )}
          {onUsageClick && (
            <RailButton
              label={t('sidebar.usage')}
              active={activeSystemTabType === 'usage'}
              onClick={onUsageClick}
            >
              <BarChart3 className="h-4 w-4" />
            </RailButton>
          )}
          {onSettingsClick && (
            <RailButton
              label={t('sidebar.settings')}
              active={activeSystemTabType === 'settings'}
              onClick={onSettingsClick}
            >
              <Settings className="h-4 w-4" />
            </RailButton>
          )}

          <DropdownMenu>
            <TooltipSimple content={t('sidebar.more')} side="right">
              <DropdownMenuTrigger asChild>
                <motion.button
                  type="button"
                  aria-label={t('sidebar.more')}
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    'inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground',
                    (activeSystemTabType === 'claude-md' || activeSystemTabType === 'mcp') && 'bg-accent text-accent-foreground shadow-sm'
                  )}
                >
                  <MoreVertical className="h-4 w-4" />
                </motion.button>
              </DropdownMenuTrigger>
            </TooltipSimple>
            <DropdownMenuContent align="end" side="right" className="w-48">
              {onClaudeClick && (
                <DropdownMenuItem onClick={onClaudeClick}>
                  <FileText className="mr-2 h-4 w-4" />
                  {t('sidebar.memory')}
                </DropdownMenuItem>
              )}
              {onMCPClick && (
                <DropdownMenuItem onClick={onMCPClick}>
                  <Network className="mr-2 h-4 w-4" />
                  {t('sidebar.mcpServers')}
                </DropdownMenuItem>
              )}
              {onInfoClick && (
                <DropdownMenuItem onClick={onInfoClick}>
                  <Info className="mr-2 h-4 w-4" />
                  {t('sidebar.about')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default SidebarRail;
