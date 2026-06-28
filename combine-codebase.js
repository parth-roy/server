const fs = require('fs');
const path = require('path');

// Files and directories to exclude
const EXCLUDE_PATTERNS = [
  'node_modules',
  'dist',
  'ios',
  '.expo',
  'android',
  'build',
  '.git',
  '.git_disabled',
  '.vscode',
  'coverage',
  '.env',
  '.env.local',
  '.env.example',
  '.enc',
  '.gitignore',
  '.gitattributes',
  'service.json',
  'package-lock.json',
  'yarn.lock',
  'tsconfig.tsbuildinfo',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '.next',
  'out',
];

const EXCLUDE_EXTENSIONS = [
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
];

const SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.prisma',
];

function shouldExclude(filePath, fileName) {
  // Check patterns
  for (const pattern of EXCLUDE_PATTERNS) {
    if (fileName === pattern || filePath.includes(`\\${pattern}\\`) || filePath.includes(`/${pattern}/`)) {
      return true;
    }
  }

  // Check extensions
  const ext = path.extname(fileName);
  if (EXCLUDE_EXTENSIONS.includes(ext)) {
    return true;
  }

  return false;
}

function shouldInclude(filePath) {
  const ext = path.extname(filePath);
  return SOURCE_EXTENSIONS.includes(ext);
}

function readFilesRecursive(dir, relativePath = '') {
  let result = [];

  try {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const relPath = path.join(relativePath, file);

      if (shouldExclude(fullPath, file)) {
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          result = result.concat(readFilesRecursive(fullPath, relPath));
        } else if (shouldInclude(file)) {
          result.push({
            path: relPath.replace(/\\/g, '/'),
            fullPath: fullPath,
          });
        }
      } catch (err) {
        console.warn(`Warning: Could not read ${fullPath}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}: ${err.message}`);
  }

  return result;
}

function combineCodebase() {
  const startDir = process.cwd();
  console.log(`🔍 Scanning directory: ${startDir}`);

  const files = readFilesRecursive(startDir, '');
  console.log(`📦 Found ${files.length} files to combine`);

  let combined = `# Combined Codebase
Generated: ${new Date().toISOString()}
Directory: ${startDir}
Total Files: ${files.length}

---\n\n`;

  for (const file of files) {
    try {
      const content = fs.readFileSync(file.fullPath, 'utf-8');
      combined += `\n${'='.repeat(80)}\n`;
      combined += `FILE: ${file.path}\n`;
      combined += `${'='.repeat(80)}\n\n`;
      combined += content;
      combined += '\n\n';
    } catch (err) {
      console.warn(`Warning: Could not read file ${file.path}: ${err.message}`);
    }
  }

  const outputFile = path.join(startDir, `codebase-combined-${Date.now()}.txt`);
  fs.writeFileSync(outputFile, combined);

  console.log(`\n✅ Successfully combined codebase!`);
  console.log(`📄 Output file: ${outputFile}`);
  console.log(`📊 Total size: ${(combined.length / 1024).toFixed(2)} KB`);
}

combineCodebase();
