const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Preserve original filename, but avoid collisions
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    const safeName = base.replace(/[^a-zA-Z0-9._\-\u00C0-\uFFFF]/g, '_');
    const timestamp = Date.now();
    const filename = fs.existsSync(path.join(UPLOADS_DIR, originalName))
      ? `${safeName}_${timestamp}${ext}`
      : originalName;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 } // 5 GB limit
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/files - List all uploaded files
app.get('/api/files', (req, res) => {
  try {
    const entries = fs.readdirSync(UPLOADS_DIR, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile())
      .map(e => {
        const filePath = path.join(UPLOADS_DIR, e.name);
        const stat = fs.statSync(filePath);
        const mimeType = mime.lookup(e.name) || 'application/octet-stream';
        return {
          name: e.name,
          size: stat.size,
          mtime: stat.mtime,
          mime: mimeType,
          type: getFileCategory(mimeType)
        };
      })
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// POST /api/upload - Upload one or more files
app.post('/api/upload', upload.array('files', 100), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  const uploaded = req.files.map(f => ({
    name: f.filename,
    size: f.size,
    mime: f.mimetype
  }));
  res.json({ uploaded });
});

// GET /api/download/:filename - Download a file
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!isPathSafe(filePath)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filePath, filename);
});

// GET /api/preview/:filename - Stream file for inline preview
app.get('/api/preview/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!isPathSafe(filePath)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const mimeType = mime.lookup(filename) || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range && mimeType.startsWith('video/')) {
    // Support range requests for video streaming
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
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

// DELETE /api/files/:filename - Delete a file
app.delete('/api/files/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!isPathSafe(filePath)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  fs.unlinkSync(filePath);
  res.json({ deleted: filename });
});

// Utility: prevent path traversal
function isPathSafe(filePath) {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(path.resolve(UPLOADS_DIR));
}

// Utility: categorize file by mime type
function getFileCategory(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/')) return 'text';
  return 'other';
}

// Get local network IP addresses
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

app.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('\n=== MyDrive - Personal File Sharing ===');
  console.log(`\nLocal:   http://localhost:${PORT}`);
  ips.forEach(ip => {
    console.log(`Network: http://${ip}:${PORT}`);
  });
  console.log('\nShare the Network URL with devices on the same WiFi/LAN.');
  console.log('=======================================\n');
});
