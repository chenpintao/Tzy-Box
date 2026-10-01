/**
 * 构建脚本：生成混淆后的源码副本，供打包成单文件使用。
 *
 * 流程：
 *   1. 把项目里需要参与打包的文件复制到 dist-build/；
 *   2. 对其中敏感的 JS（密码算法、AES 密钥、API 逻辑）做高强度混淆；
 *   3. 混淆后的副本供 pkg / PyInstaller 打包，原源码目录保持不变。
 *
 * 用法：node build.js [--all|--node|--python]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist-build');

// ---------- 需要复制的静态资源（不参与混淆，原样拷贝） ----------
// 这些是 local_server.js 运行时需要服务的页面/资源
const STATIC_FILES = [
    'index.html', 'board.html', 'chem.html', 'remark.html',
    'ezyRawContent.html', 'test-pdfjs.html',
    'icon.png', 'download.png', 'bg3.jpg', 'Board.svg', 'folder.svg', 'note.svg',
    'bootswatch.min.css', 'sweetalert.css', 'DPlayer.min.css',
    'jquery.min.js', 'jquery.watermark.js', 'bootstrap.bundle.min.js',
    'crypto-js.js', 'sweetalert-dev.js', 'DPlayer.min.js',
    'aliyun-oss-sdk.min.js', 'jspdf.umd.min.js', 'jszip.min.js',
    'update.json', 'test.json', 'blackbroad.zip', 'tbHelper.apk',
];
const STATIC_DIRS = ['web', 'build'];

// ---------- 需要混淆的 JS（浏览器端敏感逻辑） ----------
// 注意：混淆会改变标识符，这些文件在 index.html 里以 <script src> 引用，
//       混淆后内容变、文件名不变即可，引用无需改。
const OBFUSCATE_JS = [
    'index.js',       // API 调用、token、云笔记删除/重命名
    'linspirer.js',   // 领创密码算法 + FIXED_UUID
    'pdf-upload.js',  // AES 密钥生成 generateAesKey
    'chem.js',
];

// ---------- Node 服务端（入口，混淆后作为 pkg 入口） ----------
const NODE_ENTRY = 'local_server.js';

// ---------- 高强度混淆配置 ----------
// 关键：控制流扁平化 + 死代码注入 + 字符串拆分编码 + 标识符混淆
const OBFUSCATOR_OPTS = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.85,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,               // 保留全局函数名，否则 index.html 的 onclick 引用会断
    stringArray: true,
    stringArrayThreshold: 0.85,
    stringArrayEncoding: ['base64', 'rc4'],
    splitStrings: true,
    splitStringsChunkLength: 6,
    unicodeEscapeSequence: false,
    selfDefending: true,                // 防止被格式化美化后直接还原
    disableConsoleOutput: false,        // 保留 console，便于 exe 运行排查
    numbersToExpressions: true,
    transformObjectKeys: true,
};

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        ensureDir(dest);
        for (const item of fs.readdirSync(src)) {
            copyRecursive(path.join(src, item), path.join(dest, item));
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

function clean() {
    if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
    ensureDir(OUT);
    console.log('[build] 已清理输出目录 dist-build/');
}

function ensureObfuscator() {
    try {
        return require('javascript-obfuscator');
    } catch (e) {
        console.log('[build] 未检测到 javascript-obfuscator，正在本地安装...');
        execSync('npm install --no-save javascript-obfuscator', { stdio: 'inherit', cwd: ROOT });
        return require('javascript-obfuscator');
    }
}

function obfuscateFile(obf, srcFile, destFile) {
    const code = fs.readFileSync(srcFile, 'utf8');
    const result = obf.obfuscate(code, OBFUSCATOR_OPTS);
    fs.writeFileSync(destFile, result.getObfuscatedCode(), 'utf8');
    const before = (code.length / 1024).toFixed(1);
    const after = (result.getObfuscatedCode().length / 1024).toFixed(1);
    console.log(`[build] 混淆 ${path.basename(srcFile)}: ${before}KB -> ${after}KB`);
}

function buildNodeSource(obf) {
    console.log('\n[build] === 生成 Node 端混淆源码 ===');
    const nodeOut = path.join(OUT, 'node');
    ensureDir(nodeOut);

    // 1) 复制静态资源
    for (const f of STATIC_FILES) {
        const s = path.join(ROOT, f);
        if (fs.existsSync(s)) fs.copyFileSync(s, path.join(nodeOut, f));
    }
    for (const d of STATIC_DIRS) {
        const s = path.join(ROOT, d);
        if (fs.existsSync(s)) copyRecursive(s, path.join(nodeOut, d));
    }

    // 2) 混淆浏览器端敏感 JS
    for (const f of OBFUSCATE_JS) {
        const s = path.join(ROOT, f);
        if (fs.existsSync(s)) obfuscateFile(obf, s, path.join(nodeOut, f));
    }

    // 3) 混淆 Node 入口（保留 require 与全局名，强度略低以免破坏 CommonJS）
    obfuscateFile(obf, path.join(ROOT, NODE_ENTRY), path.join(nodeOut, NODE_ENTRY));

    console.log('[build] Node 端源码就绪：dist-build/node/');
    return nodeOut;
}

function buildPythonSource() {
    console.log('\n[build] === 生成 Python 端源码 ===');
    const pyOut = path.join(OUT, 'python');
    ensureDir(pyOut);
    // Python 端只做复制，混淆交给打包器（见下方说明）
    fs.copyFileSync(path.join(ROOT, 'share_server.py'), path.join(pyOut, 'share_server.py'));
    console.log('[build] Python 端源码就绪：dist-build/python/（混淆由 CI 用 pyarmor 处理）');
    return pyOut;
}

function main() {
    const arg = process.argv[2] || '--all';
    const obf = ensureObfuscator();

    clean();
    const which = { node: arg === '--all' || arg === '--node', python: arg === '--all' || arg === '--python' };

    if (which.node) buildNodeSource(obf);
    if (which.python) buildPythonSource();

    console.log('\n[build] 完成。混淆源码位于 dist-build/，可用于本地打包验证。');
    console.log('[build] 说明：');
    console.log('  - Node 端：pkg dist-build/node/local_server.js --targets node20-win-x64');
    console.log('  - Python 端：CI 会先用 pyarmor 混淆 share_server.py 再 PyInstaller 打包');
}

main();
