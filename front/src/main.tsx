import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/inter/cyrillic-400.css';
import '@fontsource/inter/cyrillic-500.css';
import '@fontsource/inter/cyrillic-600.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import App from './App';
import { connectBackend } from './api';
import { SessionProvider } from './store/data';
import './styles/global.css';
import './styles/layout.css';
import './styles/pages.css';
import './styles/wizard.css';
import './styles/chat.css';
import './styles/bank.css';

// Профили компаний приходят с бэкенда — рисуем кабинет, когда они уже в моках
void connectBackend().finally(() =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <SessionProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessionProvider>
    </React.StrictMode>,
  ),
);
