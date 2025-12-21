import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Loader2, Terminal, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { api, type ProcessInfo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatISOTimestamp } from "@/lib/date-utils";
import { shortenPath } from "@/lib/pathUtils";

interface RunningClaudeSessionsProps {
  /**
   * Optional className for styling
   */
  className?: string;
}

/**
 * Component to display currently running Claude sessions
 */
export const RunningClaudeSessions: React.FC<RunningClaudeSessionsProps> = ({
  className,
}) => {
  const [runningSessions, setRunningSessions] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRunningSessions();
    
    // Poll for updates every 5 seconds
    const interval = setInterval(loadRunningSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadRunningSessions = async () => {
    try {
      const sessions = await api.listRunningClaudeSessions();
      setRunningSessions(sessions);
      setError(null);
    } catch (err) {
      console.error("Failed to load running sessions:", err);
      setError("Failed to load running sessions");
    } finally {
      setLoading(false);
    }
  };

  // Removed handleResumeSession - running sessions can no longer be opened directly

  if (loading && runningSessions.length === 0) {
    return (
      <div className={cn("flex items-center justify-center py-4", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("flex items-center gap-2 text-destructive text-sm", className)}>
        <AlertCircle className="h-4 w-4" />
        <span>{error}</span>
      </div>
    );
  }

  if (runningSessions.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <h3 className="text-sm font-medium">Active Claude Sessions</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          ({runningSessions.length} running)
        </span>
      </div>

      <div className="space-y-2">
        {runningSessions.map((session) => {
          const sessionId = 'ClaudeSession' in session.process_type 
            ? session.process_type.ClaudeSession.session_id 
            : null;
          
          if (!sessionId) return null;

          return (
            <motion.div
              key={session.run_id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Card className="transition-all">
                <CardContent
                  className="p-3"
                  // Removed onClick - running sessions can no longer be opened directly
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Terminal className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-xs text-muted-foreground truncate">
                            {sessionId.substring(0, 20)}...
                          </p>
                          <span className="text-xs text-green-600 font-medium">
                            Running
                          </span>
                        </div>
                        
                        <p className="text-xs text-muted-foreground truncate">
                          {shortenPath(session.project_path)}
                        </p>
                        
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>Started: {formatISOTimestamp(session.started_at)}</span>
                          <span>Model: {session.model}</span>
                          {session.task && (
                            <span className="truncate max-w-[200px]" title={session.task}>
                              Task: {session.task}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Removed Resume button - running sessions can no longer be opened directly */}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}; 