/** Entry point. Mounts the router under whatever base path enlace gave us. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

// enlace serves the SPA at /lambdalab/ in production and Vite serves it at / in
// dev; import.meta.env.BASE_URL is the single source of truth for both.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
