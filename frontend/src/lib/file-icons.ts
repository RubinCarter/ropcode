/**
 * File icon utilities - Maps file extensions to lucide-react icons with colors
 * Inspired by waveterm's MIME type configuration system
 */

import {
  File,
  FileCode,
  FileCode2,
  FileJson,
  FileText,
  FileType,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileSpreadsheet,
  FileCog,
  FileKey,
  FileCheck,
  Folder,
  FolderOpen,
  FolderGit,
  FolderGit2,
  Database,
  Terminal,
  Package,
  Settings,
  Lock,
  Globe,
  Braces,
  Hash,
  Scroll,
  type LucideIcon,
} from 'lucide-react';

export interface FileIconConfig {
  icon: LucideIcon;
  color: string;
}

// Extension to icon/color mapping
const extensionIconMap: Record<string, FileIconConfig> = {
  // JavaScript/TypeScript
  'js': { icon: FileCode, color: '#f7df1e' },
  'jsx': { icon: FileCode, color: '#61dafb' },
  'ts': { icon: FileCode2, color: '#3178c6' },
  'tsx': { icon: FileCode2, color: '#3178c6' },
  'mjs': { icon: FileCode, color: '#f7df1e' },
  'cjs': { icon: FileCode, color: '#f7df1e' },

  // Web
  'html': { icon: Globe, color: '#e34c26' },
  'htm': { icon: Globe, color: '#e34c26' },
  'css': { icon: Hash, color: '#264de4' },
  'scss': { icon: Hash, color: '#cc6699' },
  'sass': { icon: Hash, color: '#cc6699' },
  'less': { icon: Hash, color: '#1d365d' },
  'vue': { icon: FileCode, color: '#42b883' },
  'svelte': { icon: FileCode, color: '#ff3e00' },

  // Data formats
  'json': { icon: Braces, color: '#cbcb41' },
  'json5': { icon: Braces, color: '#cbcb41' },
  'jsonc': { icon: Braces, color: '#cbcb41' },
  'yaml': { icon: FileText, color: '#cb171e' },
  'yml': { icon: FileText, color: '#cb171e' },
  'toml': { icon: FileText, color: '#9c4121' },
  'xml': { icon: FileCode, color: '#e37933' },
  'csv': { icon: FileSpreadsheet, color: '#89d185' },

  // Programming languages
  'py': { icon: FileCode, color: '#3572a5' },
  'pyw': { icon: FileCode, color: '#3572a5' },
  'rb': { icon: FileCode, color: '#cc342d' },
  'go': { icon: FileCode, color: '#00add8' },
  'rs': { icon: FileCode, color: '#dea584' },
  'java': { icon: FileCode, color: '#b07219' },
  'kt': { icon: FileCode, color: '#a97bff' },
  'kts': { icon: FileCode, color: '#a97bff' },
  'scala': { icon: FileCode, color: '#c22d40' },
  'swift': { icon: FileCode, color: '#f05138' },
  'c': { icon: FileCode2, color: '#555555' },
  'h': { icon: FileCode2, color: '#555555' },
  'cpp': { icon: FileCode2, color: '#f34b7d' },
  'hpp': { icon: FileCode2, color: '#f34b7d' },
  'cc': { icon: FileCode2, color: '#f34b7d' },
  'cxx': { icon: FileCode2, color: '#f34b7d' },
  'cs': { icon: FileCode2, color: '#178600' },
  'php': { icon: FileCode, color: '#4f5d95' },
  'lua': { icon: FileCode, color: '#000080' },
  'r': { icon: FileCode, color: '#198ce7' },
  'pl': { icon: FileCode, color: '#0298c3' },
  'sh': { icon: Terminal, color: '#89e051' },
  'bash': { icon: Terminal, color: '#89e051' },
  'zsh': { icon: Terminal, color: '#89e051' },
  'fish': { icon: Terminal, color: '#89e051' },
  'ps1': { icon: Terminal, color: '#012456' },
  'bat': { icon: Terminal, color: '#c1f12e' },
  'cmd': { icon: Terminal, color: '#c1f12e' },

  // Markup & docs
  'md': { icon: FileText, color: '#083fa1' },
  'mdx': { icon: FileText, color: '#fcb32c' },
  'txt': { icon: FileText, color: '#89898a' },
  'rtf': { icon: FileText, color: '#89898a' },
  'tex': { icon: FileText, color: '#3d6117' },
  'rst': { icon: FileText, color: '#141414' },
  'adoc': { icon: FileText, color: '#e40046' },

  // Config files
  'env': { icon: FileCog, color: '#ecd53f' },
  'ini': { icon: FileCog, color: '#6d8086' },
  'conf': { icon: FileCog, color: '#6d8086' },
  'config': { icon: FileCog, color: '#6d8086' },
  'cfg': { icon: FileCog, color: '#6d8086' },
  'properties': { icon: FileCog, color: '#2a6099' },
  'editorconfig': { icon: Settings, color: '#fff' },

  // Package managers
  'lock': { icon: Lock, color: '#e8e8e8' },

  // Database
  'sql': { icon: Database, color: '#dad8d8' },
  'sqlite': { icon: Database, color: '#0f80cc' },
  'db': { icon: Database, color: '#dad8d8' },

  // Images
  'png': { icon: FileImage, color: '#a074c4' },
  'jpg': { icon: FileImage, color: '#a074c4' },
  'jpeg': { icon: FileImage, color: '#a074c4' },
  'gif': { icon: FileImage, color: '#a074c4' },
  'svg': { icon: FileImage, color: '#ffb13b' },
  'webp': { icon: FileImage, color: '#a074c4' },
  'ico': { icon: FileImage, color: '#a074c4' },
  'bmp': { icon: FileImage, color: '#a074c4' },

  // Video
  'mp4': { icon: FileVideo, color: '#fd8a8a' },
  'webm': { icon: FileVideo, color: '#fd8a8a' },
  'avi': { icon: FileVideo, color: '#fd8a8a' },
  'mov': { icon: FileVideo, color: '#fd8a8a' },
  'mkv': { icon: FileVideo, color: '#fd8a8a' },

  // Audio
  'mp3': { icon: FileAudio, color: '#e6b566' },
  'wav': { icon: FileAudio, color: '#e6b566' },
  'ogg': { icon: FileAudio, color: '#e6b566' },
  'flac': { icon: FileAudio, color: '#e6b566' },
  'm4a': { icon: FileAudio, color: '#e6b566' },

  // Archives
  'zip': { icon: FileArchive, color: '#ec915c' },
  'tar': { icon: FileArchive, color: '#ec915c' },
  'gz': { icon: FileArchive, color: '#ec915c' },
  'bz2': { icon: FileArchive, color: '#ec915c' },
  'xz': { icon: FileArchive, color: '#ec915c' },
  '7z': { icon: FileArchive, color: '#ec915c' },
  'rar': { icon: FileArchive, color: '#ec915c' },

  // Documents
  'pdf': { icon: FileType, color: '#ff0000' },
  'doc': { icon: FileType, color: '#2b579a' },
  'docx': { icon: FileType, color: '#2b579a' },
  'xls': { icon: FileSpreadsheet, color: '#217346' },
  'xlsx': { icon: FileSpreadsheet, color: '#217346' },
  'ppt': { icon: FileType, color: '#d24726' },
  'pptx': { icon: FileType, color: '#d24726' },

  // Keys & certs
  'pem': { icon: FileKey, color: '#a0724c' },
  'key': { icon: FileKey, color: '#a0724c' },
  'crt': { icon: FileKey, color: '#a0724c' },
  'cert': { icon: FileKey, color: '#a0724c' },
  'pub': { icon: FileKey, color: '#a0724c' },

  // Misc
  'log': { icon: Scroll, color: '#7a7a7a' },
  'diff': { icon: FileCheck, color: '#41b883' },
  'patch': { icon: FileCheck, color: '#41b883' },
  'wasm': { icon: FileCode, color: '#654ff0' },
};

// Special filenames
const filenameIconMap: Record<string, FileIconConfig> = {
  // Package managers
  'package.json': { icon: Package, color: '#e8e8e8' },
  'package-lock.json': { icon: Lock, color: '#cb3837' },
  'pnpm-lock.yaml': { icon: Lock, color: '#f9ad00' },
  'yarn.lock': { icon: Lock, color: '#2c8ebb' },
  'Cargo.toml': { icon: Package, color: '#dea584' },
  'Cargo.lock': { icon: Lock, color: '#dea584' },
  'go.mod': { icon: Package, color: '#00add8' },
  'go.sum': { icon: Lock, color: '#00add8' },
  'requirements.txt': { icon: Package, color: '#3572a5' },
  'Pipfile': { icon: Package, color: '#3572a5' },
  'Pipfile.lock': { icon: Lock, color: '#3572a5' },
  'pyproject.toml': { icon: Package, color: '#3572a5' },
  'Gemfile': { icon: Package, color: '#cc342d' },
  'Gemfile.lock': { icon: Lock, color: '#cc342d' },

  // Git
  '.gitignore': { icon: FolderGit, color: '#f05032' },
  '.gitattributes': { icon: FolderGit, color: '#f05032' },
  '.gitmodules': { icon: FolderGit, color: '#f05032' },
  '.gitkeep': { icon: FolderGit, color: '#f05032' },

  // Config files
  'Dockerfile': { icon: FileCog, color: '#2496ed' },
  'docker-compose.yml': { icon: FileCog, color: '#2496ed' },
  'docker-compose.yaml': { icon: FileCog, color: '#2496ed' },
  '.dockerignore': { icon: FileCog, color: '#2496ed' },
  'Makefile': { icon: FileCog, color: '#427819' },
  'CMakeLists.txt': { icon: FileCog, color: '#064f8c' },
  'tsconfig.json': { icon: Settings, color: '#3178c6' },
  'jsconfig.json': { icon: Settings, color: '#f7df1e' },
  '.eslintrc': { icon: Settings, color: '#4b32c3' },
  '.eslintrc.js': { icon: Settings, color: '#4b32c3' },
  '.eslintrc.json': { icon: Settings, color: '#4b32c3' },
  '.prettierrc': { icon: Settings, color: '#56b3b4' },
  '.prettierrc.js': { icon: Settings, color: '#56b3b4' },
  '.prettierrc.json': { icon: Settings, color: '#56b3b4' },
  'vite.config.ts': { icon: Settings, color: '#646cff' },
  'vite.config.js': { icon: Settings, color: '#646cff' },
  'webpack.config.js': { icon: Settings, color: '#8dd6f9' },
  'rollup.config.js': { icon: Settings, color: '#ef3335' },
  'tailwind.config.js': { icon: Settings, color: '#38bdf8' },
  'tailwind.config.ts': { icon: Settings, color: '#38bdf8' },

  // Documentation
  'README.md': { icon: FileText, color: '#083fa1' },
  'LICENSE': { icon: FileCheck, color: '#d4af37' },
  'LICENSE.md': { icon: FileCheck, color: '#d4af37' },
  'LICENSE.txt': { icon: FileCheck, color: '#d4af37' },
  'CHANGELOG.md': { icon: Scroll, color: '#83ba45' },
  'CONTRIBUTING.md': { icon: FileText, color: '#e91e63' },

  // Environment
  '.env': { icon: FileCog, color: '#ecd53f' },
  '.env.local': { icon: FileCog, color: '#ecd53f' },
  '.env.development': { icon: FileCog, color: '#ecd53f' },
  '.env.production': { icon: FileCog, color: '#ecd53f' },
  '.env.example': { icon: FileCog, color: '#ecd53f' },
};

// Directory name to icon/color mapping
const directoryIconMap: Record<string, FileIconConfig> = {
  '.git': { icon: FolderGit2, color: '#f05032' },
  '.github': { icon: FolderGit2, color: '#4078c0' },
  '.vscode': { icon: Folder, color: '#007acc' },
  'node_modules': { icon: Folder, color: '#8bc500' },
  'src': { icon: FolderOpen, color: '#42b883' },
  'lib': { icon: Folder, color: '#89d185' },
  'dist': { icon: Folder, color: '#ff6f00' },
  'build': { icon: Folder, color: '#ff6f00' },
  'out': { icon: Folder, color: '#ff6f00' },
  'public': { icon: Folder, color: '#52b4d9' },
  'assets': { icon: Folder, color: '#a074c4' },
  'images': { icon: Folder, color: '#a074c4' },
  'img': { icon: Folder, color: '#a074c4' },
  'static': { icon: Folder, color: '#52b4d9' },
  'styles': { icon: Folder, color: '#264de4' },
  'css': { icon: Folder, color: '#264de4' },
  'components': { icon: Folder, color: '#61dafb' },
  'pages': { icon: Folder, color: '#61dafb' },
  'views': { icon: Folder, color: '#61dafb' },
  'hooks': { icon: Folder, color: '#61dafb' },
  'utils': { icon: Folder, color: '#89d185' },
  'helpers': { icon: Folder, color: '#89d185' },
  'services': { icon: Folder, color: '#42b883' },
  'api': { icon: Folder, color: '#f7df1e' },
  'test': { icon: Folder, color: '#c21325' },
  'tests': { icon: Folder, color: '#c21325' },
  '__tests__': { icon: Folder, color: '#c21325' },
  'spec': { icon: Folder, color: '#c21325' },
  'docs': { icon: Folder, color: '#083fa1' },
  'config': { icon: Folder, color: '#6d8086' },
  'configs': { icon: Folder, color: '#6d8086' },
  'scripts': { icon: Folder, color: '#89e051' },
  'bin': { icon: Folder, color: '#89e051' },
  'types': { icon: Folder, color: '#3178c6' },
  '@types': { icon: Folder, color: '#3178c6' },
};

/**
 * Get icon config for a file
 */
export function getFileIconConfig(filename: string, isDirectory: boolean, isExpanded?: boolean): FileIconConfig {
  const lowerName = filename.toLowerCase();

  if (isDirectory) {
    // Check directory-specific icons
    if (directoryIconMap[lowerName]) {
      return directoryIconMap[lowerName];
    }
    // Default directory icon
    return {
      icon: isExpanded ? FolderOpen : Folder,
      color: '#90a4ae',
    };
  }

  // Check filename-specific icons first
  if (filenameIconMap[filename]) {
    return filenameIconMap[filename];
  }
  if (filenameIconMap[lowerName]) {
    return filenameIconMap[lowerName];
  }

  // Get extension
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && extensionIconMap[ext]) {
    return extensionIconMap[ext];
  }

  // Default file icon
  return { icon: File, color: '#89898a' };
}

/**
 * Get just the icon component for a file
 */
export function getFileIcon(filename: string, isDirectory: boolean, isExpanded?: boolean): LucideIcon {
  return getFileIconConfig(filename, isDirectory, isExpanded).icon;
}

/**
 * Get just the color for a file icon
 */
export function getFileIconColor(filename: string, isDirectory: boolean): string {
  return getFileIconConfig(filename, isDirectory).color;
}

// Extension to Monaco language ID mapping
const extensionLanguageMap: Record<string, string> = {
  // JavaScript/TypeScript
  'js': 'javascript',
  'jsx': 'javascript',
  'mjs': 'javascript',
  'cjs': 'javascript',
  'ts': 'typescript',
  'tsx': 'typescript',
  'mts': 'typescript',
  'cts': 'typescript',

  // Web
  'html': 'html',
  'htm': 'html',
  'css': 'css',
  'scss': 'scss',
  'sass': 'scss',
  'less': 'less',
  'vue': 'html',
  'svelte': 'html',

  // Data formats
  'json': 'json',
  'json5': 'json',
  'jsonc': 'json',
  'yaml': 'yaml',
  'yml': 'yaml',
  'toml': 'ini',
  'xml': 'xml',
  'csv': 'plaintext',

  // Programming languages
  'py': 'python',
  'pyw': 'python',
  'pyi': 'python',
  'rb': 'ruby',
  'go': 'go',
  'rs': 'rust',
  'java': 'java',
  'kt': 'kotlin',
  'kts': 'kotlin',
  'scala': 'scala',
  'swift': 'swift',
  'c': 'c',
  'h': 'c',
  'cpp': 'cpp',
  'hpp': 'cpp',
  'cc': 'cpp',
  'cxx': 'cpp',
  'cs': 'csharp',
  'php': 'php',
  'lua': 'lua',
  'r': 'r',
  'pl': 'perl',
  'pm': 'perl',
  'sh': 'shell',
  'bash': 'shell',
  'zsh': 'shell',
  'fish': 'shell',
  'ps1': 'powershell',
  'bat': 'bat',
  'cmd': 'bat',

  // Markup & docs
  'md': 'markdown',
  'mdx': 'markdown',
  'txt': 'plaintext',
  'tex': 'latex',
  'rst': 'restructuredtext',

  // Config files
  'ini': 'ini',
  'conf': 'ini',
  'cfg': 'ini',
  'properties': 'properties',

  // Database
  'sql': 'sql',

  // Misc
  'dockerfile': 'dockerfile',
  'diff': 'diff',
  'patch': 'diff',
  'graphql': 'graphql',
  'gql': 'graphql',
};

// Special filenames to language mapping
const filenameLanguageMap: Record<string, string> = {
  'Dockerfile': 'dockerfile',
  'Makefile': 'makefile',
  'CMakeLists.txt': 'cmake',
  '.gitignore': 'ignore',
  '.dockerignore': 'ignore',
  '.editorconfig': 'ini',
};

/**
 * Get Monaco language ID for a file
 */
export function getLanguageByFilename(filePath: string): string {
  const filename = filePath.split('/').pop() || filePath;
  const lowerFilename = filename.toLowerCase();

  // Check filename-specific mapping first
  if (filenameLanguageMap[filename]) {
    return filenameLanguageMap[filename];
  }

  // Get extension
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && extensionLanguageMap[ext]) {
    return extensionLanguageMap[ext];
  }

  // Default to plaintext
  return 'plaintext';
}
