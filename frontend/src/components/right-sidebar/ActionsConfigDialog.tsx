import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, GripVertical, Save, Terminal, Globe } from 'lucide-react';
import { api, type Action } from '@/lib/api';

interface ActionsConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  workspaceName?: string;
  onActionsUpdated?: () => void;
}

export const ActionsConfigDialog: React.FC<ActionsConfigDialogProps> = ({
  open,
  onOpenChange,
  projectName,
  workspaceName,
  onActionsUpdated
}) => {
  const [actions, setActions] = useState<Action[]>([]);
  const [editingAction, setEditingAction] = useState<Action | null>(null);

  // Load actions
  useEffect(() => {
    if (open) {
      loadActions();
    }
  }, [open, projectName, workspaceName]);

  const loadActions = async () => {
    try {
      const result = await api.getActions(projectName, workspaceName);
      // Combine global, project, and workspace actions
      const allActions = [
        ...result.global_actions.map(a => ({
          ...a,
          type: 'global' as const
        })),
        ...result.project_actions.map(a => ({
          ...a,
          type: 'project' as const
        })),
        ...(workspaceName ? result.workspace_actions.map(a => ({
          ...a,
          type: 'workspace' as const
        })) : [])
      ];
      setActions(allActions);
    } catch (error) {
      console.error('Failed to load actions:', error);
    }
  };

  const handleSave = async () => {
    try {
      const globalActions = actions.filter(a => a.type === 'global');
      const projectActions = actions.filter(a => a.type === 'project');
      const workspaceActions = actions.filter(a => a.type === 'workspace');

      await api.updateGlobalActions(globalActions);
      await api.updateProjectActions(projectName, projectActions);
      if (workspaceName) {
        await api.updateWorkspaceActions(projectName, workspaceName, workspaceActions);
      }
      onActionsUpdated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save actions:', error);
    }
  };

  const handleAddAction = () => {
    const type = workspaceName ? 'workspace' : 'project';
    const newAction: Action = {
      id: `${Date.now()}`,
      name: 'New Action',
      command: '',
      type,
      shared: type === 'project' ? true : undefined,
      actionType: 'script' // 默认为 script 类型
    };
    setEditingAction(newAction);
  };

  const handleDeleteAction = (id: string) => {
    setActions(actions.filter(a => a.id !== id));
  };

  const handleSaveEditingAction = () => {
    if (!editingAction) return;

    const index = actions.findIndex(a => a.id === editingAction.id);
    if (index >= 0) {
      const updated = [...actions];
      updated[index] = editingAction;
      setActions(updated);
    } else {
      setActions([...actions, editingAction]);
    }

    setEditingAction(null);
  };

  return (
    <>
      {/* Main Actions Config Dialog */}
      <Dialog open={open && !editingAction} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configure Actions</DialogTitle>
            <DialogDescription>
              {workspaceName
                ? `Configure quick actions for workspace "${workspaceName}"`
                : `Configure quick actions for project "${projectName}"`
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                {workspaceName
                  ? 'Actions available in this workspace'
                  : 'Actions available across all workspaces in this project'
                }
              </p>
              <Button
                size="sm"
                onClick={handleAddAction}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Action
              </Button>
            </div>

            <div className="space-y-2">
              {actions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No actions configured yet. Click "Add Action" to create one.
                </div>
              ) : (
                actions.map((action) => (
                  <div
                    key={action.id}
                    className="flex items-center gap-2 p-3 border rounded-lg hover:bg-muted/50"
                  >
                    <GripVertical className="w-4 h-4 text-muted-foreground" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{action.name}</span>
                        {action.actionType === 'web' && (
                          <span className="text-xs text-green-600 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded flex items-center gap-1">
                            <Globe className="w-3 h-3" />
                            Web
                          </span>
                        )}
                        {action.type === 'global' && (
                          <span className="text-xs text-orange-600 bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 rounded flex items-center gap-1">
                            <Globe className="w-3 h-3" />
                            Global
                          </span>
                        )}
                        {action.type === 'project' && action.shared && (
                          <span className="text-xs text-blue-600 bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 rounded">
                            Shared
                          </span>
                        )}
                        {action.type === 'workspace' && (
                          <span className="text-xs text-purple-600 bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 rounded">
                            Workspace Only
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-1">
                        {action.command}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingAction(action)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteAction(action.id)}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              <Save className="w-4 h-4 mr-2" />
              Save All Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Action Dialog */}
      <Dialog open={!!editingAction} onOpenChange={(open) => !open && setEditingAction(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingAction?.name === 'New Action' ? 'Create' : 'Edit'} Action
            </DialogTitle>
            <DialogDescription>
              {editingAction?.type === 'global'
                ? 'This action will be available in all projects and workspaces'
                : editingAction?.type === 'project'
                ? 'This action will be available across all workspaces in this project'
                : 'This action is only available in the current workspace'}
            </DialogDescription>
          </DialogHeader>

          {editingAction && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={editingAction.name}
                  onChange={(e) => setEditingAction({ ...editingAction, name: e.target.value })}
                  placeholder="e.g., Build, Run, Test"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="scope">Scope</Label>
                <Select
                  value={editingAction.type}
                  onValueChange={(value: 'global' | 'project' | 'workspace') => {
                    setEditingAction({
                      ...editingAction,
                      type: value,
                      shared: value === 'project' ? true : undefined
                    });
                  }}
                >
                  <SelectTrigger id="scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4" />
                        <span>Global - Available in all projects and workspaces</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="project">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4" />
                        <span>Project - Available in all workspaces of this project</span>
                      </div>
                    </SelectItem>
                    {workspaceName && (
                      <SelectItem value="workspace">
                        <div className="flex items-center gap-2">
                          <Terminal className="w-4 h-4" />
                          <span>Workspace - Only in "{workspaceName}"</span>
                        </div>
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="actionType">Action Type</Label>
                <Select
                  value={editingAction.actionType || 'script'}
                  onValueChange={(value: 'script' | 'web') => {
                    setEditingAction({
                      ...editingAction,
                      actionType: value
                    });
                  }}
                >
                  <SelectTrigger id="actionType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="script">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4" />
                        <span>Script - Run command in terminal</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="web">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4" />
                        <span>Web - Open URL in webview</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(editingAction.actionType || 'script') === 'script' ? (
                <div className="space-y-2">
                  <Label htmlFor="command">Command *</Label>
                  <Textarea
                    id="command"
                    value={editingAction.command || ''}
                    onChange={(e) => setEditingAction({ ...editingAction, command: e.target.value })}
                    placeholder="e.g., npm run build"
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    This command will be executed in the terminal
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="command">URL *</Label>
                  <Input
                    id="command"
                    type="url"
                    value={editingAction.command || ''}
                    onChange={(e) => setEditingAction({ ...editingAction, command: e.target.value })}
                    placeholder="e.g., http://localhost:3000 or http://127.0.0.1:8080"
                  />
                  <p className="text-xs text-muted-foreground">
                    This URL will be displayed in a webview tab
                  </p>
                </div>
              )}

              {editingAction.type === 'global' && (
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground">
                    Available in all projects and workspaces
                  </p>
                </div>
              )}

              {editingAction.type === 'project' && (
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground">
                    Available in all workspaces of this project
                  </p>
                </div>
              )}

              {workspaceName && editingAction.type === 'workspace' && (
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground">
                    Only available in workspace "{workspaceName}"
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setEditingAction(null)}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveEditingAction}>
              <Save className="w-4 h-4 mr-2" />
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
