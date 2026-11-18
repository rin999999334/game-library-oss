import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import AdminApp from './AdminApp';
import AdminAccess from './AdminAccess';
createRoot(document.getElementById('root')!).render(<StrictMode><AdminAccess><AdminApp/></AdminAccess></StrictMode>);
