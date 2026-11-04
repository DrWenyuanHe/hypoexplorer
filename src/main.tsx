import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/responsive.css';
import { registerUpdates } from './pwa/registerUpdates';
import { startVersionWatch } from './pwa/versionWatch';

// Register the service worker for the mandatory update flow. Fire-and-forget so
// it never blocks first paint; no-ops in dev / unsupported / insecure contexts.
registerUpdates();

// Second, independent detector: polls the deployed version stamp so a tab whose
// service worker is absent or wedged still notices it is running an old build.
startVersionWatch();

const container = document.getElementById('root');
createRoot(container as HTMLElement).render(<App />);
window.__showApp?.();
