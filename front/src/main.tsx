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
import { api, BACKEND_URL } from './api';
import { SessionProvider } from './store/data';
import './styles/global.css';
import './styles/layout.css';
import './styles/pages.css';
import './styles/wizard.css';
import './styles/chat.css';
import './styles/bank.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

// Данные живут на сервере — рисуем кабинет, когда они загружены
api.store
  .load()
  .then(() =>
    root.render(
      <React.StrictMode>
        <SessionProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SessionProvider>
      </React.StrictMode>,
    ),
  )
  .catch((e: unknown) =>
    root.render(
      <div className="server-down" role="alert">
        <h1>Сервер недоступен</h1>
        <p>{e instanceof Error ? e.message : `Не удалось подключиться к ${BACKEND_URL}`}</p>
        <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
          Повторить
        </button>
      </div>,
    ),
  );
