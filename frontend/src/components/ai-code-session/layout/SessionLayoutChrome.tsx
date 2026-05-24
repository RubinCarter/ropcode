import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Info } from 'lucide-react';
import { ErrorBoundary } from '../../ErrorBoundary';
import { SlashCommandsManager } from '../../SlashCommandsManager';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SplitPane } from '@/components/ui/split-pane';
import { WebviewPreview } from '../../WebviewPreview';
import { SessionComposer, type SessionComposerProps } from '../composer/SessionComposer';

interface SessionLayoutChromeProps {
  messagesList: React.ReactNode;
  runtimeStatusBar: React.ReactNode;
  composerProps: SessionComposerProps;
  providerApiSwitchNotice: string | null;
  onDismissProviderApiSwitchNotice: () => void;
  showPreview: boolean;
  previewUrl: string;
  splitPosition: number;
  onSplitPositionChange: (position: number) => void;
  isPreviewMaximized: boolean;
  onClosePreview: () => void;
  onTogglePreviewMaximize: () => void;
  onPreviewUrlChange: (url: string) => void;
  showSlashCommandsSettings: boolean;
  onSlashCommandsSettingsOpenChange: (open: boolean) => void;
  projectPath: string;
}

export const SessionLayoutChrome: React.FC<SessionLayoutChromeProps> = ({
  messagesList,
  runtimeStatusBar,
  composerProps,
  providerApiSwitchNotice,
  onDismissProviderApiSwitchNotice,
  showPreview,
  previewUrl,
  splitPosition,
  onSplitPositionChange,
  isPreviewMaximized,
  onClosePreview,
  onTogglePreviewMaximize,
  onPreviewUrlChange,
  showSlashCommandsSettings,
  onSlashCommandsSettingsOpenChange,
  projectPath,
}) => (
  <>
    {/* Provider API hot-swap notice — only visible while a turn is in
        flight after the user picked a new ProviderApi. The CLI applies
        the new credentials to the next request automatically; we never
        interrupt the running turn. */}
    <AnimatePresence>
      {providerApiSwitchNotice && (
        <motion.div
          key="provider-api-switch-notice"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="px-4 pt-2"
        >
          <div className="mx-auto w-full max-w-6xl">
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
              <div className="flex-1 leading-relaxed">
                <span className="font-medium">Switched API to {providerApiSwitchNotice}.</span>
                <span className="ml-1 text-muted-foreground">
                  The current reply finishes on the previous endpoint; the next message will use the new one.
                </span>
              </div>
              <button
                type="button"
                onClick={onDismissProviderApiSwitchNotice}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss notice"
              >
                x
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Main Content Area */}
    <div className="flex-1 overflow-hidden transition-all duration-300">
      {showPreview ? (
        <SplitPane
          left={<div className="h-full flex flex-col">{messagesList}</div>}
          right={
            <WebviewPreview
              initialUrl={previewUrl}
              onClose={onClosePreview}
              isMaximized={isPreviewMaximized}
              onToggleMaximize={onTogglePreviewMaximize}
              onUrlChange={onPreviewUrlChange}
            />
          }
          initialSplit={splitPosition}
          onSplitChange={onSplitPositionChange}
          minLeftWidth={400}
          minRightWidth={400}
          className="h-full"
        />
      ) : (
        <div className="h-full flex flex-col w-full">{messagesList}</div>
      )}
    </div>

    {/* Floating Prompt Input */}
    <ErrorBoundary>
      <div className="absolute bottom-0 right-0 left-0 transition-all duration-300 z-30">
        <div className="px-4 pb-3">
          <div className="mx-auto w-full max-w-6xl">
            {runtimeStatusBar}
          </div>
        </div>
        <SessionComposer {...composerProps} />
      </div>
    </ErrorBoundary>

    {/* Slash Commands Settings Dialog */}
    {showSlashCommandsSettings && (
      <Dialog open={showSlashCommandsSettings} onOpenChange={onSlashCommandsSettingsOpenChange}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Slash Commands</DialogTitle>
            <DialogDescription>
              Manage project-specific slash commands for {projectPath}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <SlashCommandsManager projectPath={projectPath} />
          </div>
        </DialogContent>
      </Dialog>
    )}
  </>
);
