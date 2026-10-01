// Local runner for ZhongYu ToolBox.
// Serves the existing static app and provides the small local endpoints used by index.js.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// 静态根目录：优先取可执行文件所在目录（打包成单文件后，exe 旁边的 index.html/资源可被服务），
// 否则退回脚本所在目录（直接 node local_server.js 时）。也支持 TOOLBOX_ROOT 环境变量覆盖。
const EXE_DIR = (typeof process.pkg !== 'undefined')
  ? path.dirname(process.execPath)
  : __dirname;
const ROOT = process.env.TOOLBOX_ROOT
  ? path.resolve(process.env.TOOLBOX_ROOT)
  : (fs.existsSync(path.join(EXE_DIR, 'index.html')) ? EXE_DIR : __dirname);
const PORT = Number(process.env.PORT || 8080);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.zip': 'application/zip',
};
const IMAGE_HOSTS = new Set([
  'ezy-sxz.oss-cn-hangzhou.aliyuncs.com',
  'friday-note.oss-cn-hangzhou.aliyuncs.com',
  'ezy-word2html-imgs.oss-cn-hangzhou.aliyuncs.com',
]);

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const candidate = path.resolve(ROOT, decoded.replace(/^[/\\]+/, ''));
  return candidate.startsWith(ROOT) ? candidate : null;
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
    return res.end();
  }
  if (parsed.pathname === '/health') return send(res, 200, JSON.stringify({ ok: true, service: 'ZhongYuToolBox' }), 'application/json; charset=utf-8');
  if (parsed.pathname === '/proxy/ping') return send(res, 200, 'pong');

  // ===== 领创 API 转发（解决 cloud.linspirer.com 无 CORS 头的问题） =====
  if (parsed.pathname === '/linspirer-api' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(chunks);
      const upstream = https.request('https://cloud.linspirer.com:883/public-interface.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': bodyBuf.length,
        },
        timeout: 30000,
      }, remote => {
        const respChunks = [];
        remote.on('data', c => respChunks.push(c));
        remote.on('end', () => {
          const respBuf = Buffer.concat(respChunks);
          res.writeHead(remote.statusCode || 502, {
            'Content-Type': remote.headers['content-type'] || 'text/html; charset=UTF-8',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(respBuf);
        });
      });
      upstream.on('timeout', () => upstream.destroy(new Error('linspirer api timeout')));
      upstream.on('error', () => {
        if (!res.headersSent) send(res, 502, 'Linspirer API request failed');
        else res.destroy();
      });
      upstream.write(bodyBuf);
      upstream.end();
    });
    return;
  }

  // ===== 领创静态资源转发（图标等） =====
  if (parsed.pathname.startsWith('/linspirer-res/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const subPath = parsed.pathname.substring('/linspirer-res/'.length);
    const target = new URL(`https://cloud.linspirer.com:883/${subPath}${parsed.search}`);
    const upstream = https.request(target, {
      method: req.method,
      headers: { Referer: 'http://cloud.linspirer.com:883/' },
      timeout: 15000,
    }, remote => {
      if (remote.statusCode !== 200) {
        remote.resume();
        return send(res, remote.statusCode || 502, 'Resource request failed');
      }
      res.writeHead(remote.statusCode, {
        'Content-Type': remote.headers['content-type'] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      });
      if (req.method === 'HEAD') { remote.resume(); return res.end(); }
      remote.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('resource timeout')));
    upstream.on('error', () => {
      if (!res.headersSent) send(res, 502, 'Resource request failed');
      else res.destroy();
    });
    upstream.end();
    return;
  }

  if (parsed.pathname === '/image-proxy' && (req.method === 'GET' || req.method === 'HEAD')) {
    let target;
    try {
      target = new URL(parsed.searchParams.get('url') || '');
      if (target.hostname === 'sxz.alicdn.zykj.org') {
        target = new URL(`https://ezy-sxz.oss-cn-hangzhou.aliyuncs.com${target.pathname}${target.search}`);
      }
      if (target.protocol === 'http:' && IMAGE_HOSTS.has(target.hostname)) target.protocol = 'https:';
    } catch {
      return send(res, 400, 'Invalid image URL');
    }
    if (target.protocol !== 'https:' || !IMAGE_HOSTS.has(target.hostname)) {
      return send(res, 403, 'Image host not allowed');
    }
    const upstream = https.request(target, {
      method: req.method,
      headers: { Referer: 'http://sxz.school.zykj.org/' },
      timeout: 12000,
    }, remote => {
      const contentType = remote.headers['content-type'] || '';
      if (remote.statusCode !== 200 || !contentType.toLowerCase().startsWith('image/')) {
        remote.resume();
        return send(res, remote.statusCode || 502, 'Image request failed');
      }
      res.writeHead(remote.statusCode, {
        'Content-Type': contentType,
        'Cache-Control': remote.headers['cache-control'] || 'public, max-age=300',
        ...(remote.headers['content-length'] ? { 'Content-Length': remote.headers['content-length'] } : {}),
      });
      if (req.method === 'HEAD') {
        remote.resume();
        return res.end();
      }
      remote.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Image request timed out')));
    upstream.on('error', () => {
      if (!res.headersSent) send(res, 502, 'Image request failed');
      else res.destroy();
    });
    upstream.end();
    return;
  }
  // The legacy upload page posts here. The actual PDF/image upload workflows still use
  // the production API and OSS credentials; this endpoint only gives a clear local response.
  if (parsed.pathname === '/upload' && req.method === 'POST') {
    let bytes = 0;
    req.on('data', chunk => { bytes += chunk.length; });
    req.on('end', () => send(res, 200, `已接收 ${bytes} 字节文件，后续资源保存由生产接口完成。`));
    return;
  }
  let file = safePath(parsed.pathname === '/' ? '/index.html' : parsed.pathname);
  if (!file) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ZhongYu ToolBox running at http://127.0.0.1:${PORT}/index.html`);
  console.log('Production API calls remain configured by the app; use one account session at a time.');
});
