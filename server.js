const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

app.use(express.json());

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Sanitize a relative folder path: strips traversal segments
function sanitizeFolderPath(p) {
  return (p || '').split(/[/\\]/).filter(seg => seg && seg !== '.' && seg !== '..').join('/');
}

// Prevent path traversal: resolved path must stay inside UPLOADS_DIR
function isPathSafe(filePath) {
  return path.resolve(filePath).startsWith(path.resolve(UPLOADS_DIR));
}

function getFileCategory(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/')) return 'text';
  return 'other';
}

// Multer storage — destination is determined by ?folder= query param
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = sanitizeFolderPath(req.query.folder || '');
    const destDir = path.join(UPLOADS_DIR, folder);
    if (!isPathSafe(destDir)) return cb(new Error('Forbidden'));
    fs.mkdirSync(destDir, { recursive: true });
    cb(null, destDir);
  },
  filename: (req, file, cb) => {
    const folder = sanitizeFolderPath(req.query.folder || '');
    const destDir = path.join(UPLOADS_DIR, folder);
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    const filename = fs.existsSync(path.join(destDir, originalName))
      ? `${base}_${Date.now()}${ext}`
      : originalName;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 } // 5 GB
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// ── GET /api/files?folder=path — list folders + files in a directory
app.get('/api/files', (req, res) => {
  const folder = sanitizeFolderPath(req.query.folder || '');
  const dirPath = path.join(UPLOADS_DIR, folder);

  if (!isPathSafe(dirPath)) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(dirPath)) return res.status(404).json({ error: 'Folder not found' });

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  const folders = entries
    .filter(e => e.isDirectory())
    .map(e => {
      const stat = fs.statSync(path.join(dirPath, e.name));
      return { name: e.name, isFolder: true, mtime: stat.mtime };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const files = entries
    .filter(e => e.isFile())
    .map(e => {
      const filePath = path.join(dirPath, e.name);
      const stat = fs.statSync(filePath);
      const mimeType = mime.lookup(e.name) || 'application/octet-stream';
      return {
        name: e.name,
        isFolder: false,
        size: stat.size,
        mtime: stat.mtime,
        mime: mimeType,
        type: getFileCategory(mimeType)
      };
    })
    .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

  res.json({ folders, files });
});

// ── POST /api/upload?folder=path — upload files into a folder
app.post('/api/upload', upload.array('files', 100), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  res.json({ uploaded: req.files.map(f => ({ name: f.filename, size: f.size })) });
});

// ── POST /api/folders — create a folder
app.post('/api/folders', (req, res) => {
  const parent = sanitizeFolderPath(req.body.parent || '');
  const name = (req.body.name || '').replace(/[/\\:*?"<>|]/g, '_').trim();
  if (!name) return res.status(400).json({ error: 'Invalid folder name' });

  const folderPath = path.join(UPLOADS_DIR, parent, name);
  if (!isPathSafe(folderPath)) return res.status(403).json({ error: 'Forbidden' });
  if (fs.existsSync(folderPath)) return res.status(409).json({ error: 'Folder already exists' });

  fs.mkdirSync(folderPath, { recursive: true });
  res.json({ created: name });
});

// ── DELETE /api/folders?path=rel/path — delete a folder recursively
app.delete('/api/folders', (req, res) => {
  const rel = sanitizeFolderPath(req.query.path || '');
  if (!rel) return res.status(400).json({ error: 'Path required' });

  const folderPath = path.join(UPLOADS_DIR, rel);
  if (!isPathSafe(folderPath)) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(folderPath)) return res.status(404).json({ error: 'Folder not found' });

  fs.rmSync(folderPath, { recursive: true, force: true });
  res.json({ deleted: rel });
});

// ── GET /api/download/:filename?folder=path — download a file
app.get('/api/download/:filename', (req, res) => {
  const folder = sanitizeFolderPath(req.query.folder || '');
  const filePath = path.join(UPLOADS_DIR, folder, req.params.filename);

  if (!isPathSafe(filePath)) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  res.download(filePath, req.params.filename);
});

// ── GET /api/preview/:filename?folder=path — stream/preview a file
app.get('/api/preview/:filename', (req, res) => {
  const folder = sanitizeFolderPath(req.query.folder || '');
  const filename = req.params.filename;
  const filePath = path.join(UPLOADS_DIR, folder, filename);

  if (!isPathSafe(filePath)) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const mimeType = mime.lookup(filename) || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range && mimeType.startsWith('video/')) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mimeType
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ── DELETE /api/files/:filename?folder=path — delete a file
app.delete('/api/files/:filename', (req, res) => {
  const folder = sanitizeFolderPath(req.query.folder || '');
  const filePath = path.join(UPLOADS_DIR, folder, req.params.filename);

  if (!isPathSafe(filePath)) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  fs.unlinkSync(filePath);
  res.json({ deleted: req.params.filename });
});

// Get local network IPs
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

app.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('\n=== MyDrive - Personal File Sharing ===');
  console.log(`\nLocal:   http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`Network: http://${ip}:${PORT}`));
  console.log('\nShare the Network URL with devices on the same WiFi/LAN.');
  console.log('=======================================\n');
});
