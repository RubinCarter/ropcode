import React, { createContext, useContext, useState, useCallback } from 'react';

/**
 * Todo Item structure
 */
export interface TodoItem {
  content: string;      // Task description (static form)
  activeForm: string;   // Active form description (e.g., "Running tests...")
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'high' | 'medium' | 'low';
}

/**
 * Workspace status types
 */
export type WorkspaceStatus =
  | 'idle'        // Default state, no activity
  | 'working'     // Claude is currently replying/processing
  | 'active'      // Has in-progress todos
  | 'unread';     // Has unread completion message

/**
 * Workspace Todo State
 */
interface WorkspaceTodoState {
  workspaceId: string;          // Unique identifier for workspace
  workspacePath: string;        // Workspace path
  inProgressTodos: TodoItem[];  // Currently in-progress todos
  lastUpdated: number;          // Last update timestamp
  status: WorkspaceStatus;      // Current workspace status
}

/**
 * Context API for managing workspace todo states
 */
interface WorkspaceTodoContextType {
  /**
   * Get in-progress todos for a specific workspace
   */
  getInProgressTodos: (workspaceId: string) => TodoItem[];

  /**
   * Update todos for a specific workspace
   */
  updateWorkspaceTodos: (workspaceId: string, workspacePath: string, todos: TodoItem[]) => void;

  /**
   * Clear todos for a specific workspace
   */
  clearWorkspace: (workspaceId: string) => void;

  /**
   * Get all workspace todo states
   */
  getAllWorkspaceTodos: () => Map<string, WorkspaceTodoState>;

  /**
   * Get workspace status
   */
  getWorkspaceStatus: (workspaceId: string) => WorkspaceStatus;

  /**
   * Set workspace status
   */
  setWorkspaceStatus: (workspaceId: string, status: WorkspaceStatus) => void;

  /**
   * Mark workspace as read (clear unread status)
   */
  markAsRead: (workspaceId: string) => void;
}

const WorkspaceTodoContext = createContext<WorkspaceTodoContextType | undefined>(undefined);

/**
 * Provider component for workspace todo state management
 */
export const WorkspaceTodoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [workspaceTodos, setWorkspaceTodos] = useState<Map<string, WorkspaceTodoState>>(new Map());

  /**
   * Get in-progress todos for a specific workspace
   */
  const getInProgressTodos = useCallback((workspaceId: string): TodoItem[] => {
    const state = workspaceTodos.get(workspaceId);
    return state?.inProgressTodos || [];
  }, [workspaceTodos]);

  /**
   * Update todos for a specific workspace
   * Automatically filters to only store in-progress todos and updates status
   */
  const updateWorkspaceTodos = useCallback((
    workspaceId: string,
    workspacePath: string,
    allTodos: TodoItem[]
  ) => {
    
    setWorkspaceTodos(prev => {
      const newMap = new Map(prev);

      // Filter to only in-progress todos
      const inProgressTodos = allTodos.filter(todo => todo.status === 'in_progress');

      
      const prevState = prev.get(workspaceId);
      const hadInProgress = prevState && prevState.inProgressTodos.length > 0;
      const prevStatus = prevState?.status || 'idle';

      if (inProgressTodos.length === 0) {
        // No in-progress todos
        if (hadInProgress) {
          // Previously had in-progress todos, now all completed
          // Force status to 'working' to wait for spawn task completion
          // When task completes and status changes to 'idle', it will become 'unread'
          if (prevStatus === 'working' || prevStatus === 'active') {
            // Task is still running, force to 'working' state
            newMap.set(workspaceId, {
              workspaceId,
              workspacePath,
              inProgressTodos: [],
              lastUpdated: Date.now(),
              status: 'working'  // ← Force to 'working' to wait for task completion
            });
                      } else {
            // Already idle, set unread directly
            newMap.set(workspaceId, {
              workspaceId,
              workspacePath,
              inProgressTodos: [],
              lastUpdated: Date.now(),
              status: 'unread'
            });
                      }
        } else {
          // Never had in-progress todos, just remove
          newMap.delete(workspaceId);
                  }
      } else {
        // Store in-progress todos with 'active' status
        newMap.set(workspaceId, {
          workspaceId,
          workspacePath,
          inProgressTodos,
          lastUpdated: Date.now(),
          status: 'active'
        });
              }

      
      return newMap;
    });
  }, []);

  /**
   * Clear todos for a specific workspace
   */
  const clearWorkspace = useCallback((workspaceId: string) => {
    setWorkspaceTodos(prev => {
      const newMap = new Map(prev);
      newMap.delete(workspaceId);
      return newMap;
    });
  }, []);

  /**
   * Get all workspace todo states
   */
  const getAllWorkspaceTodos = useCallback(() => {
    return workspaceTodos;
  }, [workspaceTodos]);

  /**
   * Get workspace status
   */
  const getWorkspaceStatus = useCallback((workspaceId: string): WorkspaceStatus => {
    const state = workspaceTodos.get(workspaceId);
    return state?.status || 'idle';
  }, [workspaceTodos]);

  /**
   * Set workspace status
   * 🔥 IMPORTANT: Deduplicate state updates to prevent unnecessary re-renders
   * 🔥 KEY FIX: When task completes (working → idle) and todos are done, set to unread
   */
  const setWorkspaceStatus = useCallback((workspaceId: string, status: WorkspaceStatus) => {
    setWorkspaceTodos(prev => {
      const newMap = new Map(prev);
      const state = newMap.get(workspaceId);

      if (state) {
        // 🔥 KEY FIX: When spawn task completes (working → idle) and todos are already done
        if (state.status === 'working' && status === 'idle' && state.inProgressTodos.length === 0) {
          // Todos completed + Task completed → Set to 'unread'
          newMap.set(workspaceId, {
            ...state,
            status: 'unread',
            lastUpdated: Date.now()
          });
          return newMap;
        }

        // 🔥 Deduplicate: Don't update if status is already the same
        if (state.status === status) {
          return prev; // Return previous state to avoid re-render
        }

        // Update existing state
        newMap.set(workspaceId, {
          ...state,
          status,
          lastUpdated: Date.now()
        });
      } else if (status !== 'idle') {
        // Create new state if setting to non-idle status
        newMap.set(workspaceId, {
          workspaceId,
          workspacePath: workspaceId, // Use workspaceId as path for now
          inProgressTodos: [],
          lastUpdated: Date.now(),
          status
        });
      } else {
        // Trying to set idle on non-existent state, no change needed
        return prev; // Return previous state to avoid re-render
      }

      return newMap;
    });
  }, []);

  /**
   * Mark workspace as read (clear unread status)
   */
  const markAsRead = useCallback((workspaceId: string) => {
    setWorkspaceTodos(prev => {
      const newMap = new Map(prev);
      const state = newMap.get(workspaceId);

      if (state?.status === 'unread') {
        // Clear unread status and remove from map if no in-progress todos
        if (state.inProgressTodos.length === 0) {
          newMap.delete(workspaceId);
        } else {
          // If there are still todos, set to active
          newMap.set(workspaceId, {
            ...state,
            status: 'active'
          });
        }
      }

      return newMap;
    });
  }, []);

  const value: WorkspaceTodoContextType = {
    getInProgressTodos,
    updateWorkspaceTodos,
    clearWorkspace,
    getAllWorkspaceTodos,
    getWorkspaceStatus,
    setWorkspaceStatus,
    markAsRead
  };

  return (
    <WorkspaceTodoContext.Provider value={value}>
      {children}
    </WorkspaceTodoContext.Provider>
  );
};

/**
 * Hook to access workspace todo context
 */
export const useWorkspaceTodo = () => {
  const context = useContext(WorkspaceTodoContext);
  if (!context) {
    throw new Error('useWorkspaceTodo must be used within WorkspaceTodoProvider');
  }
  return context;
};
