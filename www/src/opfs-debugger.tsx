import React, { useState } from "react";

interface Entry {
  name: string;
  size: number
}

const getfiles = async (directory: FileSystemDirectoryHandle, parentPath: string, foundFiles: Array<Entry>) => {
  for await (const entry of directory.values()) {
    let name = parentPath + entry.name;
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      foundFiles.push({ name, size: file.size });
    } else {
      name = name + "/";
      foundFiles.push({ name, size: 0 });
      await getfiles(entry, name, foundFiles);
    }
  }
}

export function OpfsDebugger() {
  const [files, setFiles] = useState<any>([]);

  const scanFiles = async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const foundFiles: Array<Entry> = [];
      await getfiles(root, "/", foundFiles);
      setFiles(foundFiles);
    } catch (err) {
      console.error("Failed to read OPFS:", err);
    }
  };

  const clearOpfs = async () => {
    const root = await navigator.storage.getDirectory();
    for await (const name of root.keys()) {
      await root.removeEntry(name, { recursive: true });
    }
    scanFiles();
  };

  return (
    <div style={{ padding: '15px', background: '#1e1e1e', color: '#fff', fontFamily: 'monospace', margin: '20px 0', borderRadius: '6px' }}>
      <h3 style={{ marginTop: 0, color: '#a855f7' }}>📦 Local OPFS File Inspector</h3>
      <div style={{ marginBottom: '10px' }}>
        <button onClick={scanFiles} style={{ marginRight: '10px', padding: '5px 10px', cursor: 'pointer' }}>🔄 Scan</button>
        <button onClick={clearOpfs} style={{ padding: '5px 10px', background: '#ef4444', color: 'white', border: 'none', cursor: 'pointer' }}>🗑️ Clear</button>
      </div>
      
      {files.length === 0 ? (
        <p style={{ color: '#888' }}>No files found on disk. Click Scan or write data.</p>
      ) : (
        <ul style={{ paddingLeft: '20px' }}>
          {files.map((f: any) => (
            <li key={f.name} style={{ color: '#4ade80' }}>
              📄 {f.name} <span style={{ color: '#888' }}>({f.size} bytes)</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
