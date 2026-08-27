import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { TooltipProvider } from './components/ui/overlays.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider delayDuration={250}>
            <App />
            <Toaster
              position="bottom-right"
              closeButton
              toastOptions={{
                classNames: {
                  toast: 'border border-border bg-card text-card-foreground text-xs shadow-panel',
                  description: 'text-muted-foreground',
                  actionButton: 'bg-primary text-primary-foreground',
                },
              }}
            />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
