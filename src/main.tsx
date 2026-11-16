import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/responsive.css';
import { registerUpdates } from './pwa/registerUpdates';
import { startVersionWatch } from './pwa/versionWatch';

// Register the service worker for the mandatory update flow. Fire-and-forget so
// it never blocks first paint. Off unless the build set VITE_SERVICE_WORKER=1,
// which the Cloudflare deploy does not; also no-ops in dev / unsupported /
// insecure contexts.
registerUpdates();

// Polls the deployed version stamp so an open tab notices it is running an old
// build. With the service worker off this is the only stale-tab detector.
startVersionWatch();

const container = document.getElementById('root');
createRoot(container as HTMLElement).render(<App />);
window.__showApp?.();
