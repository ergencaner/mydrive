# MyDrive

Personal file sharing platform for your local network. Upload files from any device and access them from any other device on the same WiFi.

## Setup

1. Install **Node.js v16+** if not already installed: https://nodejs.org

2. In the project folder, install dependencies:

   ```bash
   npm install
   ```

3. Start the server:

   ```bash
   npm start
   ```

4. Open the URL printed in the terminal on any device connected to the same WiFi/LAN:

   ```
   Network: http://192.168.x.x:3000   ← open this on your phone, tablet, etc.
   ```

> **Tip:** After the first install, `npm start` will automatically run `npm install` for you, so you never need to run it manually again.

## Features

- Drag & drop or tap to upload photos, videos, documents (up to 5 GB each)
- Live upload progress per file
- Image & video previews inline
- Grid and list views with search and category filters
- Download or delete any file
- Works across all devices on the same network (Mac, iPhone, Android, Windows…)

## Folder structure

```
mydrive/
├── server.js        ← Express API server
├── package.json
├── public/
│   └── index.html   ← Frontend (single page)
└── uploads/         ← Created automatically; your files are stored here
```
