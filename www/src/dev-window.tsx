import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';

export function DevWindow({ children, onClose }: any) {
  const [container, setContainer] = useState(null);

  useEffect(() => {
    // Open a completely new blank browser window
    const win = window.open('', '', 'width=600,height=500,left=200,top=200');
    if (!win) return alert("Pop-up blocked! Please allow pop-ups for localhost.");

    // Inject standard styles into the new window
    win.document.title = "OPFS File Explorer Console";
    const body = win.document.body;
    body.style.background = "#121212";
    body.style.margin = "0";

    const div = win.document.createElement('div');
    body.appendChild(div);
    setContainer(div as any);

    win.addEventListener('beforeunload', onClose);

    return () => {
      win.close();
    };
  }, [onClose]);

  return container ? ReactDOM.createPortal(children, container) : null;
}
