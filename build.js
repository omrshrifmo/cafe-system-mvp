/**
 * Mazaj OS - Bytecode Obfuscation & Source Code Protection Compiler
 * Uses bytenode to compile core server and domain logic into V8 bytecode (.jsc files).
 */

const fs = require('fs');
const path = require('path');
const bytenode = require('bytenode');

const OUTPUT_DIR = path.join(__dirname, 'dist_bytecode');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function compileFile(srcPath, relativeOut) {
  const destPath = path.join(OUTPUT_DIR, relativeOut.replace(/\.js$/, '.jsc'));
  ensureDir(path.dirname(destPath));

  console.log(`🔒 Compiling V8 Bytecode: ${srcPath} -> ${destPath}`);
  await bytenode.compileFile({
    filename: srcPath,
    output: destPath,
    compileAsModule: true
  });
}

async function walkAndCompile(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist_bytecode' || entry.name === 'test' || entry.name === '.git') {
        continue;
      }
      await walkAndCompile(fullPath, baseDir);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      await compileFile(fullPath, relPath);
    }
  }
}

async function runBuild() {
  console.log('======================================================');
  console.log('🚀 Mazaj OS - Commercial V8 Bytecode Build Pipeline');
  console.log('======================================================');

  ensureDir(OUTPUT_DIR);

  // Compile top-level server.js
  const topServer = path.join(__dirname, 'src/server.js');
  if (fs.existsSync(topServer)) {
    await compileFile(topServer, 'server.jsc');
  }

  // Compile entire src/ directory
  const srcDir = path.join(__dirname, 'src');
  if (fs.existsSync(srcDir)) {
    await walkAndCompile(srcDir, srcDir);
  }

  console.log('======================================================');
  console.log('✅ Bytecode compilation complete! Protected files in dist_bytecode/');
  console.log('======================================================');
}

runBuild().catch(err => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
