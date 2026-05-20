import type { Project } from '@/lib/api';
import { basename } from '@/lib/pathUtils';

export interface SelectedSpace {
  path: string;
  label: string;
  projectPath: string;
  projectLabel: string;
}

const getWorkspaceProvider = (workspace: NonNullable<Project['workspaces']>[number]) => {
  return workspace.providers?.find(p => p.provider_id === 'claude')
    ?? workspace.providers?.find(p => p.provider_id === 'codex')
    ?? workspace.providers?.[0];
};

export const projectLabelForPath = (path: string | undefined): string => {
  return basename(path, 'Unknown Project');
};

export function selectedSpaceFromProject(project: Project): SelectedSpace | null {
  if (!project.path) return null;
  const label = projectLabelForPath(project.path);
  return {
    path: project.path,
    label,
    projectPath: project.path,
    projectLabel: label,
  };
}

export function findSelectedSpace(projects: Project[], activeWorkspacePath?: string | null): SelectedSpace | null {
  if (!activeWorkspacePath) {
    return projects[0] ? selectedSpaceFromProject(projects[0]) : null;
  }

  for (const project of projects) {
    if (project.path === activeWorkspacePath) {
      return selectedSpaceFromProject(project);
    }

    for (const workspace of project.workspaces ?? []) {
      const provider = getWorkspaceProvider(workspace);
      if (provider?.path === activeWorkspacePath) {
        return {
          path: provider.path,
          label: workspace.branch || workspace.name || basename(provider.path, 'Workspace'),
          projectPath: project.path,
          projectLabel: projectLabelForPath(project.path),
        };
      }
    }
  }

  return null;
}
